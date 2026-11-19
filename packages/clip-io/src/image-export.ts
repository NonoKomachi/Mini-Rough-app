import { Document, composeDocument } from "@mini-rough/core";
import { upscaleNearestNeighbor } from "./upscale";
import { encodeBmp } from "./bmp-encoder";
import { encodeGif } from "./gif-encoder";

export type FlatImageFormat = "png" | "jpeg" | "bmp" | "gif";

export interface FlatImageExportOptions {
  format: FlatImageFormat;
  /** "final" upscales to doc.finalWidth/Height (the default); "mini" keeps the working resolution. */
  size: "final" | "mini";
  /** 0..1, only used for "jpeg". */
  jpegQuality?: number;
  /** Composited onto this before flattening to formats with no alpha channel (jpeg, bmp). White by default. */
  background?: [number, number, number];
}

/** Flattens the document (composeDocument) and encodes it as a single-image file. */
export async function exportDocumentToFlatImage(doc: Document, options: FlatImageExportOptions): Promise<Uint8Array> {
  const width = options.size === "final" ? doc.finalWidth : doc.width;
  const height = options.size === "final" ? doc.finalHeight : doc.height;
  const background = options.background ?? [255, 255, 255];

  const composited = composeDocument(doc);
  const pixels = options.size === "final" ? upscaleNearestNeighbor(composited, doc.width, doc.height, width, height) : composited;

  if (options.format === "bmp") return encodeBmp(pixels, width, height, background);
  if (options.format === "gif") return encodeGif(pixels, width, height);

  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d")!;
  if (options.format === "jpeg") {
    ctx.fillStyle = `rgb(${background[0]},${background[1]},${background[2]})`;
    ctx.fillRect(0, 0, width, height);
  }
  const srcCanvas = new OffscreenCanvas(width, height);
  const srcCtx = srcCanvas.getContext("2d")!;
  srcCtx.putImageData(new ImageData(new Uint8ClampedArray(pixels), width, height), 0, 0);
  ctx.drawImage(srcCanvas, 0, 0);

  const mimeType = options.format === "jpeg" ? "image/jpeg" : "image/png";
  const blob = await canvas.convertToBlob({ type: mimeType, quality: options.jpegQuality ?? 0.92 });
  return new Uint8Array(await blob.arrayBuffer());
}

export function fileExtensionFor(format: FlatImageFormat): string {
  return format === "jpeg" ? "jpg" : format;
}
