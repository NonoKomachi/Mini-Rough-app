import { Document, RasterLayer } from "../document";

export type RGBA = [number, number, number, number];

export interface StrokeTool {
  beginStroke(layer: RasterLayer, x: number, y: number, pressure: number): void;
  continueStroke(layer: RasterLayer, x: number, y: number, pressure: number): void;
  endStroke(): void;
}

/** Tools that drag out a region against the whole document rather than painting into a layer —
 * selection tools (rect/ellipse/lasso/auto-select), the gradient tool, and the move tool. */
export interface DragTool {
  readonly kind: "selection" | "gradient" | "move";
  begin(doc: Document, x: number, y: number): void;
  drag(doc: Document, x: number, y: number): void;
  end(doc: Document): void;
}

/** The eyedropper: samples the composite color under the cursor rather than mutating the
 * document at all, so it's kept out of DragTool/StrokeTool's mutation-oriented contracts. */
export interface PickTool {
  readonly kind: "eyedropper";
}

export function isDragTool(tool: StrokeTool | DragTool | PickTool): tool is DragTool {
  return "kind" in tool && tool.kind !== "eyedropper";
}

export function isPickTool(tool: StrokeTool | DragTool | PickTool): tool is PickTool {
  return "kind" in tool && tool.kind === "eyedropper";
}
