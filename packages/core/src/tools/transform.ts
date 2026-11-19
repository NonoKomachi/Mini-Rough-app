import { Document, RasterLayer } from "../document";
import { SelectionMask, maskHasSelection, getMaskBounds } from "../selection";

export interface Point {
  x: number;
  y: number;
}

/** A rectangular region extracted from a layer — the selection's bounding box (with a mask
 * recording which pixels inside that box were actually selected) when there's a selection,
 * otherwise the whole layer (mask = null, meaning "every pixel is part of the region"). Used as
 * the source buffer for every transform (flip/rotate90/scale-rotate/free). */
export interface ExtractedRegion {
  x: number;
  y: number;
  w: number;
  h: number;
  pixels: Uint8ClampedArray;
  mask: Uint8Array | null;
}

/** Extracts the region a transform should act on, WITHOUT touching the source layer — callers
 * clear it themselves via clearRegionFromLayer once they're ready to overwrite it, so a caller
 * that just wants to read (e.g. computing the initial bounding box for a drag session) can do so
 * without side effects. */
export function extractRegion(doc: Document, layer: RasterLayer): ExtractedRegion {
  const sel = maskHasSelection(doc.selectionMask) ? doc.selectionMask : null;
  const bounds = sel ? getMaskBounds(sel, doc.width, doc.height)! : { x: 0, y: 0, w: doc.width, h: doc.height };
  const { x, y, w, h } = bounds;
  const pixels = new Uint8ClampedArray(w * h * 4);
  const mask = sel ? new Uint8Array(w * h) : null;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const srcIdx = (y + row) * doc.width + (x + col);
      if (sel && !sel[srcIdx]) continue;
      const srcPi = srcIdx * 4;
      const dstIdx = row * w + col;
      const dstPi = dstIdx * 4;
      pixels[dstPi] = layer.pixels[srcPi];
      pixels[dstPi + 1] = layer.pixels[srcPi + 1];
      pixels[dstPi + 2] = layer.pixels[srcPi + 2];
      pixels[dstPi + 3] = layer.pixels[srcPi + 3];
      if (mask) mask[dstIdx] = 255;
    }
  }
  return { x, y, w, h, pixels, mask };
}

/** Clears a previously-extracted region from the layer it came from (only the masked pixels when
 * there's a selection, the whole rect otherwise) — call once, right before writing back a
 * transformed version, so the old and new content never overlap. */
export function clearRegionFromLayer(doc: Document, layer: RasterLayer, region: ExtractedRegion): void {
  const { x, y, w, h, mask } = region;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const idx = row * w + col;
      if (mask && !mask[idx]) continue;
      const pi = ((y + row) * doc.width + (x + col)) * 4;
      layer.pixels[pi] = 0;
      layer.pixels[pi + 1] = 0;
      layer.pixels[pi + 2] = 0;
      layer.pixels[pi + 3] = 0;
    }
  }
}

function bilinearChannel(pixels: Uint8ClampedArray, w: number, h: number, channel: number, lx: number, ly: number): number {
  const x0 = Math.floor(lx - 0.5);
  const y0 = Math.floor(ly - 0.5);
  const fx = lx - 0.5 - x0;
  const fy = ly - 0.5 - y0;
  const get = (xx: number, yy: number): number => {
    if (xx < 0 || yy < 0 || xx >= w || yy >= h) return 0;
    return pixels[(yy * w + xx) * 4 + channel];
  };
  const v00 = get(x0, y0);
  const v10 = get(x0 + 1, y0);
  const v01 = get(x0, y0 + 1);
  const v11 = get(x0 + 1, y0 + 1);
  return v00 * (1 - fx) * (1 - fy) + v10 * fx * (1 - fy) + v01 * (1 - fx) * fy + v11 * fx * fy;
}

/** Nearest-neighbor on purpose — the mask is a binary (0/255) membership test, so interpolating
 * it would just require a threshold anyway. */
function sampleMaskNearest(mask: Uint8Array, w: number, h: number, lx: number, ly: number): number {
  const x = Math.floor(lx);
  const y = Math.floor(ly);
  if (x < 0 || y < 0 || x >= w || y >= h) return 0;
  return mask[y * w + x];
}

/** True if local region-space coordinates (lx, ly) are part of the region's content. */
function isInsideRegion(region: ExtractedRegion, lx: number, ly: number): boolean {
  if (region.mask) return sampleMaskNearest(region.mask, region.w, region.h, lx, ly) >= 128;
  return lx >= 0 && ly >= 0 && lx < region.w && ly < region.h;
}

function sampleRegionRGBA(region: ExtractedRegion, lx: number, ly: number): [number, number, number, number] {
  const r = bilinearChannel(region.pixels, region.w, region.h, 0, lx, ly);
  const g = bilinearChannel(region.pixels, region.w, region.h, 1, lx, ly);
  const b = bilinearChannel(region.pixels, region.w, region.h, 2, lx, ly);
  const a = bilinearChannel(region.pixels, region.w, region.h, 3, lx, ly);
  return [r, g, b, a];
}

/** Horizontal mirror of the region's content in place (selection shape mirrors too, so an
 * asymmetric selection's content lands back inside the same footprint it started in). */
export function flipRegionHorizontal(doc: Document, layer: RasterLayer): void {
  const region = extractRegion(doc, layer);
  clearRegionFromLayer(doc, layer, region);
  const { x, y, w, h, mask } = region;
  const newMask = mask ? new Uint8Array(doc.width * doc.height) : null;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const srcIdx = row * w + col;
      if (mask && !mask[srcIdx]) continue;
      const flippedCol = w - 1 - col;
      const dstIdx = (y + row) * doc.width + (x + flippedCol);
      const srcPi = srcIdx * 4;
      const dstPi = dstIdx * 4;
      layer.pixels[dstPi] = region.pixels[srcPi];
      layer.pixels[dstPi + 1] = region.pixels[srcPi + 1];
      layer.pixels[dstPi + 2] = region.pixels[srcPi + 2];
      layer.pixels[dstPi + 3] = region.pixels[srcPi + 3];
      if (newMask) newMask[dstIdx] = 255;
    }
  }
  if (newMask) doc.selectionMask = newMask;
}

/** Vertical mirror — see flipRegionHorizontal. */
export function flipRegionVertical(doc: Document, layer: RasterLayer): void {
  const region = extractRegion(doc, layer);
  clearRegionFromLayer(doc, layer, region);
  const { x, y, w, h, mask } = region;
  const newMask = mask ? new Uint8Array(doc.width * doc.height) : null;
  for (let row = 0; row < h; row++) {
    for (let col = 0; col < w; col++) {
      const srcIdx = row * w + col;
      if (mask && !mask[srcIdx]) continue;
      const flippedRow = h - 1 - row;
      const dstIdx = (y + flippedRow) * doc.width + (x + col);
      const srcPi = srcIdx * 4;
      const dstPi = dstIdx * 4;
      layer.pixels[dstPi] = region.pixels[srcPi];
      layer.pixels[dstPi + 1] = region.pixels[srcPi + 1];
      layer.pixels[dstPi + 2] = region.pixels[srcPi + 2];
      layer.pixels[dstPi + 3] = region.pixels[srcPi + 3];
      if (newMask) newMask[dstIdx] = 255;
    }
  }
  if (newMask) doc.selectionMask = newMask;
}

/** Rotates the region's content 90° around its own center, clipping anything pushed outside the
 * canvas and leaving the vacated space transparent — same convention as MoveTool for an
 * out-of-bounds result. */
export function rotateRegion90(doc: Document, layer: RasterLayer, direction: "left" | "right"): void {
  const region = extractRegion(doc, layer);
  clearRegionFromLayer(doc, layer, region);
  const { x, y, w, h, mask } = region;
  const newW = h;
  const newH = w;
  const cx = x + w / 2;
  const cy = y + h / 2;
  const destX0 = Math.round(cx - newW / 2);
  const destY0 = Math.round(cy - newH / 2);
  const newMask = mask ? new Uint8Array(doc.width * doc.height) : null;
  for (let newRow = 0; newRow < newH; newRow++) {
    for (let newCol = 0; newCol < newW; newCol++) {
      // direction === "right": output(newCol, newRow) ← source(row=newCol, col=newH-1-newRow)
      // direction === "left":  output(newCol, newRow) ← source(row=newW-1-newCol, col=newRow)
      const srcCol = direction === "right" ? newH - 1 - newRow : newRow;
      const srcRow = direction === "right" ? newCol : newW - 1 - newCol;
      const srcIdx = srcRow * w + srcCol;
      if (mask && !mask[srcIdx]) continue;
      const destPixelX = destX0 + newCol;
      const destPixelY = destY0 + newRow;
      if (destPixelX < 0 || destPixelX >= doc.width || destPixelY < 0 || destPixelY >= doc.height) continue;
      const dstIdx = destPixelY * doc.width + destPixelX;
      const srcPi = srcIdx * 4;
      const dstPi = dstIdx * 4;
      layer.pixels[dstPi] = region.pixels[srcPi];
      layer.pixels[dstPi + 1] = region.pixels[srcPi + 1];
      layer.pixels[dstPi + 2] = region.pixels[srcPi + 2];
      layer.pixels[dstPi + 3] = region.pixels[srcPi + 3];
      if (newMask) newMask[dstIdx] = 255;
    }
  }
  if (newMask) doc.selectionMask = newMask;
}

/** Writes a scale+rotate (around `center`, in document coordinates) transform of `region` into
 * `layer` — inverse-mapped per output pixel (bilinear for color, nearest for the mask), so it can
 * be called every frame of a live drag without ever compounding resampling error. Pass the
 * EXTRACTED (not-yet-cleared) layer; callers typically clear once up front via
 * clearRegionFromLayer and then call this repeatedly while the user drags. */
export function writeAffineTransform(
  doc: Document,
  layer: RasterLayer,
  region: ExtractedRegion,
  center: Point,
  scaleX: number,
  scaleY: number,
  rotationRad: number
): void {
  const cos = Math.cos(-rotationRad);
  const sin = Math.sin(-rotationRad);
  const localCenterX = region.w / 2;
  const localCenterY = region.h / 2;
  const safeScaleX = scaleX !== 0 ? scaleX : 0.0001;
  const safeScaleY = scaleY !== 0 ? scaleY : 0.0001;
  const newMask = region.mask ? new Uint8Array(doc.width * doc.height) : null;
  for (let py = 0; py < doc.height; py++) {
    for (let px = 0; px < doc.width; px++) {
      const dx = px + 0.5 - center.x;
      const dy = py + 0.5 - center.y;
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      const lx = rx / safeScaleX + localCenterX;
      const ly = ry / safeScaleY + localCenterY;
      if (!isInsideRegion(region, lx, ly)) continue;
      const [r, g, b, a] = sampleRegionRGBA(region, lx, ly);
      const idx = py * doc.width + px;
      const pi = idx * 4;
      layer.pixels[pi] = r;
      layer.pixels[pi + 1] = g;
      layer.pixels[pi + 2] = b;
      layer.pixels[pi + 3] = a;
      if (newMask) newMask[idx] = 255;
    }
  }
  if (newMask) doc.selectionMask = newMask;
}

interface Affine2D {
  a: number;
  b: number;
  c: number;
  d: number;
  e: number;
  f: number;
}

/** Solves for the affine map (x,y) -> (a*x+b*y+e, c*x+d*y+f) sending src0/1/2 to dst0/1/2
 * (Cramer's rule on the 3x3 system); falls back to identity on a degenerate (collinear) triangle. */
function affineFromTriangle(src0: Point, src1: Point, src2: Point, dst0: Point, dst1: Point, dst2: Point): Affine2D {
  const { x: x0, y: y0 } = src0;
  const { x: x1, y: y1 } = src1;
  const { x: x2, y: y2 } = src2;
  const det = x0 * (y1 - y2) - y0 * (x1 - x2) + (x1 * y2 - x2 * y1);
  if (Math.abs(det) < 1e-10) return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
  const u0 = dst0.x;
  const u1 = dst1.x;
  const u2 = dst2.x;
  const v0 = dst0.y;
  const v1 = dst1.y;
  const v2 = dst2.y;
  const a = (u0 * (y1 - y2) - y0 * (u1 - u2) + (u1 * y2 - u2 * y1)) / det;
  const b = (x0 * (u1 - u2) - u0 * (x1 - x2) + (x1 * u2 - x2 * u1)) / det;
  const e = (x0 * (y1 * u2 - y2 * u1) - y0 * (x1 * u2 - x2 * u1) + u0 * (x1 * y2 - x2 * y1)) / det;
  const c = (v0 * (y1 - y2) - y0 * (v1 - v2) + (v1 * y2 - v2 * y1)) / det;
  const d = (x0 * (v1 - v2) - v0 * (x1 - x2) + (x1 * v2 - x2 * v1)) / det;
  const f = (x0 * (y1 * v2 - y2 * v1) - y0 * (x1 * v2 - x2 * v1) + v0 * (x1 * y2 - x2 * y1)) / det;
  return { a, b, c, d, e, f };
}

function applyAffine(m: Affine2D, p: Point): Point {
  return { x: m.a * p.x + m.b * p.y + m.e, y: m.c * p.x + m.d * p.y + m.f };
}

function triangleSign(p1: Point, p2: Point, p3: Point): number {
  return (p1.x - p3.x) * (p2.y - p3.y) - (p2.x - p3.x) * (p1.y - p3.y);
}

function pointInTriangle(pt: Point, v1: Point, v2: Point, v3: Point): boolean {
  const d1 = triangleSign(pt, v1, v2);
  const d2 = triangleSign(pt, v2, v3);
  const d3 = triangleSign(pt, v3, v1);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

/** Free transform: `corners` are the region's four corners (top-left, top-right, bottom-right,
 * bottom-left, matching region-space (0,0)/(w,0)/(w,h)/(0,h)) dragged to arbitrary document-space
 * positions. Implemented as two source-space triangles, each an independent affine map (the
 * standard CLIP-STUDIO-style "bilinear via triangle pair" approach) — exact on the shared
 * diagonal, so there's no seam between the two triangles. */
export function writeFreeTransform(doc: Document, layer: RasterLayer, region: ExtractedRegion, corners: [Point, Point, Point, Point]): void {
  const [tl, tr, br, bl] = corners;
  const regionTL: Point = { x: 0, y: 0 };
  const regionTR: Point = { x: region.w, y: 0 };
  const regionBR: Point = { x: region.w, y: region.h };
  const regionBL: Point = { x: 0, y: region.h };
  // Inverse maps: document-space triangle -> region-space triangle.
  const invT1 = affineFromTriangle(tl, tr, bl, regionTL, regionTR, regionBL);
  const invT2 = affineFromTriangle(tr, br, bl, regionTR, regionBR, regionBL);

  const xs = corners.map((c) => c.x);
  const ys = corners.map((c) => c.y);
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(doc.width, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(doc.height, Math.ceil(Math.max(...ys)));

  const newMask = region.mask ? new Uint8Array(doc.width * doc.height) : null;
  for (let py = minY; py < maxY; py++) {
    for (let px = minX; px < maxX; px++) {
      const p: Point = { x: px + 0.5, y: py + 0.5 };
      let local: Point;
      if (pointInTriangle(p, tl, tr, bl)) {
        local = applyAffine(invT1, p);
      } else if (pointInTriangle(p, tr, br, bl)) {
        local = applyAffine(invT2, p);
      } else {
        continue;
      }
      if (!isInsideRegion(region, local.x, local.y)) continue;
      const [r, g, b, a] = sampleRegionRGBA(region, local.x, local.y);
      const idx = py * doc.width + px;
      const pi = idx * 4;
      layer.pixels[pi] = r;
      layer.pixels[pi + 1] = g;
      layer.pixels[pi + 2] = b;
      layer.pixels[pi + 3] = a;
      if (newMask) newMask[idx] = 255;
    }
  }
  if (newMask) doc.selectionMask = newMask;
}

export type { SelectionMask };
