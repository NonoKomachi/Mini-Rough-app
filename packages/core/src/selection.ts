import { RasterLayer } from "./document";
import { RGBA } from "./tools/tool";

/** width*height, 0 = unselected, 255 = selected. */
export type SelectionMask = Uint8Array;

export function createEmptyMask(width: number, height: number): SelectionMask {
  return new Uint8Array(width * height);
}

/** True if any pixel is selected (an all-zero mask is treated the same as "no selection"). */
export function maskHasSelection(mask: SelectionMask | null): boolean {
  if (!mask) return false;
  return mask.some((v) => v !== 0);
}

/** 選択範囲ツール(矩形/楕円/投げ縄/自動選択)と「レイヤーから選択範囲」が共通で使う、
 * CLIP STUDIOの「新規選択範囲」「選択範囲に追加」「選択範囲から削除」「選択範囲との共通範囲」
 * と同じ4種の合成モード。 */
export type SelectionCombineMode = "new" | "add" | "subtract" | "intersect";

/** `baseline`(操作開始前の選択範囲、無ければ「全く選ばれていない」扱い)と`fresh`(今回
 * ドラッグ/生成した図形・範囲)を`mode`に従って合成する。`mode`が"new"の時は`baseline`を
 * 無視して`fresh`をそのまま返す(常に新しい配列を割り当てずに済ませるため)。 */
export function combineSelectionMasks(baseline: SelectionMask | null, fresh: SelectionMask, mode: SelectionCombineMode): SelectionMask {
  if (mode === "new") return fresh;
  if (!baseline) {
    // 追加 = 何もない状態への追加 = freshそのまま。削除/共通 = 何もない状態からは何も残らない。
    return mode === "add" ? fresh : new Uint8Array(fresh.length);
  }
  const result = new Uint8Array(fresh.length);
  for (let i = 0; i < fresh.length; i++) {
    const b = baseline[i] !== 0;
    const f = fresh[i] !== 0;
    const selected = mode === "add" ? b || f : mode === "subtract" ? b && !f : b && f;
    result[i] = selected ? 255 : 0;
  }
  return result;
}

/** `a`と`b`の論理積。どちらかがnullならもう片方をそのまま返す(新規配列を作らない) —
 * 選択範囲と「透明ピクセルのロック」を同時に満たす必要があるツールが、既存のsetPixel/
 * applyColorStroke等の単一mask引数へそのまま渡せる1つのmaskにまとめるために使う。 */
export function combineMasks(a: SelectionMask | null, b: SelectionMask | null): SelectionMask | null {
  if (!a) return b;
  if (!b) return a;
  const combined = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) combined[i] = a[i] && b[i] ? 255 : 0;
  return combined;
}

/** レイヤーの現在のアルファ(不透明/透明)をSelectionMask形式に変換する — 「透明ピクセルを
 * ロック」(RasterLayer.alphaLocked)有効時、描画/塗りつぶしを「既に不透明な場所」だけに
 * 制限するためのmaskとして使う。 */
export function alphaAsMask(pixels: Uint8ClampedArray): SelectionMask {
  const count = pixels.length / 4;
  const mask = new Uint8Array(count);
  for (let i = 0; i < count; i++) mask[i] = pixels[i * 4 + 3] > 0 ? 255 : 0;
  return mask;
}

/** Smallest rectangle (half-open: [x, x+w), [y, y+h)) containing every selected pixel, or null
 * if the mask has no selection at all. Used by copy/cut to know how much to extract. */
export function getMaskBounds(mask: SelectionMask, width: number, height: number): { x: number; y: number; w: number; h: number } | null {
  let minX = width;
  let minY = height;
  let maxX = -1;
  let maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (mask[y * width + x] === 0) continue;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
  }
  if (maxX < minX || maxY < minY) return null;
  return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
}

export function setRectMask(mask: SelectionMask, width: number, height: number, x0: number, y0: number, x1: number, y1: number): void {
  const left = Math.max(0, Math.floor(Math.min(x0, x1)));
  const right = Math.min(width, Math.ceil(Math.max(x0, x1)));
  const top = Math.max(0, Math.floor(Math.min(y0, y1)));
  const bottom = Math.min(height, Math.ceil(Math.max(y0, y1)));
  for (let y = top; y < bottom; y++) {
    for (let x = left; x < right; x++) {
      mask[y * width + x] = 255;
    }
  }
}

export function setEllipseMask(mask: SelectionMask, width: number, height: number, x0: number, y0: number, x1: number, y1: number): void {
  const cx = (x0 + x1) / 2;
  const cy = (y0 + y1) / 2;
  const rx = Math.abs(x1 - x0) / 2;
  const ry = Math.abs(y1 - y0) / 2;
  if (rx <= 0 || ry <= 0) return;
  const top = Math.max(0, Math.floor(cy - ry));
  const bottom = Math.min(height, Math.ceil(cy + ry));
  const left = Math.max(0, Math.floor(cx - rx));
  const right = Math.min(width, Math.ceil(cx + rx));
  for (let y = top; y < bottom; y++) {
    const ny = (y + 0.5 - cy) / ry;
    for (let x = left; x < right; x++) {
      const nx = (x + 0.5 - cx) / rx;
      if (nx * nx + ny * ny <= 1) mask[y * width + x] = 255;
    }
  }
}

/** Scanline polygon fill; `points` is treated as a closed loop (last point connects back to the first). */
export function setPolygonMask(mask: SelectionMask, width: number, height: number, points: { x: number; y: number }[]): void {
  if (points.length < 3) return;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const top = Math.max(0, Math.floor(minY));
  const bottom = Math.min(height, Math.ceil(maxY));
  for (let y = top; y < bottom; y++) {
    const yc = y + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a.y <= yc && b.y > yc) || (b.y <= yc && a.y > yc)) {
        const t = (yc - a.y) / (b.y - a.y);
        xs.push(a.x + t * (b.x - a.x));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const left = Math.max(0, Math.round(xs[i]));
      const right = Math.min(width, Math.round(xs[i + 1]));
      for (let x = left; x < right; x++) mask[y * width + x] = 255;
    }
  }
}

/** "自動選択": 4-connected flood fill of pixels close in color/alpha to the clicked pixel — used to
 * grab the blank area enclosed by line art, same traversal as BucketFillTool. `pixels` is normally
 * the active layer's own buffer, but AutoSelectTool.sampleAllLayers passes the doc's composited
 * result instead so the detected region can take other (visible) layers' line art into account. */
export function floodFillSelectMask(width: number, height: number, pixels: Uint8ClampedArray, startX: number, startY: number, tolerance: number): SelectionMask {
  const mask = createEmptyMask(width, height);
  if (startX < 0 || startY < 0 || startX >= width || startY >= height) return mask;
  const i0 = (startY * width + startX) * 4;
  const target: RGBA = [pixels[i0], pixels[i0 + 1], pixels[i0 + 2], pixels[i0 + 3]];
  const visited = new Uint8Array(width * height);
  const stack: [number, number][] = [[startX, startY]];
  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    if (x < 0 || y < 0 || x >= width || y >= height) continue;
    const idx = y * width + x;
    if (visited[idx]) continue;
    const pi = idx * 4;
    const close =
      Math.abs(pixels[pi] - target[0]) <= tolerance &&
      Math.abs(pixels[pi + 1] - target[1]) <= tolerance &&
      Math.abs(pixels[pi + 2] - target[2]) <= tolerance &&
      Math.abs(pixels[pi + 3] - target[3]) <= tolerance;
    if (!close) continue;
    visited[idx] = 1;
    mask[idx] = 255;
    stack.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
  }
  return mask;
}

/** Fills `layer` with a solid color, constrained to `mask` when one is given (otherwise the whole layer). */
export function fillWithColor(layer: RasterLayer, mask: SelectionMask | null, color: RGBA): void {
  const { width, height, pixels } = layer;
  const count = width * height;
  for (let i = 0; i < count; i++) {
    if (mask && !mask[i]) continue;
    const pi = i * 4;
    pixels[pi] = color[0];
    pixels[pi + 1] = color[1];
    pixels[pi + 2] = color[2];
    pixels[pi + 3] = color[3];
  }
}

/** Linear gradient from `colorA` at (x0,y0) to `colorB` at (x1,y1), clamped beyond the segment's
 * ends (CLIP STUDIO-style), constrained to `mask` when one is given. Replaces pixel values
 * directly rather than alpha-blending, so a transparent endpoint truly clears the layer there. */
export function applyLinearGradient(
  layer: RasterLayer,
  mask: SelectionMask | null,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  colorA: RGBA,
  colorB: RGBA
): void {
  const { width, height, pixels } = layer;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const lenSq = dx * dx + dy * dy;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = y * width + x;
      if (mask && !mask[i]) continue;
      let t = lenSq > 0 ? ((x + 0.5 - x0) * dx + (y + 0.5 - y0) * dy) / lenSq : 0;
      t = Math.max(0, Math.min(1, t));
      const pi = i * 4;
      pixels[pi] = colorA[0] + (colorB[0] - colorA[0]) * t;
      pixels[pi + 1] = colorA[1] + (colorB[1] - colorA[1]) * t;
      pixels[pi + 2] = colorA[2] + (colorB[2] - colorA[2]) * t;
      pixels[pi + 3] = colorA[3] + (colorB[3] - colorA[3]) * t;
    }
  }
}
