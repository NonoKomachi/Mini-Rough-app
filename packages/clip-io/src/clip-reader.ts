import createClipModule from "./generated/clip-wasm.mjs";
import { ClipModule } from "./clip-module-types";

export interface ReadLayerInfo {
  name: string;
  isFolder: boolean;
  visible: boolean;
  /** 0..1 */
  opacity: number;
  depth: number;
  /** "下のレイヤーでクリッピング" flag. */
  clip: boolean;
  /** Whether this layer has an enabled mask (call renderLayerMask to get it). */
  hasMask: boolean;
  /** LayerComposite blend-mode code (see clip_composite in third_party/libclip/include/libclip/clip.h); 0 = Normal. */
  composite: number;
  /** Packed 0xRRGGBB if this is a flat ("ベタ塗り") fill layer — its render_mipmap stores only
   * the shape/alpha, not the actual fill color, so callers must recolor using this instead of
   * trusting renderLayer()'s RGB. null for ordinary raster layers, true gradients, and folders. */
  fillColor: number | null;
  /** "レイヤーカラー"(DrawColorEnable/DrawColorMain*) — packed 0xRRGGBB if the layer property
   * is on, else null. render_mipmap does NOT reflect this; callers must recolor the rendered RGB
   * themselves (alpha/shape unchanged). Note: despite docs/FORMAT.md describing
   * `LayerUsePaletteColor`/`LayerPaletteRed/Green/Blue` as "Layer color", surveying a real
   * CSP-exported .clip showed that field stays 0 even on layers with レイヤーカラー visibly set
   * in the Layer Property panel — `DrawColorEnable`/`DrawColorMain*` (documented elsewhere as
   * "Paper layer" fields) is what's actually toggled, on ordinary raster layers too. */
  layerColor: number | null;
  /** "境界効果"→"境界線"(LayerEffectInfoのEffectEdge) — present if that effect is on. Also not
   * reflected in render_mipmap; callers must draw the outline themselves. widthPx is in the
   * .clip's own canvas-resolution pixels (not mini/final-specific). */
  border: { color: number; widthPx: number } | null;
}

export interface ReadClipResult {
  width: number;
  height: number;
  dpi: number;
  /** Top-to-bottom palette order (as libclip reports it), folders listed before their contents. */
  layers: ReadLayerInfo[];
  /** Canvas-sized straight-alpha RGBA for layers[index]; undefined for folders. */
  renderLayer(index: number): Uint8ClampedArray | undefined;
  /** Canvas-sized mask (value replicated in every channel) for layers[index]; undefined for
   * folders or layers without an enabled mask (check ReadLayerInfo.hasMask first). */
  renderLayerMask(index: number): Uint8ClampedArray | undefined;
}

let modulePromise: Promise<ClipModule> | undefined;
function getModule(): Promise<ClipModule> {
  const existing = modulePromise;
  if (existing) return existing;
  const created = createClipModule();
  modulePromise = created;
  return created;
}

/** Opens a .clip file (bytes) via libclip (WASM). Call the returned result's renderLayer()
 * lazily; nothing is rendered until asked for. The underlying WASM document stays open for the
 * lifetime of the returned object (there is no explicit close — it is reclaimed with the module
 * instance, which is fine for a one-shot "import" flow). */
export async function readClipFile(bytes: Uint8Array): Promise<ReadClipResult> {
  const Module = await getModule();

  const open = Module.cwrap<(ptr: number, len: number) => number>("mini_clip_open", "number", ["number", "number"]);
  const canvasWidth = Module.cwrap<(h: number) => number>("mini_clip_canvas_width", "number", ["number"]);
  const canvasHeight = Module.cwrap<(h: number) => number>("mini_clip_canvas_height", "number", ["number"]);
  const canvasDpi = Module.cwrap<(h: number) => number>("mini_clip_canvas_dpi", "number", ["number"]);
  const layerCount = Module.cwrap<(h: number) => number>("mini_clip_layer_count", "number", ["number"]);
  const layerName = Module.cwrap<(h: number, i: number) => string>("mini_clip_layer_name", "string", [
    "number",
    "number"
  ]);
  const layerVisible = Module.cwrap<(h: number, i: number) => number>("mini_clip_layer_visible", "number", [
    "number",
    "number"
  ]);
  const layerOpacity = Module.cwrap<(h: number, i: number) => number>("mini_clip_layer_opacity", "number", [
    "number",
    "number"
  ]);
  const layerIsFolder = Module.cwrap<(h: number, i: number) => number>("mini_clip_layer_is_folder", "number", [
    "number",
    "number"
  ]);
  const layerDepth = Module.cwrap<(h: number, i: number) => number>("mini_clip_layer_depth", "number", [
    "number",
    "number"
  ]);
  const layerClip = Module.cwrap<(h: number, i: number) => number>("mini_clip_layer_clip", "number", [
    "number",
    "number"
  ]);
  const layerMaskEnabled = Module.cwrap<(h: number, i: number) => number>("mini_clip_layer_mask_enabled", "number", [
    "number",
    "number"
  ]);
  const layerComposite = Module.cwrap<(h: number, i: number) => number>("mini_clip_layer_composite", "number", [
    "number",
    "number"
  ]);
  const layerFillColor = Module.cwrap<(h: number, i: number) => number>("mini_clip_layer_fill_color", "number", [
    "number",
    "number"
  ]);
  const layerColorRgb = Module.cwrap<(h: number, i: number) => number>("mini_clip_layer_color_rgb", "number", [
    "number",
    "number"
  ]);
  const layerBorderRgb = Module.cwrap<(h: number, i: number) => number>("mini_clip_layer_border_rgb", "number", [
    "number",
    "number"
  ]);
  const layerBorderWidth = Module.cwrap<(h: number, i: number) => number>("mini_clip_layer_border_width", "number", [
    "number",
    "number"
  ]);
  const renderLayerNative = Module.cwrap<(h: number, i: number) => number>("mini_clip_render_layer", "number", [
    "number",
    "number"
  ]);
  const renderLayerMaskNative = Module.cwrap<(h: number, i: number) => number>(
    "mini_clip_render_layer_mask",
    "number",
    ["number", "number"]
  );
  const renderPtr = Module.cwrap<(h: number) => number>("mini_clip_render_ptr", "number", ["number"]);
  const renderWidth = Module.cwrap<(h: number) => number>("mini_clip_render_width", "number", ["number"]);
  const renderHeight = Module.cwrap<(h: number) => number>("mini_clip_render_height", "number", ["number"]);
  const readerError = Module.cwrap<(h: number) => string>("mini_clip_reader_error", "string", ["number"]);

  const ptr = Module._malloc(bytes.length);
  Module.HEAPU8.set(bytes, ptr);
  const handle = open(ptr, bytes.length);
  Module._free(ptr);

  if (!handle) {
    throw new Error("failed to open .clip (not a valid file, or an unsupported format)");
  }

  const width = canvasWidth(handle);
  const height = canvasHeight(handle);
  const dpi = canvasDpi(handle);
  const count = layerCount(handle);

  const layers: ReadLayerInfo[] = [];
  for (let i = 0; i < count; i++) {
    layers.push({
      name: layerName(handle, i),
      isFolder: layerIsFolder(handle, i) !== 0,
      visible: layerVisible(handle, i) !== 0,
      opacity: layerOpacity(handle, i) / 256,
      depth: layerDepth(handle, i),
      clip: layerClip(handle, i) !== 0,
      hasMask: layerMaskEnabled(handle, i) !== 0,
      composite: layerComposite(handle, i),
      fillColor: (() => {
        const packed = layerFillColor(handle, i);
        return packed < 0 ? null : packed;
      })(),
      layerColor: (() => {
        const packed = layerColorRgb(handle, i);
        return packed < 0 ? null : packed;
      })(),
      border: (() => {
        const packed = layerBorderRgb(handle, i);
        return packed < 0 ? null : { color: packed, widthPx: layerBorderWidth(handle, i) };
      })()
    });
  }

  return {
    width,
    height,
    dpi,
    layers,
    renderLayer(index: number): Uint8ClampedArray | undefined {
      if (!renderLayerNative(handle, index)) {
        throw new Error(readerError(handle) || `failed to render layer ${index}`);
      }
      const p = renderPtr(handle);
      const w = renderWidth(handle);
      const h = renderHeight(handle);
      const out = new Uint8ClampedArray(w * h * 4);
      out.set(Module.HEAPU8.subarray(p, p + out.length));
      return out;
    },
    renderLayerMask(index: number): Uint8ClampedArray | undefined {
      if (!layers[index]?.hasMask) return undefined;
      if (!renderLayerMaskNative(handle, index)) {
        throw new Error(readerError(handle) || `failed to render layer ${index} mask`);
      }
      const p = renderPtr(handle);
      const w = renderWidth(handle);
      const h = renderHeight(handle);
      const out = new Uint8ClampedArray(w * h * 4);
      out.set(Module.HEAPU8.subarray(p, p + out.length));
      return out;
    }
  };
}
