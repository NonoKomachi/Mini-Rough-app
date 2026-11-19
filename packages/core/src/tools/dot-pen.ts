import { RasterLayer } from "../document";
import { RGBA, StrokeTool } from "./tool";
import { setPixel, bresenhamLine } from "./raster-utils";

/** Fixed 1px, no anti-aliasing, ignores pressure entirely. */
export class DotPenTool implements StrokeTool {
  color: RGBA = [0, 0, 0, 255];

  private last: { x: number; y: number } | null = null;

  beginStroke(layer: RasterLayer, x: number, y: number, _pressure: number): void {
    this.last = { x, y };
    setPixel(layer, Math.floor(x), Math.floor(y), this.color);
  }

  continueStroke(layer: RasterLayer, x: number, y: number, _pressure: number): void {
    if (!this.last) {
      this.beginStroke(layer, x, y, _pressure);
      return;
    }
    for (const [px, py] of bresenhamLine(this.last.x, this.last.y, x, y)) {
      setPixel(layer, px, py, this.color);
    }
    this.last = { x, y };
  }

  endStroke(): void {
    this.last = null;
  }
}
