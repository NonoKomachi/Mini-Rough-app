import { Document } from "../document";
import { DragTool } from "./tool";
import { createEmptyMask, setEllipseMask } from "../selection";

export class EllipseSelectTool implements DragTool {
  readonly kind = "selection" as const;
  private start: { x: number; y: number } | null = null;

  begin(doc: Document, x: number, y: number): void {
    this.start = { x, y };
    const mask = createEmptyMask(doc.width, doc.height);
    setEllipseMask(mask, doc.width, doc.height, x, y, x, y);
    doc.selectionMask = mask;
  }

  drag(doc: Document, x: number, y: number): void {
    if (!this.start) return;
    const mask = createEmptyMask(doc.width, doc.height);
    setEllipseMask(mask, doc.width, doc.height, this.start.x, this.start.y, x, y);
    doc.selectionMask = mask;
  }

  end(_doc: Document): void {
    this.start = null;
  }
}
