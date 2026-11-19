import { Document, RasterLayer } from "@mini-rough/core";
import { readPsd } from "ag-psd";
import { ImportedDocument } from "./import-document";

/** .clip以外で読み込みに対応する、レイヤー構造を持たない静止画形式。PSDはレイヤーを持つが、
 * ここでは合成済みの1枚絵として取り込む(ユーザーの要望通り「静止画のみ対応」)。 */
export type FlatImportFormat = "png" | "jpeg" | "bmp" | "gif" | "psd";

/** ファイル名の拡張子から読み込み方法を判定する。.clipは別経路(importDocumentFromClip)。 */
export function detectImportFormat(fileName: string): FlatImportFormat | "clip" | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "clip":
      return "clip";
    case "png":
      return "png";
    case "jpg":
    case "jpeg":
      return "jpeg";
    case "bmp":
      return "bmp";
    case "gif":
      return "gif";
    case "psd":
      return "psd";
    default:
      return null;
  }
}

const MIME_BY_FORMAT: Record<"png" | "jpeg" | "bmp" | "gif", string> = {
  png: "image/png",
  jpeg: "image/jpeg",
  bmp: "image/bmp",
  gif: "image/gif"
};

async function decodeViaBrowser(bytes: Uint8Array, mimeType: string): Promise<{ width: number; height: number; pixels: Uint8ClampedArray }> {
  // TS 5.7+'s BlobPart wants Uint8Array<ArrayBuffer>; our buffers are always plain ArrayBuffers
  // at runtime, so this narrows a type-only mismatch, not a real one (same pattern as project-file.ts).
  const blob = new Blob([bytes as Uint8Array<ArrayBuffer>], { type: mimeType });
  const bitmap = await createImageBitmap(blob);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = bitmap.width;
    canvas.height = bitmap.height;
    const ctx = canvas.getContext("2d")!;
    ctx.drawImage(bitmap, 0, 0);
    const imageData = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
    return { width: bitmap.width, height: bitmap.height, pixels: imageData.data };
  } finally {
    bitmap.close();
  }
}

/** PSDはレイヤー構造を無視し、ag-psd自身が合成した1枚絵(psd.canvas)をそのまま取り込む —
 * ブレンドモードや不透明度はag-psdの合成結果にすでに反映されている。 */
function decodePsd(bytes: Uint8Array): { width: number; height: number; pixels: Uint8ClampedArray } {
  const psd = readPsd(bytes.buffer as ArrayBuffer);
  if (!psd.canvas) throw new Error("PSDファイルに合成済み画像が含まれていませんでした");
  const ctx = psd.canvas.getContext("2d")!;
  const imageData = ctx.getImageData(0, 0, psd.width, psd.height);
  return { width: psd.width, height: psd.height, pixels: imageData.data };
}

/**
 * .png/.jpg/.bmp/.gif/.psdを、1枚のラスターレイヤーだけを持つDocumentとして読み込む。
 * ImportedDocumentの形(doc=ミニラフ解像度、finalDoc=画像そのままの解像度)をimportDocumentFromClip
 * と揃えているので、新規読み込み時のサイズ指定ダイアログや追加読み込みの縦横比チェックなど、
 * 既存の読み込みパイプラインにそのまま乗せられる。
 */
export async function importFlatImage(bytes: Uint8Array, format: FlatImportFormat): Promise<ImportedDocument> {
  const { width, height, pixels } = format === "psd" ? decodePsd(bytes) : await decodeViaBrowser(bytes, MIME_BY_FORMAT[format]);

  const finalDoc = new Document(width, height, width, height, 350);
  const finalLayer = new RasterLayer("レイヤー1", width, height);
  finalLayer.pixels.set(pixels);
  finalDoc.layers = [finalLayer];
  finalDoc.activeLayerId = finalLayer.id;

  // ファイル自体にはミニラフ解像度の情報がないので、ひとまず等倍をミニラフとして使う —
  // 「新規に読み込み」側のサイズ指定ダイアログでユーザーが好きな作業解像度に変更できる。
  const doc = new Document(width, height, width, height, 350);
  const miniLayer = new RasterLayer("レイヤー1", width, height, finalLayer.id);
  miniLayer.pixels.set(pixels);
  doc.layers = [miniLayer];
  doc.activeLayerId = miniLayer.id;

  return { doc, finalDoc };
}
