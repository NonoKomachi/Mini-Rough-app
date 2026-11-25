import { Document } from "../document";
import { DragTool } from "./tool";
import { createEmptyMask, setRectMask, combineSelectionMasks, SelectionCombineMode, SelectionMask } from "../selection";

export class RectSelectTool implements DragTool {
  readonly kind = "selection" as const;
  /** 新規/追加/除外/共通 — 選択範囲ツール共通のオプション(main.tsが全ツールへ同期する)。 */
  mode: SelectionCombineMode = "new";
  private start: { x: number; y: number } | null = null;
  /** ドラッグ開始前の選択範囲(新規以外のモードで、今回の矩形と合成する基準)。 */
  private baseline: SelectionMask | null = null;

  begin(doc: Document, x: number, y: number): void {
    this.start = { x, y };
    this.baseline = doc.selectionMask ? doc.selectionMask.slice() : null;
    const mask = createEmptyMask(doc.width, doc.height);
    setRectMask(mask, doc.width, doc.height, x, y, x, y);
    doc.selectionMask = combineSelectionMasks(this.baseline, mask, this.mode);
  }

  drag(doc: Document, x: number, y: number): void {
    if (!this.start) return;
    const mask = createEmptyMask(doc.width, doc.height);
    setRectMask(mask, doc.width, doc.height, this.start.x, this.start.y, x, y);
    doc.selectionMask = combineSelectionMasks(this.baseline, mask, this.mode);
  }

  end(_doc: Document): void {
    this.start = null;
    this.baseline = null;
  }
}
