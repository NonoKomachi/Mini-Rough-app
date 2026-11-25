/**
 * Firebase Authentication(Googleサインイン)+ Firestore(データベース)によるパレット/設定/
 * プロジェクトの自動同期。Google Drive版(廃止)と違い、Firebaseのトークン更新は
 * `securetoken.googleapis.com`経由でブラウザだけで安全に行える設計のため、サインインは
 * 最初の1回だけで良い — ページを開き直しても/時間が経っても、ポップアップ無しで
 * サインイン状態が維持される(ユーザー指摘への対応: Google Drive版はアクセストークンが
 * 約1時間しか保たず、サーバーを持たない構成では自動更新のたびにポップアップがチラつく
 * 問題があった)。
 */
import { initializeApp, FirebaseApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut, onAuthStateChanged, Auth, User } from "firebase/auth";
import { getFirestore, doc, getDoc, setDoc, deleteDoc, Firestore } from "firebase/firestore";

export interface SyncState {
  /** Firebaseの設定(.env)が揃っているか。 */
  configured: boolean;
  signedIn: boolean;
  email: string | null;
  displayName: string | null;
}

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID
};

export function isSyncConfigured(): boolean {
  return Object.values(firebaseConfig).every((v) => !!v);
}

let app: FirebaseApp | null = null;
let auth: Auth | null = null;
let db: Firestore | null = null;
let currentUser: User | null = null;
// onAuthStateChangedの初回コールバック(前回サインインしていたセッションの復元を含む)が
// 届くまで解決しないPromise。起動直後はFirebaseの初期化自体が非同期なため、ここを待たずに
// getSyncState().signedInを読むと「実際はサインイン済みなのに、まだ復元が終わっていないだけで
// falseに見える」瞬間を拾ってしまう(起動時のクラウドからの自動読み込みが race で
// 空振りする不具合の原因だった)。 */
let authReadyResolve: (() => void) | null = null;
let authReadyPromise: Promise<void> = Promise.resolve();

type StateListener = (state: SyncState) => void;
const listeners = new Set<StateListener>();

function currentState(): SyncState {
  return {
    configured: isSyncConfigured(),
    signedIn: !!currentUser,
    email: currentUser?.email ?? null,
    displayName: currentUser?.displayName ?? null
  };
}

function notify(): void {
  const state = currentState();
  for (const listener of listeners) listener(state);
}

export function onSyncStateChange(listener: StateListener): void {
  listeners.add(listener);
}

export function getSyncState(): SyncState {
  return currentState();
}

/** サインイン状態の初回判定(前回セッションの復元、またはサインインしていないことの確定)が
 * 終わるまで待つ。起動直後にgetSyncState().signedInを読む前に必ずこれをawaitすること —
 * 設定(.env)が無い場合は即座に解決する。 */
export function waitForAuthReady(): Promise<void> {
  if (!isSyncConfigured()) return Promise.resolve();
  ensureInitialized();
  return authReadyPromise;
}

/** 設定(.env)が揃っている場合だけ、モジュール読み込み時に一度だけ初期化する。
 * `onAuthStateChanged`はFirebaseが自前でlocalStorage/IndexedDBに保持しているセッションを
 * 読み、サインイン済みなら(ポップアップ無しで)すぐにリスナーへ反映する — これが
 * Google Drive版との決定的な違い(トークン更新をアプリ側で管理する必要がない)。 */
function ensureInitialized(): { auth: Auth; db: Firestore } | null {
  if (!isSyncConfigured()) return null;
  if (!app) {
    app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    db = getFirestore(app);
    authReadyPromise = new Promise((resolve) => {
      authReadyResolve = resolve;
    });
    onAuthStateChanged(auth, (user) => {
      currentUser = user;
      notify();
      authReadyResolve?.();
      authReadyResolve = null;
    });
  }
  return { auth: auth!, db: db! };
}
// configuredなら起動時に即座に初期化しておく(呼び出し待ちにしない — onAuthStateChangedの
// 初回コールバックをできるだけ早く発火させ、UIの「未サインイン」表示が一瞬だけ出て
// すぐ「サインイン済み」に切り替わるちらつきを減らすため)。
ensureInitialized();

export async function signIn(): Promise<{ ok: true } | { ok: false; reason: string }> {
  const ctx = ensureInitialized();
  if (!ctx) return { ok: false, reason: "Firebaseの設定が見つかりません" };
  try {
    await signInWithPopup(ctx.auth, new GoogleAuthProvider());
    return { ok: true };
  } catch (err) {
    console.error(err);
    return { ok: false, reason: err instanceof Error ? err.message : "不明なエラー" };
  }
}

export function signOutUser(): void {
  if (!auth) return;
  void signOut(auth);
}

async function pushDoc(docName: string, data: object): Promise<boolean> {
  const ctx = ensureInitialized();
  if (!ctx || !currentUser) return false;
  try {
    await setDoc(doc(ctx.db, "users", currentUser.uid, "sync", docName), data);
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

async function pullDoc<T>(docName: string): Promise<T | null> {
  const ctx = ensureInitialized();
  if (!ctx || !currentUser) return null;
  try {
    const snap = await getDoc(doc(ctx.db, "users", currentUser.uid, "sync", docName));
    return snap.exists() ? (snap.data() as T) : null;
  } catch (err) {
    console.error(err);
    return null;
  }
}

export interface SyncedPalettes {
  palettes: { id: string; name: string; swatches: string[] }[];
  activePaletteId: string;
}

export function pushPalettes(data: SyncedPalettes): Promise<boolean> {
  return pushDoc("palettes", data);
}

export function pullPalettes(): Promise<SyncedPalettes | null> {
  return pullDoc<SyncedPalettes>("palettes");
}

export function pushSettings(settings: object): Promise<boolean> {
  return pushDoc("settings", settings);
}

export function pullSettings<T>(): Promise<T | null> {
  return pullDoc<T>("settings");
}

/** プロジェクト全体の自動保存JSON。Firestoreの1ドキュメントは最大1MiBまでのため、レイヤー数が
 * 多い/大きい完成サイズのプロジェクトでは単一ドキュメントに収まらず、保存が常に(無言で)
 * 失敗していた(ユーザー報告: 「今すぐ保存」で初めて失敗が可視化された)。Cloud Storageへの
 * 切り替えも検討したが、無料プラン(Spark)では新規にStorageを有効化できず有料プランへの
 * アップグレードを求められるため見送り — 代わりに、JSON文字列を複数のFirestoreドキュメントに
 * 分割して保存する(無料プランのままで上限を回避できる)。 */
const PROJECT_CHUNK_SIZE = 900_000; // 900,000文字。Firestoreの1MiB(=1,048,576バイト)上限に
// 対して、ドキュメント自体のオーバーヘッド分の余裕を持たせた値(チャンクの中身はbase64/JSON
// なので1文字=1バイト相当)。
const PROJECT_CHUNK_PREFIX = "project_chunk_";

function chunkDocName(index: number): string {
  return `${PROJECT_CHUNK_PREFIX}${index}`;
}

export async function pushProject(json: string): Promise<boolean> {
  const ctx = ensureInitialized();
  if (!ctx || !currentUser) return false;
  const uid = currentUser.uid;
  try {
    // 前回保存時のチャンク数を先に読んでおく — 今回がそれより少ない場合、末尾に古いチャンクが
    // 残ったままだとpullProject側で余計な文字列まで連結してしまうため、後で削除する。
    const prevManifestSnap = await getDoc(doc(ctx.db, "users", uid, "sync", "project"));
    const prevChunkCount = (prevManifestSnap.data() as { chunkCount?: number } | undefined)?.chunkCount ?? 0;

    const chunks: string[] = [];
    for (let i = 0; i < json.length; i += PROJECT_CHUNK_SIZE) {
      chunks.push(json.slice(i, i + PROJECT_CHUNK_SIZE));
    }
    if (chunks.length === 0) chunks.push(""); // 空のプロジェクトでも1個は書く(0チャンクだと判別できない)。

    await Promise.all(chunks.map((chunk, i) => setDoc(doc(ctx.db, "users", uid, "sync", chunkDocName(i)), { data: chunk })));
    // マニフェスト(チャンク数)はチャンク本体を書き終えた後に更新する — 途中状態をpullProject側に
    // 読まれても、マニフェストが古いチャンク数のままなら新しいチャンクはまだ参照されない。
    await setDoc(doc(ctx.db, "users", uid, "sync", "project"), { chunkCount: chunks.length });
    // 前回より減った分の古いチャンクを後片付け(マニフェスト更新後なので、残っていても
    // pullProject側からはもう参照されず実害は無い)。
    const staleIndexes = Array.from({ length: Math.max(0, prevChunkCount - chunks.length) }, (_, i) => chunks.length + i);
    await Promise.all(staleIndexes.map((i) => deleteDoc(doc(ctx.db, "users", uid, "sync", chunkDocName(i)))));
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

export async function pullProject(): Promise<string | null> {
  const ctx = ensureInitialized();
  if (!ctx || !currentUser) return null;
  const uid = currentUser.uid;
  try {
    const manifestSnap = await getDoc(doc(ctx.db, "users", uid, "sync", "project"));
    if (!manifestSnap.exists()) return null;
    const chunkCount = (manifestSnap.data() as { chunkCount?: number }).chunkCount ?? 0;
    if (chunkCount <= 0) return null;
    const chunkSnaps = await Promise.all(
      Array.from({ length: chunkCount }, (_, i) => getDoc(doc(ctx.db, "users", uid, "sync", chunkDocName(i))))
    );
    return chunkSnaps.map((snap) => (snap.data() as { data?: string } | undefined)?.data ?? "").join("");
  } catch (err) {
    console.error(err);
    return null;
  }
}
