import {
  Document,
  RasterLayer,
  ExtractedRegion,
  Point,
  TransformInterpolation,
  extractRegion,
  clearRegionFromLayer,
  writeAffineTransform,
  writeFreeTransform
} from "@mini-rough/core";
import { SelectionMask } from "@mini-rough/core";

export type TransformMode = "scaleRotate" | "free";

/** Which handle a drag grabbed. `index` is 0=TL,1=TR,2=BR,3=BL for "corner"/"rotate", and
 * 0=top,1=right,2=bottom,3=left for "edge". */
export type HandleKind =
  | { kind: "move" }
  | { kind: "corner"; index: 0 | 1 | 2 | 3 }
  | { kind: "edge"; index: 0 | 1 | 2 | 3 }
  | { kind: "rotate"; index: 0 | 1 | 2 | 3 };

const CORNER_LOCAL: Point[] = [
  { x: -1, y: -1 },
  { x: 1, y: -1 },
  { x: 1, y: 1 },
  { x: -1, y: 1 }
];

/** Scale/rotate or free-transform a region (selection bounding box, or the whole layer with no
 * selection) interactively — extracted once up front, then every preview() call restores the
 * pre-transform-but-post-extraction baseline and re-draws from the current parameters, so a long
 * drag never compounds resampling error (same restore-then-redraw pattern as BrushTool/GradientTool). */
export class TransformSession {
  readonly doc: Document;
  readonly layer: RasterLayer;
  readonly mode: TransformMode;
  private readonly region: ExtractedRegion;
  /** Full-layer snapshot taken right after the region was cleared out — the "nothing drawn yet"
   * state that every preview() restores before redrawing. */
  private readonly baseline: Uint8ClampedArray;
  /** Full-layer snapshot taken BEFORE extraction — what cancel() restores to. */
  private readonly originalPixels: Uint8ClampedArray;
  private readonly originalSelectionMask: SelectionMask | null;

  /** scaleRotate mode state. */
  center: Point;
  scaleX = 1;
  scaleY = 1;
  rotation = 0;

  /** free mode state: the region's 4 corners (TL,TR,BR,BL) in document space. */
  corners: [Point, Point, Point, Point];

  /** ハード(ニアレストネイバー)かバイリニアか。両モード共通(scaleRotate/free)。 */
  interpolation: TransformInterpolation = "bilinear";

  onChange: (() => void) | null = null;

  constructor(doc: Document, layer: RasterLayer, mode: TransformMode) {
    this.doc = doc;
    this.layer = layer;
    this.mode = mode;
    this.originalPixels = layer.pixels.slice();
    this.originalSelectionMask = doc.selectionMask ? doc.selectionMask.slice() : null;
    this.region = extractRegion(doc, layer);
    clearRegionFromLayer(doc, layer, this.region);
    this.baseline = layer.pixels.slice();
    this.center = { x: this.region.x + this.region.w / 2, y: this.region.y + this.region.h / 2 };
    this.corners = [
      { x: this.region.x, y: this.region.y },
      { x: this.region.x + this.region.w, y: this.region.y },
      { x: this.region.x + this.region.w, y: this.region.y + this.region.h },
      { x: this.region.x, y: this.region.y + this.region.h }
    ];
  }

  getRegionSize(): { w: number; h: number } {
    return { w: this.region.w, h: this.region.h };
  }

  /** Current 4 corners in document space, used for both handle hit-testing and the bounding-box
   * overlay — in scaleRotate mode these are DERIVED from center/scale/rotation rather than stored. */
  getCurrentCorners(): [Point, Point, Point, Point] {
    if (this.mode === "free") return this.corners;
    const hw = (this.region.w * this.scaleX) / 2;
    const hh = (this.region.h * this.scaleY) / 2;
    const cos = Math.cos(this.rotation);
    const sin = Math.sin(this.rotation);
    return CORNER_LOCAL.map((c) => {
      const lx = c.x * hw;
      const ly = c.y * hh;
      return { x: this.center.x + lx * cos - ly * sin, y: this.center.y + lx * sin + ly * cos };
    }) as [Point, Point, Point, Point];
  }

  getCenter(): Point {
    if (this.mode === "free") {
      const [tl, tr, br, bl] = this.corners;
      return { x: (tl.x + tr.x + br.x + bl.x) / 4, y: (tl.y + tr.y + br.y + bl.y) / 4 };
    }
    return this.center;
  }

  /** Repaints the layer from the extracted region using the current parameters. Call after any
   * change to center/scale/rotation/corners, including every pointermove of a drag. */
  preview(): void {
    this.layer.pixels.set(this.baseline);
    this.doc.selectionMask = this.originalSelectionMask ? this.originalSelectionMask.slice() : null;
    if (this.mode === "free") {
      writeFreeTransform(this.doc, this.layer, this.region, this.corners, this.interpolation);
    } else {
      writeAffineTransform(this.doc, this.layer, this.region, this.center, this.scaleX, this.scaleY, this.rotation, this.interpolation);
    }
    this.onChange?.();
  }

  /** Moves the whole transform (center, or all 4 free-transform corners) by a document-space delta. */
  moveBy(dx: number, dy: number): void {
    if (this.mode === "free") {
      this.corners = this.corners.map((c) => ({ x: c.x + dx, y: c.y + dy })) as [Point, Point, Point, Point];
    } else {
      this.center = { x: this.center.x + dx, y: this.center.y + dy };
    }
  }

  /** Drags a free-transform corner to an absolute document-space position. */
  setFreeCorner(index: 0 | 1 | 2 | 3, pos: Point): void {
    this.corners[index] = pos;
  }

  /** Recomputes scale from a corner handle's absolute document-space position (scaleRotate mode):
   * projects the point into the pre-rotation local frame and reads off the half-size ratio. */
  setScaleFromCornerDrag(pos: Point): void {
    const cos = Math.cos(-this.rotation);
    const sin = Math.sin(-this.rotation);
    const dx = pos.x - this.center.x;
    const dy = pos.y - this.center.y;
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    const minScale = 0.02;
    this.scaleX = Math.max(minScale, (Math.abs(lx) * 2) / this.region.w);
    this.scaleY = Math.max(minScale, (Math.abs(ly) * 2) / this.region.h);
  }

  /** Recomputes just one axis of scale from an edge-midpoint handle's drag (scaleRotate mode). */
  setScaleFromEdgeDrag(edgeIndex: 0 | 1 | 2 | 3, pos: Point): void {
    const cos = Math.cos(-this.rotation);
    const sin = Math.sin(-this.rotation);
    const dx = pos.x - this.center.x;
    const dy = pos.y - this.center.y;
    const lx = dx * cos - dy * sin;
    const ly = dx * sin + dy * cos;
    const minScale = 0.02;
    if (edgeIndex === 0 || edgeIndex === 2) {
      this.scaleY = Math.max(minScale, (Math.abs(ly) * 2) / this.region.h);
    } else {
      this.scaleX = Math.max(minScale, (Math.abs(lx) * 2) / this.region.w);
    }
  }

  /** Recomputes rotation so that `cornerIndex`'s handle points toward `pos`. */
  setRotationFromHandleDrag(cornerIndex: 0 | 1 | 2 | 3, pos: Point): void {
    const local = CORNER_LOCAL[cornerIndex];
    const baseAngle = Math.atan2(local.y, local.x);
    const pointerAngle = Math.atan2(pos.y - this.center.y, pos.x - this.center.x);
    this.rotation = pointerAngle - baseAngle;
  }

  commit(): void {
    this.preview();
  }

  cancel(): void {
    this.layer.pixels.set(this.originalPixels);
    this.doc.selectionMask = this.originalSelectionMask;
  }
}
