import { Document } from "@mini-rough/core";
import { exportDocumentToClip, exportDocumentToPsd, exportDocumentToFlatImage, fileExtensionFor } from "@mini-rough/clip-io";
import { SaveFormat, SaveSize } from "./save-dialog";

export async function exportDocumentAs(doc: Document, format: SaveFormat, size: SaveSize): Promise<Uint8Array> {
  switch (format) {
    case "clip":
      return exportDocumentToClip(doc, { size });
    case "psd":
      return exportDocumentToPsd(doc, { size });
    default:
      return exportDocumentToFlatImage(doc, { format, size });
  }
}

export function extensionFor(format: SaveFormat): string {
  if (format === "clip") return "clip";
  if (format === "psd") return "psd";
  return fileExtensionFor(format);
}
