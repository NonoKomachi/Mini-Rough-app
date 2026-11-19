export type DefaultLoadSize = "mini" | "final";

export interface AppSettings {
  autoSaveEnabled: boolean;
  /** 1分未満は実質ポーリングと変わらなくなるので1以上を想定(UI側でも1未満は入力させない)。 */
  autoSaveIntervalMinutes: number;
  /** 「新規に読み込み」「追加で読み込み」「一括読み込み」で、読み込んだバリエーションを
   * 最初にどちらの表示サイズで開くか。 */
  defaultLoadSize: DefaultLoadSize;
  /** 起動時、鉛筆の初期サイズ(px)に使う値。アプリを開く(リロードする)たびに鉛筆のサイズが
   * 常にクラス定義のデフォルト値へ戻ってしまう、という指摘を受けて設定可能にした。 */
  defaultBrushSize: number;
  /** 太さに対する筆圧感知の強さ(%)。100=生の筆圧をそのまま使う(既定)、0=常に最大筆圧として
   * 扱う(筆圧を完全に無視する)、100超は効果を誇張する。鉛筆/ブラシ/透明ブラシ/消しゴムの
   * サイズに共通で効く。 */
  sizePressureSensitivityPercent: number;
  /** 透明ブラシの濃さ(不透明度)に対する筆圧感知の強さ(%)。太さとは独立に調整できる
   * (太さは0〜1のサイズ範囲、濃さは0〜1の不透明度範囲と意味が違うため)。 */
  opacityPressureSensitivityPercent: number;
}

const STORAGE_KEY = "mini-rough-settings";

const DEFAULT_SETTINGS: AppSettings = {
  autoSaveEnabled: true,
  autoSaveIntervalMinutes: 5,
  defaultLoadSize: "mini",
  defaultBrushSize: 2,
  sizePressureSensitivityPercent: 100,
  opacityPressureSensitivityPercent: 100
};

/** アプリ全体の環境設定(プロジェクトの内容ではなくブラウザ単位の好み)。.mrkファイル側には
 * 保存しない — 複数のプロジェクトファイルを使い分けても、自動保存の周期などはこの端末で
 * 共通であってほしいため。 */
export function loadAppSettings(): AppSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    return { ...DEFAULT_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveAppSettings(settings: AppSettings): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // プライベートブラウジング等でlocalStorageが使えない場合は諦める(設定はこのセッション中
    // メモリ上でだけ有効になる)。
  }
}
