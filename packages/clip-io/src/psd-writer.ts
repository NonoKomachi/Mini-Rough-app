import { Document, LayerNode } from "@mini-rough/core";
import { BlendMode as PsdBlendMode, Layer, Psd, writePsdUint8Array } from "ag-psd";
import { upscaleNearestNeighbor } from "./upscale";

/** CSPのLayerComposite(@mini-rough/coreのBlendMode)→ag-psdのブレンドモード文字列への対応表。
 * グロー(10)・加算(発光)(12)はPSDに同名のモードが無いため、見た目が近い覆い焼き系で近似する。 */
const PSD_BLEND_MODE_BY_COMPOSITE: Record<number, PsdBlendMode> = {
  0: "normal",
  1: "darken",
  2: "multiply",
  3: "color burn",
  4: "linear burn",
  5: "subtract",
  6: "darker color",
  7: "lighten",
  8: "screen",
  9: "color dodge",
  10: "color dodge",
  11: "linear dodge",
  12: "linear dodge",
  13: "lighter color",
  14: "overlay",
  15: "soft light",
  16: "hard light",
  17: "vivid light",
  18: "linear light",
  19: "pin light",
  20: "hard mix",
  21: "difference",
  22: "exclusion",
  23: "hue",
  24: "saturation",
  25: "color",
  26: "luminosity",
  27: "divide"
};

function toPsdBlendMode(composite: number): PsdBlendMode {
  return PSD_BLEND_MODE_BY_COMPOSITE[composite] ?? "normal";
}

export interface PsdExportOptions {
  /** 書き出し先の実ピクセルサイズ。doc.width/height(ミニラフ解像度)と異なる場合だけ
   * 各レイヤーをnearest-neighborでリサンプルする — 完成サイズ(doc.finalWidth/Height)、
   * ミニラフそのまま(doc.width/Height)、カスタムサイズのいずれも同じ仕組みで扱える。 */
  targetWidth: number;
  targetHeight: number;
}

export function exportDocumentToPsd(doc: Document, options: PsdExportOptions): Uint8Array {
  const { targetWidth: width, targetHeight: height } = options;
  const needsResample = width !== doc.width || height !== doc.height;

  const psd: Psd = {
    width,
    height,
    children: buildLayers(doc.layers, doc, width, height, needsResample)
  };
  return writePsdUint8Array(psd, { noBackground: true });
}

/** PSD's `children` is top-to-bottom; our LayerNode[] is bottom-to-top, so iterate in reverse. */
function buildLayers(
  nodes: LayerNode[],
  doc: Document,
  width: number,
  height: number,
  needsResample: boolean
): Layer[] {
  const result: Layer[] = [];
  for (let i = nodes.length - 1; i >= 0; i--) {
    const node = nodes[i];
    if (node.kind === "layer") {
      const pixels = needsResample ? upscaleNearestNeighbor(node.pixels, doc.width, doc.height, width, height) : node.pixels;
      // ag-psd reads a mask's imageData the same way as a layer's own (RGBA, channel 0 = the
      // mask value), so the existing grayscale-replicated-to-RGBA mask buffer works unchanged.
      const maskPixels =
        node.mask && node.maskEnabled
          ? needsResample
            ? upscaleNearestNeighbor(node.mask, doc.width, doc.height, width, height)
            : node.mask
          : undefined;
      result.push({
        name: node.name,
        opacity: node.opacity,
        hidden: !node.visible,
        clipping: node.clipToBelow,
        blendMode: toPsdBlendMode(node.blendMode),
        mask: maskPixels ? { imageData: { width, height, data: maskPixels } } : undefined,
        imageData: { width, height, data: pixels }
      });
    } else {
      result.push({
        name: node.name,
        opacity: node.opacity,
        hidden: !node.visible,
        blendMode: "pass through",
        opened: true,
        children: buildLayers(node.children, doc, width, height, needsResample)
      });
    }
  }
  return result;
}
