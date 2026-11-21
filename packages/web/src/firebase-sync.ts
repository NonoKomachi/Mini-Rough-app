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
import { getFirestore, doc, getDoc, setDoc, Firestore } from "firebase/firestore";

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
    onAuthStateChanged(auth, (user) => {
      currentUser = user;
      notify();
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

/** プロジェクト全体の自動保存JSON。Firestoreの1ドキュメントは最大1MiBまでのため、
 * レイヤー数が多い/大きい完成サイズのプロジェクトでは書き込みに失敗することがある —
 * その場合もpushDocがfalseを返すだけで例外は外に出ない(ローカルのIndexedDB自動保存は
 * この制限を受けないため、失われるのはクロスデバイス同期の方だけ)。 */
export function pushProject(json: string): Promise<boolean> {
  return pushDoc("project", { json });
}

export async function pullProject(): Promise<string | null> {
  const data = await pullDoc<{ json: string }>("project");
  return data?.json ?? null;
}
