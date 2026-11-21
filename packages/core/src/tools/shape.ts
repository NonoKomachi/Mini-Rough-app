import { Document, RasterLayer } from "../document";
import { DragTool, RGBA } from "./tool";
import { setPixel, stampFilledCircle } from "./raster-utils";
import { SelectionMask, maskHasSelection } from "../selection";

export type ShapeKind = "line" | "rect" | "ellipse" | "triangle" | "star";
export type AngleMode = "none" | "snap45" | "snapCustom" | "free";

type Box = { cx: number; cy: number; w: number; h: number };
type Vec = { x: number; y: number };

/** 四角/丸/三角/星で、サイズ確定後の回転ドラッグがこの距離(ドキュメント座標px)を超えるまでは
 * 角度を0(無回転)のまま保つ — ごく小さな動き(ほぼ同じ場所でのクリック)を「回転しない」の
 * 意思表示として扱えるようにする(ユーザー指示: 2段階目のドラッグをそのまま離せば無回転で確定)。 */
const ROTATE_ENGAGE_THRESHOLD = 4;

/** 5芒星の内側頂点の半径比(外側を1としたとき)。古典的な正五芒星の比(1/φ²)に近い値。 */
const STAR_INNER_RATIO = 0.382;

function snapAngle(angle: number, mode: AngleMode, stepDegrees: number): number {
  if (mode === "none" || mode === "free") return angle;
  const step = mode === "snap45" ? Math.PI / 4 : (Math.max(1, stepDegrees) * Math.PI) / 180;
  return Math.round(angle / step) * step;
}

/** Even-odd ray casting; `verts` is treated as a closed loop. */
function pointInPolygon(px: number, py: number, verts: Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = verts.length - 1; i < verts.length; j = i++) {
    const a = verts[i];
    const b = verts[j];
    if (a.y > py !== b.y > py && px < ((b.x - a.x) * (py - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Local (unrotated, centered at origin) vertices — apex pointing up (toward -y). */
function triangleVerts(w: number, h: number): Vec[] {
  return [
    { x: 0, y: -h / 2 },
    { x: w / 2, y: h / 2 },
    { x: -w / 2, y: h / 2 }
  ];
}

/** Local (unrotated, centered at origin) 10-vertex star outline, outer points at 72°, 1点が上。 */
function starVerts(w: number, h: number): Vec[] {
  const rxOuter = w / 2;
  const ryOuter = h / 2;
  const rxInner = rxOuter * STAR_INNER_RATIO;
  const ryInner = ryOuter * STAR_INNER_RATIO;
  const verts: Vec[] = [];
  for (let i = 0; i < 10; i++) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const outer = i % 2 === 0;
    const rx = outer ? rxOuter : rxInner;
    const ry = outer ? ryOuter : ryInner;
    verts.push({ x: rx * Math.cos(angle), y: ry * Math.sin(angle) });
  }
  return verts;
}

/** Fills a (possibly rotated) rect/ellipse/triangle/star bounding box into `layer`. `angleRad`
 * rotates the shape around (cx,cy); each candidate pixel is transformed into the shape's local
 * (unrotated) frame before testing membership, so one generic loop covers all 4 kinds. */
function rasterizeShapeBox(
  layer: RasterLayer,
  shape: Exclude<ShapeKind, "line">,
  box: Box,
  angleRad: number,
  color: RGBA,
  mask: SelectionMask | null
): void {
  const { cx, cy, w, h } = box;
  if (w <= 0 || h <= 0) return;
  const cos = Math.cos(angleRad);
  const sin = Math.sin(angleRad);
  const halfDiag = Math.hypot(w, h) / 2 + 1;
  const minX = Math.max(0, Math.floor(cx - halfDiag));
  const maxX = Math.min(layer.width, Math.ceil(cx + halfDiag));
  const minY = Math.max(0, Math.floor(cy - halfDiag));
  const maxY = Math.min(layer.height, Math.ceil(cy + halfDiag));
  const hw = w / 2;
  const hh = h / 2;
  const poly = shape === "triangle" ? triangleVerts(w, h) : shape === "star" ? starVerts(w, h) : null;

  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cy;
      // 逆回転: ドキュメント座標 → 図形のローカル(無回転)座標。
      const lx = cos * dx + sin * dy;
      const ly = -sin * dx + cos * dy;
      let inside: boolean;
      if (shape === "rect") {
        inside = Math.abs(lx) <= hw && Math.abs(ly) <= hh;
      } else if (shape === "ellipse") {
        const nx = lx / hw;
        const ny = ly / hh;
        inside = nx * nx + ny * ny <= 1;
      } else {
        inside = pointInPolygon(lx, ly, poly!);
      }
      if (inside) setPixel(layer, x, y, color, mask);
    }
  }
}

function rasterizeLine(layer: RasterLayer, start: Vec, end: Vec, thickness: number, color: RGBA, mask: SelectionMask | null): void {
  const radius = Math.max(0.5, thickness / 2);
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  const dist = Math.hypot(dx, dy);
  const steps = Math.max(1, Math.ceil(dist / 0.5));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    stampFilledCircle(layer, start.x + dx * t, start.y + dy * t, radius, color, mask);
  }
}

/**
 * 直線/四角/丸/三角/星の図形ツール。
 *
 * 直線: 1回のドラッグだけで決まる — 方向(角度)は`angleMode`でスナップし、長さはドラッグ距離。
 *
 * 四角/丸/三角/星: 2段階操作(ユーザー指示の仕様)。
 *   1. ドラッグで大きさ(幅・高さ、`lockAspect`時は正方形/正円等)を確定。
 *   2. `angleMode`が「なし」以外なら、指を離した後もう一度ドラッグ(どこから始めてもよい) —
 *      図形の中心から現在のカーソル方向へ、`angleMode`でスナップした角度が付き、離した時点の
 *      角度で確定する。しきい値未満の移動で離せば無回転(0度)のまま確定する。
 *      「なし」なら2段階目自体が発生せず、常に軸に沿った図形になる。
 */
export class ShapeTool implements DragTool {
  readonly kind = "shape" as const;
  shape: ShapeKind = "rect";
  color: RGBA = [0, 0, 0, 255];
  /** 直線の太さ(px)。塗りの図形(四角/丸/三角/星)では使わない。 */
  size = 4;
  lockAspect = false;
  angleMode: AngleMode = "none";
  /** angleMode === "snapCustom" のときのスナップ間隔(度)。 */
  angleStepDegrees = 15;

  private phase: "idle" | "sizing" | "awaitingRotate" | "rotating" = "idle";
  /** 複数のバリエーション(キャンバス)がこのツールインスタンスを共有しているため、2段階目が
   * 別のdocへ紛れ込まないようにする安全策。 */
  private activeDoc: Document | null = null;
  private preStroke: Uint8ClampedArray | null = null;
  private start: Vec | null = null;
  private current: Vec | null = null;
  /** 四角/丸/三角/星のみ: サイズ確定(end of sizing)時点で凍結される外接矩形。 */
  private box: Box | null = null;
  private rotateStart: Vec | null = null;
  private angle = 0;

  begin(doc: Document, x: number, y: number): void {
    if (this.phase === "awaitingRotate" && this.activeDoc === doc) {
      this.phase = "rotating";
      this.rotateStart = { x, y };
      this.repaint(doc);
      return;
    }
    const layer = doc.getActiveLayer();
    this.activeDoc = doc;
    this.preStroke = layer ? layer.pixels.slice() : null;
    this.start = { x, y };
    this.current = { x, y };
    this.box = null;
    this.angle = 0;
    this.phase = "sizing";
    this.repaint(doc);
  }

  drag(doc: Document, x: number, y: number): void {
    if (this.phase === "sizing") {
      this.current = { x, y };
      this.repaint(doc);
    } else if (this.phase === "rotating") {
      this.updateAngle(x, y);
      this.repaint(doc);
    }
  }

  end(_doc: Document): void {
    if (this.phase === "sizing") {
      if (this.shape !== "line") this.box = this.computeBox();
      if (this.shape === "line" || this.angleMode === "none") this.finish();
      else this.phase = "awaitingRotate";
    } else if (this.phase === "rotating") {
      this.finish();
    }
  }

  /** ツール切替時に呼ぶ — 「サイズ確定済み・角度ドラッグ待ち」の状態を他のツールに持ち越させない
   * (このインスタンスは全バリエーションで共有されているため)。待機中だった図形はサイズ確定
   * 時点(角度0)の見た目のまま、もう操作できずに残る。 */
  reset(): void {
    this.finish();
  }

  private finish(): void {
    this.phase = "idle";
    this.activeDoc = null;
    this.preStroke = null;
    this.start = null;
    this.current = null;
    this.box = null;
    this.rotateStart = null;
    this.angle = 0;
  }

  private computeBox(): Box {
    const start = this.start!;
    const cur = this.current!;
    let dx = cur.x - start.x;
    let dy = cur.y - start.y;
    if (this.lockAspect) {
      const m = Math.max(Math.abs(dx), Math.abs(dy));
      dx = (dx < 0 ? -1 : 1) * m;
      dy = (dy < 0 ? -1 : 1) * m;
    }
    return { cx: start.x + dx / 2, cy: start.y + dy / 2, w: Math.abs(dx), h: Math.abs(dy) };
  }

  private updateAngle(x: number, y: number): void {
    const box = this.box;
    const rotateStart = this.rotateStart;
    if (!box || !rotateStart) return;
    if (Math.hypot(x - rotateStart.x, y - rotateStart.y) < ROTATE_ENGAGE_THRESHOLD) {
      this.angle = 0;
      return;
    }
    const raw = Math.atan2(y - box.cy, x - box.cx);
    this.angle = snapAngle(raw, this.angleMode, this.angleStepDegrees);
  }

  private repaint(doc: Document): void {
    const layer = doc.getActiveLayer();
    if (!layer || !this.preStroke || !this.start) return;
    layer.pixels.set(this.preStroke);
    const mask = maskHasSelection(doc.selectionMask) ? doc.selectionMask : null;
    if (this.shape === "line") {
      if (!this.current) return;
      this.paintLine(layer, this.start, this.current, mask);
      return;
    }
    const box = this.phase === "sizing" ? this.computeBox() : this.box;
    if (!box) return;
    rasterizeShapeBox(layer, this.shape, box, this.angle, this.color, mask);
  }

  private paintLine(layer: RasterLayer, start: Vec, cur: Vec, mask: SelectionMask | null): void {
    const rawDx = cur.x - start.x;
    const rawDy = cur.y - start.y;
    const dist = Math.hypot(rawDx, rawDy);
    if (dist === 0) return;
    const angle = snapAngle(Math.atan2(rawDy, rawDx), this.angleMode, this.angleStepDegrees);
    const end: Vec = { x: start.x + Math.cos(angle) * dist, y: start.y + Math.sin(angle) * dist };
    rasterizeLine(layer, start, end, this.size, this.color, mask);
  }
}
