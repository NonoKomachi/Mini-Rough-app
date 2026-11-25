import { Document } from "../document";
import { DragTool } from "./tool";
import { createEmptyMask, setEllipseMask, combineSelectionMasks, SelectionCombineMode, SelectionMask } from "../selection";

export class EllipseSelectTool implements DragTool {
  readonly kind = "selection" as const;
  /** 新規/追加/除外/共通 — 選択範囲ツール共通のオプション(main.tsが全ツールへ同期する)。 */
  mode: SelectionCombineMode = "new";
  private start: { x: number; y: number } | null = null;
  private baseline: SelectionMask | null = null;

  begin(doc: Document, x: number, y: number): void {
    this.start = { x, y };
    this.baseline = doc.selectionMask ? doc.selectionMask.slice() : null;
    const mask = createEmptyMask(doc.width, doc.height);
    setEllipseMask(mask, doc.width, doc.height, x, y, x, y);
    doc.selectionMask = combineSelectionMasks(this.baseline, mask, this.mode);
  }

  drag(doc: Document, x: number, y: number): void {
    if (!this.start) return;
    const mask = createEmptyMask(doc.width, doc.height);
    setEllipseMask(mask, doc.width, doc.height, this.start.x, this.start.y, x, y);
    doc.selectionMask = combineSelectionMasks(this.baseline, mask, this.mode);
  }

  end(_doc: Document): void {
    this.start = null;
    this.baseline = null;
  }
}
