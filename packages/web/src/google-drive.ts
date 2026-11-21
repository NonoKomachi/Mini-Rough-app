/**
 * Google Driveへのパレット/設定/プロジェクト自動保存の同期。サーバーは持たず、ブラウザから
 * Google Identity Services(サインイン)・Drive API v3(REST、fetch)・Picker API(フォルダ変更)を
 * 直接呼ぶだけ — バックエンドを自前で用意する必要がない構成(ユーザー要望に基づく設計)。
 *
 * スコープは`drive.file`(+`userinfo.email`)のみ — Googleの「機密スコープ」審査が不要な
 * 非機密スコープで、アプリ自身が作成/選択したファイル以外には触れない。
 *
 * ログイン情報(メールアドレス)とフォルダ(id/name)はlocalStorageにキャッシュし、ブラウザを
 * 閉じても覚えている。アクセストークン自体は(有効期限が短く、漏れても影響が限定的な性質のため)
 * メモリ上にのみ保持し、再読み込みのたびにGoogle側へ無言のトークン再取得(サイレント更新)を試みる
 * — それに失敗した場合だけ「再ログインが必要」状態になる(第三者Cookieをブロックするブラウザ等)。
 */

export interface DriveAccountState {
  /** アカウント+フォルダの組がキャッシュされているか(=連携済みとして表示するか)。有効な
   * アクセストークンを今この瞬間持っているかどうかとは別 — トークンは`needsReauth`で示す。 */
  connected: boolean;
  /** サイレント更新に失敗した状態 — 再ログインボタンを出す合図。 */
  needsReauth: boolean;
  email: string | null;
  folderId: string | null;
  folderName: string | null;
}

interface StoredAccount {
  email: string;
  folderId: string;
  folderName: string;
}

interface TokenClient {
  requestAccessToken(options?: { prompt?: string }): void;
  callback: (resp: TokenResponse) => void;
}

interface TokenResponse {
  access_token?: string;
  expires_in?: number;
  error?: string;
}

interface PickerBuilder {
  addView(view: DocsView): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setCallback(cb: (data: { action: string; docs?: { id: string; name: string }[] }) => void): PickerBuilder;
  build(): { setVisible(visible: boolean): void };
}

interface DocsView {
  setSelectFolderEnabled(v: boolean): DocsView;
  setIncludeFolders(v: boolean): DocsView;
}

// Google Identity Services / gapi(Picker用)はscriptタグで動的に読み込むグローバル —
// 使う範囲だけ最小限に型付けする(project-file-handle.tsのFile System Access API宣言と同じ方針)。
declare global {
  interface Window {
    google?: {
      accounts: {
        oauth2: {
          initTokenClient(config: { client_id: string; scope: string; callback: (resp: TokenResponse) => void }): TokenClient;
          revoke(token: string, done?: () => void): void;
        };
      };
      // Picker APIは列挙/ビルダー等の表面が広く、@types未導入のためここだけ型を割り切る。
      picker: {
        PickerBuilder: new () => PickerBuilder;
        DocsView: new (viewId: unknown) => DocsView;
        ViewId: { FOLDERS: unknown };
        Action: { PICKED: string; CANCEL: string };
      };
    };
    gapi?: {
      load(api: string, options: { callback: () => void; onerror?: () => void }): void;
    };
  }
}

// ビルド時に埋め込まれる環境変数(packages/web/.env、コミットされない — .env.example参照)。
// ローカル開発はvite devが.envを読み、GitHub PagesはCIがリポジトリのSecretsから注入する
// (.github/workflows/deploy-pages.yml参照)。
const CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;
const API_KEY = import.meta.env.VITE_GOOGLE_API_KEY;
const SCOPE = "https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/userinfo.email";

/** クライアントID/APIキーが未設定(ローカルに.envが無い、Secrets未登録のビルド等)でもアプリ
 * 本体は普通に動くようにする — Drive機能だけを「使えない」扱いにする。 */
export function isDriveConfigured(): boolean {
  return !!CLIENT_ID && !!API_KEY;
}
const APP_FOLDER_NAME = "ミニラフ小町";
const STORAGE_KEY = "mini-rough-drive-account";

function loadStored(): StoredAccount | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as StoredAccount) : null;
  } catch {
    return null;
  }
}

function saveStored(account: StoredAccount | null): void {
  try {
    if (account) localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // localStorageが使えなくても致命的ではない(次回起動時に再連携が必要になるだけ)。
  }
}

let stored: StoredAccount | null = loadStored();
let accessToken: string | null = null;
let tokenExpiresAt = 0;
let needsReauth = false;
let tokenClient: TokenClient | null = null;
let scriptsLoadedPromise: Promise<void> | null = null;

type StateListener = (state: DriveAccountState) => void;
const listeners = new Set<StateListener>();

function currentState(): DriveAccountState {
  return {
    connected: !!stored,
    needsReauth,
    email: stored?.email ?? null,
    folderId: stored?.folderId ?? null,
    folderName: stored?.folderName ?? null
  };
}

function notify(): void {
  const state = currentState();
  for (const listener of listeners) listener(state);
}

export function onDriveStateChange(listener: StateListener): void {
  listeners.add(listener);
}

export function getDriveState(): DriveAccountState {
  return currentState();
}

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`スクリプトの読み込みに失敗しました: ${src}`));
    document.head.appendChild(script);
  });
}

/** GIS(サインイン用)は常に必要なので先に読み込む。gapi+Picker本体は実際に「フォルダを変更」が
 * 呼ばれるまで遅延させたいところだが、どちらも軽量なスクリプトなので単純化のため一括で読み込む。 */
function ensureScriptsLoaded(): Promise<void> {
  if (!scriptsLoadedPromise) {
    scriptsLoadedPromise = Promise.all([loadScript("https://accounts.google.com/gsi/client"), loadScript("https://apis.google.com/js/api.js")]).then(
      () =>
        new Promise<void>((resolve, reject) => {
          window.gapi!.load("picker", { callback: resolve, onerror: () => reject(new Error("Google Picker APIの読み込みに失敗しました")) });
        })
    );
  }
  return scriptsLoadedPromise;
}

function getTokenClient(): TokenClient {
  if (!tokenClient) {
    tokenClient = window.google!.accounts.oauth2.initTokenClient({ client_id: CLIENT_ID, scope: SCOPE, callback: () => {} });
  }
  return tokenClient;
}

/** `prompt: "consent"`で明示的なサインイン(同意画面が出る)、`prompt: ""`でサイレント更新
 * (既に許可済みなら画面を出さずに新しいトークンだけ受け取る、失敗することもある)。 */
function requestToken(prompt: string): Promise<{ accessToken: string; email: string } | null> {
  return ensureScriptsLoaded().then(
    () =>
      new Promise((resolve) => {
        const client = getTokenClient();
        client.callback = async (resp) => {
          if (resp.error || !resp.access_token) {
            resolve(null);
            return;
          }
          accessToken = resp.access_token;
          tokenExpiresAt = Date.now() + (resp.expires_in ?? 3600) * 1000 - 60_000;
          const email = await fetchUserEmail(accessToken);
          resolve({ accessToken, email });
        };
        client.requestAccessToken({ prompt });
      })
  );
}

async function fetchUserEmail(token: string): Promise<string> {
  try {
    const res = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return "";
    const data = (await res.json()) as { email?: string };
    return data.email ?? "";
  } catch {
    return "";
  }
}

/** サイレント更新(requestToken(""))の実行中リクエスト — google.accounts.oauth2のトークン
 * クライアントはcallbackを1個しか持てないため、並行して複数回呼ぶと先に待っていた側の
 * callbackを後発の呼び出しが上書きしてしまい、先に待っていたPromiseが永遠に解決しなくなる
 * (起動時にtryAutoRestoreOnStartupとパレット/設定の同期が同時にトークンを要求しうるため、
 * 実際に起こりうる)。進行中なら同じPromiseを共有させて直列化する。 */
let pendingSilentRefresh: Promise<string | null> | null = null;

/** 有効なアクセストークンを返す(必要ならサイレント更新する)。取得できなければ
 * `needsReauth`を立てて通知し、nullを返す。 */
async function ensureFreshToken(): Promise<string | null> {
  if (!stored) return null;
  if (accessToken && Date.now() < tokenExpiresAt) return accessToken;
  if (pendingSilentRefresh) return pendingSilentRefresh;
  pendingSilentRefresh = (async () => {
    const result = await requestToken("");
    if (!result) {
      needsReauth = true;
      notify();
      return null;
    }
    needsReauth = false;
    return result.accessToken;
  })().finally(() => {
    pendingSilentRefresh = null;
  });
  return pendingSilentRefresh;
}

async function findOrCreateAppFolder(): Promise<{ id: string; name: string } | null> {
  const token = accessToken;
  if (!token) return null;
  const listQ = encodeURIComponent(`mimeType='application/vnd.google-apps.folder' and name='${APP_FOLDER_NAME}' and trashed=false`);
  const listRes = await fetch(`https://www.googleapis.com/drive/v3/files?q=${listQ}&fields=files(id,name)`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  if (listRes.ok) {
    const data = (await listRes.json()) as { files?: { id: string; name: string }[] };
    if (data.files && data.files.length > 0) return data.files[0];
  }
  const createRes = await fetch("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ name: APP_FOLDER_NAME, mimeType: "application/vnd.google-apps.folder" })
  });
  if (!createRes.ok) return null;
  const created = (await createRes.json()) as { id: string; name: string };
  return created;
}

/**
 * 初回連携: サインイン→「ミニラフ小町」フォルダをDrive上に探す(無ければ自動作成、
 * ユーザー要望の「ログイン時に自動で決める」に対応)→キャッシュに保存。
 * 呼び出し元(main.ts)は成功後、現在のパレット/設定/プロジェクトをこの関数が返すfolderへ
 * シード(無ければ書き込み、あれば読み込んで反映)するところまで担当する。
 */
export async function connectDrive(): Promise<{ ok: true } | { ok: false; reason: string }> {
  if (!isDriveConfigured()) return { ok: false, reason: "Google DriveのクライアントID/APIキーが設定されていません" };
  const result = await requestToken("consent");
  if (!result) return { ok: false, reason: "サインインがキャンセルされたか失敗しました" };
  const folder = await findOrCreateAppFolder();
  if (!folder) return { ok: false, reason: "Drive上のフォルダ作成/検索に失敗しました" };
  stored = { email: result.email, folderId: folder.id, folderName: folder.name };
  needsReauth = false;
  saveStored(stored);
  notify();
  return { ok: true };
}

/** 再ログインが必要(needsReauth)な状態からの復帰専用 — フォルダ選び直しは不要、トークンだけ
 * 取り直す。 */
export async function reauthorizeDrive(): Promise<boolean> {
  if (!stored) return false;
  const result = await requestToken("consent");
  if (!result) return false;
  needsReauth = false;
  notify();
  return true;
}

export function disconnectDrive(): void {
  if (accessToken && window.google?.accounts?.oauth2?.revoke) {
    window.google.accounts.oauth2.revoke(accessToken, () => {});
  }
  stored = null;
  accessToken = null;
  tokenExpiresAt = 0;
  needsReauth = false;
  saveStored(null);
  notify();
}

/** 起動時、ページを開くたびにこれを呼ぶ — キャッシュされたアカウントがあれば無言でトークンの
 * サイレント更新を試みる(ユーザー操作無しでも自動同期が働くように)。失敗してもUIに
 * needsReauthとして反映されるだけで、ここでは例外を投げない。 */
export async function trySilentReconnect(): Promise<void> {
  if (!stored) return;
  await ensureFreshToken();
}

/** フォルダを選び直す(Picker)。「ログイン時に自動で決めるが後から変更可能」のうち
 * 「後から変更」側を担当する。 */
export async function changeDriveFolder(): Promise<boolean> {
  if (!stored) return false;
  const token = await ensureFreshToken();
  if (!token) return false;
  await ensureScriptsLoaded();
  return new Promise((resolve) => {
    const google = window.google!;
    const view = new google.picker.DocsView(google.picker.ViewId.FOLDERS).setSelectFolderEnabled(true).setIncludeFolders(true);
    const picker = new google.picker.PickerBuilder()
      .addView(view)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .setCallback((data) => {
        if (data.action === google.picker.Action.PICKED && data.docs?.[0]) {
          const doc = data.docs[0];
          stored = { ...stored!, folderId: doc.id, folderName: doc.name };
          saveStored(stored);
          notify();
          resolve(true);
        } else if (data.action === google.picker.Action.CANCEL) {
          resolve(false);
        }
      })
      .build();
    picker.setVisible(true);
  });
}

async function findFileInFolder(folderId: string, filename: string, token: string): Promise<string | null> {
  const q = encodeURIComponent(`'${folderId}' in parents and name='${filename}' and trashed=false`);
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id)`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  const data = (await res.json()) as { files?: { id: string }[] };
  return data.files?.[0]?.id ?? null;
}

/** `filename`をフォルダ内に新規作成/上書きする。同名ファイルが既にあればPATCH(上書き)、
 * 無ければPOST(新規作成)。未連携/トークン取得失敗時はfalseを返すだけで例外は投げない —
 * 自動同期は「できれば」で良く、失敗のたびにUIへエラーを出す必要は無いため。 */
export async function uploadToDrive(filename: string, content: string, mimeType: string): Promise<boolean> {
  if (!stored) return false;
  const token = await ensureFreshToken();
  if (!token) return false;
  const existingId = await findFileInFolder(stored.folderId, filename, token);
  const boundary = "mini_rough_sync_boundary";
  const metadata = existingId ? {} : { name: filename, parents: [stored.folderId], mimeType };
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
    `--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n${content}\r\n` +
    `--${boundary}--`;
  const url = existingId
    ? `https://www.googleapis.com/upload/drive/v3/files/${existingId}?uploadType=multipart`
    : "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart";
  try {
    const res = await fetch(url, {
      method: existingId ? "PATCH" : "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": `multipart/related; boundary=${boundary}` },
      body
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** `filename`の内容を読む。未連携/未発見/失敗はnull(呼び出し元は「Driveには無かった」と
 * 「そもそも繋がっていない」を区別する必要が無いので一律null)。 */
export async function downloadFromDrive(filename: string): Promise<string | null> {
  if (!stored) return null;
  const token = await ensureFreshToken();
  if (!token) return null;
  try {
    const fileId = await findFileInFolder(stored.folderId, filename, token);
    if (!fileId) return null;
    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}
