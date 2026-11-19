import { RasterLayer } from "../document";
import { RGBA, StrokeTool } from "./tool";
import { getPixel, setPixel } from "./raster-utils";

function colorsClose(a: RGBA, b: RGBA, tolerance: number): boolean {
  return (
    Math.abs(a[0] - b[0]) <= tolerance &&
    Math.abs(a[1] - b[1]) <= tolerance &&
    Math.abs(a[2] - b[2]) <= tolerance &&
    Math.abs(a[3] - b[3]) <= tolerance
  );
}

function floodFill(layer: RasterLayer, startX: number, startY: number, fillColor: RGBA, tolerance: number): void {
  if (startX < 0 || startY < 0 || startX >= layer.width || startY >= layer.height) return;
  const target = getPixel(layer, startX, startY);
  if (colorsClose(target, fillColor, 0)) return;

  const visited = new Uint8Array(layer.width * layer.height);
  const stack: [number, number][] = [[startX, startY]];

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    if (x < 0 || y < 0 || x >= layer.width || y >= layer.height) continue;
    const idx = y * layer.width + x;
    if (visited[idx]) continue;
    if (!colorsClose(getPixel(layer, x, y), target, tolerance)) continue;
    visited[idx] = 1;
    setPixel(layer, x, y, fillColor);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
}

/** Single-click 4-connected flood fill; continue/end are no-ops. */
export class BucketFillTool implements StrokeTool {
  color: RGBA = [0, 0, 0, 255];
  tolerance = 24;

  beginStroke(layer: RasterLayer, x: number, y: number, _pressure: number): void {
    floodFill(layer, Math.floor(x), Math.floor(y), this.color, this.tolerance);
  }

  continueStroke(_layer: RasterLayer, _x: number, _y: number, _pressure: number): void {
    // single-click tool, nothing to do on drag
  }

  endStroke(): void {
    // no-op
  }
}
