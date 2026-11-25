import { Document } from "../document";
import { DragTool } from "./tool";
import { createEmptyMask, setPolygonMask, combineSelectionMasks, SelectionCombineMode, SelectionMask } from "../selection";

/** Freehand selection: accumulates the dragged path and re-fills the (implicitly closed) polygon
 * on every move, so the selection previews live while dragging rather than only on release. */
export class LassoSelectTool implements DragTool {
  readonly kind = "selection" as const;
  /** 新規/追加/除外/共通 — 選択範囲ツール共通のオプション(main.tsが全ツールへ同期する)。 */
  mode: SelectionCombineMode = "new";
  private points: { x: number; y: number }[] = [];
  private baseline: SelectionMask | null = null;

  begin(doc: Document, x: number, y: number): void {
    this.points = [{ x, y }];
    this.baseline = doc.selectionMask ? doc.selectionMask.slice() : null;
    doc.selectionMask = combineSelectionMasks(this.baseline, createEmptyMask(doc.width, doc.height), this.mode);
  }

  drag(doc: Document, x: number, y: number): void {
    if (this.points.length === 0) return;
    this.points.push({ x, y });
    const mask = createEmptyMask(doc.width, doc.height);
    setPolygonMask(mask, doc.width, doc.height, this.points);
    doc.selectionMask = combineSelectionMasks(this.baseline, mask, this.mode);
  }

  end(_doc: Document): void {
    this.points = [];
    this.baseline = null;
  }
}
