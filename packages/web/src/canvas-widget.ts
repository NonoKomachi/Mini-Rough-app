import { Document, RasterLayer, composeDocument, maskHasSelection, StrokeTool, DragTool, PickTool, RGBA, Point, isDragTool, isPickTool } from "@mini-rough/core";
import { TransformSession, HandleKind } from "./transform-session";

function midpoint(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function triSign(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  return (px - bx) * (ay - by) - (ax - bx) * (py - by);
}

function pointInTriangle(px: number, py: number, a: Point, b: Point, c: Point): boolean {
  const d1 = triSign(px, py, a.x, a.y, b.x, b.y);
  const d2 = triSign(px, py, b.x, b.y, c.x, c.y);
  const d3 = triSign(px, py, c.x, c.y, a.x, a.y);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function isPointInQuad(px: number, py: number, corners: readonly [Point, Point, Point, Point]): boolean {
  const [tl, tr, br, bl] = corners;
  return pointInTriangle(px, py, tl, tr, bl) || pointInTriangle(px, py, tr, br, bl);
}

const DISPLAY_MARGIN = 24;
const FALLBACK_DISPLAY_WIDTH = 600;
const FALLBACK_DISPLAY_HEIGHT = 500;
// 完成サイズ(数千px級)をウィンドウに収めるには等倍未満への縮小が必須なのでMIN_ZOOMは1ではない。
const MIN_ZOOM = 0.05;
const MAX_ZOOM = 20;
// ホイール/+-ボタン1段階あたりの倍率(等倍以上の整数刻みだと0.05〜1の範囲が扱えないため、
// 加算ではなく乗算のステップにして範囲全体をなめらかにカバーする)。
const ZOOM_STEP_FACTOR = 1.25;

function roundZoom(zoom: number): number {
  return Math.round(zoom * 100) / 100;
}
// Marching-ants animation: the dash pattern repeats every 6 canvas units, so an offset step of 1
// every ~80ms gives a smooth, moderately-paced march (common drawing-app pace) without redrawing
// so often it costs noticeable CPU on a large/zoomed-in canvas.
const SELECTION_MARCH_INTERVAL_MS = 80;
const SELECTION_DASH_PATTERN = [3, 3];
const TOUCH_TAP_MOVE_THRESHOLD = 10;

export class CanvasWidget {
  private readonly doc: Document;
  private tool: StrokeTool | DragTool | PickTool;
  private readonly container: HTMLElement;
  private readonly offscreen: HTMLCanvasElement;
  private readonly offCtx: CanvasRenderingContext2D;
  private readonly visible: HTMLCanvasElement;
  private readonly visCtx: CanvasRenderingContext2D;
  private zoom: number;
  private isDrawing = false;
  private selectionDashOffset = 0;
  private selectionMarchTimer: number | null = null;
  private touchCount = 0;
  /** isEditablePointer専用の、Pointer Eventだけで数えるアクティブなタッチ指の集合。
   * touchCount(Touch Event側、onTouchStartで更新)はpointerdownより後に発火することがあり、
   * 2本目の指のpointerdownが来た瞬間はまだtouchCountが1のまま(=1本指として許可)判定されて
   * しまう競合があった — 2本目の指も描画を始めてしまい、タップが複数箇所に点として残る不具合
   * の原因だった。pointerdown/pointerup(cancel含む)自身でSetを更新すれば、この順序に
   * 依存せず常に正確な本数を即座に反映できる。 */
  private activeTouchPointerIds = new Set<number>();
  private touchMoved = false;
  private touchStartDistance = 0;
  private touchStartZoom = 0;
  /** 2本指の中点(平行ドラッグ=パンかどうかの判定用)。main.ts側がPointer Eventベースで
   * #canvas-viewportを実際にスクロールさせる処理を別途持つが、ここ(Touch Eventベースの
   * タップ判定)が指の距離(ピンチ)の変化だけを見ていたため、2本指を平行に(距離を変えずに)
   * ドラッグしてスクロールさせようとすると「タップ」と誤認し、指を離した瞬間に2本指タップ=
   * 取り消しジェスチャーが暴発していた。中点の移動も「動いた」判定に含めることで防ぐ。 */
  private touchStartMidX = 0;
  private touchStartMidY = 0;
  /** タッチでの編集(描画・ツール操作)を許可するかどうか — 既定はfalse(マウス/ペンのみ)。
   * 縦長レイアウト時にmain.tsがtrueにして、スマホの指描画を有効にする。 */
  private touchEditingEnabled = false;
  private zoomLocked = false;
  private transformSession: TransformSession | null = null;
  private activeHandle: HandleKind | null = null;
  private transformDragStart: Point | null = null;
  /** Fired whenever a transform session's parameters change (preview redraw) — the transform
   * panel UI refreshes its numeric fields here. */
  onTransformChange: (() => void) | null = null;
  onZoomChange: ((zoom: number) => void) | null = null;
  /** Fired once per stroke, before the tool mutates anything — used to push undo snapshots. */
  onBeforeStroke: (() => void) | null = null;
  /** Fired before a wheel/pinch-triggered zoom — used to drop out of auto-fit mode, the same way
   * dragging the zoom slider does. Never fired for a zoom change that auto-fit itself requested. */
  onManualZoomRequest: (() => void) | null = null;
  /** Right-click anywhere (regardless of the active tool) or the eyedropper tool itself, both
   * sample the composite color under the cursor and report it here. */
  onColorPick: ((color: RGBA) => void) | null = null;
  /** Two-finger tap. */
  onUndoGesture: (() => void) | null = null;
  /** Three-finger tap. */
  onRedoGesture: (() => void) | null = null;

  constructor(container: HTMLElement, doc: Document, tool: StrokeTool | DragTool | PickTool) {
    this.doc = doc;
    this.tool = tool;
    this.container = container;

    this.offscreen = document.createElement("canvas");
    this.offscreen.width = doc.width;
    this.offscreen.height = doc.height;
    this.offCtx = this.offscreen.getContext("2d", { willReadFrequently: true })!;

    this.zoom = this.computeFitZoom();

    this.visible = document.createElement("canvas");
    this.visible.className = "doc-canvas";
    this.visCtx = this.visible.getContext("2d")!;
    this.visCtx.imageSmoothingEnabled = false;
    this.resizeVisible();

    // `container` is the scrolling viewport; centering lives on this inner wrapper instead of on
    // `container` itself, otherwise a canvas bigger than the viewport becomes unreachable by
    // scroll on its top/left side (a well-known flex-center + overflow:auto scroll trap).
    const centerer = document.createElement("div");
    centerer.className = "canvas-centerer";
    centerer.appendChild(this.visible);
    container.appendChild(centerer);

    this.visible.addEventListener("pointerdown", this.onPointerDown);
    this.visible.addEventListener("pointermove", this.onPointerMove);
    this.visible.addEventListener("pointerup", this.onPointerUp);
    this.visible.addEventListener("pointercancel", this.onPointerUp);
    this.visible.addEventListener("contextmenu", this.onContextMenu);
    this.visible.addEventListener("wheel", this.onWheel, { passive: false });
    this.visible.addEventListener("touchstart", this.onTouchStart, { passive: false });
    this.visible.addEventListener("touchmove", this.onTouchMove, { passive: false });
    this.visible.addEventListener("touchend", this.onTouchEnd);
    this.visible.addEventListener("touchcancel", this.onTouchEnd);

    this.render();
  }

  setTool(tool: StrokeTool | DragTool | PickTool): void {
    this.tool = tool;
  }

  /** Enters/exits transform mode. While a session is active, pointer input is captured entirely
   * by the transform handles (hit-tested in document space) instead of the normal tool. */
  setTransformSession(session: TransformSession | null): void {
    this.transformSession = session;
    this.activeHandle = null;
    this.transformDragStart = null;
    session?.preview();
    this.render();
  }

  /** Visual-only preview backdrop; never affects the document's actual (always-transparent) pixels. */
  setPreviewBackground(color: string | null): void {
    this.visible.style.background = color ?? "";
  }

  getZoom(): number {
    return this.zoom;
  }

  /** Fits the whole mini canvas back into the viewport (undoes manual zoom in/out). */
  fitToContainer(): void {
    this.setZoom(this.computeFitZoom());
  }

  zoomIn(): void {
    this.setZoom(this.zoom * ZOOM_STEP_FACTOR);
  }

  zoomOut(): void {
    this.setZoom(this.zoom / ZOOM_STEP_FACTOR);
  }

  setZoom(zoom: number): void {
    if (this.zoomLocked) {
      // ロック中はズーム値自体は変えないが、variant-grid.tsのapplyFitAll/equalizeSizes等は
      // hostコンテナに「目標」サイズを直接書き込んだ直後にこれを呼んでhostを現在のzoomの実サイズに
      // 戻すことに依存しているため、resizeVisibleだけは呼んでレイアウトのズレを防ぐ。
      // resizeVisible()はvisible(表示用canvas)のwidth/heightを再代入する — 値が変わらなくても
      // HTML Canvas仕様上ビットマップが毎回クリアされるため、redrawVisible()(offscreenの
      // 合成済みバッファを描き直すだけの軽い処理、composeDocumentは走らない)で即座に復元する。
      // これがないと、ロック中にピンチ操作でsetZoomが連続発火する間キャンバスが透明に見えていた。
      this.resizeVisible();
      this.redrawVisible();
      this.onZoomChange?.(this.zoom);
      return;
    }
    // Deliberately no early-return when the clamped zoom matches the current one: callers like
    // applyFitAll/applyFitActive/equalizeSizes in variant-grid.ts write a target pixel size to
    // the host container directly (to let computeFitZoom() read it back), and rely on this call
    // to snap the host back to the EXACT doc.width*zoom size afterward. Skipping that snap
    // whenever the zoom number happens not to change left the host at the approximate target
    // size instead of the true one, causing visible drift between variants after repeated fits.
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, roundZoom(zoom)));
    this.zoom = clamped;
    this.resizeVisible();
    this.render();
    this.onZoomChange?.(this.zoom);
  }

  /** While locked, setZoom() (and therefore the slider, number input, actual-size, every fit
   * mode, pinch, and wheel zoom — all of them funnel through setZoom) becomes a no-op for this
   * canvas's zoom level. */
  setZoomLocked(locked: boolean): void {
    this.zoomLocked = locked;
  }

  isZoomLocked(): boolean {
    return this.zoomLocked;
  }

  /** Stops the marching-ants timer — call when discarding this widget (e.g. on resize/removal)
   * so it doesn't keep redrawing a canvas nobody can see anymore. */
  dispose(): void {
    if (this.selectionMarchTimer !== null) {
      window.clearInterval(this.selectionMarchTimer);
      this.selectionMarchTimer = null;
    }
  }

  private computeFitZoom(): number {
    // A brand-new (or not-yet-laid-out) host can report a stray small width (e.g. inherited
    // intrinsic/min-content sizing) while height still reads a genuine 0 — mixing a "real" width
    // with a fallback height (or vice versa) produces a bogus, inconsistent zoom. Trust the
    // measurement only when BOTH dimensions clear the threshold; otherwise fall back for both.
    const minReliable = DISPLAY_MARGIN * 2;
    const measuredReliable = this.container.clientWidth > minReliable && this.container.clientHeight > minReliable;
    const maxWidth = measuredReliable ? this.container.clientWidth - DISPLAY_MARGIN : FALLBACK_DISPLAY_WIDTH;
    const maxHeight = measuredReliable ? this.container.clientHeight - DISPLAY_MARGIN : FALLBACK_DISPLAY_HEIGHT;
    const rawZoom = Math.min(maxWidth / this.doc.width, maxHeight / this.doc.height);
    // setZoom()の四捨五入(roundZoom)ではなく切り捨てる: フィットは「必ず収まる」側に倒さないと、
    // 完成サイズのような大きいdocで四捨五入が上側に転んだ瞬間にコンテナからあふれてしまう。
    const flooredPercent = Math.floor(Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, rawZoom)) * 100);
    return Math.max(MIN_ZOOM, flooredPercent / 100);
  }

  private resizeVisible(): void {
    this.visible.width = this.doc.width * this.zoom;
    this.visible.height = this.doc.height * this.zoom;
    // canvasの.width/.height代入はビットマップの再生成を伴い、2Dコンテキストの状態を丸ごと
    // 初期値に戻す(= imageSmoothingEnabledもtrueに戻る)。これを再設定し忘れると、ズーム変更
    // 直後の描画だけ拡大時に補間(ぼやけ)がかかり、1ピクセルがくっきり大きな正方形として
    // 見えるべき高倍率表示が台無しになる。
    this.visCtx.imageSmoothingEnabled = false;
    // The host's own footprint tracks the canvas size (not a fixed box), so changing one
    // variant's zoom grows/shrinks just its tile and the flex-wrap grid reflows the rest to
    // keep as many neighboring variants visible as will fit.
    this.container.style.width = `${this.visible.width}px`;
    this.container.style.height = `${this.visible.height}px`;
  }

  private toDocCoords(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.visible.getBoundingClientRect();
    const x = ((clientX - rect.left) * (this.visible.width / rect.width)) / this.zoom;
    const y = ((clientY - rect.top) * (this.visible.height / rect.height)) / this.zoom;
    return { x, y };
  }

  /** 既定ではマウス/ペンのみ編集可能。touchEditingEnabled時(縦長レイアウト)は1本指タッチも
   * 編集扱いにするが、2本指以上が触れている間は常に拒否する — 複数指ジェスチャー(2本指Undo/
   * 3本指Redo/ピンチズーム、touchstart/touchmove/touchend側で別途処理)と描画が競合しないように。 */
  private isEditablePointer(e: PointerEvent): boolean {
    if (e.pointerType !== "touch") return true;
    return this.touchEditingEnabled && this.activeTouchPointerIds.size <= 1;
  }

  /** 縦長レイアウト等、スマホでの指描画を許可するかどうかを切り替える。 */
  setTouchEditingEnabled(enabled: boolean): void {
    this.touchEditingEnabled = enabled;
  }

  private onPointerDown = (e: PointerEvent): void => {
    // isEditablePointer()より前にSetへ追加する — このポインター自身を含めた「今何本触れているか」
    // で判定する必要があるため(追加を後回しにすると、2本目の指が常に「まだ1本」として許可されてしまう)。
    if (e.pointerType === "touch") this.activeTouchPointerIds.add(e.pointerId);
    if (!this.isEditablePointer(e)) return;
    const { x, y } = this.toDocCoords(e.clientX, e.clientY);
    if (this.transformSession) {
      const handle = this.hitTestHandle(x, y);
      if (handle) {
        this.visible.setPointerCapture(e.pointerId);
        this.isDrawing = true;
        this.activeHandle = handle;
        this.transformDragStart = { x, y };
      }
      return;
    }
    if (isPickTool(this.tool)) {
      // スポイトはドキュメントを一切変更しないので、Undo用のスナップショットは積まない。
      this.visible.setPointerCapture(e.pointerId);
      this.isDrawing = true;
      this.pickColorAt(x, y);
      return;
    }
    this.onBeforeStroke?.();
    if (isDragTool(this.tool)) {
      this.visible.setPointerCapture(e.pointerId);
      this.isDrawing = true;
      this.tool.begin(this.doc, x, y);
      this.render();
      return;
    }
    const layer = this.getPaintTarget();
    if (!layer) return;
    this.visible.setPointerCapture(e.pointerId);
    this.isDrawing = true;
    const pressure = e.pressure > 0 ? e.pressure : 1;
    this.tool.beginStroke(layer, x, y, pressure);
    this.render();
  };

  private onPointerMove = (e: PointerEvent): void => {
    if (!this.isDrawing || !this.isEditablePointer(e)) return;
    const { x, y } = this.toDocCoords(e.clientX, e.clientY);
    if (this.transformSession) {
      this.applyHandleDrag(x, y);
      this.render();
      return;
    }
    if (isPickTool(this.tool)) {
      this.pickColorAt(x, y);
      return;
    }
    if (isDragTool(this.tool)) {
      this.tool.drag(this.doc, x, y);
      this.render();
      return;
    }
    const layer = this.getPaintTarget();
    if (!layer) return;
    const pressure = e.pressure > 0 ? e.pressure : 1;
    this.tool.continueStroke(layer, x, y, pressure);
    this.render();
  };

  /** Normally the active layer; while editing a mask (doc.maskPaintLayerId), returns a
   * RasterLayer-shaped view backed directly by that layer's mask buffer, so every existing paint
   * tool can edit the mask completely unchanged (writes land straight in `layer.mask`). */
  private getPaintTarget(): RasterLayer | undefined {
    const maskLayerId = this.doc.maskPaintLayerId;
    if (maskLayerId) {
      const layer = this.doc.findLayer(maskLayerId);
      if (layer?.mask) {
        return { kind: "layer", id: layer.id, name: layer.name, width: layer.width, height: layer.height, visible: true, opacity: 1, mask: null, maskEnabled: true, clipToBelow: false, pixels: layer.mask } as RasterLayer;
      }
    }
    return this.doc.getActiveLayer();
  }

  private onPointerUp = (e: PointerEvent): void => {
    if (this.isDrawing && this.isEditablePointer(e)) this.finishDrawing(e.pointerId);
    // 判定が終わってから取り除く(isEditablePointerがこの指自身を含めた本数で判定できるように)。
    if (e.pointerType === "touch") this.activeTouchPointerIds.delete(e.pointerId);
  };

  /** Finalizes whatever drawing/drag/transform operation is in progress — shared by onPointerUp
   * and onTouchStart's forced-finish when a second finger lands mid-stroke (タッチ編集時、1本指
   * の描画中に2本目が触れたら、ジェスチャーを邪魔しないようにその場で確定させる)。 */
  private finishDrawing(pointerId?: number): void {
    this.isDrawing = false;
    if (this.transformSession) {
      this.activeHandle = null;
      this.transformDragStart = null;
    } else if (isPickTool(this.tool)) {
      // 何もファイナライズしない。
    } else if (isDragTool(this.tool)) {
      this.tool.end(this.doc);
    } else {
      this.tool.endStroke();
    }
    if (pointerId !== undefined && this.visible.hasPointerCapture(pointerId)) {
      this.visible.releasePointerCapture(pointerId);
    }
    this.render();
  }

  /** Right-click always acts as a temporary eyedropper, regardless of the active tool (CLIP
   * STUDIO-style), sampling the composite color under the cursor. */
  private onContextMenu = (e: MouseEvent): void => {
    e.preventDefault();
    const { x, y } = this.toDocCoords(e.clientX, e.clientY);
    this.pickColorAt(x, y);
  };

  private readonly HANDLE_HIT_RADIUS_SCREEN = 8;
  private readonly ROTATE_HANDLE_OFFSET_SCREEN = 16;

  /** Hit-tests document-space point (x,y) against the transform session's handles, in priority
   * order: rotate (slightly outside each corner) > corner > edge-midpoint (scaleRotate only) >
   * inside the quad (move). Returns null outside all of those (click ignored while transforming). */
  private hitTestHandle(x: number, y: number): HandleKind | null {
    const session = this.transformSession;
    if (!session) return null;
    const corners = session.getCurrentCorners();
    const center = session.getCenter();
    const hitRadius = this.HANDLE_HIT_RADIUS_SCREEN / this.zoom;
    const rotateOffset = this.ROTATE_HANDLE_OFFSET_SCREEN / this.zoom;

    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      const dirX = c.x - center.x;
      const dirY = c.y - center.y;
      const len = Math.hypot(dirX, dirY) || 1;
      const rx = c.x + (dirX / len) * rotateOffset;
      const ry = c.y + (dirY / len) * rotateOffset;
      if (Math.hypot(x - rx, y - ry) <= hitRadius) return { kind: "rotate", index: i as 0 | 1 | 2 | 3 };
    }

    for (let i = 0; i < 4; i++) {
      const c = corners[i];
      if (Math.hypot(x - c.x, y - c.y) <= hitRadius) return { kind: "corner", index: i as 0 | 1 | 2 | 3 };
    }

    if (session.mode === "scaleRotate") {
      const mids = [midpoint(corners[0], corners[1]), midpoint(corners[1], corners[2]), midpoint(corners[2], corners[3]), midpoint(corners[3], corners[0])];
      for (let i = 0; i < 4; i++) {
        if (Math.hypot(x - mids[i].x, y - mids[i].y) <= hitRadius) return { kind: "edge", index: i as 0 | 1 | 2 | 3 };
      }
    }

    if (isPointInQuad(x, y, corners)) return { kind: "move" };
    return null;
  }

  private applyHandleDrag(x: number, y: number): void {
    const session = this.transformSession;
    const handle = this.activeHandle;
    if (!session || !handle) return;
    if (handle.kind === "move") {
      if (!this.transformDragStart) return;
      session.moveBy(x - this.transformDragStart.x, y - this.transformDragStart.y);
      this.transformDragStart = { x, y };
    } else if (handle.kind === "corner") {
      if (session.mode === "free") session.setFreeCorner(handle.index, { x, y });
      else session.setScaleFromCornerDrag({ x, y });
    } else if (handle.kind === "edge") {
      session.setScaleFromEdgeDrag(handle.index, { x, y });
    } else if (handle.kind === "rotate") {
      session.setRotationFromHandleDrag(handle.index, { x, y });
    }
    session.preview();
    this.onTransformChange?.();
  }

  private pickColorAt(x: number, y: number): void {
    const px = Math.floor(x);
    const py = Math.floor(y);
    if (px < 0 || py < 0 || px >= this.doc.width || py >= this.doc.height) return;
    const pixels = composeDocument(this.doc);
    const i = (py * this.doc.width + px) * 4;
    this.onColorPick?.([pixels[i], pixels[i + 1], pixels[i + 2], pixels[i + 3]]);
  }

  /** Mouse wheel zoom: scroll up/away = zoom in, scroll down/toward = zoom out. */
  private onWheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.onManualZoomRequest?.();
    this.setZoom(this.zoom * (e.deltaY < 0 ? ZOOM_STEP_FACTOR : 1 / ZOOM_STEP_FACTOR));
  };

  private touchDistance(touches: TouchList): number {
    const dx = touches[0].clientX - touches[1].clientX;
    const dy = touches[0].clientY - touches[1].clientY;
    return Math.hypot(dx, dy);
  }

  private touchMidpoint(touches: TouchList): { x: number; y: number } {
    return { x: (touches[0].clientX + touches[1].clientX) / 2, y: (touches[0].clientY + touches[1].clientY) / 2 };
  }

  private onTouchStart = (e: TouchEvent): void => {
    // 1本指での描画中(タッチ編集有効時)に2本目以降が触れたら、ピンチ/タップジェスチャーを
    // 邪魔しないようにその場で描画を確定させる。
    if (e.touches.length >= 2 && this.isDrawing) {
      this.finishDrawing();
    }
    this.touchCount = e.touches.length;
    this.touchMoved = false;
    if (e.touches.length === 2) {
      this.touchStartDistance = this.touchDistance(e.touches);
      this.touchStartZoom = this.zoom;
      const mid = this.touchMidpoint(e.touches);
      this.touchStartMidX = mid.x;
      this.touchStartMidY = mid.y;
    }
  };

  /** Two fingers: pinch-to-zoom(距離の変化)。距離が変わらなくても中点が動いていれば
   * (=2本指を平行にドラッグしてスクロールしようとしている)、ズームはしないがtouchMovedは
   * 立てる — onTouchEndの「動きがなければタップ=取り消しジェスチャー」がパン操作と
   * 競合しないようにするため(実際のスクロール自体はmain.ts側のPointer Eventベースの
   * 処理が#canvas-viewportに対して行う、ここでは発火させない)。 */
  private onTouchMove = (e: TouchEvent): void => {
    if (e.touches.length !== 2) return;
    e.preventDefault();
    const distance = this.touchDistance(e.touches);
    const mid = this.touchMidpoint(e.touches);
    const distanceChanged = Math.abs(distance - this.touchStartDistance) > TOUCH_TAP_MOVE_THRESHOLD;
    const midMoved = Math.hypot(mid.x - this.touchStartMidX, mid.y - this.touchStartMidY) > TOUCH_TAP_MOVE_THRESHOLD;
    if (!distanceChanged && !midMoved) return;
    this.touchMoved = true;
    if (!distanceChanged) return;
    this.onManualZoomRequest?.();
    this.setZoom(this.touchStartZoom * (distance / this.touchStartDistance));
  };

  /** A tap (no pinch movement) with two fingers undoes; with three fingers redoes. */
  private onTouchEnd = (e: TouchEvent): void => {
    if (!this.touchMoved) {
      if (this.touchCount === 2) this.onUndoGesture?.();
      else if (this.touchCount === 3) this.onRedoGesture?.();
    }
    this.touchCount = e.touches.length;
    if (e.touches.length === 0) this.touchMoved = false;
  };

  render(): void {
    const pixels = composeDocument(this.doc);
    // TS 5.7+'s typed-array generics want Uint8ClampedArray<ArrayBuffer>; our buffers are always
    // plain ArrayBuffers at runtime, so this narrows a type-only mismatch, not a real one.
    const imageData = new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, this.doc.width, this.doc.height);
    this.offCtx.putImageData(imageData, 0, 0);
    this.redrawVisible();
  }

  /** Redraws the already-composed offscreen buffer onto the visible (scaled) canvas, plus the
   * selection outline — cheap, so the march timer can call this repeatedly without recomposing
   * the whole document every tick. */
  private redrawVisible(): void {
    this.visCtx.clearRect(0, 0, this.visible.width, this.visible.height);
    this.visCtx.drawImage(
      this.offscreen,
      0,
      0,
      this.doc.width,
      this.doc.height,
      0,
      0,
      this.visible.width,
      this.visible.height
    );
    this.updateSelectionMarchTimer();
    this.drawSelectionOutline();
    this.drawTransformOverlay();
  }

  private updateSelectionMarchTimer(): void {
    const hasSelection = maskHasSelection(this.doc.selectionMask);
    if (hasSelection && this.selectionMarchTimer === null) {
      this.selectionMarchTimer = window.setInterval(() => {
        this.selectionDashOffset = (this.selectionDashOffset + 1) % (SELECTION_DASH_PATTERN[0] + SELECTION_DASH_PATTERN[1]);
        this.redrawVisible();
      }, SELECTION_MARCH_INTERVAL_MS);
    } else if (!hasSelection && this.selectionMarchTimer !== null) {
      window.clearInterval(this.selectionMarchTimer);
      this.selectionMarchTimer = null;
      this.selectionDashOffset = 0;
    }
  }

  /** Dashed gray outline traced around the selection mask's boundary, with the dash pattern
   * continuously offset ("marching ants") rather than blinking on/off — the common convention in
   * drawing software — drawn on the already-scaled visible canvas (so dashes stay a consistent,
   * thin screen size regardless of zoom) rather than tinting the document pixels. */
  private drawSelectionOutline(): void {
    const mask = this.doc.selectionMask;
    if (!mask) return;
    const w = this.doc.width;
    const h = this.doc.height;
    const z = this.zoom;
    const selected = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && mask[y * w + x] !== 0;

    this.visCtx.save();
    this.visCtx.strokeStyle = "rgba(160, 160, 160, 0.9)";
    this.visCtx.lineWidth = 1;
    this.visCtx.setLineDash(SELECTION_DASH_PATTERN);
    this.visCtx.lineDashOffset = -this.selectionDashOffset;
    this.visCtx.beginPath();
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (!selected(x, y)) continue;
        if (!selected(x, y - 1)) {
          this.visCtx.moveTo(x * z, y * z);
          this.visCtx.lineTo((x + 1) * z, y * z);
        }
        if (!selected(x, y + 1)) {
          this.visCtx.moveTo(x * z, (y + 1) * z);
          this.visCtx.lineTo((x + 1) * z, (y + 1) * z);
        }
        if (!selected(x - 1, y)) {
          this.visCtx.moveTo(x * z, y * z);
          this.visCtx.lineTo(x * z, (y + 1) * z);
        }
        if (!selected(x + 1, y)) {
          this.visCtx.moveTo((x + 1) * z, y * z);
          this.visCtx.lineTo((x + 1) * z, (y + 1) * z);
        }
      }
    }
    this.visCtx.stroke();
    this.visCtx.restore();
  }

  /** CLIP STUDIO-style transform overlay: a solid quad outline, square handles at the 4 corners
   * (drag = scale in scaleRotate mode, free-drag in free mode), round handles at edge midpoints
   * (scaleRotate only, single-axis scale), and an invisible ring just outside each corner for
   * rotation — all hit-tested in hitTestHandle() using the same screen-space radius. */
  private drawTransformOverlay(): void {
    const session = this.transformSession;
    if (!session) return;
    const z = this.zoom;
    const corners = session.getCurrentCorners().map((p) => ({ x: p.x * z, y: p.y * z })) as [Point, Point, Point, Point];
    const [tl, tr, br, bl] = corners;

    this.visCtx.save();
    this.visCtx.strokeStyle = "#4a7dff";
    this.visCtx.lineWidth = 1.5;
    this.visCtx.setLineDash([]);
    this.visCtx.beginPath();
    this.visCtx.moveTo(tl.x, tl.y);
    this.visCtx.lineTo(tr.x, tr.y);
    this.visCtx.lineTo(br.x, br.y);
    this.visCtx.lineTo(bl.x, bl.y);
    this.visCtx.closePath();
    this.visCtx.stroke();

    const handleSize = 8;
    this.visCtx.fillStyle = "#ffffff";
    for (const c of [tl, tr, br, bl]) {
      this.visCtx.fillRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
      this.visCtx.strokeRect(c.x - handleSize / 2, c.y - handleSize / 2, handleSize, handleSize);
    }

    if (session.mode === "scaleRotate") {
      const mids = [midpoint(tl, tr), midpoint(tr, br), midpoint(br, bl), midpoint(bl, tl)];
      for (const m of mids) {
        this.visCtx.beginPath();
        this.visCtx.arc(m.x, m.y, handleSize / 2, 0, Math.PI * 2);
        this.visCtx.fill();
        this.visCtx.stroke();
      }
    }
    this.visCtx.restore();
  }
}
