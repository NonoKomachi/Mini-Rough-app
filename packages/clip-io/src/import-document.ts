import { Document, LayerFolder, LayerNode, RasterLayer } from "@mini-rough/core";
import { ReadClipResult, readClipFile } from "./clip-reader";
import { downscaleNearestNeighbor } from "./upscale";
import { parseWrapperFolderName } from "./wrapper-folder";

interface FlatEntry {
  /** 同じレイヤー/フォルダーに対してミニラフ版・完成サイズ版の両方で共通のid — これが一致して
   * いないと、後で完成サイズ表示に切り替えたときの構造同期(reconcileDocumentResolution、見ている
   * side参照)が「新規レイヤー」と誤認してミニラフ側の荒い画像を拡大しただけのものに差し替えてしまう。 */
  id: string;
  name: string;
  isFolder: boolean;
  visible: boolean;
  opacity: number;
  depth: number;
  sourceIndex: number;
  clip: boolean;
  hasMask: boolean;
  composite: number;
  /** Packed 0xRRGGBB if this is a flat ("ベタ塗り") fill layer — see ReadLayerInfo.fillColor. */
  fillColor: number | null;
  /** "レイヤーカラー" — see ReadLayerInfo.layerColor. */
  layerColor: number | null;
  /** "境界効果"→"境界線" — see ReadLayerInfo.border. */
  border: { color: number; widthPx: number } | null;
}

function createEntryId(): string {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2);
}

export interface ImportedDocument {
  /** 作業用のミニラフ解像度のDocument。 */
  doc: Document;
  /** .clipが実際に持っていた完成サイズ解像度の、本物の(縮小→拡大のような劣化のない)Document。
   * 呼び出し側はこれをVariant.otherModeDocに設定しておくことで、「完成サイズ」表示へ最初に
   * 切り替えたときにミニラフ側の荒い画像を引き伸ばすのではなく、この本来の解像度の画像を
   * そのまま表示できる(レイヤーidはdocと共通なので、reconcileDocumentResolutionがそのまま
   * 再利用する)。 */
  finalDoc: Document;
}

/**
 * Reconstructs a Document from a .clip file. If the canvas's sole top-level folder matches our
 * own "ミニラフ (WxH)" naming (see wrapper-folder.ts), its contents are unwrapped and downscaled
 * back to that original mini resolution — full fidelity for files this app exported. Otherwise
 * it's a best-effort import: the canvas resolution is used directly as the mini resolution (no
 * downscale), since there is no recorded "intended" mini size for a foreign .clip.
 *
 * Also returns a second Document (`finalDoc`) at the .clip's real canvas resolution, built from
 * the same render without any downscale — so switching to "完成サイズ" display shows the actual
 * imported artwork, not a nearest-neighbor blow-up of the downscaled mini copy.
 */
export async function importDocumentFromClip(bytes: Uint8Array): Promise<ImportedDocument> {
  const result = await readClipFile(bytes);

  const entries: FlatEntry[] = result.layers.map((l, i) => ({
    id: createEntryId(),
    name: l.name,
    isFolder: l.isFolder,
    visible: l.visible,
    opacity: l.opacity,
    depth: l.depth,
    sourceIndex: i,
    clip: l.clip,
    hasMask: l.hasMask,
    composite: l.composite,
    fillColor: l.fillColor,
    layerColor: l.layerColor,
    border: l.border
  }));

  const { miniWidth, miniHeight, innerEntries } = detectWrapper(entries, result.width, result.height);

  const { miniRoot, finalRoot } = buildTrees(innerEntries, result, miniWidth, miniHeight);

  const doc = new Document(miniWidth, miniHeight, result.width, result.height, result.dpi);
  doc.layers = miniRoot;
  doc.activeLayerId = doc.findFirstLayer()?.id ?? null;

  const finalDoc = new Document(result.width, result.height, result.width, result.height, result.dpi);
  finalDoc.layers = finalRoot;
  finalDoc.activeLayerId = finalDoc.findFirstLayer()?.id ?? null;

  return { doc, finalDoc };
}

function detectWrapper(
  entries: FlatEntry[],
  canvasWidth: number,
  canvasHeight: number
): { miniWidth: number; miniHeight: number; innerEntries: FlatEntry[] } {
  const topLevel = entries.filter((e) => e.depth === 0);
  if (topLevel.length === 1 && topLevel[0].isFolder) {
    const parsed = parseWrapperFolderName(topLevel[0].name);
    if (parsed) {
      return {
        miniWidth: parsed.width,
        miniHeight: parsed.height,
        innerEntries: entries.slice(1).map((e) => ({ ...e, depth: e.depth - 1 }))
      };
    }
  }
  return { miniWidth: canvasWidth, miniHeight: canvasHeight, innerEntries: entries };
}

/** Entries are top-to-bottom (libclip's read order); builds BOTH the ミニラフ(mini)-resolution
 * and 完成サイズ(final/canvas)-resolution trees in a single pass, sharing one `renderLayer()`
 * call (+ fillColor/layerColor/border rasterization) per layer between them — rendering and
 * recoloring are the expensive part (full canvas-resolution WASM round-trips), so doing them
 * twice (once per resolution, as an earlier version of this function did by being called twice)
 * roughly doubled .clip import time on files with many layers. The final-resolution layer is a
 * plain copy of the rendered buffer (same resolution, no resampling loss); the mini-resolution
 * layer is downscaled from that same already-recolored buffer. */
function buildTrees(
  entries: FlatEntry[],
  result: ReadClipResult,
  miniWidth: number,
  miniHeight: number
): { miniRoot: LayerNode[]; finalRoot: LayerNode[] } {
  const miniRoot: LayerNode[] = [];
  const finalRoot: LayerNode[] = [];
  const miniStack: { depth: number; children: LayerNode[] }[] = [{ depth: -1, children: miniRoot }];
  const finalStack: { depth: number; children: LayerNode[] }[] = [{ depth: -1, children: finalRoot }];

  for (const entry of entries) {
    while (miniStack.length > 1 && miniStack[miniStack.length - 1].depth >= entry.depth) miniStack.pop();
    while (finalStack.length > 1 && finalStack[finalStack.length - 1].depth >= entry.depth) finalStack.pop();
    const miniParent = miniStack[miniStack.length - 1];
    const finalParent = finalStack[finalStack.length - 1];

    if (entry.isFolder) {
      const miniFolder = new LayerFolder(entry.name, entry.id);
      miniFolder.visible = entry.visible;
      miniFolder.opacity = entry.opacity;
      miniParent.children.push(miniFolder);
      miniStack.push({ depth: entry.depth, children: miniFolder.children });

      const finalFolder = new LayerFolder(entry.name, entry.id);
      finalFolder.visible = entry.visible;
      finalFolder.opacity = entry.opacity;
      finalParent.children.push(finalFolder);
      finalStack.push({ depth: entry.depth, children: finalFolder.children });
      continue;
    }

    const miniLayer = new RasterLayer(entry.name, miniWidth, miniHeight, entry.id);
    miniLayer.visible = entry.visible;
    miniLayer.opacity = entry.opacity;
    miniLayer.clipToBelow = entry.clip;
    miniLayer.blendMode = entry.composite;

    const finalLayer = new RasterLayer(entry.name, result.width, result.height, entry.id);
    finalLayer.visible = entry.visible;
    finalLayer.opacity = entry.opacity;
    finalLayer.clipToBelow = entry.clip;
    finalLayer.blendMode = entry.composite;

    const rendered = result.renderLayer(entry.sourceIndex);
    if (rendered) {
      // render_mipmap(CSPが描画に使うキャッシュ)には、ベタ塗りレイヤーの色/レイヤーカラー/
      // 境界効果のいずれも反映されていない(形状=アルファだけ)ので、ここでラスタライズし直す
      // (完成サイズ解像度で1回だけ行い、ミニラフ側はその結果を縮小して使う)。
      if (entry.fillColor !== null) applyFillColor(rendered, entry.fillColor);
      if (entry.layerColor !== null) applyFillColor(rendered, entry.layerColor);
      if (entry.border !== null) {
        applyBorderEffect(rendered, result.width, result.height, entry.border.widthPx, entry.border.color);
      }
      finalLayer.pixels.set(rendered);
      const miniResampled = downscaleNearestNeighbor(rendered, result.width, result.height, miniWidth, miniHeight);
      miniLayer.pixels.set(miniResampled);
    }
    if (entry.hasMask) {
      const renderedMask = result.renderLayerMask(entry.sourceIndex);
      if (renderedMask) {
        finalLayer.mask = renderedMask;
        miniLayer.mask = downscaleNearestNeighbor(renderedMask, result.width, result.height, miniWidth, miniHeight);
      }
    }
    miniParent.children.push(miniLayer);
    finalParent.children.push(finalLayer);
  }

  reverseAll(miniRoot);
  reverseAll(finalRoot);
  return { miniRoot, finalRoot };
}

/** Overwrites every pixel's RGB (not alpha) with `packedRgb` (0xRRGGBB) in place. */
function applyFillColor(rgba: Uint8ClampedArray, packedRgb: number): void {
  const r = (packedRgb >> 16) & 0xff;
  const g = (packedRgb >> 8) & 0xff;
  const b = packedRgb & 0xff;
  for (let i = 0; i < rgba.length; i += 4) {
    rgba[i] = r;
    rgba[i + 1] = g;
    rgba[i + 2] = b;
  }
}

/** Chamfer 3-4 distance transform (a fast, roughly-circular approximation of the true Euclidean
 * distance transform — exact distance transforms need a slower two-pass per-axis scan; this is
 * good enough for an outline effect's visual purpose): for every pixel, the distance (×3) to the
 * nearest pixel with alpha>0. BIG marks "no opaque pixel reachable within a sane range". */
const CHAMFER_BIG = 0x3fffffff;
function chamferDistanceToOpaque(alpha: Uint8Array, width: number, height: number): Int32Array {
  const n = width * height;
  const dist = new Int32Array(n);
  for (let i = 0; i < n; i++) dist[i] = alpha[i] > 0 ? 0 : CHAMFER_BIG;

  for (let y = 0; y < height; y++) {
    const row = y * width;
    for (let x = 0; x < width; x++) {
      const i = row + x;
      let d = dist[i];
      if (x > 0) d = Math.min(d, dist[i - 1] + 3);
      if (y > 0) {
        d = Math.min(d, dist[i - width] + 3);
        if (x > 0) d = Math.min(d, dist[i - width - 1] + 4);
        if (x < width - 1) d = Math.min(d, dist[i - width + 1] + 4);
      }
      dist[i] = d;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    const row = y * width;
    for (let x = width - 1; x >= 0; x--) {
      const i = row + x;
      let d = dist[i];
      if (x < width - 1) d = Math.min(d, dist[i + 1] + 3);
      if (y < height - 1) {
        d = Math.min(d, dist[i + width] + 3);
        if (x < width - 1) d = Math.min(d, dist[i + width + 1] + 4);
        if (x > 0) d = Math.min(d, dist[i + width - 1] + 4);
      }
      dist[i] = d;
    }
  }
  return dist;
}

/** Rasterizes CSPの「境界効果」→「境界線」: paints `borderRgb` fully opaque into every
 * currently-transparent-ish pixel within `widthPx` of the layer's own opaque pixels, without
 * touching pixels the layer itself already covers (CSP draws the border only in the halo outside
 * the ink, never over it). Mutates `rgba` (canvas-resolution, straight alpha) in place. */
function applyBorderEffect(rgba: Uint8ClampedArray, width: number, height: number, widthPx: number, borderRgb: number): void {
  if (widthPx <= 0) return;
  const n = width * height;
  const alpha = new Uint8Array(n);
  for (let i = 0; i < n; i++) alpha[i] = rgba[i * 4 + 3];

  const dist = chamferDistanceToOpaque(alpha, width, height);
  const maxChamfer = widthPx * 3;
  const r = (borderRgb >> 16) & 0xff;
  const g = (borderRgb >> 8) & 0xff;
  const b = borderRgb & 0xff;
  for (let i = 0; i < n; i++) {
    if (alpha[i] > 0) continue;
    const d = dist[i];
    if (d > 0 && d <= maxChamfer) {
      const i4 = i * 4;
      rgba[i4] = r;
      rgba[i4 + 1] = g;
      rgba[i4 + 2] = b;
      rgba[i4 + 3] = 255;
    }
  }
}

function reverseAll(nodes: LayerNode[]): void {
  nodes.reverse();
  for (const node of nodes) {
    if (node.kind === "folder") reverseAll(node.children);
  }
}
