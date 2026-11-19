/** プロジェクトを再起動後も失わないための永続化層。2つの独立した仕組みを持つ:
 *
 * 1. 実ファイルのハンドル(FileSystemFileHandle) — 「保存」「開く」でFile System Access API
 *    (showOpenFilePicker/showSaveFilePicker)を使った場合に、そのファイルへの参照を覚えておく。
 *    起動時にそのファイルへ無言で書き込み/読み込みできるが、対応ブラウザ(主にChromium系)限定、
 *    かつ権限(queryPermission)が残っている場合限定で働く。
 * 2. プレーンなJSONスナップショットのキャッシュ — 権限もFile System Access API対応も不要で、
 *    どのブラウザでも常に働く「保険」。実ファイルを一度も保存/開いていない状態でも、一定周期の
 *    自動保存とリロード後の復元が効くようにするための仕組み(1だけだと、最初に一度手動で
 *    保存/開くをするまで自動保存/自動復元が何も起きない)。
 *
 * どちらもlocalStorageには入れられない(1は構造化クローン可能だが文字列化できない、2は
 * サイズが大きくなりがちでlocalStorageの容量制限に収まらない可能性がある)ため、IndexedDBに
 * 保存する。対応していないブラウザ(Firefox等)やプライベートブラウジングでは、自動保存/自動
 * 復元が単に働かないだけにする(例外を投げて他の機能を止めない)。
 *
 * File System Access API(showOpenFilePicker/showSaveFilePicker、および
 * FileSystemHandleのqueryPermission/requestPermission)はTS 5.9のlib.dom.d.tsにまだ
 * 含まれていない(または不完全)ため、実際に使うメソッドだけを持つ最小限の型を自前で定義する
 * (packages/web/src/main.tsのshowDirectoryPicker用の宣言と同じ方針)。 */
export interface ProjectFileHandleLike {
  readonly name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<{ write(data: string | Uint8Array): Promise<void>; close(): Promise<void> }>;
  queryPermission(options?: { mode?: "read" | "readwrite" }): Promise<"granted" | "denied" | "prompt">;
  requestPermission(options?: { mode?: "read" | "readwrite" }): Promise<"granted" | "denied" | "prompt">;
}

declare global {
  interface Window {
    showOpenFilePicker?: (options?: {
      types?: { description?: string; accept: Record<string, string[]> }[];
    }) => Promise<ProjectFileHandleLike[]>;
    showSaveFilePicker?: (options?: {
      suggestedName?: string;
      types?: { description?: string; accept: Record<string, string[]> }[];
    }) => Promise<ProjectFileHandleLike>;
  }
}

const DB_NAME = "mini-rough-db";
const STORE_HANDLES = "handles";
const STORE_SNAPSHOT = "snapshot";
const HANDLE_KEY = "lastProjectFile";
const SNAPSHOT_KEY = "latest";

// v1は"handles"ストアのみで作られていたセッションが既に存在しうるため、v2で"snapshot"を
// 追加する側も既存ストアを再作成しない(contains チェック)ようにしておく。
const DB_VERSION = 2;

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_HANDLES)) req.result.createObjectStore(STORE_HANDLES);
      if (!req.result.objectStoreNames.contains(STORE_SNAPSHOT)) req.result.createObjectStore(STORE_SNAPSHOT);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function isFileSystemAccessSupported(): boolean {
  return typeof window.showOpenFilePicker === "function" && typeof window.showSaveFilePicker === "function" && "indexedDB" in window;
}

export async function getStoredProjectFileHandle(): Promise<ProjectFileHandleLike | undefined> {
  if (!isFileSystemAccessSupported()) return undefined;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_HANDLES, "readonly");
      const req = tx.objectStore(STORE_HANDLES).get(HANDLE_KEY);
      req.onsuccess = () => resolve(req.result as ProjectFileHandleLike | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export async function setStoredProjectFileHandle(handle: ProjectFileHandleLike): Promise<void> {
  if (!isFileSystemAccessSupported()) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_HANDLES, "readwrite");
      tx.objectStore(STORE_HANDLES).put(handle, HANDLE_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // 記憶できなくても手動の保存/読み込み自体は成立するので、ここで失敗を伝播させない。
  }
}

/** 自動保存/起動時の自動復元用の「保険」スナップショット。File System Access APIの対応・権限に
 * 関係なく常に読み書きできる。 */
export async function getCachedProjectSnapshot(): Promise<string | undefined> {
  if (!("indexedDB" in window)) return undefined;
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SNAPSHOT, "readonly");
      const req = tx.objectStore(STORE_SNAPSHOT).get(SNAPSHOT_KEY);
      req.onsuccess = () => resolve(req.result as string | undefined);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export async function setCachedProjectSnapshot(json: string): Promise<void> {
  if (!("indexedDB" in window)) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SNAPSHOT, "readwrite");
      tx.objectStore(STORE_SNAPSHOT).put(json, SNAPSHOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // キャッシュできなくても保存自体(ファイル/ダウンロード)は成立するので伝播させない。
  }
}

/** 「開く」「新規」「保存」など、実ファイル側に状態が確定した/白紙に戻ったタイミングで呼ぶ —
 * 古いキャッシュが残ったままだと、次回起動時にその古い内容を誤って自動復元してしまう。 */
export async function clearCachedProjectSnapshot(): Promise<void> {
  if (!("indexedDB" in window)) return;
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_SNAPSHOT, "readwrite");
      tx.objectStore(STORE_SNAPSHOT).delete(SNAPSHOT_KEY);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // 消せなくても実害は小さい(次回起動時に古いキャッシュが出てくるだけ)ので伝播させない。
  }
}
