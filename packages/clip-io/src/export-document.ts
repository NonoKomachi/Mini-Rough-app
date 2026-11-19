import { Document, LayerNode } from "@mini-rough/core";
import { writeClipFile, MiniLayerExport } from "./clip-writer";
import { upscaleNearestNeighbor } from "./upscale";
import { wrapperFolderName } from "./wrapper-folder";

export interface ClipExportOptions {
  /** "final" upscales every layer to doc.finalWidth/Height (the default); "mini" keeps the working resolution as-is. */
  size: "final" | "mini";
}

/**
 * Exports the document as a brand-new .clip canvas, with every visible layer grouped under one
 * "ミニラフ (WxH)" folder so it drops cleanly into an existing CLIP STUDIO project. Hidden
 * layers/folders are skipped. The folder name encodes the mini resolution so re-opening this
 * file (M7) can resume at the original tiny canvas size instead of the upscaled one.
 */
export async function exportDocumentToClip(doc: Document, options: ClipExportOptions = { size: "final" }): Promise<Uint8Array> {
  const targetWidth = options.size === "final" ? doc.finalWidth : doc.width;
  const targetHeight = options.size === "final" ? doc.finalHeight : doc.height;

  const flat: MiniLayerExport[] = [];
  flattenInto(doc.layers, 1, flat, doc, targetWidth, targetHeight, options.size);
  flat.push({ name: wrapperFolderName(doc.width, doc.height), kind: "folder", depth: 0, opacity: 1 });

  return writeClipFile({
    width: targetWidth,
    height: targetHeight,
    dpi: doc.dpi,
    layers: flat
  });
}

/** Extracts a single-channel (red) luma buffer from an RGBA mask buffer — mask painting is
 * always grayscale (R=G=B), so the red channel alone carries the mask value. */
function toSingleChannel(rgba: Uint8Array | Uint8ClampedArray): Uint8Array {
  const out = new Uint8Array(rgba.length / 4);
  for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4];
  return out;
}

function flattenInto(
  nodes: LayerNode[],
  depth: number,
  out: MiniLayerExport[],
  doc: Document,
  targetWidth: number,
  targetHeight: number,
  size: "final" | "mini"
): void {
  for (const node of nodes) {
    if (!node.visible) continue;
    if (node.kind === "layer") {
      const pixels =
        size === "final" ? upscaleNearestNeighbor(node.pixels, doc.width, doc.height, targetWidth, targetHeight) : node.pixels;
      let mask: Uint8Array | undefined;
      if (node.mask && node.maskEnabled) {
        const maskRgba =
          size === "final" ? upscaleNearestNeighbor(node.mask, doc.width, doc.height, targetWidth, targetHeight) : node.mask;
        mask = toSingleChannel(maskRgba);
      }
      out.push({
        name: node.name,
        kind: "raster",
        depth,
        opacity: node.opacity,
        pixels,
        clip: node.clipToBelow,
        mask,
        composite: node.blendMode
      });
    } else {
      flattenInto(node.children, depth + 1, out, doc, targetWidth, targetHeight, size);
      out.push({ name: node.name, kind: "folder", depth, opacity: node.opacity });
    }
  }
}
