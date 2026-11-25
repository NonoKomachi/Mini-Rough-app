import { Document } from "../document";
import { DragTool } from "./tool";
import { floodFillSelectMask } from "../selection";
import { composeDocument } from "../rendering";

/** 線画領域の自動選択: single click, 4-connected flood fill of the active layer from the clicked
 * pixel (same tolerance-based matching as BucketFillTool) — grabs the blank area enclosed by
 * line art. Drag/end are no-ops, matching BucketFillTool's single-click shape. */
export class AutoSelectTool implements DragTool {
  readonly kind = "selection" as const;
  tolerance = 24;
  /** true: 全レイヤーを合成した見た目で領域判定する(他レイヤーの線もまたがない)。
   * false(既定): 現在のレイヤーの中身だけで判定する。選択範囲自体はどちらでも同じ形。 */
  sampleAllLayers = false;

  begin(doc: Document, x: number, y: number): void {
    const layer = doc.getActiveLayer();
    if (!layer) return;
    const reference = this.sampleAllLayers ? composeDocument(doc) : layer.pixels;
    doc.selectionMask = floodFillSelectMask(layer.width, layer.height, reference, Math.floor(x), Math.floor(y), this.tolerance);
  }

  drag(_doc: Document, _x: number, _y: number): void {
    // single-click tool, nothing to do on drag
  }

  end(_doc: Document): void {
    // no-op
  }
}
