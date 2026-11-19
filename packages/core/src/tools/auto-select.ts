import { Document } from "../document";
import { DragTool } from "./tool";
import { floodFillSelectMask } from "../selection";

/** 線画領域の自動選択: single click, 4-connected flood fill of the active layer from the clicked
 * pixel (same tolerance-based matching as BucketFillTool) — grabs the blank area enclosed by
 * line art. Drag/end are no-ops, matching BucketFillTool's single-click shape. */
export class AutoSelectTool implements DragTool {
  readonly kind = "selection" as const;
  tolerance = 24;

  begin(doc: Document, x: number, y: number): void {
    const layer = doc.getActiveLayer();
    if (!layer) return;
    doc.selectionMask = floodFillSelectMask(layer, Math.floor(x), Math.floor(y), this.tolerance);
  }

  drag(_doc: Document, _x: number, _y: number): void {
    // single-click tool, nothing to do on drag
  }

  end(_doc: Document): void {
    // no-op
  }
}
