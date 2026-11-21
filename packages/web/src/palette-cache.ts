import { NamedPalette } from "./color-picker";

const STORAGE_KEY = "mini-rough-palettes-cache";

interface CachedPalettes {
  palettes: NamedPalette[];
  activePaletteId: string;
}

/** 名前付きパレット(一時パレットではない方)のブラウザ単位キャッシュ。プロジェクトファイル
 * (.mrk)には含めない — パレットは「今開いているプロジェクト」ではなく「このブラウザ/この
 * アカウント」に属する設定という扱いにする(ユーザー指摘: 以前はファイルごとに別のパレットに
 * なってしまっていた)。Firebaseにサインインしている間はクラウド側(firebase-sync.ts)が
 * 真実の情報源になり、このキャッシュは未サインイン時のフォールバック、およびサインイン中でも
 * オフラインで使えるよう最新状態を保持しておく保険として働く。 */
export function loadCachedPalettes(): CachedPalettes | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as CachedPalettes) : null;
  } catch {
    return null;
  }
}

export function saveCachedPalettes(palettes: NamedPalette[], activePaletteId: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ palettes, activePaletteId }));
  } catch {
    // ブラウザがlocalStorageを使えない場合は諦める(このセッション中はメモリ上の値のみ有効)。
  }
}
