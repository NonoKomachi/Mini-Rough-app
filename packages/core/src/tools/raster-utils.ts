import { RasterLayer } from "../document";
import { RGBA } from "./tool";

export function setPixel(layer: RasterLayer, x: number, y: number, color: RGBA): void {
  if (x < 0 || y < 0 || x >= layer.width || y >= layer.height) return;
  const idx = (y * layer.width + x) * 4;
  layer.pixels[idx] = color[0];
  layer.pixels[idx + 1] = color[1];
  layer.pixels[idx + 2] = color[2];
  layer.pixels[idx + 3] = color[3];
}

export function getPixel(layer: RasterLayer, x: number, y: number): RGBA {
  const idx = (y * layer.width + x) * 4;
  return [layer.pixels[idx], layer.pixels[idx + 1], layer.pixels[idx + 2], layer.pixels[idx + 3]];
}

/** Integer-pixel Bresenham walk from (x0,y0) to (x1,y1), inclusive of both ends. Inputs are
 * continuous document coordinates; `floor` matches the pixel-center convention used by the
 * circle-stamping tools (pixel N occupies [N, N+1)). */
export function* bresenhamLine(x0: number, y0: number, x1: number, y1: number): Generator<[number, number]> {
  let ix0 = Math.floor(x0);
  let iy0 = Math.floor(y0);
  const ix1 = Math.floor(x1);
  const iy1 = Math.floor(y1);
  const dx = Math.abs(ix1 - ix0);
  const sx = ix0 < ix1 ? 1 : -1;
  const dy = -Math.abs(iy1 - iy0);
  const sy = iy0 < iy1 ? 1 : -1;
  let err = dx + dy;
  while (true) {
    yield [ix0, iy0];
    if (ix0 === ix1 && iy0 === iy1) break;
    const e2 = 2 * err;
    if (e2 >= dy) {
      err += dy;
      ix0 += sx;
    }
    if (e2 <= dx) {
      err += dx;
      iy0 += sy;
    }
  }
}
