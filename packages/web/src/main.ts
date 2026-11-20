import {
  Document,
  RasterLayer,
  PencilTool,
  BrushTool,
  TransparentBrushTool,
  EraserTool,
  DotPenTool,
  BucketFillTool,
  RectSelectTool,
  EllipseSelectTool,
  LassoSelectTool,
  AutoSelectTool,
  GradientTool,
  GradientPair,
  RGBA,
  DragTool,
  EyedropperTool,
  MoveTool,
  resizeDocumentMini,
  maskHasSelection,
  fillWithColor,
  getMaskBounds,
  flipRegionHorizontal,
  flipRegionVertical,
  rotateRegion90
} from "@mini-rough/core";
import { importDocumentFromClip, importFlatImage, detectImportFormat, ImportedDocument } from "@mini-rough/clip-io";
import { CanvasWidget } from "./canvas-widget";
import { TransformSession } from "./transform-session";
import { TransformPanel } from "./transform-panel";
import { LayerPanel } from "./layer-panel";
import { VariantGrid, Variant, SizeMode } from "./variant-grid";
import { DropdownMenu } from "./dropdown-menu";
import { NewDocumentDialog } from "./new-document-dialog";
import { CanvasSizeDialog, CanvasSizeResult } from "./canvas-size-dialog";
import { SaveDialog } from "./save-dialog";
import { BatchExportDialog } from "./batch-export-dialog";
import { ColorDialog } from "./color-dialog";
import { SizePresetDialog } from "./size-preset-dialog";
import { AboutDialog } from "./about-dialog";
import { HelpDialog } from "./help-dialog";
import { exportDocumentAs, extensionFor } from "./export-helpers";
import { rgbToHex, checkeredBackgroundImage } from "./color-utils";
import { serializeProject, deserializeProject } from "./project-file";
import { UnsavedChangesDialog } from "./unsaved-changes-dialog";
import { ConfirmDialog } from "./confirm-dialog";
import { AlertDialog } from "./alert-dialog";
import { PromptDialog } from "./prompt-dialog";
import { isPenActive } from "./pen-state";
import { AppSettings, loadAppSettings, saveAppSettings } from "./app-settings";
import { SettingsDialog } from "./settings-dialog";
import {
  ProjectFileHandleLike,
  isFileSystemAccessSupported,
  getStoredProjectFileHandle,
  setStoredProjectFileHandle,
  getCachedProjectSnapshot,
  setCachedProjectSnapshot,
  clearCachedProjectSnapshot
} from "./project-file-handle";

declare global {
  interface Window {
    showDirectoryPicker?: () => Promise<FileSystemDirectoryHandleLike>;
  }
}
interface FileSystemDirectoryHandleLike {
  getFileHandle(name: string, options?: { create?: boolean }): Promise<FileSystemFileHandleLike>;
}
interface FileSystemFileHandleLike {
  createWritable(): Promise<{ write(data: Uint8Array): Promise<void>; close(): Promise<void> }>;
}

const DEFAULT_MINI_WIDTH = 60;
const DEFAULT_MINI_HEIGHT = 50;

// ペン系(鉛筆・ブラシ・透明ブラシ・ドットペン)を左側にまとめ、消しゴムは右寄りに置く。
// 選択範囲系(rectSelect/ellipseSelect/lassoSelect/autoSelect)は単独ボタンにはせず、1つの
// 「選択範囲」ボタン+プルダウンから切り替える(下の selectionToolIds 参照)。
const tools = {
  pencil: new PencilTool(),
  brush: new BrushTool(),
  transparentBrush: new TransparentBrushTool(),
  dotPen: new DotPenTool(),
  eraser: new EraserTool(),
  bucketFill: new BucketFillTool(),
  eyedropper: new EyedropperTool(),
  move: new MoveTool(),
  rectSelect: new RectSelectTool(),
  ellipseSelect: new EllipseSelectTool(),
  lassoSelect: new LassoSelectTool(),
  autoSelect: new AutoSelectTool(),
  gradient: new GradientTool()
};

type ToolId = keyof typeof tools;
const REGULAR_TOOL_ORDER: ToolId[] = ["pencil", "brush", "transparentBrush", "dotPen", "eraser", "bucketFill", "eyedropper", "move"];
const selectionToolIds: ToolId[] = ["rectSelect", "ellipseSelect", "lassoSelect", "autoSelect"];

// 絵文字は機種(OS/フォント)によって見た目が変わってしまうため、全ツールアイコンを自前のSVGで統一する。
// 鉛筆:茶色の木軸+薄茶色の芯+先端だけ黒。ブラシ:明るいオレンジの軸+丸い白ブラシ毛(毛先だけ着色)。
const PENCIL_ICON_SVG = `
<svg viewBox="0 0 24 24" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(0,1.25) rotate(45 12 10.75)">
    <rect x="9" y="0.5" width="6" height="2" fill="#e07a9a" stroke="#333333" stroke-width="0.8"/>
    <rect x="9" y="2.3" width="6" height="2.2" fill="#d8d8d8" stroke="#333333" stroke-width="0.8"/>
    <rect x="9" y="4.3" width="6" height="10.7" fill="#9c6b3f" stroke="#333333" stroke-width="1"/>
    <polygon points="9,15 15,15 12,21" fill="#9c6b3f" stroke="#333333" stroke-width="1"/>
    <polygon points="10.1,17.3 13.9,17.3 12,21" fill="#d9b48f"/>
    <polygon points="11,19 13,19 12,21" fill="#1c1c1c"/>
  </g>
</svg>`;

const BRUSH_ICON_SVG = `
<svg viewBox="0 0 24 24" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(-0.18,1.15) rotate(45 12 11)">
    <rect x="9.5" y="1" width="5" height="10.5" rx="2" fill="#f28c28" stroke="#333333" stroke-width="1"/>
    <rect x="9" y="11.3" width="6" height="2" fill="#bfbfbf" stroke="#333333" stroke-width="0.8"/>
    <path d="M9 13.2 C8.7 15.3 8.8 17.8 9.9 19.8 C10.5 20.9 13.5 20.9 14.1 19.8 C15.2 17.8 15.3 15.3 15 13.2 Z" fill="#ffffff" stroke="#333333" stroke-width="1"/>
    <path d="M9.7 17.6 C10.1 18.9 10.8 20.1 12 20.3 C13.2 20.1 13.9 18.9 14.3 17.6 C13.3 18.6 10.7 18.6 9.7 17.6 Z" fill="#e23a3a"/>
  </g>
</svg>`;

// 透明ブラシ:形はブラシと同じ丸い毛先だが、全体をモノクロにしつつ毛先だけキャンバスの透過
// 表示と同じ市松模様にして「透明」を示す。通常ブラシとの違いが一目でわかるようにしている。
const TRANSPARENT_BRUSH_ICON_SVG = `
<svg viewBox="0 0 24 24" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="transparent-brush-checker" width="3" height="3" patternUnits="userSpaceOnUse">
      <rect width="3" height="3" fill="#ffffff"/>
      <rect width="1.5" height="1.5" fill="#9a9a9a"/>
      <rect x="1.5" y="1.5" width="1.5" height="1.5" fill="#9a9a9a"/>
    </pattern>
    <clipPath id="transparent-brush-tip-clip">
      <path d="M9.7 17.6 C10.1 18.9 10.8 20.1 12 20.3 C13.2 20.1 13.9 18.9 14.3 17.6 C13.3 18.6 10.7 18.6 9.7 17.6 Z"/>
    </clipPath>
  </defs>
  <g transform="translate(0,1) rotate(45 12 11)">
    <rect x="9.5" y="1" width="5" height="10.5" rx="2" fill="#8a8f98" stroke="#333333" stroke-width="1"/>
    <rect x="9" y="11.3" width="6" height="2" fill="#bfbfbf" stroke="#333333" stroke-width="0.8"/>
    <path d="M9 13.2 C8.7 15.3 8.8 17.8 9.9 19.8 C10.5 20.9 13.5 20.9 14.1 19.8 C15.2 17.8 15.3 15.3 15 13.2 Z" fill="#ffffff" stroke="#333333" stroke-width="1"/>
    <rect x="9" y="16" width="6" height="5" fill="url(#transparent-brush-checker)" clip-path="url(#transparent-brush-tip-clip)"/>
  </g>
</svg>`;

// 白いゴム本体に、本体より長い青いスリーブが巻かれた一般的な消しゴムの見た目。ペン/ブラシと
// 混同しないよう、白いゴム側を左上、スリーブ側を右下に向けた逆方向の斜めにしている。
const ERASER_ICON_SVG = `
<svg viewBox="0 0 24 24" width="28" height="28" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <clipPath id="eraser-body-clip"><rect x="7" y="2" width="10" height="20" rx="2.5"/></clipPath>
  </defs>
  <g transform="rotate(-40 12 12)">
    <g clip-path="url(#eraser-body-clip)">
      <rect x="7" y="2" width="10" height="20" fill="#ffffff"/>
      <rect x="7" y="8.5" width="10" height="13.5" fill="#3b82f6"/>
    </g>
    <rect x="7" y="2" width="10" height="20" rx="2.5" fill="none" stroke="#333333" stroke-width="1"/>
    <line x1="7" y1="8.5" x2="17" y2="8.5" stroke="#333333" stroke-width="0.8"/>
  </g>
</svg>`;

const DOT_PEN_ICON_SVG = `
<svg viewBox="0 0 24 24" width="26" height="26" xmlns="http://www.w3.org/2000/svg">
  <rect x="5" y="5" width="14" height="14" rx="1.5" fill="#111111" stroke="#333333" stroke-width="1"/>
</svg>`;

// 青いバケツを左寄りに配置して65度まで大きく傾ける。口には折り返しのフチ(リム)を一周
// 付け、持ち手は正面から見て縁の左右両端を結ぶ半円として、倒れ込んで正面(バケツ本体)に
// 重なっている状態で描く(弧は口の中へ、バケツに重なる向きに湾曲させる)。塗料は口から
// 途切れず一続きの滑らかな帯として、右側へ向けて注がれているように流れる。
const BUCKET_FILL_ICON_SVG = `
<svg viewBox="0 0 24 24" width="30" height="30" xmlns="http://www.w3.org/2000/svg">
  <g transform="translate(-4,0)">
    <g transform="rotate(65 12 12)">
      <path d="M5 6 L19 6 L16 16 L8 16 Z" fill="#2f74d9" stroke="#333333" stroke-width="1"/>
      <path d="M5 6 L19 6 L18 7.6 L6 7.6 Z" fill="#1e5bb8" stroke="#333333" stroke-width="0.8"/>
      <path d="M5 6 A7 7 0 0 0 19 6" fill="none" stroke="#2a2a2a" stroke-width="1.5" stroke-linecap="round"/>
      <path d="M5 6 A7 7 0 0 0 19 6" fill="none" stroke="#a9b2bb" stroke-width="0.8" stroke-linecap="round"/>
    </g>
    <path d="M17.4 9.5 C19.3 11 21 12.8 20.3 14.8 C22.5 16.6 23.8 19 22.8 21.8 C22.3 23.1 20.6 23.3 19.9 22.1 C19.6 20 19.8 17.6 18.6 15.6 C17.8 13.5 17.3 11.4 17.4 9.5 Z" fill="#f5b942" stroke="#333333" stroke-width="0.7"/>
  </g>
</svg>`;

// スポイト: 青い本体を斜めに傾け、先端だけ色が付いたゴム球(吸い込む側)にする。業界標準の
// スポイト(ピペット)アイコンを自前のSVGで再現。
// スポイト(ピペット): 丸いゴム球(押す部分、赤)+細いガラス管(白)+尖った吸い込み口。鉛筆/ブラシ
// と混同しないよう、先端(吸い込み口)には色を一切つけない(白のまま)のがポイント。
const EYEDROPPER_ICON_SVG = `
<svg viewBox="0 0 24 24" width="26" height="26" xmlns="http://www.w3.org/2000/svg">
  <g transform="rotate(45 12 12)">
    <ellipse cx="12" cy="2.5" rx="3.1" ry="3.1" fill="#e23a3a" stroke="#333333" stroke-width="1"/>
    <rect x="10" y="4.8" width="4" height="10.7" fill="#f2f2f2" stroke="#333333" stroke-width="1"/>
    <polygon points="10,15.3 14,15.3 12,22" fill="#f2f2f2" stroke="#333333" stroke-width="1"/>
  </g>
</svg>`;

// 移動ツール: 4方向矢印の十字(一般的な移動アイコン)。
const MOVE_ICON_SVG = `
<svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
  <g fill="#ffffff" stroke="#333333" stroke-width="1">
    <polygon points="12,1.5 15.5,6 8.5,6"/>
    <polygon points="12,22.5 15.5,18 8.5,18"/>
    <polygon points="1.5,12 6,8.5 6,15.5"/>
    <polygon points="22.5,12 18,8.5 18,15.5"/>
  </g>
  <line x1="12" y1="6.5" x2="12" y2="17.5" stroke="#ffffff" stroke-width="2.4"/>
  <line x1="6.5" y1="12" x2="17.5" y2="12" stroke="#ffffff" stroke-width="2.4"/>
</svg>`;

const RECT_SELECT_ICON_SVG = `
<svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
  <rect x="4" y="4" width="16" height="16" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-dasharray="3 2"/>
</svg>`;

const ELLIPSE_SELECT_ICON_SVG = `
<svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
  <ellipse cx="12" cy="12" rx="8" ry="8" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-dasharray="3 2"/>
</svg>`;

const LASSO_SELECT_ICON_SVG = `
<svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
  <path d="M12 4 C7 4 4 7.5 4 11 C4 14.5 7.5 17 11.5 16.8 C13 16.7 13.5 15.5 12.5 14.8 C10.5 13.5 9 13 9 11 C9 8.5 11 7 13.5 7.5 C17 8.2 18 11 17 13.5" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-dasharray="3 2"/>
  <line x1="17" y1="13.5" x2="19.5" y2="19.5" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round"/>
</svg>`;

// 「線画領域の自動選択」(魔法の杖で囲まれた領域を選ぶイメージ)。
const AUTO_SELECT_ICON_SVG = `
<svg viewBox="0 0 24 24" width="24" height="24" xmlns="http://www.w3.org/2000/svg">
  <line x1="6" y1="18" x2="15" y2="9" stroke="#ffffff" stroke-width="2" stroke-linecap="round"/>
  <path d="M17 4 L17.8 6 L20 6.8 L17.8 7.6 L17 9.8 L16.2 7.6 L14 6.8 L16.2 6 Z" fill="#f2c14e" stroke="#333333" stroke-width="0.6"/>
  <circle cx="19.5" cy="3.5" r="0.8" fill="#f2c14e" stroke="#333333" stroke-width="0.5"/>
</svg>`;

const GRADIENT_ICON_SVG = `
<svg viewBox="0 0 24 24" width="26" height="26" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="gradient-icon-fill" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#1c1c1c"/>
      <stop offset="1" stop-color="#ffffff"/>
    </linearGradient>
  </defs>
  <rect x="3" y="7" width="18" height="10" rx="1.5" fill="url(#gradient-icon-fill)" stroke="#333333" stroke-width="1"/>
</svg>`;

const toolIcons: Record<ToolId, string> = {
  pencil: PENCIL_ICON_SVG,
  brush: BRUSH_ICON_SVG,
  transparentBrush: TRANSPARENT_BRUSH_ICON_SVG,
  dotPen: DOT_PEN_ICON_SVG,
  eraser: ERASER_ICON_SVG,
  bucketFill: BUCKET_FILL_ICON_SVG,
  eyedropper: EYEDROPPER_ICON_SVG,
  move: MOVE_ICON_SVG,
  rectSelect: RECT_SELECT_ICON_SVG,
  ellipseSelect: ELLIPSE_SELECT_ICON_SVG,
  lassoSelect: LASSO_SELECT_ICON_SVG,
  autoSelect: AUTO_SELECT_ICON_SVG,
  gradient: GRADIENT_ICON_SVG
};

const toolTitles: Record<ToolId, string> = {
  pencil: "鉛筆",
  brush: "ブラシ",
  transparentBrush: "透明ブラシ",
  dotPen: "ドットペン",
  eraser: "消しゴム",
  bucketFill: "バケツ塗り",
  eyedropper: "スポイト",
  move: "移動",
  rectSelect: "矩形選択",
  ellipseSelect: "楕円選択",
  lassoSelect: "投げ縄選択",
  autoSelect: "自動選択(線画領域)",
  gradient: "グラデーション"
};

function hasColor(tool: object): tool is { color: RGBA } {
  return "color" in tool;
}

function hasSize(tool: object): tool is { size: number } {
  return "size" in tool;
}

function downloadBytes(bytes: Uint8Array, filename: string): void {
  // TS 5.7+'s typed-array generics want Uint8ClampedArray<ArrayBuffer>; our buffers are always
  // plain ArrayBuffers at runtime, so this narrows a type-only mismatch, not a real one.
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function downloadText(text: string, filename: string): void {
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// DOM roots
// ---------------------------------------------------------------------------
const menuBarEl = document.getElementById("menu-bar")!;
const variantViewBarEl = document.getElementById("variant-view-bar")!;
const topToolbarEl = document.getElementById("top-toolbar")!;
const canvasViewport = document.getElementById("canvas-viewport")!;
const layerPanelContainer = document.getElementById("layer-panel-content")!;
const transformPanelContainer = document.getElementById("transform-panel")!;

// ---------------------------------------------------------------------------
// Color state (main / sub; "transparent" is just alpha 0, no stored slot)
// ---------------------------------------------------------------------------
let mainColor: RGBA = [0, 0, 0, 255];
let subColor: RGBA = [255, 255, 255, 255];
let lastColorSlot: "main" | "sub" = "main";
let activeColorSlot: "main" | "sub" | "transparent" = "main";

function applyColorToTools(rgba: RGBA): void {
  for (const tool of Object.values(tools)) {
    if (hasColor(tool)) tool.color = rgba;
  }
  // グラデーションツールはメイン/サブの両方を常に把握しておく必要があるため、個別に同期する。
  tools.gradient.mainColor = mainColor;
  tools.gradient.subColor = subColor;
}

// ---------------------------------------------------------------------------
// Dialogs
// ---------------------------------------------------------------------------
const colorDialog = new ColorDialog();
// プロジェクトファイルの保存/読込で使う最新のパレット状態(ColorPickerから都度同期される)。
let savedPaletteSwatches: string[] = [];
let tempPaletteSwatches: string[] = [];
colorDialog.onPaletteChange((kind, swatches) => {
  if (kind === "custom") savedPaletteSwatches = swatches;
  else tempPaletteSwatches = swatches;
});
const sizePresetDialog = new SizePresetDialog();
const aboutDialog = new AboutDialog();
const helpDialog = new HelpDialog();
const canvasSizeDialog = new CanvasSizeDialog();
const saveDialog = new SaveDialog();
const unsavedChangesDialog = new UnsavedChangesDialog();
const confirmDialog = new ConfirmDialog();
const alertDialog = new AlertDialog();
const promptDialog = new PromptDialog();

/** CanvasSizeDialogの入力結果をDocumentへ適用する。ミニラフ解像度が変わらない場合は完成サイズ/
 * dpiだけをその場で書き換え(リサンプル不要)、変わる場合だけ新しいDocumentを作って返す。 */
function resizeDocumentToResult(doc: Document, result: CanvasSizeResult): Document {
  if (result.miniWidth === doc.width && result.miniHeight === doc.height) {
    doc.finalWidth = result.finalWidth;
    doc.finalHeight = result.finalHeight;
    doc.dpi = result.dpi;
    return doc;
  }
  const resized = resizeDocumentMini(doc, result.miniWidth, result.miniHeight);
  resized.finalWidth = result.finalWidth;
  resized.finalHeight = result.finalHeight;
  resized.dpi = result.dpi;
  return resized;
}

// ---------------------------------------------------------------------------
// 環境設定(自動保存・読み込み時のデフォルトサイズ・鉛筆の初期サイズ)。.mrkの中身ではなく
// ブラウザ単位の好みなので、保存はlocalStorageへ(project-file.tsのプロジェクト直列化とは独立)。
// ---------------------------------------------------------------------------
let appSettings: AppSettings = loadAppSettings();
const settingsDialog = new SettingsDialog(appSettings, isFileSystemAccessSupported());

let autoSaveTimer: ReturnType<typeof setInterval> | undefined;
function restartAutoSaveTimer(): void {
  if (autoSaveTimer !== undefined) {
    clearInterval(autoSaveTimer);
    autoSaveTimer = undefined;
  }
  if (!appSettings.autoSaveEnabled) return;
  autoSaveTimer = setInterval(() => {
    void autoSaveTick();
  }, appSettings.autoSaveIntervalMinutes * 60 * 1000);
}

/** 筆圧感知の設定を、全バリエーションが共有する各ツールのインスタンスへ直接反映する。
 * CanvasWidget/VariantGrid側には何も持たせていない — ツールは`tools`に1個ずつしか無く、
 * 全バリエーションの全CanvasWidgetが同じインスタンスを参照しているので、ここで1回設定すれば
 * 既存・今後作られる全バリエーションに等しく効く(sizeの既定値などと同じ仕組み)。
 * 太さ(pressureSensitivity)は鉛筆/ブラシ/透明ブラシ/消しゴムに共通、濃さ
 * (opacityPressureSensitivity)は透明ブラシの不透明度にのみ別設定として効く。 */
function applyPressureSettingsToTools(settings: AppSettings): void {
  const sizeSensitivity = settings.sizePressureSensitivityPercent / 100;
  tools.pencil.pressureSensitivity = sizeSensitivity;
  tools.brush.pressureSensitivity = sizeSensitivity;
  tools.transparentBrush.pressureSensitivity = sizeSensitivity;
  tools.eraser.pressureSensitivity = sizeSensitivity;
  tools.transparentBrush.opacityPressureSensitivity = settings.opacityPressureSensitivityPercent / 100;
}

settingsDialog.onSettingsChange((settings) => {
  appSettings = settings;
  saveAppSettings(settings);
  restartAutoSaveTimer();
  applyPressureSettingsToTools(settings);
});

function openColorDialogFor(slot: "main" | "sub"): void {
  const initial = slot === "main" ? mainColor : subColor;
  colorDialog.open(slot === "main" ? "メインカラー" : "サブカラー", initial, (rgba) => {
    if (slot === "main") mainColor = rgba;
    else subColor = rgba;
    lastColorSlot = slot;
    activeColorSlot = slot;
    refreshColorSwatches();
    applyColorToTools(rgba);
  });
}

// ---------------------------------------------------------------------------
// Preview background (display-only — a Live2D-viewer-style backdrop, never part of the
// exported document). Persistent across "新規キャンバス" instead of being a one-time
// creation-time choice, since it's purely a viewing aid.
// ---------------------------------------------------------------------------
let bgColor: RGBA = [255, 255, 255, 255];
let bgMode: "color" | "transparent" = "transparent";

function rgbaToCss(rgba: RGBA): string {
  return `rgba(${rgba[0]}, ${rgba[1]}, ${rgba[2]}, ${rgba[3] / 255})`;
}

// ---------------------------------------------------------------------------
// Variant grid + active-variant wiring
// ---------------------------------------------------------------------------
let activeId: ToolId = "pencil";

const grid = new VariantGrid(canvasViewport, () => tools[activeId], (doc, widget) => {
  layerPanelContainer.innerHTML = "";
  new LayerPanel(
    layerPanelContainer,
    doc,
    () => widget.render(),
    () => grid.pushUndoForActive(),
    (title, defaultValue, onResult) => promptDialog.show(title, defaultValue, onResult)
  );
});

grid.onHistoryChange = () => updateUndoRedoButtons();

// ---------------------------------------------------------------------------
// 終了時の保存確認 — 実際の内容変更(grid.onEdit、setActiveだけの切替では発火しない)があった
// 場合に、ブラウザを閉じる/タブを離れる時と「閉じる」メニューの両方で確認を挟む。
// ---------------------------------------------------------------------------
let isDirty = false;
// 「閉じる」メニューで確認済みの場合、直後に発火するbeforeunloadの標準ダイアログと二重に
// 聞かれないようにするためのフラグ。
let suppressUnloadConfirm = false;
// 編集のたびにこのタイマーを立て直し、一定時間(連続した編集が落ち着いた頃)経ったら
// 自動保存する。setInterval式の定期保存(既定5分間隔)はタブがバックグラウンド/非アクティブの
// 間ブラウザに強くスロットリングされ、最悪ページごと凍結されて何分経っても一切発火しない
// ことがある — ブラウザがクラッシュ/強制終了する、電源が落ちるなど「閉じる前触れ」を伴わず
// 不意に消える場合にはvisibilitychangeにも頼れないため、タブがアクティブかどうかに関係なく
// 編集のたびその場で保存の予約をする、という方式でないと信頼できない(ユーザー指示)。
// 編集はほぼ必ずタブがアクティブな間に起きるので、この短いタイマー自体がスロットリングの
// 影響を受けることはまず無い。
let editAutoSaveTimer: ReturnType<typeof setTimeout> | undefined;
const EDIT_AUTO_SAVE_DELAY_MS = 3000;
grid.onEdit = () => {
  isDirty = true;
  if (editAutoSaveTimer !== undefined) clearTimeout(editAutoSaveTimer);
  if (!appSettings.autoSaveEnabled) return;
  editAutoSaveTimer = setTimeout(() => {
    editAutoSaveTimer = undefined;
    void autoSaveTick();
  }, EDIT_AUTO_SAVE_DELAY_MS);
};
window.addEventListener("beforeunload", (e) => {
  if (!isDirty || suppressUnloadConfirm) return;
  e.preventDefault();
  e.returnValue = "";
});
// beforeunload/unloadはページを閉じる直前に発火するが、非同期処理(IndexedDBへの書き込みを
// 含むautoSaveTick)を待ってくれる保証が無く、特にモバイルや一部ブラウザでは全く発火しない
// ことすらある。タブを閉じる/切り替える/最小化する際は必ずその前にvisibilitychange(hidden)が
// 先に発火し、かつ非同期処理の完了をブラウザが多少待ってくれるため、ここで実際のキャッシュ
// 保存を行う — これが無いと、次回の自動保存タイマー(既定5分間隔)が一度も回らないうちに
// タブを閉じてしまった場合、直前までの編集内容がキャッシュに一切反映されず、再度開いた時に
// 古い状態まで戻ってしまっていた。
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") void autoSaveTick();
});

// 右クリック(常時)またはスポイトツール自体でクリックした位置の色を、現在アクティブな
// カラースロット(メイン/サブ)に反映する。透明スロットを選んでいた場合はメインに戻す。
grid.onColorPick = (rgba) => {
  if (activeColorSlot === "sub") {
    subColor = rgba;
  } else {
    mainColor = rgba;
    activeColorSlot = "main";
  }
  lastColorSlot = activeColorSlot === "sub" ? "sub" : "main";
  refreshColorSwatches();
  applyColorToTools(activeColorSlot === "sub" ? subColor : mainColor);
};

function requireActiveVariant(): Variant | undefined {
  const active = grid.getActive();
  if (!active) alertDialog.show("バリエーションを選んでください");
  return active;
}

function deselectActive(): void {
  const active = grid.getActive();
  if (!active) return;
  active.doc.selectionMask = null;
  active.widget.render();
}

function selectAllActive(): void {
  const active = grid.getActive();
  if (!active) return;
  active.doc.selectionMask = new Uint8Array(active.doc.width * active.doc.height).fill(255);
  active.widget.render();
}

// ---------------------------------------------------------------------------
// Edit actions (shared by menu items, toolbar buttons, and keyboard shortcuts)
// ---------------------------------------------------------------------------
function clearActiveLayer(): void {
  const active = requireActiveVariant();
  const layer = active?.doc.getActiveLayer();
  if (!active || !layer) return;
  grid.pushUndoForActive();
  layer.pixels.fill(0);
  active.widget.render();
}

/** 現在選んでいる色スロット(メイン/サブ/透明)が指す実際の色 — ツールバーの各スウォッチの
 * クリックハンドラがapplyColorToToolsに渡す色と常に一致させる。 */
function currentSlotColor(): RGBA {
  if (activeColorSlot === "sub") return subColor;
  if (activeColorSlot === "transparent") return [0, 0, 0, 0];
  return mainColor;
}

function fillActiveLayer(): void {
  // CLIP STUDIOと同じ仕様: 選択範囲があればその中だけ、なければレイヤー全体を塗る。
  // 塗る色は常にmainColor固定ではなく、サブカラー/透明を選んでいればそちらを使う。
  const active = requireActiveVariant();
  const layer = active?.doc.getActiveLayer();
  if (!active || !layer) return;
  grid.pushUndoForActive();
  const mask = maskHasSelection(active.doc.selectionMask) ? active.doc.selectionMask : null;
  fillWithColor(layer, mask, currentSlotColor());
  active.widget.render();
}

function deleteActiveVariant(): void {
  const active = requireActiveVariant();
  if (!active) return;
  confirmDialog.show(
    `バリエーション「${active.label}」を削除しますか？この操作は元に戻せません。`,
    (choice) => {
      if (choice !== "confirm") return;
      if (grid.removeVariant(active.id) === "only-one") {
        const d = active.doc;
        const zoom = active.widget.getZoom();
        grid.resizeActive(Document.createDefault(d.width, d.height, d.finalWidth, d.finalHeight, d.dpi));
        active.widget.setZoom(zoom);
      }
    },
    { confirmLabel: "削除" }
  );
}

function openSaveDialogForActive(): void {
  const active = requireActiveVariant();
  if (!active) return;
  saveDialog.show(async (result) => {
    try {
      const bytes = await exportDocumentAs(active.doc, result.format, result.size);
      downloadBytes(bytes, `mini-rough.${extensionFor(result.format)}`);
    } catch (err) {
      console.error(err);
      alertDialog.show(`保存に失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    }
  });
}

function flipActiveHorizontal(): void {
  const active = requireActiveVariant();
  const layer = active?.doc.getActiveLayer();
  if (!active || !layer) return;
  grid.pushUndoForActive();
  flipRegionHorizontal(active.doc, layer);
  active.widget.render();
}

function flipActiveVertical(): void {
  const active = requireActiveVariant();
  const layer = active?.doc.getActiveLayer();
  if (!active || !layer) return;
  grid.pushUndoForActive();
  flipRegionVertical(active.doc, layer);
  active.widget.render();
}

function rotateActive90(direction: "left" | "right"): void {
  const active = requireActiveVariant();
  const layer = active?.doc.getActiveLayer();
  if (!active || !layer) return;
  grid.pushUndoForActive();
  rotateRegion90(active.doc, layer, direction);
  active.widget.render();
}

function openBrushSizeDialog(): void {
  sizePresetDialog.open((size) => {
    const tool = tools[activeId];
    if (hasSize(tool)) {
      tool.size = size;
      updatePenSizeUI();
    }
  });
}

// ---------------------------------------------------------------------------
// Transform (拡大・縮小・回転 / 自由変形) — selection-or-whole-layer, interactive bounding box
// with a left-side numeric panel, CLIP STUDIO style.
// ---------------------------------------------------------------------------
const transformPanel = new TransformPanel(transformPanelContainer);
let activeTransformSession: TransformSession | null = null;

function startTransform(mode: "scaleRotate" | "free"): void {
  if (activeTransformSession) return; // 変形中はメニューからの再入をしない
  const active = requireActiveVariant();
  const layer = active?.doc.getActiveLayer();
  if (!active || !layer) return;
  grid.pushUndoForActive();
  const session = new TransformSession(active.doc, layer, mode);
  activeTransformSession = session;
  active.widget.setTransformSession(session);
  active.widget.onTransformChange = () => transformPanel.refresh();
  // パネルの数値入力からの変更(ハンドルドラッグ経由はCanvasWidget側がrenderを呼ぶので別経路)もプレビューを画面に反映させる。
  session.onChange = () => active.widget.render();
  transformPanel.open(session, {
    docWidth: active.doc.width,
    docHeight: active.doc.height,
    finalWidth: active.doc.finalWidth,
    finalHeight: active.doc.finalHeight
  });
}

function startScaleRotateTransform(): void {
  startTransform("scaleRotate");
}

function startFreeTransform(): void {
  startTransform("free");
}

function endActiveTransform(apply: boolean): void {
  if (!activeTransformSession) return;
  const active = grid.getActive();
  if (apply) activeTransformSession.commit();
  else activeTransformSession.cancel();
  active?.widget.setTransformSession(null);
  if (active) active.widget.onTransformChange = null;
  activeTransformSession = null;
  transformPanel.close();
  active?.widget.render();
}

transformPanel.onApply = () => endActiveTransform(true);
transformPanel.onCancel = () => endActiveTransform(false);

// ---------------------------------------------------------------------------
// プロジェクト保存/読み込み(.mrk) — 全バリエーションのレイヤー構成・各バリエーションの表示状態
// (倍率/倍率ロック/ミニラフ・完成サイズどちら表示か)・色・ブラシサイズ・パレットをまとめて保存する
// 独自形式。一括書き出し→一括読み込みの往復だとUI状態が毎回失われるのを避けるのが目的。
//
// File System Access API(showOpenFilePicker/showSaveFilePicker)が使えるブラウザでは、一度
// 保存/開くで選んだファイルのハンドルを覚えておき(project-file-handle.ts、IndexedDB経由で
// 再起動後も復元できる)、以後の保存はダウンロードではなく同じファイルへの上書きにする。これが
// 「自動保存」(同じファイルに無言で書き込めないと、タイマーで動かした時にダウンロードが
// 溜まり続けるだけになる)と「起動時に前回のファイルを自動で開く」の両方の前提になっている。
// 対応していないブラウザ(Firefox等)では従来通りダウンロード/ファイル選択ダイアログに留まる。
// ---------------------------------------------------------------------------
let currentProjectFileHandle: ProjectFileHandleLike | undefined;

async function writeTextToHandle(handle: ProjectFileHandleLike, text: string): Promise<void> {
  const writable = await handle.createWritable();
  await writable.write(text);
  await writable.close();
}

function isAbortError(err: unknown): boolean {
  return err instanceof DOMException && err.name === "AbortError";
}

async function buildProjectJson(): Promise<string> {
  const brushSizes: Record<string, number> = {};
  for (const [id, tool] of Object.entries(tools)) {
    if (hasSize(tool)) brushSizes[id] = tool.size;
  }
  return serializeProject(grid, {
    mainColor,
    subColor,
    bgColor,
    bgMode,
    brushSizes,
    savedPalette: savedPaletteSwatches,
    tempPalette: tempPaletteSwatches,
    activeToolId: activeId
  });
}

/** 手動の「保存」。どの経路で成功しても、自動保存用キャッシュ(project-file-handle.tsの
 * スナップショット)はクリアする — 実ファイルに保存できた以上、未保存作業の保険だったキャッシュ
 * は用済みで、残しておくと次回起動時に古い(保存済みの)内容を自動復元の対象として誤って
 * 拾ってしまう。 */
async function saveProjectFile(): Promise<void> {
  const json = await buildProjectJson();

  if (currentProjectFileHandle) {
    try {
      await writeTextToHandle(currentProjectFileHandle, json);
      isDirty = false;
      void clearCachedProjectSnapshot();
      return;
    } catch (err) {
      console.error(err);
      // 前回選んだファイルが削除/移動された等で書き込めなくなっていたら、ハンドルを諦めて
      // 下の「新しい保存先を選ぶ」側にフォールバックする。
      currentProjectFileHandle = undefined;
    }
  }

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: "mini-rough.mrk",
        types: [{ description: "ミニラフ小町プロジェクト", accept: { "application/octet-stream": [".mrk"] } }]
      });
      await writeTextToHandle(handle, json);
      currentProjectFileHandle = handle;
      void setStoredProjectFileHandle(handle);
      isDirty = false;
      void clearCachedProjectSnapshot();
      return;
    } catch (err) {
      if (isAbortError(err)) return; // ユーザーがファイル選択をキャンセルした
      console.error(err);
      // ピッカー自体が失敗した場合は、従来のダウンロード方式にフォールバックする。
    }
  }

  downloadText(json, "mini-rough.mrk");
  isDirty = false;
  void clearCachedProjectSnapshot();
}

/** 自動保存タイマーの1tick。手動の保存とは違い、File System Access未対応/ハンドル未確立でも
 * 常にキャッシュへは書けるようにする(キャッシュはIndexedDBへの素のJSON保存で、権限も
 * ユーザー操作も不要)。ハンドルがあれば実ファイルにも上書きするが、失敗してもキャッシュへの
 * 保存自体は成立しているので、ここでは諦めてハンドルだけ外す。 */
async function autoSaveTick(): Promise<void> {
  if (!isDirty) return;
  const json = await buildProjectJson();
  void setCachedProjectSnapshot(json);
  if (currentProjectFileHandle) {
    try {
      await writeTextToHandle(currentProjectFileHandle, json);
    } catch (err) {
      console.error(err);
      currentProjectFileHandle = undefined;
    }
  }
  isDirty = false;
}

/** .mrkのテキスト内容(実ファイルから読んだものでも、自動保存キャッシュから復元したものでも
 * 共通)を現在のプロジェクトへ反映する。File/キャッシュどちら由来かに関わらずここへ集約する。 */
async function loadProjectFromJson(text: string, clearCache = true): Promise<void> {
  try {
    const restored = await deserializeProject(text);
    if (restored.docs.length === 0) return;

    grid.reset(restored.docs[0].doc);
    for (let i = 1; i < restored.docs.length; i++) {
      grid.addVariant(restored.docs[i].doc);
    }

    const variants = grid.getAll();
    restored.data.variants.forEach((vData, i) => {
      const variant = variants[i];
      if (!variant) return;
      variant.miniWidth = vData.miniWidth;
      variant.miniHeight = vData.miniHeight;
      variant.sizeMode = vData.sizeMode;
      variant.otherModeDoc = restored.docs[i].otherModeDoc;
      variant.widget.setZoom(vData.zoom);
      grid.setZoomLockedFor(variant, vData.zoomLocked);
    });

    const activeIndex = Math.max(0, Math.min(variants.length - 1, restored.data.activeVariantIndex));
    grid.setActive(variants[activeIndex].id);

    mainColor = restored.data.mainColor;
    subColor = restored.data.subColor;
    bgColor = restored.data.bgColor;
    bgMode = restored.data.bgMode;
    activeColorSlot = "main";
    lastColorSlot = "main";
    refreshColorSwatches();
    refreshBgSwatches();
    grid.setPreviewBackground(bgMode === "transparent" ? null : rgbaToCss(bgColor));

    for (const [id, size] of Object.entries(restored.data.brushSizes)) {
      const tool = tools[id as ToolId];
      if (tool && hasSize(tool)) tool.size = size;
    }

    savedPaletteSwatches = restored.data.savedPalette;
    tempPaletteSwatches = restored.data.tempPalette;
    colorDialog.setCustomSwatches(savedPaletteSwatches);
    colorDialog.setTempSwatches(tempPaletteSwatches);

    if (restored.data.activeToolId in tools) {
      selectTool(restored.data.activeToolId as ToolId);
    } else {
      applyColorToTools(mainColor);
      updatePenSizeUI();
    }
    // 読み込んだ直後は保存済みの状態そのものなので「未保存の変更」ではない。
    isDirty = false;
    // clearCache=falseで呼ばれるのは起動時にキャッシュ自体から復元した時だけ — その場合は
    // キャッシュを消すと「次に何も編集せず再読み込みしたら復元対象が無くなる」ことになるので残す。
    if (clearCache) void clearCachedProjectSnapshot();
  } catch (err) {
    console.error(err);
    alertDialog.show(`プロジェクトの読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function loadProjectFile(file: File, clearCache = true): Promise<void> {
  await loadProjectFromJson(await file.text(), clearCache);
}

const projectFileInput = document.createElement("input");
projectFileInput.type = "file";
projectFileInput.accept = ".mrk";
projectFileInput.style.display = "none";
document.body.appendChild(projectFileInput);
projectFileInput.addEventListener("change", async () => {
  const file = projectFileInput.files?.[0];
  projectFileInput.value = "";
  if (!file) return;
  await loadProjectFile(file);
});

/** 「開く」(Ctrl+O)。File System Access APIが使えるブラウザではshowOpenFilePickerでハンドルを
 * 取得し、以後の保存/自動保存/次回起動時の自動読み込みに使えるよう覚えておく。使えない/失敗した
 * 場合は従来の<input type=file>にフォールバックする。 */
async function openProjectFile(): Promise<void> {
  if (window.showOpenFilePicker) {
    try {
      const [handle] = await window.showOpenFilePicker({
        types: [{ description: "ミニラフ小町プロジェクト", accept: { "application/octet-stream": [".mrk"] } }]
      });
      const file = await handle.getFile();
      await loadProjectFile(file);
      currentProjectFileHandle = handle;
      void setStoredProjectFileHandle(handle);
      return;
    } catch (err) {
      if (isAbortError(err)) return; // ユーザーがファイル選択をキャンセルした
      console.error(err);
      // ピッカー自体が失敗した場合は、従来の<input type=file>にフォールバックする。
    }
  }
  projectFileInput.click();
}

/** 起動時の自動復元。2段階:
 * 1. 前回保存/開いた実ファイルのハンドルが残っていて、権限(queryPermission)が生きていれば
 *    それを最優先で無言で読み込む — ユーザー操作を伴わないこの経路ではrequestPermissionを
 *    呼んでも(多くのブラウザで)許可は下りないので、既に許可が残っている場合だけ進める。
 * 2. 実ファイルが無い/権限が無ければ、自動保存キャッシュ(File System Access非対応でも常に
 *    書けていたIndexedDBのスナップショット)から復元する。これにより、一度も「保存」「開く」を
 *    手動で行っていない状態でも、リロードで作業内容を失わずに済む。
 * どちらも無ければ何もしない(呼び出し元が用意した白紙ドキュメントのまま)。 */
async function tryAutoRestoreOnStartup(): Promise<void> {
  const handle = await getStoredProjectFileHandle();
  if (handle) {
    try {
      const permission = await handle.queryPermission({ mode: "readwrite" });
      if (permission === "granted") {
        const file = await handle.getFile();
        await loadProjectFile(file);
        currentProjectFileHandle = handle;
        return;
      }
    } catch (err) {
      console.error(err);
      // 前回のファイルが削除/移動されていた場合などは、下のキャッシュ復元にフォールバックする。
    }
  }

  const cached = await getCachedProjectSnapshot();
  if (!cached) return;
  try {
    await loadProjectFromJson(cached, false);
  } catch (err) {
    console.error(err);
    // キャッシュが壊れていた場合などはそのまま白紙で起動する。
  }
}

// ---------------------------------------------------------------------------
// Clipboard (copy / cut / paste) — an in-app shared variable (not the OS clipboard), so pasting
// works identically within the same variant and across different variants/documents.
// ---------------------------------------------------------------------------
interface ClipboardPayload {
  width: number;
  height: number;
  pixels: Uint8ClampedArray;
  offsetX: number;
  offsetY: number;
  /** コピー元レイヤーの名前。貼り付け時に新規レイヤーへそのまま引き継ぐ。 */
  sourceName: string;
}

let clipboard: ClipboardPayload | null = null;

/** Extracts the region to copy: the selection's bounding box (pixels outside the selection but
 * inside that box are left transparent) when there's a selection, otherwise the whole active layer. */
function extractClipboardPayload(doc: Document, layer: RasterLayer): ClipboardPayload {
  const mask = maskHasSelection(doc.selectionMask) ? doc.selectionMask : null;
  const bounds = mask ? getMaskBounds(mask, doc.width, doc.height) : null;
  const x = bounds?.x ?? 0;
  const y = bounds?.y ?? 0;
  const w = bounds?.w ?? doc.width;
  const h = bounds?.h ?? doc.height;
  const pixels = new Uint8ClampedArray(w * h * 4);
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const srcX = x + col;
      const srcY = y + row;
      if (mask && !mask[srcY * doc.width + srcX]) continue;
      const srcIdx = (srcY * doc.width + srcX) * 4;
      const dstIdx = (row * w + col) * 4;
      pixels[dstIdx] = layer.pixels[srcIdx];
      pixels[dstIdx + 1] = layer.pixels[srcIdx + 1];
      pixels[dstIdx + 2] = layer.pixels[srcIdx + 2];
      pixels[dstIdx + 3] = layer.pixels[srcIdx + 3];
    }
  }
  return { width: w, height: h, pixels, offsetX: x, offsetY: y, sourceName: layer.name };
}

function copyActive(): void {
  const active = grid.getActive();
  const layer = active?.doc.getActiveLayer();
  if (!active || !layer) return;
  clipboard = extractClipboardPayload(active.doc, layer);
}

function cutActive(): void {
  const active = grid.getActive();
  const layer = active?.doc.getActiveLayer();
  if (!active || !layer) return;
  clipboard = extractClipboardPayload(active.doc, layer);
  grid.pushUndoForActive();
  const mask = maskHasSelection(active.doc.selectionMask) ? active.doc.selectionMask : null;
  const count = active.doc.width * active.doc.height;
  for (let i = 0; i < count; i++) {
    if (mask && !mask[i]) continue;
    const pi = i * 4;
    layer.pixels[pi] = 0;
    layer.pixels[pi + 1] = 0;
    layer.pixels[pi + 2] = 0;
    layer.pixels[pi + 3] = 0;
  }
  active.widget.render();
}

/** Pastes into a new layer above the active one (CLIP STUDIO convention), positioned at the
 * clipboard's original offset when that still fits the target canvas, otherwise centered —
 * necessary since paste can target a differently-sized variant than the one it was copied from. */
function pasteActive(): void {
  const active = grid.getActive();
  if (!active || !clipboard) return;
  const doc = active.doc;
  grid.pushUndoForActive();
  const layer = doc.addLayer();
  layer.name = clipboard.sourceName;
  const fitsAtOriginalOffset = clipboard.offsetX + clipboard.width <= doc.width && clipboard.offsetY + clipboard.height <= doc.height;
  const destX = fitsAtOriginalOffset ? clipboard.offsetX : Math.max(0, Math.floor((doc.width - clipboard.width) / 2));
  const destY = fitsAtOriginalOffset ? clipboard.offsetY : Math.max(0, Math.floor((doc.height - clipboard.height) / 2));
  for (let row = 0; row < clipboard.height; row++) {
    const dstY = destY + row;
    if (dstY < 0 || dstY >= doc.height) continue;
    for (let col = 0; col < clipboard.width; col++) {
      const dstX = destX + col;
      if (dstX < 0 || dstX >= doc.width) continue;
      const srcIdx = (row * clipboard.width + col) * 4;
      const dstIdx = (dstY * doc.width + dstX) * 4;
      layer.pixels[dstIdx] = clipboard.pixels[srcIdx];
      layer.pixels[dstIdx + 1] = clipboard.pixels[srcIdx + 1];
      layer.pixels[dstIdx + 2] = clipboard.pixels[srcIdx + 2];
      layer.pixels[dstIdx + 3] = clipboard.pixels[srcIdx + 3];
    }
  }
  active.widget.render();
  // addLayer() so far only touched the Document — the layer panel listens for layer-structure
  // changes via setActive's onActiveChange callback, so re-trigger it to show the new layer.
  grid.setActive(active.id);
}

// ---------------------------------------------------------------------------
// Menu bar (File / Edit / Help) as pulldown menus
//   スマホのナビゲーションドロワー(左から出る縦リスト)内では、同じボタンをプルダウンでは
//   なくアコーディオンの見出しとして使う — タップした項目をその場で展開し、他は折りたたむ。
//   build()自体(各項目の定義)はプルダウン/アコーディオンどちらでも共通で、DropdownMenu.
//   addItemが生成する.dropdown-itemボタンをそのまま並べるだけでアコーディオンの内容になる。
// ---------------------------------------------------------------------------
const menu = new DropdownMenu();
const navAccordionSections: { btn: HTMLButtonElement; panel: HTMLDivElement }[] = [];

function closeAllNavAccordionSections(): void {
  for (const section of navAccordionSections) {
    section.panel.classList.remove("open");
    section.btn.classList.remove("open");
  }
}

function addMenuButton(label: string, build: (container: HTMLElement, m: DropdownMenu) => void): void {
  const btn = document.createElement("button");
  btn.textContent = label;
  btn.classList.add("nav-accordion-trigger");
  menuBarEl.appendChild(btn);

  const panel = document.createElement("div");
  panel.className = "nav-accordion-panel";
  menuBarEl.appendChild(panel);
  navAccordionSections.push({ btn, panel });

  btn.addEventListener("click", () => {
    if (!document.body.classList.contains("portrait-layout")) {
      menu.toggle(btn, build);
      return;
    }
    const opening = !panel.classList.contains("open");
    closeAllNavAccordionSections();
    if (opening) {
      btn.classList.add("open");
      panel.classList.add("open");
      panel.innerHTML = "";
      build(panel, menu);
    }
  });
}

const ASPECT_TOLERANCE = 0.01;

function aspectRatiosMatch(w1: number, h1: number, w2: number, h2: number): boolean {
  return Math.abs(w1 / h1 - w2 / h2) <= ASPECT_TOLERANCE * (w2 / h2);
}

/** 「prefix+連番+suffix+拡張子」(prefix/suffixは省略可)という名前のファイル群を連番順に並べる。
 * ファイル名(拡張子を除く)に現れる最初の数字の並びを連番とみなす — 一括読み込みでOSのファイル
 * 選択ダイアログが返す順序(必ずしも連番順ではない)に頼らず、常に意図した順で取り込むため。
 * 数字を含まないファイル名は末尾にまとめ、同じ連番内ではファイル名順に揺れを解消する。 */
function extractSequenceNumber(fileName: string): number {
  const base = fileName.replace(/\.[^./\\]+$/, "");
  const match = base.match(/\d+/);
  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
}

function sortFilesBySequence(files: File[]): File[] {
  return [...files].sort((a, b) => {
    const diff = extractSequenceNumber(a.name) - extractSequenceNumber(b.name);
    return diff !== 0 ? diff : a.name.localeCompare(b.name);
  });
}

type LoadMode = "add" | "new";

// .clip以外に、出力(「出力」メニュー)で使える静止画形式も読み込める — PSDはレイヤーを無視して
// ag-psdの合成済み画像を、png/jpg/bmp/gifはブラウザの画像デコーダーをそのまま1枚のラスター
// レイヤーとして取り込む(静止画のみ対応、という要望に合わせてレイヤー構造の再現はしない)。
const LOAD_FILE_ACCEPT = ".clip,.psd,.png,.jpg,.jpeg,.bmp,.gif";

/** ファイル名の拡張子で読み込み方法を振り分ける共通入口 — .clipはimportDocumentFromClip、
 * その他の静止画形式はimportFlatImageに渡す。どちらもImportedDocument({doc, finalDoc})を
 * 返すので、呼び出し側(新規読み込みのサイズ指定ダイアログ・追加読み込みの縦横比チェック等)は
 * 読み込み元の形式を意識しなくて良い。 */
async function importAnyDocument(file: File): Promise<ImportedDocument> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const format = detectImportFormat(file.name);
  if (format === "clip") return importDocumentFromClip(bytes);
  if (format === null) throw new Error(`対応していないファイル形式です: 「${file.name}」`);
  return importFlatImage(bytes, format);
}

// 「新規に読み込み」「追加で読み込み」はどちらも同じ<input type=file>を使い回す。clickは
// 同期的に呼べるが結果(change)は非同期なので、どちらのボタン/ショートカットから開いたかを
// このフラグに覚えておいてchangeハンドラ側で読む。
let pendingLoadMode: LoadMode = "add";

const loadFileInput = document.createElement("input");
loadFileInput.type = "file";
loadFileInput.accept = LOAD_FILE_ACCEPT;
loadFileInput.style.display = "none";
document.body.appendChild(loadFileInput);
loadFileInput.addEventListener("change", async () => {
  const file = loadFileInput.files?.[0];
  loadFileInput.value = "";
  if (!file) return;
  await loadVariantFromFile(file, pendingLoadMode);
});

function startLoadNew(): void {
  pendingLoadMode = "new";
  loadFileInput.click();
}

function startLoadAdd(): void {
  pendingLoadMode = "add";
  loadFileInput.click();
}

/** 読み込んだDocumentを、`mode`(新規/追加)と設定の「読み込み時のデフォルトサイズ」に従って
 * 反映する。「新規」は現在のプロジェクト全体を置き換えるので縦横比チェック不要。「追加」は他の
 * バリエーションと完成サイズの縦横比が揃っていないと一括書き出し時に混乱するため、縦横比チェック
 * を行う。「新規」はこの前にダイアログでミニラフ解像度を指定済み(loadVariantFromFile参照)。
 * 「追加」はファイル自身が記録しているミニラフ/完成サイズをそのまま使い、リサンプルはしない。
 * imported.finalDocを追加したVariantのotherModeDocに設定しておくことで、初めて「完成サイズ」
 * 表示に切り替えたときにミニラフ側の荒い画像を引き伸ばすのではなく、.clipが実際に持っていた
 * 完成サイズの画像をそのまま表示できる(variant-grid.tsのreconcileDocumentResolution参照)。 */
type ApplyLoadResult = { ok: true } | { ok: false; reason: string };

function applyLoadedDocument(imported: ImportedDocument, mode: LoadMode): ApplyLoadResult {
  const fileDoc = imported.doc;
  if (mode === "new") {
    grid.reset(fileDoc);
    // 一時パレットは「現在の編集セッション」専用なので、プロジェクトの置き換えで切り離す。
    tempPaletteSwatches = [];
    colorDialog.setTempSwatches([]);
    isDirty = false;
    // 「新規」系の操作なので、古い自動保存キャッシュが次回起動時に誤って復元されないよう消す。
    void clearCachedProjectSnapshot();
    // 前に開いていた実ファイルのハンドルを持ち越さない(新規キャンバス作成時と同じ理由)。
    currentProjectFileHandle = undefined;
  } else {
    const active = requireActiveVariant();
    if (!active) return { ok: false, reason: "アクティブなバリエーションがありません" };
    const target = active.doc;
    if (!aspectRatiosMatch(fileDoc.finalWidth, fileDoc.finalHeight, target.finalWidth, target.finalHeight)) {
      return {
        ok: false,
        reason: `縦横比(${fileDoc.finalWidth}×${fileDoc.finalHeight})が現在のバリエーションの完成サイズ(${target.finalWidth}×${target.finalHeight})と異なります`
      };
    }
    grid.addVariant(fileDoc);
  }
  const added = grid.getActive();
  if (added) added.otherModeDoc = imported.finalDoc;
  if (appSettings.defaultLoadSize === "final") grid.setSizeModeForActive("final");
  return { ok: true };
}

async function loadVariantFromFile(file: File, mode: LoadMode): Promise<void> {
  try {
    const imported = await importAnyDocument(file);
    if (mode === "new") {
      // 「新規に読み込み」はファイルが記録しているミニラフ解像度をそのまま使うのではなく、
      // ここで指定し直せるようにする(ファイルによってミニラフ解像度の基準が揃っていないことが
      // あるため)。キャンセル時は何も反映しない。
      canvasSizeDialog.show(
        {
          miniWidth: imported.doc.width,
          miniHeight: imported.doc.height,
          finalWidth: imported.doc.finalWidth,
          finalHeight: imported.doc.finalHeight,
          dpi: imported.doc.dpi
        },
        (sizeResult) => {
          const doc = resizeDocumentToResult(imported.doc, sizeResult);
          const result = applyLoadedDocument({ doc, finalDoc: imported.finalDoc }, mode);
          if (!result.ok) alertDialog.show(`「${file.name}」を追加できません: ${result.reason}`);
        },
        { title: "新規に読み込み:ミニラフ解像度", applyLabel: "読み込む" }
      );
      return;
    }
    const result = applyLoadedDocument(imported, mode);
    if (!result.ok) alertDialog.show(`「${file.name}」を追加できません: ${result.reason}`);
  } catch (err) {
    console.error(err);
    alertDialog.show(`読み込みに失敗しました: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// 一括読み込み(Ctrl+Shift+R): 複数ファイルをまとめてバリエーション追加する。件数分ダイアログを
// 閉じる手間がかかるので、単体の読み込みと同じく常にダイアログなしで「追加」として自動処理する。
// ---------------------------------------------------------------------------
const batchLoadFileInput = document.createElement("input");
batchLoadFileInput.type = "file";
batchLoadFileInput.accept = LOAD_FILE_ACCEPT;
batchLoadFileInput.multiple = true;
batchLoadFileInput.style.display = "none";
document.body.appendChild(batchLoadFileInput);
batchLoadFileInput.addEventListener("change", async () => {
  const files = sortFilesBySequence(Array.from(batchLoadFileInput.files ?? []));
  batchLoadFileInput.value = "";
  if (files.length === 0) return;
  const skipped: string[] = [];
  for (const file of files) {
    try {
      const imported = await importAnyDocument(file);
      const result = applyLoadedDocument(imported, "add");
      if (!result.ok) skipped.push(`${file.name}(${result.reason})`);
    } catch (err) {
      console.error(err);
      skipped.push(`${file.name}(読み込み失敗)`);
    }
  }
  if (skipped.length > 0) {
    alertDialog.show(`以下のファイルは読み込めませんでした:\n${skipped.join("\n")}`);
  }
});

addMenuButton("ファイル", (container, m) => {
  m.addItem(container, "新規", () => newDocDialog.show(), "Ctrl+Shift+N");
  m.addItem(container, "開く", () => void openProjectFile(), "Ctrl+O");
  m.addItem(container, "新規に読み込み", () => startLoadNew(), "Alt+R");
  m.addItem(container, "追加で読み込み", () => startLoadAdd(), "Ctrl+R");
  m.addItem(container, "一括読み込み", () => batchLoadFileInput.click(), "Ctrl+Shift+R");
  m.addItem(container, "保存", () => void saveProjectFile(), "Ctrl+S");
  m.addItem(container, "出力", () => openSaveDialogForActive(), "Alt+S");
  m.addItem(container, "一括出力", () => batchExportDialog.show(grid.getAll().length), "Alt+Shift+S");
  m.addItem(container, "閉じる", () => {
    if (!isDirty) {
      suppressUnloadConfirm = true;
      window.close();
      return;
    }
    unsavedChangesDialog.show(async (choice) => {
      if (choice === "cancel") return;
      if (choice === "save") await saveProjectFile();
      suppressUnloadConfirm = true;
      window.close();
    });
  });
});

addMenuButton("編集", (container, m) => {
  m.addItem(container, "キャンバスサイズ", () => {
    const active = requireActiveVariant();
    if (!active) return;
    // 完成サイズ表示中にミニラフ解像度をいじると基準が狂うので、設定は常にミニラフ基準で行う。
    if (active.sizeMode === "final") grid.setSizeModeForActive("mini");
    const doc = active.doc;
    canvasSizeDialog.show(
      { miniWidth: doc.width, miniHeight: doc.height, finalWidth: doc.finalWidth, finalHeight: doc.finalHeight, dpi: doc.dpi },
      (result) => {
        const newDoc = resizeDocumentToResult(doc, result);
        if (newDoc === doc) active.widget.render();
        else grid.resizeActive(newDoc);
      }
    );
  });
  m.addItem(container, "消去", () => clearActiveLayer(), "Delete");
  m.addItem(container, "塗りつぶし", () => fillActiveLayer(), "Alt+Delete");
  m.addItem(container, "戻る", () => grid.undoActive(), "Ctrl+Z");
  m.addItem(container, "進む", () => grid.redoActive(), "Ctrl+Y");
  m.addItem(container, "コピー", () => copyActive(), "Ctrl+C");
  m.addItem(container, "切り取り", () => cutActive(), "Ctrl+X");
  m.addItem(container, "貼り付け", () => pasteActive(), "Ctrl+V");
  m.addItem(container, "拡大・縮小・回転", () => startScaleRotateTransform(), "Ctrl+T");
  m.addItem(container, "自由変形", () => startFreeTransform(), "Ctrl+Shift+T");
  m.addItem(container, "左右反転", () => flipActiveHorizontal());
  m.addItem(container, "上下反転", () => flipActiveVertical());
  m.addItem(container, "90°左に回転する", () => rotateActive90("left"));
  m.addItem(container, "90°右に回転する", () => rotateActive90("right"));
});

addMenuButton("選択範囲", (container, m) => {
  m.addItem(container, "解除", () => deselectActive(), "Ctrl+D");
  m.addItem(container, "全選択", () => selectAllActive(), "Ctrl+A");
});

addMenuButton("ヘルプ", (container, m) => {
  m.addItem(container, "ヘルプ", () => void helpDialog.show());
  m.addItem(container, "このアプリについて", () => aboutDialog.show());
});

// 「設定」は項目が1つ(ダイアログを開く)だけなので、ファイル/編集等と違いプルダウンにはせず
// 直接ダイアログを開くボタンにする。
const settingsBtn = document.createElement("button");
settingsBtn.textContent = "設定";
settingsBtn.addEventListener("click", () => settingsDialog.show());
menuBarEl.appendChild(settingsBtn);

const newDocDialog = new NewDocumentDialog((result) => {
  const newDoc = Document.createDefault(result.miniWidth, result.miniHeight, result.finalWidth, result.finalHeight, result.dpi);
  grid.reset(newDoc);
  // 一時パレットは「現在の編集セッション」専用なので、新規作成で切り離す。
  tempPaletteSwatches = [];
  colorDialog.setTempSwatches([]);
  // 新規作成した直後は「未保存の変更」ではない(まだ何も描いていない白紙の状態)。
  isDirty = false;
  // 古い自動保存キャッシュが次回起動時に誤って復元されないよう消す。
  void clearCachedProjectSnapshot();
  // 前に開いていた実ファイルのハンドルを持ち越さない — 持ち越すと、次の自動保存/保存で
  // この白紙の新規プロジェクトが前のファイルへ無言で上書きされてしまう。
  currentProjectFileHandle = undefined;
});

const batchExportDialog = new BatchExportDialog(async (result, count) => {
  const variants = grid.getAll().slice(0, count);
  let dirHandle: FileSystemDirectoryHandleLike | undefined;
  if (window.showDirectoryPicker) {
    try {
      dirHandle = await window.showDirectoryPicker();
    } catch {
      return; // user cancelled the folder picker
    }
  }
  for (let i = 0; i < variants.length; i++) {
    const filename = `${result.prefix}${String(result.start + i).padStart(result.digits, "0")}${result.suffix}.${extensionFor(result.format)}`;
    try {
      const bytes = await exportDocumentAs(variants[i].doc, result.format, result.size);
      if (dirHandle) {
        const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(bytes);
        await writable.close();
      } else {
        downloadBytes(bytes, filename);
        await new Promise((resolve) => setTimeout(resolve, 150));
      }
    } catch (err) {
      console.error(err);
      alertDialog.show(`「${filename}」の書き出しに失敗しました: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Persistent variant / view bar (below the menu bar, above the tools)
//   役割ごとに5グループに分け、幅に応じて1〜3行に折り返す(updateViewBarLayout参照)。
//   1行目: バリエーション操作(view-bar-actions-group) / 背景色(view-bar-bg-group、右端固定)
//   2行目: ミニラフ・完成サイズ切替(size-mode-group) / 倍率スライダー・数値(view-bar-zoom-group)
//   3行目: 等倍・フィッティング系の自動倍率調節(view-bar-zoom-auto-group)
//   すべて1行に収まる時は actions → zoom → zoomAuto → sizeMode → bg の順に並ぶ。
// ---------------------------------------------------------------------------
const actionsGroup = document.createElement("div");
actionsGroup.className = "view-bar-group view-bar-actions-group";
variantViewBarEl.appendChild(actionsGroup);

const addVariantBtn = document.createElement("button");
addVariantBtn.textContent = "＋ 追加";
addVariantBtn.title = "現在の設定でバリエーションを追加";
addVariantBtn.addEventListener("click", () => grid.addVariantLikeActive());
actionsGroup.appendChild(addVariantBtn);

const duplicateVariantBtn = document.createElement("button");
duplicateVariantBtn.textContent = "⧉ 複製";
duplicateVariantBtn.title = "現在のバリエーションと同じレイヤー構成のバリエーションを末尾に追加";
duplicateVariantBtn.addEventListener("click", () => grid.duplicateActiveVariant());
actionsGroup.appendChild(duplicateVariantBtn);

const deleteVariantBtn = document.createElement("button");
deleteVariantBtn.textContent = "✕ 削除";
deleteVariantBtn.title = "現在のバリエーションを削除";
deleteVariantBtn.addEventListener("click", () => deleteActiveVariant());
actionsGroup.appendChild(deleteVariantBtn);

const viewDivider = document.createElement("span");
viewDivider.className = "toolbar-divider";
actionsGroup.appendChild(viewDivider);

const zoomGroup = document.createElement("div");
zoomGroup.className = "zoom-group view-bar-group view-bar-zoom-group";
variantViewBarEl.appendChild(zoomGroup);
const zoomLabel = document.createElement("span");
zoomLabel.textContent = "倍率";
const zoomSlider = document.createElement("input");
zoomSlider.type = "range";
zoomSlider.min = "0.05";
zoomSlider.max = "20";
zoomSlider.step = "0.01";
zoomSlider.addEventListener("input", () => {
  grid.clearAutoFit();
  grid.getActive()?.widget.setZoom(Number(zoomSlider.value));
});
// スライダーだけでなく、数値を直接入力しても倍率を指定できるように。
const zoomPrefix = document.createElement("span");
zoomPrefix.textContent = "×";
const zoomNumberInput = document.createElement("input");
zoomNumberInput.type = "number";
zoomNumberInput.className = "zoom-number";
zoomNumberInput.min = "0.05";
zoomNumberInput.max = "20";
zoomNumberInput.step = "0.05";
zoomNumberInput.addEventListener("input", () => {
  const value = Number(zoomNumberInput.value);
  if (!value) return;
  grid.clearAutoFit();
  grid.getActive()?.widget.setZoom(value);
});
zoomGroup.appendChild(zoomLabel);
zoomGroup.appendChild(zoomSlider);
zoomGroup.appendChild(zoomPrefix);
zoomGroup.appendChild(zoomNumberInput);

function updateZoomDisplay(zoom: number): void {
  zoomSlider.value = String(zoom);
  zoomNumberInput.value = String(zoom);
}
grid.onActiveZoomChange = updateZoomDisplay;

// 等倍・フィッティング系(自動で倍率を決める操作)はまとめてview-bar-zoom-auto-groupに入れ、
// 手動指定の倍率スライダー(zoomGroup)とは別の折り返し単位にする(3行目に送られる対象)。
const zoomAutoGroup = document.createElement("div");
zoomAutoGroup.className = "view-bar-group view-bar-zoom-auto-group";
variantViewBarEl.appendChild(zoomAutoGroup);

const actualSizeBtn = document.createElement("button");
actualSizeBtn.textContent = "等倍";
actualSizeBtn.addEventListener("click", () => grid.setActualSize());
zoomAutoGroup.appendChild(actualSizeBtn);

const fitActiveBtn = document.createElement("button");
fitActiveBtn.textContent = "単体フィッティング";
fitActiveBtn.addEventListener("click", () => grid.fitActive());
zoomAutoGroup.appendChild(fitActiveBtn);

const fitAllBtn = document.createElement("button");
fitAllBtn.textContent = "全体フィッティング";
fitAllBtn.addEventListener("click", () => grid.fitAll());
zoomAutoGroup.appendChild(fitAllBtn);

const equalizeSizesBtn = document.createElement("button");
equalizeSizesBtn.textContent = "サイズを揃える";
equalizeSizesBtn.addEventListener("click", () => grid.equalizeSizes());
zoomAutoGroup.appendChild(equalizeSizesBtn);

// ミニラフ/完成サイズの表示切替。CLIP STUDIO本番出力に近い解像度で細部を確認・修正したい時に、
// 一時的にキャンバスを完成サイズへ拡大/縮小する(見た目だけでなく実際に編集もできる)。
// 1行に収まる時はフィッティング系ボタンの右側に表示されるが、幅が足りない時は2行目または
// 3行目の先頭に送られる(updateViewBarLayout参照、view-bar-groupでorder制御)。
const sizeModeGroup = document.createElement("div");
sizeModeGroup.className = "view-bar-group size-mode-group";
const miniSizeRadio = document.createElement("input");
miniSizeRadio.type = "radio";
miniSizeRadio.name = "size-mode-display";
miniSizeRadio.id = "size-mode-mini";
const miniSizeLabel = document.createElement("label");
miniSizeLabel.htmlFor = "size-mode-mini";
miniSizeLabel.textContent = "ミニラフ";
const finalSizeRadio = document.createElement("input");
finalSizeRadio.type = "radio";
finalSizeRadio.name = "size-mode-display";
finalSizeRadio.id = "size-mode-final";
const finalSizeLabel = document.createElement("label");
finalSizeLabel.htmlFor = "size-mode-final";
finalSizeLabel.textContent = "完成サイズ";
miniSizeRadio.addEventListener("change", () => {
  if (miniSizeRadio.checked) grid.setSizeModeForActive("mini");
});
finalSizeRadio.addEventListener("change", () => {
  if (finalSizeRadio.checked) grid.setSizeModeForActive("final");
});
sizeModeGroup.appendChild(miniSizeRadio);
sizeModeGroup.appendChild(miniSizeLabel);
sizeModeGroup.appendChild(finalSizeRadio);
sizeModeGroup.appendChild(finalSizeLabel);

const applySizeModeToAllBtn = document.createElement("button");
applySizeModeToAllBtn.textContent = "全部に適用";
applySizeModeToAllBtn.title = "選択中の表示サイズ(ミニラフ/完成)を全バリエーションに適用";
applySizeModeToAllBtn.addEventListener("click", () => {
  const mode: SizeMode = finalSizeRadio.checked ? "final" : "mini";
  grid.setSizeModeForAll(mode);
});
sizeModeGroup.appendChild(applySizeModeToAllBtn);

variantViewBarEl.appendChild(sizeModeGroup);

function updateSizeModeDisplay(mode: "mini" | "final"): void {
  miniSizeRadio.checked = mode === "mini";
  finalSizeRadio.checked = mode === "final";
}
grid.onActiveSizeModeChange = updateSizeModeDisplay;

// 背景色グループ — margin-left:autoで常に現在の行の右端に固定(CSS側)。
const bgGroup = document.createElement("div");
bgGroup.className = "view-bar-group view-bar-bg-group";
variantViewBarEl.appendChild(bgGroup);

// 行の折り返し位置を指定するための幅0のスペーサー。グループ自体にflex-basis:100%を付けると
// そのグループが行の全幅を占有してしまい、同じ行に並べたい後続グループが次の行に押し出されて
// しまう。代わりにこの「スペーサーだけ」がflex-basis:100%になって行を折り返させ、後続の
// グループは通常通り同じ新しい行の中で並ぶ(updateViewBarLayout/CSSのlayout-2line・3lineで使用)。
const viewBarBreakA = document.createElement("div");
viewBarBreakA.className = "view-bar-linebreak view-bar-linebreak-a";
variantViewBarEl.appendChild(viewBarBreakA);

const viewBarBreakB = document.createElement("div");
viewBarBreakB.className = "view-bar-linebreak view-bar-linebreak-b";
variantViewBarEl.appendChild(viewBarBreakB);

const bgViewDivider = document.createElement("span");
bgViewDivider.className = "toolbar-divider";
bgGroup.appendChild(bgViewDivider);

const bgLabel = document.createElement("span");
bgLabel.textContent = "背景色";
bgGroup.appendChild(bgLabel);

const bgColorSwatch = document.createElement("button");
bgColorSwatch.className = "color-swatch";
bgColorSwatch.title = "プレビュー背景色(右クリック/ダブルクリックで変更・書き出しには影響しません)";
bgColorSwatch.addEventListener("click", () => {
  bgMode = "color";
  refreshBgSwatches();
  grid.setPreviewBackground(rgbaToCss(bgColor));
});
bgColorSwatch.addEventListener("dblclick", () => openBgColorDialog());
bgColorSwatch.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  openBgColorDialog();
});

const bgTransparentSwatch = document.createElement("button");
bgTransparentSwatch.className = "color-swatch transparent-swatch";
bgTransparentSwatch.title = "プレビュー背景を透過(チェッカー)にする";
bgTransparentSwatch.addEventListener("click", () => {
  bgMode = "transparent";
  refreshBgSwatches();
  grid.setPreviewBackground(null);
});

bgGroup.appendChild(bgColorSwatch);
bgGroup.appendChild(bgTransparentSwatch);

// 幅に応じて1〜3行に折り返す。
//   1行: actions + zoom + zoomAuto + sizeMode + bg がすべて収まる。
//   2行目: actions + sizeMode + bg / 2行目: zoom + zoomAuto
//   3行: 1行目: actions + bg / 2行目: sizeMode + zoom / 3行目: zoomAuto
function updateViewBarLayout(): void {
  // 判定の前に一旦解除してから幅を測る — layout-2line/3line(flex-basis:100%)が付いたままだと
  // scrollWidthが「現在表示されている(コンテナ幅に広がった)幅」を返してしまい、一度折り返したら
  // 元の行数に戻れなくなる(ヒステリシス)。
  variantViewBarEl.classList.remove("layout-2line", "layout-3line");
  const gap = 8; // #variant-view-barのgapと合わせる
  const actionsW = actionsGroup.scrollWidth;
  const zoomW = zoomGroup.scrollWidth;
  const zoomAutoW = zoomAutoGroup.scrollWidth;
  const sizeModeW = sizeModeGroup.scrollWidth;
  const bgW = bgGroup.scrollWidth;
  const containerW = variantViewBarEl.clientWidth;

  const oneLineTotal = actionsW + zoomW + zoomAutoW + sizeModeW + bgW + gap * 4;
  if (oneLineTotal <= containerW) return;

  const twoLineRow1 = actionsW + sizeModeW + bgW + gap * 2;
  const twoLineRow2 = zoomW + zoomAutoW + gap;
  if (twoLineRow1 <= containerW && twoLineRow2 <= containerW) {
    variantViewBarEl.classList.add("layout-2line");
    return;
  }

  variantViewBarEl.classList.add("layout-3line");
}
new ResizeObserver(() => updateViewBarLayout()).observe(variantViewBarEl);
// ResizeObserverは要素自体のサイズ変化で発火するはずだが、保険としてwindowのresizeでも
// 再判定する(ウィンドウリサイズ直後の一部環境でResizeObserverの発火が遅れることがあるため)。
window.addEventListener("resize", updateViewBarLayout);
updateViewBarLayout();

function openBgColorDialog(): void {
  colorDialog.open("プレビュー背景色", bgColor, (rgba) => {
    bgColor = rgba;
    bgMode = "color";
    refreshBgSwatches();
    grid.setPreviewBackground(rgbaToCss(bgColor));
  });
}

function refreshBgSwatches(): void {
  bgColorSwatch.style.background = rgbToHex(bgColor[0], bgColor[1], bgColor[2]);
  bgColorSwatch.style.opacity = String(bgColor[3] / 255);
  bgColorSwatch.classList.toggle("selected", bgMode === "color");
  bgTransparentSwatch.classList.toggle("selected", bgMode === "transparent");
}
refreshBgSwatches();

// ---------------------------------------------------------------------------
// Top toolbar: undo/redo, tools, pen size, colors
// ---------------------------------------------------------------------------
function divider(): HTMLSpanElement {
  const el = document.createElement("span");
  el.className = "toolbar-divider";
  return el;
}

// 常に1行目に残したい最小限の操作(undo/redo・各ツール)はtoolbarPrimaryGroupに、幅が足りない
// 時は2行目に送ってよい項目(ブラシサイズ・グラデーションのペア選択・配色)はtoolbarConditionalGroup
// にまとめる — 幅が足りない時はconditionalGroup全体だけを2行目へ折り返す(updateToolbarLayout)。
const toolbarPrimaryGroup = document.createElement("div");
toolbarPrimaryGroup.className = "toolbar-group toolbar-primary-group";
topToolbarEl.appendChild(toolbarPrimaryGroup);

const toolbarConditionalGroup = document.createElement("div");
toolbarConditionalGroup.className = "toolbar-group toolbar-conditional-group";
topToolbarEl.appendChild(toolbarConditionalGroup);

const undoBtn = document.createElement("button");
undoBtn.className = "toolbar-icon-btn toolbar-undo-redo-btn";
undoBtn.textContent = "↶";
undoBtn.title = "元に戻す";
undoBtn.addEventListener("click", () => grid.undoActive());

const redoBtn = document.createElement("button");
redoBtn.className = "toolbar-icon-btn toolbar-undo-redo-btn";
redoBtn.textContent = "↷";
redoBtn.title = "やり直す";
redoBtn.addEventListener("click", () => grid.redoActive());

toolbarPrimaryGroup.appendChild(undoBtn);
toolbarPrimaryGroup.appendChild(redoBtn);
toolbarPrimaryGroup.appendChild(divider());

function updateUndoRedoButtons(): void {
  undoBtn.disabled = !grid.canUndoActive();
  redoBtn.disabled = !grid.canRedoActive();
}

const toolButtons: Partial<Record<ToolId, HTMLButtonElement>> = {};
for (const id of REGULAR_TOOL_ORDER) {
  const btn = document.createElement("button");
  btn.className = "toolbar-icon-btn";
  btn.innerHTML = toolIcons[id];
  btn.title = toolTitles[id];
  btn.addEventListener("click", () => selectTool(id));
  toolbarPrimaryGroup.appendChild(btn);
  toolButtons[id] = btn;
}

// 選択範囲系(矩形/楕円/投げ縄/自動選択)は1つのボタンにまとめ、ダブルクリック・右クリック・
// 「すでに選択範囲ツールが有効な状態でのクリック」のいずれかでプルダウンを開いて切り替える。
let activeSelectionVariant: ToolId = "rectSelect";

const selectionGroupBtn = document.createElement("button");
selectionGroupBtn.className = "toolbar-icon-btn";

function updateSelectionGroupButton(): void {
  selectionGroupBtn.innerHTML = toolIcons[activeSelectionVariant];
  selectionGroupBtn.title = `${toolTitles[activeSelectionVariant]}(ダブルクリック/右クリックで切替)`;
}
updateSelectionGroupButton();

function openSelectionDropdown(): void {
  menu.toggle(selectionGroupBtn, (container, m) => {
    for (const id of selectionToolIds) {
      m.addItem(container, toolTitles[id], () => {
        activeSelectionVariant = id;
        updateSelectionGroupButton();
        selectTool(id);
      });
    }
  });
}

selectionGroupBtn.addEventListener("click", () => {
  if (selectionToolIds.includes(activeId)) openSelectionDropdown();
  else selectTool(activeSelectionVariant);
});
selectionGroupBtn.addEventListener("dblclick", () => openSelectionDropdown());
selectionGroupBtn.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  openSelectionDropdown();
});
toolbarPrimaryGroup.appendChild(selectionGroupBtn);

const gradientBtn = document.createElement("button");
gradientBtn.className = "toolbar-icon-btn";
gradientBtn.innerHTML = toolIcons.gradient;
gradientBtn.title = toolTitles.gradient;
gradientBtn.addEventListener("click", () => selectTool("gradient"));
toolbarPrimaryGroup.appendChild(gradientBtn);

// グラデーションの色ペア選択は色変更ボタンのすぐ右に置く(下の colorGroup 組み立て部分を参照)。
const gradientPairSelect = document.createElement("select");
gradientPairSelect.className = "gradient-pair-select";
const gradientPairOptions: { value: GradientPair; label: string }[] = [
  { value: "mainToSub", label: "メイン→サブ" },
  { value: "mainToTransparent", label: "メイン→透明" },
  { value: "subToTransparent", label: "サブ→透明" }
];
for (const opt of gradientPairOptions) {
  const el = document.createElement("option");
  el.value = opt.value;
  el.textContent = opt.label;
  gradientPairSelect.appendChild(el);
}
gradientPairSelect.addEventListener("change", () => {
  tools.gradient.pair = gradientPairSelect.value as GradientPair;
});
gradientPairSelect.style.display = "none";
// ブラシサイズ・グラデーションのペア選択は、選んだツールによって出たり消えたりするので
// toolbarConditionalGroupにまとめる(幅が足りない時はこのグループだけ2行目へ折り返る)。
toolbarConditionalGroup.appendChild(gradientPairSelect);

const penSizeGroup = document.createElement("div");
penSizeGroup.className = "pen-size-group";
const sizeSlider = document.createElement("input");
sizeSlider.type = "range";
sizeSlider.min = "1";
sizeSlider.max = "500";
const sizeDisplay = document.createElement("button");
sizeDisplay.className = "pen-size-display";
sizeDisplay.title = "プリセットサイズから選ぶ (Alt+B)";
sizeDisplay.addEventListener("click", () => openBrushSizeDialog());
sizeSlider.addEventListener("input", () => {
  const tool = tools[activeId];
  if (hasSize(tool)) {
    tool.size = Number(sizeSlider.value);
    sizeDisplay.textContent = `${tool.size}px`;
  }
});
penSizeGroup.appendChild(sizeSlider);
penSizeGroup.appendChild(sizeDisplay);
toolbarConditionalGroup.appendChild(penSizeGroup);

function updatePenSizeUI(): void {
  const tool = tools[activeId];
  const sizable = hasSize(tool);
  // ブラシサイズを持たないツール(選択範囲・グラデーション等)ではスライダー/ボタンごと隠す。
  penSizeGroup.style.display = sizable ? "" : "none";
  if (sizable) {
    sizeSlider.value = String(tool.size);
    sizeDisplay.textContent = `${tool.size}px`;
  }
}

const colorGroup = document.createElement("div");
colorGroup.className = "color-swatch-group";

const mainSwatch = document.createElement("button");
mainSwatch.className = "color-swatch";
mainSwatch.title = "メインカラー(右クリック/ダブルクリックで変更)";
mainSwatch.addEventListener("click", () => {
  lastColorSlot = "main";
  activeColorSlot = "main";
  applyColorToTools(mainColor);
  refreshColorSwatches();
});
mainSwatch.addEventListener("dblclick", () => openColorDialogFor("main"));
mainSwatch.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  openColorDialogFor("main");
});

const subSwatch = document.createElement("button");
subSwatch.className = "color-swatch";
subSwatch.title = "サブカラー(右クリック/ダブルクリックで変更)";
subSwatch.addEventListener("click", () => {
  lastColorSlot = "sub";
  activeColorSlot = "sub";
  applyColorToTools(subColor);
  refreshColorSwatches();
});
subSwatch.addEventListener("dblclick", () => openColorDialogFor("sub"));
subSwatch.addEventListener("contextmenu", (e) => {
  e.preventDefault();
  openColorDialogFor("sub");
});

const transparentSwatch = document.createElement("button");
transparentSwatch.className = "color-swatch transparent-swatch";
transparentSwatch.title = "透明色(選んだツールの形で消去します)";
transparentSwatch.addEventListener("click", () => {
  activeColorSlot = "transparent";
  applyColorToTools([0, 0, 0, 0]);
  refreshColorSwatches();
});

const changeColorBtn = document.createElement("button");
changeColorBtn.className = "change-color-btn";
changeColorBtn.textContent = "色変更";
changeColorBtn.title = "色変更 (Alt+C)";
changeColorBtn.addEventListener("click", () => openColorDialogFor(lastColorSlot));

colorGroup.appendChild(mainSwatch);
colorGroup.appendChild(subSwatch);
colorGroup.appendChild(transparentSwatch);
colorGroup.appendChild(changeColorBtn);
// 配色は常時表示だが、幅が足りない時はブラシサイズ等と一緒に2行目へ送ってよい。
toolbarConditionalGroup.appendChild(colorGroup);

function refreshColorSwatches(): void {
  // checkeredBackgroundImage()は色(alpha込み)のレイヤーを市松模様の上に重ねる —
  // element.style.opacityで要素全体を薄めると市松模様(同じ要素のbackground-image)まで
  // 一緒に薄まり、どの不透明度でも市松が透けて見える・色自体も薄汚れて見える不具合になる。
  mainSwatch.style.backgroundImage = checkeredBackgroundImage(mainColor[0], mainColor[1], mainColor[2], mainColor[3]);
  subSwatch.style.backgroundImage = checkeredBackgroundImage(subColor[0], subColor[1], subColor[2], subColor[3]);
  mainSwatch.classList.toggle("selected", activeColorSlot === "main");
  subSwatch.classList.toggle("selected", activeColorSlot === "sub");
  transparentSwatch.classList.toggle("selected", activeColorSlot === "transparent");
}

function selectTool(id: ToolId): void {
  activeId = id;
  grid.setToolForAll(tools[id]);
  // 選択範囲系の4ツールは1つのボタン(selectionGroupBtn)を共有しているため、個別キーの
  // ループで active を付け外しすると、同じ要素への後続の "false" 設定で直前の "true" が
  // 上書きされてしまう。グループ単位でまとめて判定する。
  for (const toolId of REGULAR_TOOL_ORDER) {
    toolButtons[toolId]?.classList.toggle("active", toolId === id);
  }
  selectionGroupBtn.classList.toggle("active", selectionToolIds.includes(id));
  gradientBtn.classList.toggle("active", id === "gradient");
  gradientPairSelect.style.display = id === "gradient" ? "" : "none";
  updatePenSizeUI();
}

// 幅が足りない時は、toolbarConditionalGroup(ブラシサイズ・グラデーションのペア選択・配色)
// だけをまとめて2行目へ折り返す(undo/redo・各ツールボタンは常に1行目に残る)。
function updateToolbarLayout(): void {
  toolbarConditionalGroup.classList.remove("force-new-line");
  const gap = 4; // #top-toolbarのgapに合わせる
  const total = toolbarPrimaryGroup.scrollWidth + toolbarConditionalGroup.scrollWidth + gap;
  const fitsOneLine = total <= topToolbarEl.clientWidth;
  toolbarConditionalGroup.classList.toggle("force-new-line", !fitsOneLine);
}
// conditionalGroup自体の表示/非表示切り替え(ツール変更時)でも幅が変わるため、両方を監視する。
new ResizeObserver(() => updateToolbarLayout()).observe(topToolbarEl);
new ResizeObserver(() => updateToolbarLayout()).observe(toolbarConditionalGroup);
window.addEventListener("resize", updateToolbarLayout);
updateToolbarLayout();

// ---------------------------------------------------------------------------
// Keyboard shortcuts
//   無modifier: Delete=消去
//   Alt:        Delete=塗りつぶし, C=色変更, B=ブラシサイズ変更, S=出力, R=新規に読み込み
//   Alt+Shift:  S=一括出力
//   Ctrl:       Z=戻る, Y=進む, D=選択解除, A=全選択, N=新規バリエーション, O=開く,
//               R=追加で読み込み, S=保存, C=コピー, X=切り取り, V=貼り付け, T=拡大・縮小・回転
//   Ctrl+Shift: N=新規, R=一括読み込み, Delete=バリエーション削除, T=自由変形
// ---------------------------------------------------------------------------
window.addEventListener("keydown", (e) => {
  if (e.metaKey) return;
  const target = e.target as HTMLElement;
  // テキスト入力中は、ブラウザ標準の undo/redo/select-all/copy/paste をそのまま使わせる。
  if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;
  const key = e.key.toLowerCase();

  if (!e.ctrlKey && !e.altKey) {
    if (e.key === "Delete") {
      e.preventDefault();
      clearActiveLayer();
    }
    return;
  }

  if (e.altKey && !e.ctrlKey) {
    if (e.shiftKey) {
      if (key === "s") {
        e.preventDefault();
        batchExportDialog.show(grid.getAll().length);
      }
      return;
    }
    if (e.key === "Delete") {
      e.preventDefault();
      fillActiveLayer();
    } else if (key === "c") {
      e.preventDefault();
      openColorDialogFor(lastColorSlot);
    } else if (key === "b") {
      e.preventDefault();
      openBrushSizeDialog();
    } else if (key === "s") {
      e.preventDefault();
      openSaveDialogForActive();
    } else if (key === "r") {
      e.preventDefault();
      startLoadNew();
    }
    return;
  }

  if (e.ctrlKey && !e.altKey) {
    if (e.shiftKey) {
      if (key === "n") {
        e.preventDefault();
        newDocDialog.show();
      } else if (key === "r") {
        e.preventDefault();
        batchLoadFileInput.click();
      } else if (e.key === "Delete") {
        e.preventDefault();
        deleteActiveVariant();
      } else if (key === "t") {
        e.preventDefault();
        startFreeTransform();
      }
      return;
    }
    switch (key) {
      case "z":
        e.preventDefault();
        grid.undoActive();
        break;
      case "y":
        e.preventDefault();
        grid.redoActive();
        break;
      case "d":
        e.preventDefault();
        deselectActive();
        break;
      case "a":
        e.preventDefault();
        selectAllActive();
        break;
      case "n":
        e.preventDefault();
        grid.addVariantLikeActive();
        break;
      case "o":
        e.preventDefault();
        void openProjectFile();
        break;
      case "r":
        e.preventDefault();
        startLoadAdd();
        break;
      case "s":
        e.preventDefault();
        void saveProjectFile();
        break;
      case "c":
        e.preventDefault();
        copyActive();
        break;
      case "x":
        e.preventDefault();
        cutActive();
        break;
      case "v":
        e.preventDefault();
        pasteActive();
        break;
      case "t":
        e.preventDefault();
        startScaleRotateTransform();
        break;
    }
  }
});

// ---------------------------------------------------------------------------
// バリエーション表示領域(#canvas-viewport)のタッチ/マウスドラッグでのスクロール。
//   ・1本指(タッチ)・マウス: キャンバスの外(タイル間の余白・非アクティブなバリエーション等)
//     で始めた場合のみスクロール対象にする。キャンバス上で始めた場合は描画に使うため奪わない —
//     ブラウザは「描画中の連続ドラッグ」と「スクロール操作」を1本の動きだけでは区別できない
//     ため、両立できない(ユーザー確認済み: キャンバス外=スクロール、キャンバス内=描画/
//     タッチは2本指でスクロールという使い分け)。マウスは常に1ポインターなので、この
//     1本指と同じ分岐をそのまま通る。
//   ・2本指(タッチのみ): キャンバスの内外を問わず常にスクロール対象。ピンチズーム(距離の変化、
//     canvas-widget.ts側で処理)とは独立に、2本指の中点の移動量でスクロールする —
//     ピンチしながら同時に平行移動もできる(地図アプリのピンチ操作と同じ感覚)。
// ---------------------------------------------------------------------------
{
  const activePointers = new Map<number, { x: number; y: number }>();
  let scrollStartLeft = 0;
  let scrollStartTop = 0;
  let scrollStartMidX = 0;
  let scrollStartMidY = 0;
  let panning = false;
  let panningPointerId: number | null = null; // 1本指パン中のpointerId(2本指パン中はnull)

  function isInsideDocCanvas(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(".doc-canvas") !== null;
  }

  function currentMidpoint(): { x: number; y: number } {
    const pts = Array.from(activePointers.values()).slice(0, 2);
    if (pts.length === 1) return pts[0];
    return { x: (pts[0].x + pts[1].x) / 2, y: (pts[0].y + pts[1].y) / 2 };
  }

  canvasViewport.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "touch" && e.pointerType !== "mouse") return; // ペンは常に描画専用。
    // ペンが触れている間は、手のひらの誤タッチ(パームリジェクション)としてタッチでの
    // パンも一切受け付けない(ユーザー要望)。マウスはペンの有無に関係なく常に有効。
    if (e.pointerType === "touch" && isPenActive()) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (activePointers.size === 1) {
      if (isInsideDocCanvas(e.target)) return; // キャンバス上の1本指は描画に使わせる。
      panning = true;
      panningPointerId = e.pointerId;
      scrollStartLeft = canvasViewport.scrollLeft;
      scrollStartTop = canvasViewport.scrollTop;
      ({ x: scrollStartMidX, y: scrollStartMidY } = currentMidpoint());
    } else if (activePointers.size === 2) {
      // 1本指パン中でもキャンバス上の指でも、2本目が触れた時点で常に2本指パンへ切り替える。
      panning = true;
      panningPointerId = null;
      scrollStartLeft = canvasViewport.scrollLeft;
      scrollStartTop = canvasViewport.scrollTop;
      ({ x: scrollStartMidX, y: scrollStartMidY } = currentMidpoint());
    }
  });

  canvasViewport.addEventListener("pointermove", (e) => {
    if (!activePointers.has(e.pointerId)) return;
    // パン中に途中からペンが触れた場合も、以降はタッチでの移動を無視する(パームリジェクション)。
    if (e.pointerType === "touch" && isPenActive()) return;
    activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!panning) return;
    if (panningPointerId !== null && panningPointerId !== e.pointerId) return;
    const mid = currentMidpoint();
    canvasViewport.scrollLeft = scrollStartLeft - (mid.x - scrollStartMidX);
    canvasViewport.scrollTop = scrollStartTop - (mid.y - scrollStartMidY);
  });

  const endTouch = (e: PointerEvent): void => {
    if (e.pointerType !== "touch" && e.pointerType !== "mouse") return;
    activePointers.delete(e.pointerId);
    if (activePointers.size === 0) {
      panning = false;
      panningPointerId = null;
    } else if (panningPointerId === e.pointerId) {
      // 2本の片方が離れたら、残った1本で続ける(キャンバス外ならそのままパン継続)。
      const remaining = Array.from(activePointers.entries())[0];
      if (remaining && !isInsideDocCanvas(document.elementFromPoint(remaining[1].x, remaining[1].y))) {
        panningPointerId = remaining[0];
        scrollStartLeft = canvasViewport.scrollLeft;
        scrollStartTop = canvasViewport.scrollTop;
        scrollStartMidX = remaining[1].x;
        scrollStartMidY = remaining[1].y;
      } else {
        panning = false;
        panningPointerId = null;
      }
    } else if (panningPointerId === null && activePointers.size === 1) {
      // 2本指パンから1本指に減った場合も同様に引き継ぐ。
      const remaining = Array.from(activePointers.entries())[0];
      if (!isInsideDocCanvas(document.elementFromPoint(remaining[1].x, remaining[1].y))) {
        panningPointerId = remaining[0];
        scrollStartLeft = canvasViewport.scrollLeft;
        scrollStartTop = canvasViewport.scrollTop;
        scrollStartMidX = remaining[1].x;
        scrollStartMidY = remaining[1].y;
      } else {
        panning = false;
      }
    }
  };
  canvasViewport.addEventListener("pointerup", endTouch);
  canvasViewport.addEventListener("pointercancel", endTouch);
}

// ---------------------------------------------------------------------------
// レイアウトモード(縦長/横長) — スマホの縦持ちでは幅が狭すぎてレイヤーパネル等を横に置けない
// ので、ビューポートが縦長の時はbodyに.portrait-layoutを付けてCSS側で下段配置に切り替える。
// 縦長の間はタッチ(指)での描画も許可する(横長=PC想定ではタッチは誤操作防止で無効のまま)。
// ---------------------------------------------------------------------------
let wasPortraitLayout = false;
function updateLayoutMode(): void {
  const isPortrait = window.innerWidth < window.innerHeight;
  document.body.classList.toggle("portrait-layout", isPortrait);
  grid.setTouchEditingEnabledForAll(isPortrait);
  // 横長⇄縦長が切り替わった瞬間は、常に閉じた状態から始める(縦長内での単純なリサイズでは
  // ユーザーが開いていたドロワーの状態を維持する)。
  if (isPortrait !== wasPortraitLayout) {
    closeLayerDrawer();
    setMobileNavDrawerOpen(false);
    setMobileViewbarDrawerOpen(false);
  }
  wasPortraitLayout = isPortrait;
}
window.addEventListener("resize", updateLayoutMode);
window.addEventListener("orientationchange", updateLayoutMode);

// ---------------------------------------------------------------------------
// スマホ縦持ち専用の2種類のドロワー:
//   ・ナビゲーションドロワー(ファイル/編集/選択範囲/ヘルプ/設定のメニューバー) — 左から
//   ・表示バードロワー(バリエーション操作/倍率/表示サイズ切替/背景色) — 上から
// ツールバー(ペン等の描画ツール)はどちらにも入れず常時表示のまま。
// ---------------------------------------------------------------------------
const mobileNavDrawerEl = document.getElementById("mobile-nav-drawer")!;
const mobileNavBackdropEl = document.getElementById("mobile-nav-backdrop")!;
const mobileNavToggleBtn = document.getElementById("mobile-nav-toggle")!;
let mobileNavDrawerOpen = false;

/** 開閉位置をleft(px)で直接設定する。#layer-panelのapplyLayerDrawerBottomと同じ理由
 * (transition付きのtransform/プロパティ変更がこの環境ではcomputed styleに反映されない
 * ことがある)で、常にtransitionを無効化してから値を設定し、強制リフローで確実に反映させる。 */
function applyMobileNavLeft(leftPx: number): void {
  mobileNavDrawerEl.style.transition = "none";
  mobileNavDrawerEl.style.left = `${leftPx}px`;
  mobileNavDrawerEl.getBoundingClientRect(); // 強制リフロー
}

function setMobileNavDrawerOpen(open: boolean): void {
  mobileNavDrawerOpen = open;
  mobileNavBackdropEl.classList.toggle("open", open);
  applyMobileNavLeft(open ? 0 : -mobileNavDrawerEl.getBoundingClientRect().width);
  // 次に開いた時は常に全アコーディオン折りたたみ済みの状態から始める。
  if (!open) closeAllNavAccordionSections();
}

mobileNavToggleBtn.addEventListener("click", () => setMobileNavDrawerOpen(!mobileNavDrawerOpen));
mobileNavBackdropEl.addEventListener("click", () => setMobileNavDrawerOpen(false));
new ResizeObserver(() => {
  if (!mobileNavDrawerOpen) applyMobileNavLeft(-mobileNavDrawerEl.getBoundingClientRect().width);
}).observe(mobileNavDrawerEl);

// バリエーション操作/倍率/表示サイズ切替/背景色は、キャンバスやツールバーに被せる
// オーバーレイではなく、通常のフロー内でツールバーを押し下げる形で開閉する(display:none/flex
// の切替だけで済む — position:fixedではないのでtransformの反映不具合も関係しない)。
const mobileViewbarDrawerEl = document.getElementById("mobile-viewbar-drawer")!;
// #layer-panel-handleと同じ「全幅の横長ハンドルバー」(小さなボタンではない)がトリガー。
const mobileViewbarHandleEl = document.getElementById("mobile-viewbar-handle")!;
let mobileViewbarDrawerOpen = false;

function setMobileViewbarDrawerOpen(open: boolean): void {
  mobileViewbarDrawerOpen = open;
  mobileViewbarDrawerEl.classList.toggle("open", open);
  mobileViewbarHandleEl.textContent = open ? "▲" : "▾";
}

mobileViewbarHandleEl.addEventListener("click", () => setMobileViewbarDrawerOpen(!mobileViewbarDrawerOpen));

// ---------------------------------------------------------------------------
// レイヤーパネルのボトムシート化(縦長レイアウト専用) — 普段は画面下端につまみだけ見える状態
// で隠れていて、つまみを上にドラッグするとスライドアップして開く。ドラッグ距離が小さければ
// タップ(開閉トグル)として扱う。
// ---------------------------------------------------------------------------
const layerPanelEl = document.getElementById("layer-panel")!;
const layerPanelHandle = document.getElementById("layer-panel-handle")!;
let layerDrawerOpen = false;
let layerDrawerDragStartY = 0;
let layerDrawerDragMoved = false;

/** --layer-drawer-handle-h の実測値(px) — 閉じた状態で隠れる量は「パネル高さ全体」ではなく
 * 「パネル高さ - つまみの高さ」(つまみだけ画面に残る分)なので、ドラッグ中の計算にも必要。 */
function getLayerDrawerHandleHeight(): number {
  const value = getComputedStyle(document.body).getPropertyValue("--layer-drawer-handle-h");
  return parseFloat(value) || 28;
}

/** 開閉位置をbottom(px)で設定する。transition付きのプロパティ変更がcomputed styleに反映
 * されない(見た目が更新されない)現象が確認されたため、毎回transitionを無効化してから値を
 * 設定し、強制リフローで確実に反映させる。アニメーションより「必ず正しい位置に開閉する」こと
 * を優先する。 */
function applyLayerDrawerBottom(bottomPx: number): void {
  layerPanelEl.style.transition = "none";
  layerPanelEl.style.bottom = `${bottomPx}px`;
  layerPanelEl.getBoundingClientRect(); // 強制リフロー
}

function closeLayerDrawer(): void {
  layerDrawerOpen = false;
  layerPanelEl.classList.remove("drawer-open", "drawer-dragging");
  const maxHidden = layerPanelEl.getBoundingClientRect().height - getLayerDrawerHandleHeight();
  applyLayerDrawerBottom(-maxHidden);
}

function setLayerDrawerOpen(open: boolean): void {
  if (open) {
    layerDrawerOpen = true;
    layerPanelEl.classList.add("drawer-open");
    applyLayerDrawerBottom(0);
  } else {
    closeLayerDrawer();
  }
}

layerPanelHandle.addEventListener("pointerdown", (e) => {
  layerDrawerDragStartY = e.clientY;
  layerDrawerDragMoved = false;
  layerPanelEl.classList.add("drawer-dragging");
  layerPanelHandle.setPointerCapture(e.pointerId);
});
layerPanelHandle.addEventListener("pointermove", (e) => {
  if (!layerPanelHandle.hasPointerCapture(e.pointerId)) return;
  // 上にドラッグ(delta<0)するほどbottomが0に近づいて開く方向に動く。
  const delta = e.clientY - layerDrawerDragStartY;
  if (Math.abs(delta) > 4) layerDrawerDragMoved = true;
  const maxHidden = layerPanelEl.getBoundingClientRect().height - getLayerDrawerHandleHeight();
  const baseBottom = layerDrawerOpen ? 0 : -maxHidden;
  const clamped = Math.max(-maxHidden, Math.min(0, baseBottom - delta));
  layerPanelEl.style.bottom = `${clamped}px`;
});
layerPanelHandle.addEventListener("pointerup", (e) => {
  if (!layerPanelHandle.hasPointerCapture(e.pointerId)) return;
  layerPanelHandle.releasePointerCapture(e.pointerId);
  layerPanelEl.classList.remove("drawer-dragging");
  if (!layerDrawerDragMoved) {
    // 僅かな移動(=実質タップ)はドラッグではなく開閉トグルとして扱う。
    setLayerDrawerOpen(!layerDrawerOpen);
    return;
  }
  const maxHidden = layerPanelEl.getBoundingClientRect().height - getLayerDrawerHandleHeight();
  const delta = e.clientY - layerDrawerDragStartY;
  const baseBottom = layerDrawerOpen ? 0 : -maxHidden;
  const clamped = Math.max(-maxHidden, Math.min(0, baseBottom - delta));
  setLayerDrawerOpen(clamped > -maxHidden / 2);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
refreshColorSwatches();
applyColorToTools(mainColor);
grid.reset(Document.createDefault(DEFAULT_MINI_WIDTH, DEFAULT_MINI_HEIGHT));
grid.setPreviewBackground(bgMode === "transparent" ? null : rgbaToCss(bgColor));
// 鉛筆はリロードごとにクラス定義の初期値(2px)へ戻ってしまうという指摘を受けて、起動時のサイズを
// 設定値で上書きする(ユーザーが設定で変えない限り2pxのまま、デフォルトの見た目は変わらない)。
tools.pencil.size = appSettings.defaultBrushSize;
applyPressureSettingsToTools(appSettings);
selectTool("pencil");
updateUndoRedoButtons();
updateLayoutMode();
restartAutoSaveTimer();
// 起動時の初期ドキュメント作成はgrid.onEditを発火させるが、これはユーザーの「変更」ではない。
isDirty = false;
// 前回のファイル(実ファイルのハンドル、無ければ自動保存キャッシュ)が生きていれば無言で
// 読み込む。どちらも無い/失敗した場合は何もせず上の白紙ドキュメントのまま。
void tryAutoRestoreOnStartup();
