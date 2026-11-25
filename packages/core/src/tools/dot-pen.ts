import { Document, RasterLayer } from "../document";
import { RGBA, StrokeTool } from "./tool";
import { setPixel, bresenhamLine } from "./raster-utils";
import { maskHasSelection } from "../selection";

/** Fixed 1px, no anti-aliasing, ignores pressure entirely. */
export class DotPenTool implements StrokeTool {
  color: RGBA = [0, 0, 0, 255];

  private last: { x: number; y: number } | null = null;

  beginStroke(layer: RasterLayer, x: number, y: number, _pressure: number, doc?: Document): void {
    this.last = { x, y };
    const mask = doc && maskHasSelection(doc.selectionMask) ? doc.selectionMask : null;
    setPixel(layer, Math.floor(x), Math.floor(y), this.color, mask);
  }

  continueStroke(layer: RasterLayer, x: number, y: number, _pressure: number, doc?: Document): void {
    if (!this.last) {
      this.beginStroke(layer, x, y, _pressure, doc);
      return;
    }
    const mask = doc && maskHasSelection(doc.selectionMask) ? doc.selectionMask : null;
    for (const [px, py] of bresenhamLine(this.last.x, this.last.y, x, y)) {
      setPixel(layer, px, py, this.color, mask);
    }
    this.last = { x, y };
  }

  endStroke(): void {
    this.last = null;
  }
}
