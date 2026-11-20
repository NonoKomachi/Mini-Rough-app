import { Document } from "@mini-rough/core";
import { exportDocumentToClip, exportDocumentToPsd, exportDocumentToFlatImage, fileExtensionFor } from "@mini-rough/clip-io";
import { SaveFormat, SaveSize } from "./save-dialog";

/** SaveSize(ミニラフ/完成/カスタム)を、ドキュメントを基準にした実ピクセルサイズへ解決する。
 * clip-io側は「ミニラフ/完成/カスタム」という区別自体を知らず、常に明示的な
 * targetWidth/targetHeightだけを受け取る(doc.width/heightと異なる時だけリサンプルする)。 */
export function resolveExportSize(doc: Document, size: SaveSize): { width: number; height: number } {
  if (size.mode === "final") return { width: doc.finalWidth, height: doc.finalHeight };
  if (size.mode === "custom") return { width: Math.max(1, Math.round(size.width)), height: Math.max(1, Math.round(size.height)) };
  return { width: doc.width, height: doc.height };
}

export async function exportDocumentAs(doc: Document, format: SaveFormat, size: SaveSize): Promise<Uint8Array> {
  const { width: targetWidth, height: targetHeight } = resolveExportSize(doc, size);
  switch (format) {
    case "clip":
      return exportDocumentToClip(doc, { targetWidth, targetHeight });
    case "psd":
      return exportDocumentToPsd(doc, { targetWidth, targetHeight });
    default:
      return exportDocumentToFlatImage(doc, { format, targetWidth, targetHeight });
  }
}

export function extensionFor(format: SaveFormat): string {
  if (format === "clip") return "clip";
  if (format === "psd") return "psd";
  return fileExtensionFor(format);
}
