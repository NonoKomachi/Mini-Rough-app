import { Document, RasterLayer } from "../document";
import { RGBA, StrokeTool } from "./tool";
import { setPixel } from "./raster-utils";
import { composeDocument } from "../rendering";
import { SelectionMask, maskHasSelection, combineMasks, alphaAsMask } from "../selection";

function colorsClose(a: RGBA, b: RGBA, tolerance: number): boolean {
  return (
    Math.abs(a[0] - b[0]) <= tolerance &&
    Math.abs(a[1] - b[1]) <= tolerance &&
    Math.abs(a[2] - b[2]) <= tolerance &&
    Math.abs(a[3] - b[3]) <= tolerance
  );
}

function readPixel(pixels: Uint8ClampedArray, width: number, x: number, y: number): RGBA {
  const idx = (y * width + x) * 4;
  return [pixels[idx], pixels[idx + 1], pixels[idx + 2], pixels[idx + 3]];
}

/** `referencePixels`の色でマッチング判定しつつ、実際の塗りは常に`layer`へ書く — 「他レイヤーを
 * 参照」(BucketFillTool.sampleAllLayers)が有効な時はdoc全体の合成結果を参照元として渡す。
 * `wallMask`(選択範囲・透明ピクセルのロックの合成、あれば)の外側は壁として扱い、そこで
 * 途切れて止まる(そこへは一切広がらない/塗らない) — 開始点自体が壁の外にある場合も何もしない。 */
function floodFill(
  layer: RasterLayer,
  referencePixels: Uint8ClampedArray,
  startX: number,
  startY: number,
  fillColor: RGBA,
  tolerance: number,
  wallMask: SelectionMask | null
): void {
  const { width, height } = layer;
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) return;
  const startIdx = startY * width + startX;
  if (wallMask && !wallMask[startIdx]) return;
  const target = readPixel(referencePixels, width, startX, startY);
  if (colorsClose(target, fillColor, 0)) return;

  const visited = new Uint8Array(width * height);
  const stack: [number, number][] = [[startX, startY]];

  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const idx = y * width + x;
    if (visited[idx]) continue;
    if (wallMask && !wallMask[idx]) continue;
    if (!colorsClose(readPixel(referencePixels, width, x, y), target, tolerance)) continue;
    visited[idx] = 1;
    setPixel(layer, x, y, fillColor);
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
}

/** Single-click 4-connected flood fill; continue/end are no-ops. */
export class BucketFillTool implements StrokeTool {
  color: RGBA = [0, 0, 0, 255];
  tolerance = 24;
  /** true: 全レイヤーを合成した見た目で領域判定する(他レイヤーの線もまたがない)。
   * false(既定): 現在のレイヤーの中身だけで判定する。どちらでも塗り自体は現在のレイヤーのみ。 */
  sampleAllLayers = false;

  beginStroke(layer: RasterLayer, x: number, y: number, _pressure: number, doc?: Document): void {
    const reference = this.sampleAllLayers && doc ? composeDocument(doc) : layer.pixels;
    const selMask = doc && maskHasSelection(doc.selectionMask) ? doc.selectionMask : null;
    const alphaMask = layer.alphaLocked ? alphaAsMask(layer.pixels) : null;
    floodFill(layer, reference, Math.floor(x), Math.floor(y), this.color, this.tolerance, combineMasks(selMask, alphaMask));
  }

  continueStroke(_layer: RasterLayer, _x: number, _y: number, _pressure: number): void {
    // single-click tool, nothing to do on drag
  }

  endStroke(): void {
    // no-op
  }
}
