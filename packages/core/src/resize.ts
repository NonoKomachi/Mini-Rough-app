import { Document, LayerFolder, LayerNode, RasterLayer } from "./document";

function resampleNearestNeighbor(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): Uint8ClampedArray {
  const dst = new Uint8ClampedArray(dstW * dstH * 4);
  for (let y = 0; y < dstH; y++) {
    const sy = Math.min(srcH - 1, Math.floor((y * srcH) / dstH));
    for (let x = 0; x < dstW; x++) {
      const sx = Math.min(srcW - 1, Math.floor((x * srcW) / dstW));
      const sIdx = (sy * srcW + sx) * 4;
      const dIdx = (y * dstW + x) * 4;
      dst[dIdx] = src[sIdx];
      dst[dIdx + 1] = src[sIdx + 1];
      dst[dIdx + 2] = src[sIdx + 2];
      dst[dIdx + 3] = src[sIdx + 3];
    }
  }
  return dst;
}

function cloneNodeResized(node: LayerNode, srcW: number, srcH: number, dstW: number, dstH: number): LayerNode {
  if (node.kind === "layer") {
    const clone = new RasterLayer(node.name, dstW, dstH, node.id);
    clone.visible = node.visible;
    clone.opacity = node.opacity;
    clone.blendMode = node.blendMode;
    clone.maskEnabled = node.maskEnabled;
    clone.clipToBelow = node.clipToBelow;
    clone.pixels.set(resampleNearestNeighbor(node.pixels, srcW, srcH, dstW, dstH));
    if (node.mask) clone.mask = resampleNearestNeighbor(node.mask, srcW, srcH, dstW, dstH);
    return clone;
  }
  const clone = new LayerFolder(node.name, node.id);
  clone.visible = node.visible;
  clone.opacity = node.opacity;
  clone.children = node.children.map((child) => cloneNodeResized(child, srcW, srcH, dstW, dstH));
  return clone;
}

/**
 * Builds a new Document at a different mini (working) resolution, resampling every layer's
 * pixels via nearest-neighbor. Final size and dpi are carried over unchanged. Width/height are
 * read-only on Document (many call sites assume a stable size), so resizing always produces a
 * new instance rather than mutating in place.
 */
export function resizeDocumentMini(doc: Document, newWidth: number, newHeight: number): Document {
  const resized = new Document(newWidth, newHeight, doc.finalWidth, doc.finalHeight, doc.dpi);
  resized.layers = doc.layers.map((node) => cloneNodeResized(node, doc.width, doc.height, newWidth, newHeight));
  resized.activeLayerId = doc.activeLayerId;
  return resized;
}

function reconcileNode(
  node: LayerNode,
  target: Document | null,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number
): LayerNode {
  if (node.kind === "folder") {
    const folder = new LayerFolder(node.name, node.id);
    folder.visible = node.visible;
    folder.opacity = node.opacity;
    folder.children = node.children.map((child) => reconcileNode(child, target, srcW, srcH, dstW, dstH));
    return folder;
  }
  const existing = target?.findNode(node.id);
  if (existing && existing.kind === "layer" && existing.width === dstW && existing.height === dstH) {
    // 既にこのidのレイヤーがtarget解像度に存在する — そのpixels/maskは「その解像度で最後に
    // 表示されていた間に描かれた内容」をそのまま保持しているので、再サンプルで潰さず再利用する。
    // 属性(可視/不透明度/マスク有効/クリッピング)だけはsource側の最新値に合わせて同期する。
    existing.name = node.name;
    existing.visible = node.visible;
    existing.opacity = node.opacity;
    existing.blendMode = node.blendMode;
    existing.maskEnabled = node.maskEnabled;
    existing.clipToBelow = node.clipToBelow;
    if (!node.mask) {
      existing.mask = null;
    } else if (!existing.mask) {
      existing.mask = resampleNearestNeighbor(node.mask, srcW, srcH, dstW, dstH);
    }
    return existing;
  }
  // target側に存在しない(このモードに切り替わってから新しく追加されたレイヤー/フォルダー) —
  // 他に元にできる解像度のデータが無いので、今の解像度からリサンプルするしかない。
  return cloneNodeResized(node, srcW, srcH, dstW, dstH);
}

/**
 * Rebuilds a Document at `targetWidth`×`targetHeight` to match `source`'s current layer tree
 * (structure, order, names, visibility, opacity, mask on/off, clipping) while preserving
 * `target`'s own pixel data for any layer/folder whose id already exists in `target`. Only
 * layers that are new since `target` was last synced get their pixels resampled from `source`.
 *
 * This is what lets detail painted while displaying at one resolution (e.g. 完成サイズ) survive
 * toggling back to the other resolution (ミニラフ) and then back again — previously, switching
 * modes always resampled fresh from whichever resolution was currently active, so anything drawn
 * at the resolution being left behind was discarded and the next visit to it was re-derived
 * (blurrily, via nearest-neighbor upscale) from the other, lower-detail resolution.
 */
export function reconcileDocumentResolution(
  source: Document,
  target: Document | null,
  targetWidth: number,
  targetHeight: number
): Document {
  const result = new Document(targetWidth, targetHeight, source.finalWidth, source.finalHeight, source.dpi);
  result.layers = source.layers.map((node) =>
    reconcileNode(node, target, source.width, source.height, targetWidth, targetHeight)
  );
  result.activeLayerId = source.activeLayerId && result.findLayer(source.activeLayerId) ? source.activeLayerId : null;
  return result;
}
