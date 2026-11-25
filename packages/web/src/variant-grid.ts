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
  /** バリエーションの並び替え(ヘッダーのドラッグ)用の状態 — layer-panel.tsのレイヤー並び替えと
   * 同じPointer Events方式(HTML5 drag-and-dropではなくpointerdown/move/up)を使う理由も同じ:
   * ペン(スタイラス)ではdragstartが確実に発火しないブラウザがあるため。 */
  private dragCandidateVariantId: string | null = null;
  private draggingVariantId: string | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
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
      // margin/min-width/min-heightはコンテナの寸法を基準に計算した値なので、コンテナの寸法が
      // 変わった時点でもう正しくない — 測り直さずに残すと、リサイズ後は必要ないはずの
      // スクロールバーが古い値のせいで出続けたり、逆に中央まで届く余白が狭すぎたりする
      // (タイル自体のサイズは別途grid-column/row spanで保持されるので、これを測り直しても
      // タイルが縮む/単体フィッティングが再適用されることはない=ユーザー指示には抵触しない)。
      this.resetGridSlack();
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
    this.resetGridSlack();
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
      // ズームが変わるとどの軸があふれているかも変わりうるので、中央まで届く余白を
      // ここでも測り直す(単体フィッティング以外の、手動ズームやequalizeSizes経由の
      // 変更でも常に最新の状態にしておくため)。
      this.resetGridSlack();
      if (this.activeId === variant.id) this.onActiveZoomChange?.(zoom);
    };
    widget.onColorPick = (color) => this.onColorPick?.(color);
    widget.onUndoGesture = () => this.undoActive();
    widget.onRedoGesture = () => this.redoActive();
    this.updateTileSpan(variant);

    // 既にアクティブなタイルをクリックした時は何もしない — ここで無条件にsetActive()を
    // 呼ぶと、マウスでのドラッグ描画(mousedown→drag→mouseup)の後に発火する"click"イベントの
    // たびにsetActive()が走り、setActive内部のscrollTileToCenter()で表示位置がキャンバス中央へ
    // 戻ってしまっていた(ズームインして中央からずらして描いているときに特に目立つ不具合)。
    // 別のバリエーションへの切替時は従来どおり中央寄せする。
    tile.addEventListener("click", () => {
      if (this.activeId !== variant.id) this.setActive(variant.id);
    });

    // ヘッダーをドラッグしてバリエーションの並び順を入れ替える。しきい値を超えるまでは
    // setPointerCaptureを呼ばない(layer-panel.tsの行ドラッグと同じ理由 — Chromeは captured
    // pointer の以降のmouseup/clickをcapture元の要素へretargetするため、無条件にcaptureすると
    // タップ(=タイルを選ぶクリック)まで吸われてしまう)。pointerdown自体は常に
    // stopPropagationする — ここは#canvas-viewportレベルのパン/キャンバス外ドラッグ描画が
    // 関与すべきでないタイルの「chrome」部分なので、二重に処理されるのを防ぐ。
    header.style.touchAction = "none";
    header.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (e.pointerType === "mouse" && e.button !== 0) return;
      this.dragCandidateVariantId = variant.id;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
    });
    header.addEventListener("pointermove", (e) => {
      if (this.dragCandidateVariantId !== variant.id) return;
      if (!this.draggingVariantId) {
        if (Math.hypot(e.clientX - this.dragStartX, e.clientY - this.dragStartY) < 4) return;
        this.draggingVariantId = variant.id;
        tile.classList.add("dragging");
        header.setPointerCapture(e.pointerId);
      }
      e.preventDefault();
      this.clearVariantDragHints();
      const targetTile = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(".variant-tile") as HTMLElement | null;
      if (!targetTile || targetTile === tile) return;
      const rect = targetTile.getBoundingClientRect();
      const afterHalf = e.clientX - rect.left > rect.width / 2;
      targetTile.classList.add(afterHalf ? "drag-over-after" : "drag-over");
    });
    const endVariantDrag = (e: PointerEvent): void => {
      if (this.dragCandidateVariantId !== variant.id) return;
      if (header.hasPointerCapture(e.pointerId)) header.releasePointerCapture(e.pointerId);
      this.dragCandidateVariantId = null;
      tile.classList.remove("dragging");
      const draggedId = this.draggingVariantId;
      this.draggingVariantId = null;
      this.clearVariantDragHints();
      if (!draggedId) return; // しきい値を超えなかった = ただのタップ(タイル選択はtileのclickに任せる)
      const targetTile = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(".variant-tile") as HTMLElement | null;
      if (!targetTile || targetTile === tile) return;
      const targetVariant = this.variants.find((v) => v.tileEl === targetTile);
      if (!targetVariant) return;
      const rect = targetTile.getBoundingClientRect();
      const afterHalf = e.clientX - rect.left > rect.width / 2;
      this.reorderVariant(draggedId, targetVariant.id, afterHalf);
    };
    header.addEventListener("pointerup", endVariantDrag);
    header.addEventListener("pointercancel", endVariantDrag);

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

  private clearVariantDragHints(): void {
    this.gridEl.querySelectorAll(".drag-over, .drag-over-after").forEach((el) => {
      el.classList.remove("drag-over", "drag-over-after");
    });
  }

  /** `draggedId`のバリエーションを、`targetId`の直前(after=false)/直後(after=true)へ移動する
   * (ヘッダーのドラッグ&ドロップから呼ばれる)。配列の並びを変えた後、DOM上の並び順(CSS
   * Gridのdense packingがソース順に依存する)もgridEl.appendChildで一括して揃え直す —
   * appendChildは既存の子を末尾へ「移動」する仕様なので、配列の順になぞるだけで揃う。 */
  private reorderVariant(draggedId: string, targetId: string, after: boolean): void {
    if (draggedId === targetId) return;
    const fromIndex = this.variants.findIndex((v) => v.id === draggedId);
    if (fromIndex === -1) return;
    const [dragged] = this.variants.splice(fromIndex, 1);
    let toIndex = this.variants.findIndex((v) => v.id === targetId);
    if (toIndex === -1) {
      this.variants.splice(fromIndex, 0, dragged);
      return;
    }
    if (after) toIndex += 1;
    this.variants.splice(toIndex, 0, dragged);
    for (const v of this.variants) this.gridEl.appendChild(v.tileEl);
    this.renumberAll();
    this.onEdit?.();
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
    // addVariant()内のsetActive()が中央寄せした直後に、このsetZoom(1)がその表示状態を
    // (等倍への変更に合わせて)作り直してしまうため、最後にもう一度中央へ合わせ直す。
    this.scrollTileToCenter(variant);
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
    // addVariant()内のsetActive()が中央寄せした直後に、このsetZoom(1)がその表示状態を
    // (等倍への変更に合わせて)作り直してしまうため、最後にもう一度中央へ合わせ直す。
    this.scrollTileToCenter(variant);
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
      // ズームが変わるとどの軸があふれているかも変わりうるので、中央まで届く余白を
      // ここでも測り直す(単体フィッティング以外の、手動ズームやequalizeSizes経由の
      // 変更でも常に最新の状態にしておくため)。
      this.resetGridSlack();
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
    // 単体フィッティングが中央寄せのために上乗せしたmargin/min-width/min-height(あれば)は、
    // 別のバリエーションへ切り替えた時点でその上乗せ分の意味を失う — 消さずに残すと、以後
    // ずっと(その古い値のせいで)必要ないスクロールバーが出続けてしまう。切り替え先の内容
    // だけを基準にした値へ測り直す。タイル自体のサイズはgrid-column/row spanで別途保持
    // されるので、ここで測り直しても「以前フィットしたタイルはそのまま残る」という仕様
    // (ユーザー指示)には影響しない。
    this.resetGridSlack();
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
    // 起きるべきではない(ユーザー指示) — 以前フィットしたタイルのズーム/サイズは、再度
    // 単体フィッティングボタンが押されるまでそのまま残る。
    if (this.autoFitMode === "all") {
      this.applyFitAll();
    } else if (active) {
      // タブを切り替えた時の「既定の位置」は、そのバリエーションが表示領域の中央に見える
      // 位置であるべき(ユーザー指示) — あふれていて中央に届かない場合は、resetGridSlack()
      // が付けた余白(あふれている軸だけ)のおかげで中央まで届く。
      this.scrollTileToCenter(active);
    }
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
    this.resetGridSlack();
    const rect = this.container.getBoundingClientRect();
    const chrome = this.measureChrome(active);
    // .variant-grid's own padding (12px each side) — see index.html.
    const gridPadding = 24;
    active.canvasHost.style.width = `${Math.max(50, rect.width - gridPadding - chrome.horizontal)}px`;
    active.canvasHost.style.height = `${Math.max(50, rect.height - gridPadding - chrome.vertical)}px`;
    active.widget.fitToContainer();
    this.scrollTileToCenter(active);
  }

  /** `variant`のタイルの中心と#canvas-viewportの中心とのズレ(px)。 */
  private centerOffset(variant: Variant): { dx: number; dy: number } {
    const rect = this.container.getBoundingClientRect();
    const tileRect = variant.tileEl.getBoundingClientRect();
    return {
      dx: tileRect.left + tileRect.width / 2 - (rect.left + rect.width / 2),
      dy: tileRect.top + tileRect.height / 2 - (rect.top + rect.height / 2),
    };
  }

  /** scrollLeft/scrollTopへ現在のズレをそのまま加算する。スクロール可能な余地が足りない方向は
   * ブラウザ側で自然にクランプされ、可能な範囲で最も中央に近い位置になる。 */
  private applyCenterScroll(variant: Variant): void {
    const { dx, dy } = this.centerOffset(variant);
    this.container.scrollLeft += dx;
    this.container.scrollTop += dy;
  }

  /** .variant-gridのmargin/min-width/min-heightを、今の内容だけから導ける「基準の」状態に
   * 作り直す(付けすぎればequalizeSizes/applyFitAll/resetなど他のレイアウトモードにまで
   * 古い値が持ち越されてズレて見える/不要なスクロールバーが出るので、必ずリセットしてから
   * 測り直す)。
   *
   * 1. タイルが大きすぎて.variant-grid自身の高さ/幅(height/width:100%)を超えてあふれている
   *    場合、そのあふれはグリッド自身の「余白(margin)」の基準点より深い位置まで達してしまい、
   *    margin-top/bottom等を付けても(あふれの方がさらに深いので)スクロール範囲が全く広がらない
   *    ことがあった。先にgrid自身のscrollWidth/Height(実際にあふれている範囲込みの寸法)を
   *    min-width/min-heightとして明示することで、グリッド自身の箱をそのあふれを含む大きさに
   *    揃え、以降のmarginが正しく効くようにする。
   * 2. (1を揃えた後もなお)実際にその軸があふれている場合だけ、前後にビューポート半分ぶんの
   *    余白(margin)を追加する — スクロールし切った位置が内容の端ぴったりではなく、そこから
   *    さらに中央まで持ってこられる余地を常に残しておくため(ユーザー要望)。あふれていない軸
   *    には何も足さないので、収まっている時に不要なスクロールバーが出ることはない。 */
  private resetGridSlack(): void {
    // マージンを一旦""に戻してから測り直す都合上、その一瞬だけスクロール可能範囲が
    // 縮むため、ブラウザが現在のscrollLeft/scrollTopをその場で切り詰めてしまうことがあった
    // (新しいマージンを付け直した後も、切り詰められた値はそのままで元には戻らない) —
    // 呼び出し前の位置を保存しておき、最後に新しい範囲の中で(自然にクランプされつつ)
    // 復元することで、resetGridSlack()を呼んだだけで今の表示位置が勝手にずれることを防ぐ。
    const savedScrollLeft = this.container.scrollLeft;
    const savedScrollTop = this.container.scrollTop;
    this.gridEl.style.marginLeft = "";
    this.gridEl.style.marginRight = "";
    this.gridEl.style.marginTop = "";
    this.gridEl.style.marginBottom = "";
    this.gridEl.style.minWidth = "";
    this.gridEl.style.minHeight = "";
    // どちらの軸があふれているかは、min-width/min-heightを付ける前に判定しておく —
    // min-height等を付けるとグリッド自身のclientHeightがそのあふれを含む大きさまで
    // 広がってしまい、後から同じ条件(scrollHeight > clientHeight)で判定し直すと
    // 「あふれていない」ことになってしまい、2のmarginが永久に付かなくなる不具合があった。
    const overflowsH = this.gridEl.scrollWidth > this.gridEl.clientWidth;
    const overflowsV = this.gridEl.scrollHeight > this.gridEl.clientHeight;
    if (overflowsH) this.gridEl.style.minWidth = `${this.gridEl.scrollWidth}px`;
    if (overflowsV) this.gridEl.style.minHeight = `${this.gridEl.scrollHeight}px`;
    const rect = this.container.getBoundingClientRect();
    if (overflowsH) {
      const half = `${rect.width / 2}px`;
      this.gridEl.style.marginLeft = half;
      this.gridEl.style.marginRight = half;
    }
    if (overflowsV) {
      const half = `${rect.height / 2}px`;
      this.gridEl.style.marginTop = half;
      this.gridEl.style.marginBottom = half;
    }
    this.container.scrollLeft = savedScrollLeft;
    this.container.scrollTop = savedScrollTop;
  }

  /** 指定した方向のmarginを、今の値より大きい場合だけ引き上げる — resetGridSlack()が既に
   * 付けたビューポート半分ぶんの余白を、より大きな値で上書きすることはあっても、小さい値で
   * 消してしまうことはない。 */
  private growMargin(side: "marginLeft" | "marginRight" | "marginTop" | "marginBottom", px: number): void {
    const current = parseFloat(this.gridEl.style[side]) || 0;
    if (px > current) this.gridEl.style[side] = `${px}px`;
  }

  /** `variant`のタイルが#canvas-viewportの中央に来るようスクロールする。
   *
   * 他のバリエーション(特にdense packingで大きいタイルの周りの隙間を詰めるように配置された
   * 小さいタイル群)が非対称に配置されていると、このタイルを中央へスクロールしようとしても
   * resetGridSlack()が付けた余白だけでは足りず、ズレた位置に取り残されることがある
   * (scrollLeft/scrollTopは0未満・最大値超えにできないため)。その場合だけ、ズレをちょうど
   * 打ち消す分までmarginを追加で引き上げ(growMargin)、もう一度センタリングし直す。 */
  private scrollTileToCenter(variant: Variant): void {
    this.resetGridSlack();
    this.applyCenterScroll(variant);
    const remaining = this.centerOffset(variant);
    const EPS = 0.5;
    if (Math.abs(remaining.dx) < EPS && Math.abs(remaining.dy) < EPS) return;
    if (remaining.dx < -EPS) this.growMargin("marginLeft", -remaining.dx);
    else if (remaining.dx > EPS) this.growMargin("marginRight", remaining.dx);
    if (remaining.dy < -EPS) this.growMargin("marginTop", -remaining.dy);
    else if (remaining.dy > EPS) this.growMargin("marginBottom", remaining.dy);
    this.applyCenterScroll(variant);
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
    this.resetGridSlack();
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
    this.resetGridSlack();
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
