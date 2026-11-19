import { Document, RasterLayer } from "../document";
import { DragTool, RGBA } from "./tool";
import { applyLinearGradient, maskHasSelection } from "../selection";

export type GradientPair = "mainToSub" | "mainToTransparent" | "subToTransparent";

/** CLIP STUDIO-style linear gradient: drag from a start point to an end point, previewed live
 * while dragging (same restore-then-redraw approach as BrushTool's preStroke) so the user can see
 * exactly which range the gradient covers before releasing. */
export class GradientTool implements DragTool {
  readonly kind = "gradient" as const;
  mainColor: RGBA = [0, 0, 0, 255];
  subColor: RGBA = [255, 255, 255, 255];
  pair: GradientPair = "mainToSub";

  private start: { x: number; y: number } | null = null;
  private preStroke: Uint8ClampedArray | null = null;

  begin(doc: Document, x: number, y: number): void {
    const layer = doc.getActiveLayer();
    this.start = { x, y };
    this.preStroke = layer ? layer.pixels.slice() : null;
    this.apply(layer, doc, x, y);
  }

  drag(doc: Document, x: number, y: number): void {
    this.apply(doc.getActiveLayer(), doc, x, y);
  }

  end(_doc: Document): void {
    this.start = null;
    this.preStroke = null;
  }

  private apply(layer: RasterLayer | undefined, doc: Document, x: number, y: number): void {
    if (!layer || !this.start || !this.preStroke) return;
    layer.pixels.set(this.preStroke);
    const [colorA, colorB] = this.resolveColors();
    const mask = maskHasSelection(doc.selectionMask) ? doc.selectionMask : null;
    applyLinearGradient(layer, mask, this.start.x, this.start.y, x, y, colorA, colorB);
  }

  private resolveColors(): [RGBA, RGBA] {
    const transparent: RGBA = [0, 0, 0, 0];
    switch (this.pair) {
      case "mainToSub":
        return [this.mainColor, this.subColor];
      case "mainToTransparent":
        return [this.mainColor, transparent];
      case "subToTransparent":
        return [this.subColor, transparent];
    }
  }
}
