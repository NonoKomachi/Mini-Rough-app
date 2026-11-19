import {
  Document,
  StrokeTool,
  DragTool,
  PickTool,
  RGBA,
  UndoStack,
  snapshotLayers,
  restoreLayers,
  reconcileDocumentResolution
} from "@mini-rough/core";
import { CanvasWidget } from "./canvas-widget";

export type SizeMode = "mini" | "final";

export interface Variant {
  id: string;
  label: string;
  doc: Document;
  widget: CanvasWidget;
  tileEl: HTMLElement;
  canvasHost: HTMLElement;
  nameEl: HTMLElement;
  undoStack: UndoStack;
  /** Which resolution the canvas is currently displayed/edited at. */
  sizeMode: SizeMode;
  /** The working (mini) resolution to return to when switching back from "final" — kept
   * separately from doc.width/height since those change out from under us while sizeMode is
   * "final". Updated whenever the mini resolution is deliberately changed (キャンバスサイズ). */
  miniWidth: number;
  miniHeight: number;
  /** Undo history for whichever sizeMode is NOT currently active — kept apart from `undoStack`
   * because the two modes' snapshots have different layer pixel dimensions; mixing them into one
   * stack would let an undo restore mini-sized layers into a final-sized Document (or vice
   * versa), corrupting it. */
  otherModeUndoStack: UndoStack;
  /** The OTHER sizeMode's own persisted Document (its last-synced pixel data at that
   * resolution), or null if that mode has never been visited yet. Kept across switches — see
   * VariantGrid.applySizeMode — so detail painted while displaying at one resolution survives
   * toggling to the other resolution and back, instead of being discarded and re-derived
   * (blurrily) from whichever resolution happens to be active at the moment of the switch. */
  otherModeDoc: Document | null;
  /** Reference kept so programmatic zoom-lock changes (project-file restore) can keep the
   * checkbox's displayed state in sync — see VariantGrid.setZoomLockedFor. */
  zoomLockCheckbox: HTMLInputElement;
}

function createId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

type AutoFitMode = "all" | null;

// Must match .variant-grid's grid-auto-columns/grid-auto-rows in index.html.
const GRID_CELL_PX = 20;
// Must match .variant-grid's `gap` in index.html. CSS Grid inserts this gap between every
// track line, including the ones *inside* a multi-track span — so a naive
// `span = pxSize / GRID_CELL_PX` under-counts how many tracks a span of that pixel size
// actually needs, and tiles balloon far past their intended size. We invert the real formula
// (pxSize = span*CELL + (span-1)*GAP) to pick the span that fits the target size.
const GRID_GAP_PX = 12;

function spanForPx(px: number): number {
  // Must round UP: rounding to the nearest span can land on a track count whose actual pixel
  // size (span*CELL + (span-1)*GAP) is slightly SMALLER than the real content (e.g. a 60px-wide
  // canvas at zoom=1 rounds to a 2-column span worth only 52px), which then overflows its own
  // grid cell into neighboring tiles. Ceil guarantees the allocated cell is never smaller.
  return Math.max(1, Math.ceil((px + GRID_GAP_PX) / (GRID_CELL_PX + GRID_GAP_PX)));
}

export class VariantGrid {
  private readonly container: HTMLElement;
  private readonly gridEl: HTMLElement;
  private readonly getCurrentTool: () => StrokeTool | DragTool | PickTool;
  private readonly onActiveChange: (doc: Document, widget: CanvasWidget) => void;
  private previewBackground: string | null = null;
  private variants: Variant[] = [];
  private activeId: string | null = null;
  private autoFitMode: AutoFitMode = null;
  /** Applied to every widget, including ones created after this was last set — see
   * setTouchEditingEnabledForAll. */
  private touchEditingEnabled = false;
  /** Fired whenever a variant's undo/redo stack changes (push, undo, or redo) — refresh button states here. */
  onHistoryChange: (() => void) | null = null;
  /** Fired whenever the ACTIVE variant's zoom changes (including switching to a different active variant) — refresh the persistent zoom display here. */
  onActiveZoomChange: ((zoom: number) => void) | null = null;
  /** Right-click eyedropper (any tool) or the eyedropper tool itself picked a color. */
  onColorPick: ((color: RGBA) => void) | null = null;
  /** Fired whenever the ACTIVE variant's size mode (mini/final) changes, including switching to a
   * different active variant — refresh the persistent mini/final radio buttons here. */
  onActiveSizeModeChange: ((mode: SizeMode) => void) | null = null;
  /** Fired whenever the project's actual CONTENT changes — a stroke/menu edit about to be
   * undo-snapshotted, or a variant being added/removed/duplicated. Deliberately NOT fired by
   * setActive (switching the active variant) or zoom/size-mode-only changes, so main.ts can use
   * this as an accurate "needs saving" (dirty) signal for the 終了時の確認 prompt. */
  onEdit: (() => void) | null = null;

  constructor(
    container: HTMLElement,
    getCurrentTool: () => StrokeTool | DragTool | PickTool,
    onActiveChange: (doc: Document, widget: CanvasWidget) => void
  ) {
    this.container = container;
    this.gridEl = document.createElement("div");
    this.gridEl.className = "variant-grid";
    container.appendChild(this.gridEl);
    this.getCurrentTool = getCurrentTool;
    this.onActiveChange = onActiveChange;

    new ResizeObserver(() => {
      // 単体フィッティングはボタンを押した時の一回限りの処理であって、ビューポートの
      // リサイズに追従して勝手に再適用するものではない(ユーザー指示) — 全体フィッティングは
      // 元々の仕様どおりリサイズに追従する。
      if (this.autoFitMode === "all") this.applyFitAll();
    }).observe(container);
  }

  /** Clears the grid and starts over with a single new document (used by "新規キャンバス").
   * Deliberately does NOT touch the preview background — that's a persistent app-wide display
   * preference (see setPreviewBackground), not something tied to any one document. */
  reset(doc: Document): void {
    for (const v of this.variants) {
      v.widget.dispose();
      v.tileEl.remove();
    }
    this.variants = [];
    this.autoFitMode = null;
    this.addVariant(doc);
  }

  /** Sets the preview backdrop (CSS color string, or null for the transparency checker) and
   * applies it live to every existing variant, not just future ones. */
  setPreviewBackground(background: string | null): void {
    this.previewBackground = background;
    for (const v of this.variants) v.widget.setPreviewBackground(background);
  }

  /** Allows/disallows touch (finger) editing on every widget, including ones added later —
   * main.ts toggles this when switching into/out of the portrait (smartphone) layout. */
  setTouchEditingEnabledForAll(enabled: boolean): void {
    this.touchEditingEnabled = enabled;
    for (const v of this.variants) v.widget.setTouchEditingEnabled(enabled);
  }

  /** Adds a sibling canvas (used by the initial reset, "バリエーション追加", and "開く"). */
  addVariant(doc: Document): Variant {
    const tile = document.createElement("div");
    tile.className = "variant-tile";

    const header = document.createElement("div");
    header.className = "variant-tile-header";
    const nameEl = document.createElement("span");
    header.appendChild(nameEl);

    const zoomLockCheckbox = document.createElement("input");
    zoomLockCheckbox.type = "checkbox";
    zoomLockCheckbox.className = "variant-zoom-lock";
    zoomLockCheckbox.title = "倍率固定(オンの間はこのバリエーションの拡大縮小操作を一切受け付けません)";
    // タイル全体のクリック(アクティブ化)にチェック操作が伝播して意図せずバリエーションが
    // 切り替わらないように。
    zoomLockCheckbox.addEventListener("click", (e) => e.stopPropagation());
    zoomLockCheckbox.addEventListener("change", () => widget.setZoomLocked(zoomLockCheckbox.checked));
    header.appendChild(zoomLockCheckbox);

    tile.appendChild(header);

    const canvasHost = document.createElement("div");
    canvasHost.className = "variant-canvas-host";
    tile.appendChild(canvasHost);

    this.gridEl.appendChild(tile);

    const widget = new CanvasWidget(canvasHost, doc, this.getCurrentTool());
    widget.setPreviewBackground(this.previewBackground);
    widget.setTouchEditingEnabled(this.touchEditingEnabled);

    const variant: Variant = {
      id: createId(),
      label: "",
      doc,
      widget,
      tileEl: tile,
      canvasHost,
      nameEl,
      undoStack: new UndoStack(),
      sizeMode: "mini",
      miniWidth: doc.width,
      miniHeight: doc.height,
      otherModeUndoStack: new UndoStack(),
      otherModeDoc: null,
      zoomLockCheckbox,
    };

    widget.onBeforeStroke = () => {
      variant.undoStack.pushUndo(snapshotLayers(variant.doc));
      this.onHistoryChange?.();
      this.onEdit?.();
    };
    widget.onZoomChange = (zoom) => {
      this.updateTileSpan(variant);
      if (this.activeId === variant.id) this.onActiveZoomChange?.(zoom);
    };
    widget.onColorPick = (color) => this.onColorPick?.(color);
    widget.onUndoGesture = () => this.undoActive();
    widget.onRedoGesture = () => this.redoActive();
    this.updateTileSpan(variant);

    tile.addEventListener("click", () => this.setActive(variant.id));

    this.variants.push(variant);
    // Labels always reflect creation order among the CURRENTLY remaining variants (#1, #2, ...)
    // rather than an ever-incrementing counter, so a deleted variant's number doesn't stay
    // "used up" — removeVariant() renumbers the same way after a deletion.
    this.renumberAll();
    this.setActive(variant.id);
    this.onEdit?.();
    return variant;
  }

  private renumberAll(): void {
    this.variants.forEach((v, i) => {
      v.label = `#${i + 1}`;
      v.nameEl.textContent = v.label;
    });
  }

  /** New variant seeded with the same settings as the currently active one, always starting at
   * 等倍 (zoom=1) rather than whatever fit-zoom a not-yet-laid-out host would otherwise compute. */
  addVariantLikeActive(): Variant | undefined {
    const active = this.getActive();
    if (!active) return undefined;
    const d = active.doc;
    const doc = Document.createDefault(d.width, d.height, d.finalWidth, d.finalHeight, d.dpi);
    const variant = this.addVariant(doc);
    variant.widget.setZoom(1);
    return variant;
  }

  /** New variant at the END of the list with the SAME layer structure (pixels, masks, folders,
   * opacity, etc.) as the currently active one — unlike addVariantLikeActive, which seeds an
   * empty document of the same size. Selection mask is deliberately not carried over, matching
   * CLIP STUDIO's "複製" convention of copying content, not transient edit state. */
  duplicateActiveVariant(): Variant | undefined {
    const active = this.getActive();
    if (!active) return undefined;
    const d = active.doc;
    const doc = new Document(d.width, d.height, d.finalWidth, d.finalHeight, d.dpi);
    restoreLayers(doc, snapshotLayers(d));
    const variant = this.addVariant(doc);
    variant.widget.setZoom(1);
    return variant;
  }

  removeVariant(id: string): "only-one" | "not-found" | "removed" {
    if (this.variants.length <= 1) return "only-one";
    const index = this.variants.findIndex((v) => v.id === id);
    if (index === -1) return "not-found";
    this.variants[index].widget.dispose();
    this.variants[index].tileEl.remove();
    this.variants.splice(index, 1);
    this.renumberAll();
    if (this.activeId === id) {
      const fallback = this.variants[Math.max(0, index - 1)];
      this.setActive(fallback.id);
    }
    this.onEdit?.();
    return "removed";
  }

  /** Rebuilds `variant`'s CanvasWidget around `newDoc` (same tile/host, re-wired the same way) —
   * shared by resizeActive (real キャンバスサイズ change) and applySizeMode (mini/final display
   * toggle). Leaves undoStack untouched; callers decide whether/how to swap or reset it.
   * Deliberately does NOT call setActive() — a bulk operation (setSizeModeForAll) rebuilds every
   * variant's widget in a loop, and activating each one in turn would flash the UI through every
   * tile and re-trigger onActiveChange for variants that were never meant to become active.
   * Callers that DO want this variant to become active call setActive() themselves afterward. */
  private rebuildWidget(variant: Variant, newDoc: Document): void {
    variant.widget.dispose();
    variant.canvasHost.innerHTML = "";
    // innerHTMLをクリアしても前のdoc/zoomで書き込まれたcanvasHostの実寸(style.width/height)は
    // 残ったままなので、クリアせずに次のCanvasWidgetを作るとそのstyle.width/heightが
    // computeFitZoom()の基準として読み込まれてしまう。mini⇄完成サイズの切替のたびに古いサイズを
    // 基準に新しいフィットを計算することになり、倍率がどんどん縮んでいく不具合の原因だった。
    // 新規バリエーション作成時(addVariant)と同じ「まっさらなホスト」の状態に戻してから作る。
    variant.canvasHost.style.width = "";
    variant.canvasHost.style.height = "";
    const widget = new CanvasWidget(variant.canvasHost, newDoc, this.getCurrentTool());
    widget.setPreviewBackground(this.previewBackground);
    widget.setTouchEditingEnabled(this.touchEditingEnabled);
    widget.onBeforeStroke = () => {
      variant.undoStack.pushUndo(snapshotLayers(variant.doc));
      this.onHistoryChange?.();
      this.onEdit?.();
    };
    widget.onZoomChange = (zoom) => {
      this.updateTileSpan(variant);
      if (this.activeId === variant.id) this.onActiveZoomChange?.(zoom);
    };
    widget.onColorPick = (color) => this.onColorPick?.(color);
    widget.onUndoGesture = () => this.undoActive();
    widget.onRedoGesture = () => this.redoActive();
    variant.doc = newDoc;
    variant.widget = widget;
    this.updateTileSpan(variant);
  }

  /** Swaps the active variant's document for a resized one (same tile; undo history resets — a
   * real キャンバスサイズ change invalidates old snapshots' pixel dimensions anyway). Always
   * returns to "mini" display mode and records the new size as the mini resolution to return to. */
  resizeActive(newDoc: Document): void {
    const active = this.getActive();
    if (!active) return;
    active.undoStack = new UndoStack();
    // otherModeUndoStack/otherModeDoc(完成サイズ側)はこのミニラフ解像度変更の影響を受けない
    // ので、わざと触れない — 消してしまうと完成サイズ側で描いた内容やその取り消し履歴まで
    // 無駄に失われる。
    active.sizeMode = "mini";
    active.miniWidth = newDoc.width;
    active.miniHeight = newDoc.height;
    this.rebuildWidget(active, newDoc);
    this.setActive(active.id);
    this.onEdit?.();
  }

  /** Core of the mini/final display toggle for ONE variant — swaps in a resized Document and
   * swaps which undo stack is "current" (see Variant.otherModeUndoStack). Returns false (no-op)
   * if the variant is already in the requested mode, so callers can skip the change-notification
   * work entirely when nothing happened. */
  private applySizeMode(variant: Variant, mode: SizeMode): boolean {
    if (variant.sizeMode === mode) return false;
    const d = variant.doc;
    const targetW = mode === "final" ? d.finalWidth : variant.miniWidth;
    const targetH = mode === "final" ? d.finalHeight : variant.miniHeight;
    // d(今離れる解像度)を再サンプルするのではなく、target解像度側に以前から持っている
    // otherModeDocを土台にして、構造(レイヤー構成/順序/属性)だけをdから同期する。これにより
    // target解像度で過去に描いた内容(otherModeDocのpixels)が保持され、行き来するたびに
    // 画質が劣化する不具合を避けられる。
    const targetDoc = reconcileDocumentResolution(d, variant.otherModeDoc, targetW, targetH);

    const swappedStack = variant.otherModeUndoStack;
    variant.otherModeUndoStack = variant.undoStack;
    variant.undoStack = swappedStack;
    variant.sizeMode = mode;
    variant.otherModeDoc = d;
    this.rebuildWidget(variant, targetDoc);
    return true;
  }

  /** Toggles the active variant between displaying/editing at its mini (working) resolution and
   * its final (export) resolution — e.g. to touch up details while seeing them at true output
   * size. Each mode keeps its OWN undo history (Variant.otherModeUndoStack) so switching back and
   * forth never risks restoring a snapshot whose layers are the wrong pixel size for the current
   * Document. No-op if the variant is already in the requested mode. */
  setSizeModeForActive(mode: SizeMode): void {
    const active = this.getActive();
    if (!active || !this.applySizeMode(active, mode)) return;
    this.setActive(active.id);
    this.onActiveSizeModeChange?.(mode);
    this.onEdit?.();
  }

  /** Applies the mini/final display toggle to EVERY variant at once, not just the active one —
   * whichever variant was active beforehand stays active afterward. */
  setSizeModeForAll(mode: SizeMode): void {
    const originalActiveId = this.activeId;
    let changedAny = false;
    for (const variant of this.variants) {
      if (this.applySizeMode(variant, mode)) changedAny = true;
    }
    if (!changedAny) return;
    if (originalActiveId) this.setActive(originalActiveId);
    this.onActiveSizeModeChange?.(mode);
    this.onEdit?.();
  }

  /** Measures the real pixel overhead a tile's chrome (header incl. its margin, plus the tile's
   * own padding/border) adds on top of the canvas host, so size calculations can reserve exactly
   * that much instead of guessing with a constant — a guess silently goes stale whenever the
   * header's actual rendered size changes (e.g. its label wrapping onto two lines), which is
   * exactly what caused tiles to overflow their allotted space before this was measured live. */
  private measureChrome(variant: Variant): { horizontal: number; vertical: number; minHeaderWidth: number } {
    const tileStyle = getComputedStyle(variant.tileEl);
    const header = variant.tileEl.querySelector(".variant-tile-header") as HTMLElement | null;
    const headerStyle = header ? getComputedStyle(header) : null;
    const vertical =
      (header?.offsetHeight ?? 0) +
      (headerStyle ? parseFloat(headerStyle.marginBottom) || 0 : 0) +
      (parseFloat(tileStyle.paddingTop) || 0) +
      (parseFloat(tileStyle.paddingBottom) || 0) +
      (parseFloat(tileStyle.borderTopWidth) || 0) +
      (parseFloat(tileStyle.borderBottomWidth) || 0);
    const horizontal =
      (parseFloat(tileStyle.paddingLeft) || 0) +
      (parseFloat(tileStyle.paddingRight) || 0) +
      (parseFloat(tileStyle.borderLeftWidth) || 0) +
      (parseFloat(tileStyle.borderRightWidth) || 0);
    return { horizontal, vertical, minHeaderWidth: header?.scrollWidth ?? 0 };
  }

  /** Sizes a tile's grid-column/grid-row span to match its canvas host's current pixel size plus
   * its real chrome overhead, so CSS Grid's dense packing can fill the gaps around it with other
   * (smaller) variants without any tile spilling past the cell it was allotted. */
  private updateTileSpan(variant: Variant): void {
    const hostWidth = parseFloat(variant.canvasHost.style.width) || 0;
    const hostHeight = parseFloat(variant.canvasHost.style.height) || 0;
    const chrome = this.measureChrome(variant);
    const colSpan = spanForPx(Math.max(hostWidth, chrome.minHeaderWidth) + chrome.horizontal);
    const rowSpan = spanForPx(hostHeight + chrome.vertical);
    variant.tileEl.style.gridColumn = `span ${colSpan}`;
    variant.tileEl.style.gridRow = `span ${rowSpan}`;
  }

  setActive(id: string): void {
    this.activeId = id;
    for (const v of this.variants) {
      v.tileEl.classList.toggle("active", v.id === id);
    }
    const active = this.getActive();
    if (active) {
      this.onActiveChange(active.doc, active.widget);
      this.onActiveZoomChange?.(active.widget.getZoom());
      this.onActiveSizeModeChange?.(active.sizeMode);
    }
    this.onHistoryChange?.();
    // 全体フィッティング中に別のバリエーションへ切り替えた時はそのまま再適用する(元々の
    // 仕様どおり)。単体フィッティングはボタンを押した直後の一回限りの処理であって、ただ
    // アクティブなバリエーションを切り替えただけで勝手に再適用・前のタイルの縮小/拡大が
    // 起きるべきではない(ユーザー指示) — 以前フィットしたタイルは、再度単体フィッティング
    // ボタンが押されるまでそのまま(フォーカスされた位置)に残る。
    if (this.autoFitMode === "all") this.applyFitAll();
  }

  getActiveSizeMode(): SizeMode | undefined {
    return this.getActive()?.sizeMode;
  }

  /** Sets a variant's zoom lock AND keeps its checkbox's displayed state in sync — the checkbox
   * only drives widget.setZoomLocked() one-way (via its own change listener), so programmatic
   * callers (project-file restore) must go through here instead of calling the widget directly. */
  setZoomLockedFor(variant: Variant, locked: boolean): void {
    variant.zoomLockCheckbox.checked = locked;
    variant.widget.setZoomLocked(locked);
  }

  getActive(): Variant | undefined {
    return this.variants.find((v) => v.id === this.activeId);
  }

  getAll(): Variant[] {
    return this.variants;
  }

  setToolForAll(tool: StrokeTool | DragTool | PickTool): void {
    for (const v of this.variants) v.widget.setTool(tool);
  }

  renderAll(): void {
    for (const v of this.variants) v.widget.render();
  }

  undoActive(): void {
    const active = this.getActive();
    if (!active) return;
    const restored = active.undoStack.undo(snapshotLayers(active.doc));
    if (!restored) return;
    restoreLayers(active.doc, restored);
    active.widget.render();
    this.onHistoryChange?.();
  }

  redoActive(): void {
    const active = this.getActive();
    if (!active) return;
    const restored = active.undoStack.redo(snapshotLayers(active.doc));
    if (!restored) return;
    restoreLayers(active.doc, restored);
    active.widget.render();
    this.onHistoryChange?.();
  }

  canUndoActive(): boolean {
    return this.getActive()?.undoStack.canUndo() ?? false;
  }

  canRedoActive(): boolean {
    return this.getActive()?.undoStack.canRedo() ?? false;
  }

  pushUndoForActive(): void {
    const active = this.getActive();
    if (!active) return;
    active.undoStack.pushUndo(snapshotLayers(active.doc));
    this.onHistoryChange?.();
    this.onEdit?.();
  }

  /** Stops any live fit-to-window mode (call this when the user zooms manually). */
  clearAutoFit(): void {
    this.autoFitMode = null;
  }

  setActualSize(): void {
    this.autoFitMode = null;
    this.getActive()?.widget.setZoom(1);
  }

  /** アクティブなバリエーションのキャンバスを、長辺がバリエーション表示領域いっぱいになる
   * ように拡大し、その時点で表示領域の中央にスクロールする。ボタンを押した時の一回限りの
   * 処理であって、その後は手動でズームを変えた時と同じ「ただズームが大きいだけの、普通の
   * グリッド内のタイル」になる — ウィンドウのリサイズや他のバリエーションへの切り替えを
   * きっかけに自動的に再適用・縮小されることはない(ユーザー指示)。
   *
   * 以前はこのタイルを.variant-gridの外のposition:fixedなオーバーレイへ実際に移し、常に
   * 画面中央に居続ける「ライブモード」にしていたが、その仕組み自体が複雑で、フォーカスが
   * 外れた時にズームを元に戻す処理を忘れると古い巨大サイズが残って他のタイルと重なって
   * 見える等の不具合を繰り返した。.variant-gridのdense packingは元々「1枚だけ大きいタイルが
   * あっても他が隙間を詰めて重ならない」ように設計されている(手動でズームを大きくした時と
   * 全く同じ状況)ので、タイルを特別扱いでDOMから移動させる必要はなく、普通にリサイズして
   * から表示位置までスクロールするだけで十分だった。 */
  fitActive(): void {
    const active = this.getActive();
    if (!active) return;
    const rect = this.container.getBoundingClientRect();
    const chrome = this.measureChrome(active);
    // .variant-grid's own padding (12px each side) — see index.html.
    const gridPadding = 24;
    active.canvasHost.style.width = `${Math.max(50, rect.width - gridPadding - chrome.horizontal)}px`;
    active.canvasHost.style.height = `${Math.max(50, rect.height - gridPadding - chrome.vertical)}px`;
    active.widget.fitToContainer();
    this.scrollTileToCenter(active);
  }

  /** `variant`のタイルが#canvas-viewportの中央に来るようスクロールする。タイルの近くに
   * (グリッドの端などで)十分なスクロール余地がない場合はscrollLeft/scrollTopの代入が
   * ブラウザ側で自然にクランプされ、可能な範囲で最も中央に近い位置になる。 */
  private scrollTileToCenter(variant: Variant): void {
    const rect = this.container.getBoundingClientRect();
    const tileRect = variant.tileEl.getBoundingClientRect();
    const dx = tileRect.left + tileRect.width / 2 - (rect.left + rect.width / 2);
    const dy = tileRect.top + tileRect.height / 2 - (rect.top + rect.height / 2);
    this.container.scrollLeft += dx;
    this.container.scrollTop += dy;
  }

  /** Arranges + sizes every variant so they all fit in the viewport at once; keeps re-fitting on resize. */
  fitAll(): void {
    this.autoFitMode = "all";
    this.applyFitAll();
  }

  /** Matches every other variant's ZOOM to the active one's, rather than copying its pixel
   * dimensions and re-fitting — copying pixels and calling fitToContainer() re-quantizes the
   * zoom (floor + margin subtraction) independently for each variant, which can't reliably land
   * back on the exact size that was copied. Matching zoom directly is exact by construction. */
  equalizeSizes(): void {
    this.autoFitMode = null;
    const active = this.getActive();
    if (!active) return;
    const zoom = active.widget.getZoom();
    for (const v of this.variants) {
      if (v === active) continue;
      v.widget.setZoom(zoom);
    }
  }

  private applyFitAll(): void {
    const n = this.variants.length;
    if (n === 0) return;
    const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
    const rows = Math.max(1, Math.ceil(n / cols));
    const rect = this.container.getBoundingClientRect();
    const gap = 12;
    const chrome = this.measureChrome(this.variants[0]);
    const tileW = Math.max(50, (rect.width - gap * (cols + 1)) / cols - chrome.horizontal);
    const tileH = Math.max(50, (rect.height - gap * (rows + 1)) / rows - chrome.vertical);
    for (const v of this.variants) {
      v.canvasHost.style.width = `${tileW}px`;
      v.canvasHost.style.height = `${tileH}px`;
      v.widget.fitToContainer();
    }
    const active = this.getActive();
    if (active) active.tileEl.scrollIntoView({ block: "center", inline: "center" });
  }
}
