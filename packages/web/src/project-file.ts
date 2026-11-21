import { Document, RasterLayer, LayerFolder, LayerNode, RGBA } from "@mini-rough/core";
import { VariantGrid, SizeMode } from "./variant-grid";

const FORMAT_VERSION = 1;

interface ProjectFileLayerBase {
  id: string;
  name: string;
  visible: boolean;
  opacity: number;
}

interface ProjectFileRasterLayer extends ProjectFileLayerBase {
  kind: "layer";
  pixelsPng: string;
  maskPng: string | null;
  maskEnabled: boolean;
  clipToBelow: boolean;
  /** CLIP STUDIO PAINTのLayerComposite合成モードコード(@mini-rough/coreのBlendMode)。旧バージョンの
   * 保存ファイルには無いので、読み込み時はundefined→0(通常)として扱う。 */
  blendMode?: number;
}

interface ProjectFileFolder extends ProjectFileLayerBase {
  kind: "folder";
  children: ProjectFileNode[];
}

type ProjectFileNode = ProjectFileRasterLayer | ProjectFileFolder;

interface ProjectFileVariant {
  miniWidth: number;
  miniHeight: number;
  finalWidth: number;
  finalHeight: number;
  dpi: number;
  zoom: number;
  zoomLocked: boolean;
  sizeMode: SizeMode;
  activeLayerId: string | null;
  layers: ProjectFileNode[];
  /** sizeModeの「逆」の表示サイズ(ミニラフ⇄完成サイズ)で保持していた内容
   * (variant.otherModeDoc — 一度もそちら側を表示していなければ存在しない)。これが無いと、
   * 保存→読み込みを挟むたびにそちら側の描画内容が失われ、次に表示したときにもう片方から
   * 再サンプルされた荒い見た目になってしまう。 */
  otherModeActiveLayerId?: string | null;
  otherModeLayers?: ProjectFileNode[];
}

export interface ProjectFilePalette {
  id: string;
  name: string;
  swatches: string[];
}

export interface ProjectFileData {
  formatVersion: number;
  mainColor: RGBA;
  subColor: RGBA;
  bgColor: RGBA;
  bgMode: "color" | "transparent";
  brushSizes: Record<string, number>;
  /** 複数の名前付きパレット。旧バージョンの保存ファイルには無く、代わりに`savedPalette`
   * (名前無しの単一パレット、下方互換のため残す)しか無いので、読み込み時はcaller(main.ts)が
   * `savedPalette`を1つのパレットとして読み替える。 */
  palettes?: ProjectFilePalette[];
  activePaletteId?: string;
  /** 旧フォーマット(複数パレット導入前)専用 — 新しい保存では書き込まない。 */
  savedPalette?: string[];
  tempPalette: string[];
  activeVariantIndex: number;
  activeToolId: string;
  variants: ProjectFileVariant[];
}

function pixelsToPngDataUrl(pixels: Uint8ClampedArray, width: number, height: number): string {
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  // TS 5.7+'s typed-array generics want Uint8ClampedArray<ArrayBuffer>; our buffers are always
  // plain ArrayBuffers at runtime, so this narrows a type-only mismatch, not a real one.
  ctx.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, height), 0, 0);
  return canvas.toDataURL("image/png");
}

function pngDataUrlToPixels(dataUrl: string, width: number, height: number): Promise<Uint8ClampedArray> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      resolve(new Uint8ClampedArray(ctx.getImageData(0, 0, width, height).data));
    };
    img.onerror = () => reject(new Error("PNGデータの読み込みに失敗しました"));
    img.src = dataUrl;
  });
}

function serializeLayerNode(node: LayerNode): ProjectFileNode {
  if (node.kind === "folder") {
    return {
      kind: "folder",
      id: node.id,
      name: node.name,
      visible: node.visible,
      opacity: node.opacity,
      children: node.children.map(serializeLayerNode)
    };
  }
  return {
    kind: "layer",
    id: node.id,
    name: node.name,
    visible: node.visible,
    opacity: node.opacity,
    pixelsPng: pixelsToPngDataUrl(node.pixels, node.width, node.height),
    maskPng: node.mask ? pixelsToPngDataUrl(node.mask, node.width, node.height) : null,
    maskEnabled: node.maskEnabled,
    clipToBelow: node.clipToBelow,
    blendMode: node.blendMode
  };
}

async function deserializeLayerNode(data: ProjectFileNode, width: number, height: number): Promise<LayerNode> {
  if (data.kind === "folder") {
    const folder = new LayerFolder(data.name, data.id);
    folder.visible = data.visible;
    folder.opacity = data.opacity;
    folder.children = await Promise.all(data.children.map((child) => deserializeLayerNode(child, width, height)));
    return folder;
  }
  const layer = new RasterLayer(data.name, width, height, data.id);
  layer.visible = data.visible;
  layer.opacity = data.opacity;
  layer.clipToBelow = data.clipToBelow;
  layer.blendMode = data.blendMode ?? 0;
  layer.maskEnabled = data.maskEnabled;
  layer.pixels.set(await pngDataUrlToPixels(data.pixelsPng, width, height));
  if (data.maskPng) layer.mask = await pngDataUrlToPixels(data.maskPng, width, height);
  return layer;
}

export interface ProjectUiState {
  mainColor: RGBA;
  subColor: RGBA;
  bgColor: RGBA;
  bgMode: "color" | "transparent";
  brushSizes: Record<string, number>;
  palettes: ProjectFilePalette[];
  activePaletteId: string;
  tempPalette: string[];
  activeToolId: string;
}

/** Builds the full project JSON (keyboard metadata + per-variant canvas size/zoom/lock/display
 * mode + the whole layer tree, each layer's pixels/mask PNG-compressed and base64'd). Synchronous
 * — canvas toDataURL is sync — but kept async-shaped so swapping to a compressed/blob encoding
 * later doesn't change the call sites. */
export async function serializeProject(grid: VariantGrid, ui: ProjectUiState): Promise<string> {
  const variants = grid.getAll();
  const activeIndex = Math.max(0, variants.findIndex((v) => v === grid.getActive()));
  const data: ProjectFileData = {
    formatVersion: FORMAT_VERSION,
    mainColor: ui.mainColor,
    subColor: ui.subColor,
    bgColor: ui.bgColor,
    bgMode: ui.bgMode,
    brushSizes: ui.brushSizes,
    palettes: ui.palettes,
    activePaletteId: ui.activePaletteId,
    tempPalette: ui.tempPalette,
    activeVariantIndex: activeIndex,
    activeToolId: ui.activeToolId,
    variants: variants.map((v) => ({
      miniWidth: v.miniWidth,
      miniHeight: v.miniHeight,
      finalWidth: v.doc.finalWidth,
      finalHeight: v.doc.finalHeight,
      dpi: v.doc.dpi,
      zoom: v.widget.getZoom(),
      zoomLocked: v.widget.isZoomLocked(),
      sizeMode: v.sizeMode,
      activeLayerId: v.doc.activeLayerId,
      layers: v.doc.layers.map(serializeLayerNode),
      otherModeActiveLayerId: v.otherModeDoc?.activeLayerId ?? null,
      otherModeLayers: v.otherModeDoc?.layers.map(serializeLayerNode)
    }))
  };
  return JSON.stringify(data);
}

export interface RestoredProject {
  data: ProjectFileData;
  docs: { doc: Document; zoom: number; zoomLocked: boolean; otherModeDoc: Document | null }[];
}

/** Rebuilds every variant's Document (at whichever resolution — mini or final — it was displayed
 * in when saved) from project JSON, plus the OTHER resolution's Document if it was saved (see
 * ProjectFileVariant.otherModeLayers) — callers (main.ts) must assign the latter onto the
 * restored Variant's otherModeDoc themselves, since only they build the Variant. Does not touch
 * the VariantGrid itself; callers are responsible for resetting the grid and re-adding each
 * document, since only they know how to wire up a fresh CanvasWidget's callbacks. */
export async function deserializeProject(json: string): Promise<RestoredProject> {
  const data: ProjectFileData = JSON.parse(json);
  const docs = await Promise.all(
    data.variants.map(async (v) => {
      const width = v.sizeMode === "final" ? v.finalWidth : v.miniWidth;
      const height = v.sizeMode === "final" ? v.finalHeight : v.miniHeight;
      const doc = new Document(width, height, v.finalWidth, v.finalHeight, v.dpi);
      doc.layers = await Promise.all(v.layers.map((layer) => deserializeLayerNode(layer, width, height)));
      doc.activeLayerId = v.activeLayerId;

      let otherModeDoc: Document | null = null;
      if (v.otherModeLayers) {
        const otherWidth = v.sizeMode === "final" ? v.miniWidth : v.finalWidth;
        const otherHeight = v.sizeMode === "final" ? v.miniHeight : v.finalHeight;
        otherModeDoc = new Document(otherWidth, otherHeight, v.finalWidth, v.finalHeight, v.dpi);
        otherModeDoc.layers = await Promise.all(
          v.otherModeLayers.map((layer) => deserializeLayerNode(layer, otherWidth, otherHeight))
        );
        otherModeDoc.activeLayerId = v.otherModeActiveLayerId ?? null;
      }
      return { doc, zoom: v.zoom, zoomLocked: v.zoomLocked, otherModeDoc };
    })
  );
  return { data, docs };
}
