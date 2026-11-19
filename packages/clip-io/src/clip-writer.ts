import createClipModule from "./generated/clip-wasm.mjs";
import { ClipModule } from "./clip-module-types";

const CLIP_WRITE_RASTER = 0;
const CLIP_WRITE_FOLDER = 3;

export interface MiniLayerExport {
  name: string;
  kind: "raster" | "folder";
  /** 0 = top level; a folder's children are depth+1. */
  depth: number;
  /** 0..1 */
  opacity: number;
  /** Straight-alpha RGBA, exactly width*height*4 bytes, already at canvas resolution. Required for "raster". */
  pixels?: Uint8Array | Uint8ClampedArray;
  /** "下のレイヤーでクリッピング" — clips this layer to the one directly below it. */
  clip?: boolean;
  /** Canvas-sized single-channel (luma) mask, exactly width*height bytes; omit for no mask. */
  mask?: Uint8Array | Uint8ClampedArray;
  /** LayerComposite blend-mode code (see @mini-rough/core's BlendMode); ignored for "folder"
   * (always written as pass-through). Omit for 0 (Normal). */
  composite?: number;
}

export interface WriteClipOptions {
  width: number;
  height: number;
  dpi: number;
  /** Bottom-most first, top-most last; each folder must directly follow its own (already-flattened) children. */
  layers: MiniLayerExport[];
}

let modulePromise: Promise<ClipModule> | undefined;
function getModule(): Promise<ClipModule> {
  const existing = modulePromise;
  if (existing) return existing;
  const created = createClipModule();
  modulePromise = created;
  return created;
}

/** Builds a .clip file in memory via libclip (WASM) and returns its raw bytes. */
export async function writeClipFile(options: WriteClipOptions): Promise<Uint8Array> {
  const Module = await getModule();

  const begin = Module.cwrap<(w: number, h: number, dpi: number) => number>("mini_clip_begin", "number", [
    "number",
    "number",
    "number"
  ]);
  const addLayer = Module.cwrap<
    (
      handle: number,
      name: string,
      kind: number,
      depth: number,
      visible: number,
      opacity: number,
      composite: number,
      pixelsPtr: number,
      pixelsLen: number,
      clipFlag: number,
      maskPtr: number,
      maskLen: number
    ) => number
  >("mini_clip_add_layer", "number", [
    "number",
    "string",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number",
    "number"
  ]);
  const writeDoc = Module.cwrap<(handle: number) => number>("mini_clip_write", "number", ["number"]);
  const outputPtr = Module.cwrap<(handle: number) => number>("mini_clip_output_ptr", "number", ["number"]);
  const outputSize = Module.cwrap<(handle: number) => number>("mini_clip_output_size", "number", ["number"]);
  const errorMessage = Module.cwrap<(handle: number) => string>("mini_clip_error", "string", ["number"]);
  const freeHandle = Module.cwrap<(handle: number) => void>("mini_clip_free", null, ["number"]);

  const handle = begin(options.width, options.height, options.dpi);
  try {
    for (const layer of options.layers) {
      let pixelsPtr = 0;
      let pixelsLen = 0;
      let maskPtr = 0;
      let maskLen = 0;
      if (layer.kind === "raster") {
        if (!layer.pixels) throw new Error(`raster layer "${layer.name}" is missing pixel data`);
        pixelsLen = layer.pixels.length;
        pixelsPtr = Module._malloc(pixelsLen);
        Module.HEAPU8.set(layer.pixels, pixelsPtr);
        if (layer.mask) {
          maskLen = layer.mask.length;
          maskPtr = Module._malloc(maskLen);
          Module.HEAPU8.set(layer.mask, maskPtr);
        }
      }
      const kind = layer.kind === "folder" ? CLIP_WRITE_FOLDER : CLIP_WRITE_RASTER;
      const opacity256 = Math.round(Math.max(0, Math.min(1, layer.opacity)) * 256);
      const ok = addLayer(
        handle,
        layer.name,
        kind,
        layer.depth,
        1,
        opacity256,
        layer.composite ?? 0,
        pixelsPtr,
        pixelsLen,
        layer.clip ? 1 : 0,
        maskPtr,
        maskLen
      );
      if (pixelsPtr) Module._free(pixelsPtr);
      if (maskPtr) Module._free(maskPtr);
      if (!ok) throw new Error(`libclip rejected layer "${layer.name}"`);
    }

    if (!writeDoc(handle)) {
      throw new Error(errorMessage(handle) || "clip_write_memory failed");
    }

    const ptr = outputPtr(handle);
    const size = outputSize(handle);
    const result = new Uint8Array(size);
    result.set(Module.HEAPU8.subarray(ptr, ptr + size));
    return result;
  } finally {
    freeHandle(handle);
  }
}
