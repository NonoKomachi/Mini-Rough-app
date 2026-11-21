import { Document, LayerNode, RasterLayer } from "./document";
import { BLEND_NORMAL, BlendMode, blendPixel } from "./blend-modes";

const blendScratch: [number, number, number] = [0, 0, 0];

/** "src over dst" compositing, src alpha scaled by `opacity`, with `blendMode`(CSPの合成モード
 * コード)を使って色を混ぜる。式はW3C Compositing仕様の
 * `Co = αs×((1−αb)×Cs + αb×B(Cb,Cs)) + (1−αs)×αb×Cb` を正規化した形(通常合成のときはB(Cb,Cs)=Cs
 * になるので既存の単純な over合成と完全に一致する)。Mutates dst in place. */
function compositeOver(dst: Uint8ClampedArray, src: Uint8ClampedArray, opacity: number, blendMode: BlendMode = BLEND_NORMAL): void {
  if (opacity <= 0) return;
  const useBlend = blendMode !== BLEND_NORMAL;
  for (let i = 0; i < dst.length; i += 4) {
    // 完全透明ピクセルの判定を(255で割って×opacityした後の)srcAではなく生のバイト値で先に
    // 行う — ラフ画像の各レイヤーは大部分(実測で8〜9割以上)が透明なので、割り算すら発生させず
    // 整数比較1回だけでスキップできる。これが実質的にcomposeDocumentの主なコストだった
    // (レイヤー数×画素数回の割り算の大半が、結局何もしない透明ピクセルに対して行われていた)。
    if (src[i + 3] === 0) continue;
    const srcA = (src[i + 3] / 255) * opacity;
    if (srcA <= 0) continue;
    // 下地が完全不透明(dstA=1)のときはoutA=srcA+1*(1-srcA)=1が常に成り立つので、/outAの除算を
    // 丸ごと省略できる(結果は数学的に同一)。実際のイラストは下の方で完全不透明な背景/下塗りに
    // 達することが多く、このパスがほとんどのピクセルで使われる — 除算はJSエンジンでも乗算より
    // 数倍遅いため、レイヤー数の多い大きな画像でcomposeDocumentが数百ms〜1秒近くかかって
    // UIが固まって見える不具合の主因になっていた。
    if (dst[i + 3] === 255) {
      if (useBlend) {
        blendPixel(blendMode, dst[i] / 255, dst[i + 1] / 255, dst[i + 2] / 255, src[i] / 255, src[i + 1] / 255, src[i + 2] / 255, blendScratch);
        // dstA=1なので(1-dstA)*Cs項が消え、mixed = blendScratch[c] そのもの。
        dst[i] = blendScratch[0] * 255 * srcA + dst[i] * (1 - srcA);
        dst[i + 1] = blendScratch[1] * 255 * srcA + dst[i + 1] * (1 - srcA);
        dst[i + 2] = blendScratch[2] * 255 * srcA + dst[i + 2] * (1 - srcA);
      } else {
        dst[i] = src[i] * srcA + dst[i] * (1 - srcA);
        dst[i + 1] = src[i + 1] * srcA + dst[i + 1] * (1 - srcA);
        dst[i + 2] = src[i + 2] * srcA + dst[i + 2] * (1 - srcA);
      }
      dst[i + 3] = 255;
      continue;
    }
    const dstA = dst[i + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) {
      dst[i] = 0;
      dst[i + 1] = 0;
      dst[i + 2] = 0;
      dst[i + 3] = 0;
      continue;
    }
    if (useBlend && dstA > 0) {
      blendPixel(blendMode, dst[i] / 255, dst[i + 1] / 255, dst[i + 2] / 255, src[i] / 255, src[i + 1] / 255, src[i + 2] / 255, blendScratch);
      for (let c = 0; c < 3; c++) {
        const mixed = (1 - dstA) * (src[i + c] / 255) + dstA * blendScratch[c];
        dst[i + c] = (mixed * srcA + (dst[i + c] / 255) * dstA * (1 - srcA)) * 255 / outA;
      }
    } else {
      for (let c = 0; c < 3; c++) {
        dst[i + c] = (src[i + c] * srcA + dst[i + c] * dstA * (1 - srcA)) / outA;
      }
    }
    dst[i + 3] = outA * 255;
  }
}

/** Multiplies `buf`'s alpha by the layer's mask luma (red channel; mask paint is always grayscale)
 * and, if the layer clips to the one below, by `baseBuffer`'s alpha too. Mutates `buf` in place —
 * callers must pass a buffer that's safe to mutate (a folder's composed result, or a layer's own
 * pixels cloned first). */
function applyMaskAndClip(buf: Uint8ClampedArray, node: RasterLayer, baseBuffer: Uint8ClampedArray | null): void {
  if (node.mask && node.maskEnabled) {
    const mask = node.mask;
    for (let i = 0; i < buf.length; i += 4) {
      buf[i + 3] = (buf[i + 3] * mask[i]) / 255;
    }
  }
  if (node.clipToBelow && baseBuffer) {
    for (let i = 0; i < buf.length; i += 4) {
      buf[i + 3] = (buf[i + 3] * baseBuffer[i + 3]) / 255;
    }
  }
}

function composeNodes(nodes: LayerNode[], width: number, height: number): Uint8ClampedArray {
  const buffer = new Uint8ClampedArray(width * height * 4);
  // Tracks the nearest-below NON-clipped node's rendered buffer, so a run of clipped layers all
  // clip to the same base rather than chaining onto each other.
  let baseBuffer: Uint8ClampedArray | null = null;
  for (const node of nodes) {
    if (!node.visible || node.opacity <= 0) continue;
    const clipped = node.kind === "layer" && node.clipToBelow;
    let nodeBuffer: Uint8ClampedArray;
    if (node.kind === "layer") {
      // applyMaskAndClipはバッファを書き換えるので、実際に何か適用する必要があるときだけ
      // node.pixelsを複製する(cloneしてから書き換える) — マスクもクリッピングも無い大半の
      // レイヤーでは複製(.slice())を丸ごと省略する。多レイヤーの大きな画像では、この複製の
      // メモリコピーがcomposeDocument全体のコストの大部分を占めていた(画面がクリックに
      // 反応しなくなるほどの重さの主因)。
      const needsMutation = (!!node.mask && node.maskEnabled) || (node.clipToBelow && baseBuffer !== null);
      nodeBuffer = needsMutation ? node.pixels.slice() : node.pixels;
      if (needsMutation) applyMaskAndClip(nodeBuffer, node, baseBuffer);
    } else {
      nodeBuffer = composeNodes(node.children, width, height);
    }
    compositeOver(buffer, nodeBuffer, node.opacity, node.kind === "layer" ? node.blendMode : BLEND_NORMAL);
    if (!clipped) baseBuffer = nodeBuffer;
  }
  return buffer;
}

/** Flattens the full visible layer tree into a single RGBA buffer at document resolution. */
export function composeDocument(doc: Document): Uint8ClampedArray {
  return composeNodes(doc.layers, doc.width, doc.height);
}

/**
 * CLIP STUDIOの「下のレイヤーと結合」: `id`のレイヤーを、同じ親の中で直下にあるレイヤーへ統合する。
 * 統合結果は、この2枚だけを(他の階層と同じ合成ロジック=composeNodesで)重ねた見た目をそのまま
 * 焼き込んだもの — 上のレイヤー(`id`)の不透明度・合成モード・マスク・クリッピングは全てこの時点で
 * 焼き込まれて消え、生き残る下のレイヤーの不透明度は100%・合成モードは通常・マスクは無しにリセット
 * される(すでに結果に反映済みのため)。下のレイヤー自身の「下のレイヤーでクリッピング」設定は、
 * さらにその下(統合後も変わらず存在する)を参照し続けるので、そのままにする。
 * `id`がレイヤーでない、または直下がレイヤーでない(フォルダー or 何もない)場合はfalseを返し何もしない。
 */
export function mergeLayerDown(doc: Document, id: string): boolean {
  const top = doc.findLayer(id);
  const below = top ? doc.nodeBelow(id) : undefined;
  if (!top || !below || below.kind !== "layer") return false;
  const bottom = below;
  bottom.pixels = composeNodes([bottom, top], doc.width, doc.height);
  bottom.opacity = 1;
  bottom.blendMode = BLEND_NORMAL;
  bottom.mask = null;
  doc.deleteNode(id);
  doc.activeLayerId = bottom.id;
  return true;
}
