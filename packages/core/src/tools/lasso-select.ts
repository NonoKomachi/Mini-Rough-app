import { Document } from "../document";
import { DragTool } from "./tool";
import { createEmptyMask, setPolygonMask } from "../selection";

/** Freehand selection: accumulates the dragged path and re-fills the (implicitly closed) polygon
 * on every move, so the selection previews live while dragging rather than only on release. */
export class LassoSelectTool implements DragTool {
  readonly kind = "selection" as const;
  private points: { x: number; y: number }[] = [];

  begin(doc: Document, x: number, y: number): void {
    this.points = [{ x, y }];
    doc.selectionMask = createEmptyMask(doc.width, doc.height);
  }

  drag(doc: Document, x: number, y: number): void {
    if (this.points.length === 0) return;
    this.points.push({ x, y });
    const mask = createEmptyMask(doc.width, doc.height);
    setPolygonMask(mask, doc.width, doc.height, this.points);
    doc.selectionMask = mask;
  }

  end(_doc: Document): void {
    this.points = [];
  }
}
