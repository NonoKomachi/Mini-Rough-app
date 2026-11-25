import { RasterLayer } from "../document";
import { RGBA } from "./tool";
import { SelectionMask } from "../selection";

/**
 * Per-stroke alpha coverage mask (0..1), max-combined across dabs. Keeping this separate
 * from the layer lets a whole stroke be recomposited from scratch on every pointer move,
 * which avoids dark seams where soft dabs overlap each other within the same stroke.
 */
export class StrokeCoverage {
  readonly width: number;
  readonly height: number;
  readonly data: Float32Array;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Float32Array(width * height);
  }

  /** Soft circular falloff, `intensity` scales the dab's peak alpha (used for pressure-driven opacity). */
  stampSoftCircle(cx: number, cy: number, radius: number, intensity = 1): void {
    if (radius <= 0 || intensity <= 0) return;
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(this.width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(this.height - 1, Math.ceil(cy + radius));
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > radius) continue;
        const t = dist / radius;
        const alpha = Math.max(0, 1 - t * t) * intensity;
        const idx = y * this.width + x;
        if (alpha > this.data[idx]) this.data[idx] = alpha;
      }
    }
  }

  /** Hard circular edge (falloffなし、円の内側は常に`intensity`) — 消しゴムのように
   * 「縁がぼやけず、ここまでは消える/消えない」をくっきり分けたい用途向け。 */
  stampHardCircle(cx: number, cy: number, radius: number, intensity = 1): void {
    if (radius <= 0 || intensity <= 0) return;
    const minX = Math.max(0, Math.floor(cx - radius));
    const maxX = Math.min(this.width - 1, Math.ceil(cx + radius));
    const minY = Math.max(0, Math.floor(cy - radius));
    const maxY = Math.min(this.height - 1, Math.ceil(cy + radius));
    const r2 = radius * radius;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy > r2) continue;
        const idx = y * this.width + x;
        if (intensity > this.data[idx]) this.data[idx] = intensity;
      }
    }
  }
}

/** Recomposites `color` over `preStrokePixels` using `coverage` as the per-pixel alpha, writing
 * into layer.pixels. `mask`(選択範囲、あれば)の外は常にcoverageを0扱いし、preStrokePixelsの
 * ままにする — 全ピクセルを毎回復元→再描画し直す都合上(stampの都度ではなくここ1箇所で)選択
 * 範囲の外側をクリップするのが最も簡単で確実。 */
export function applyColorStroke(
  layer: RasterLayer,
  preStrokePixels: Uint8ClampedArray,
  coverage: Float32Array,
  color: RGBA,
  opacityScale: number,
  mask?: SelectionMask | null
): void {
  const colorA = color[3] / 255;
  for (let i = 0; i < coverage.length; i++) {
    const p = i * 4;
    const covered = mask && !mask[i] ? 0 : coverage[i];
    const srcA = Math.min(1, covered * opacityScale) * colorA;
    if (srcA <= 0) {
      layer.pixels[p] = preStrokePixels[p];
      layer.pixels[p + 1] = preStrokePixels[p + 1];
      layer.pixels[p + 2] = preStrokePixels[p + 2];
      layer.pixels[p + 3] = preStrokePixels[p + 3];
      continue;
    }
    const dstA = preStrokePixels[p + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) {
      layer.pixels[p] = 0;
      layer.pixels[p + 1] = 0;
      layer.pixels[p + 2] = 0;
      layer.pixels[p + 3] = 0;
      continue;
    }
    for (let c = 0; c < 3; c++) {
      layer.pixels[p + c] = (color[c] * srcA + preStrokePixels[p + c] * dstA * (1 - srcA)) / outA;
    }
    layer.pixels[p + 3] = outA * 255;
  }
}

/** Reduces alpha of `preStrokePixels` by `coverage`, writing into layer.pixels. RGB is left
 * untouched. `mask`の外は常にcoverageを0扱いし(消えない)、applyColorStrokeと同じ理由。 */
export function applyEraseStroke(
  layer: RasterLayer,
  preStrokePixels: Uint8ClampedArray,
  coverage: Float32Array,
  opacityScale: number,
  mask?: SelectionMask | null
): void {
  for (let i = 0; i < coverage.length; i++) {
    const p = i * 4;
    const covered = mask && !mask[i] ? 0 : coverage[i];
    const erase = Math.min(1, covered * opacityScale);
    const preA = preStrokePixels[p + 3] / 255;
    layer.pixels[p] = preStrokePixels[p];
    layer.pixels[p + 1] = preStrokePixels[p + 1];
    layer.pixels[p + 2] = preStrokePixels[p + 2];
    layer.pixels[p + 3] = preA * (1 - erase) * 255;
  }
}
