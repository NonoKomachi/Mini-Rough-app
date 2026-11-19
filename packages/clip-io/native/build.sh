#!/usr/bin/env bash
# Builds packages/clip-io/src/generated/clip-wasm.mjs (+ embedded .wasm) from
# libclip + bridge.c using emcc. Requires the Emscripten SDK to be activated;
# this script sources it from third_party/emsdk relative to the repo root.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"
LIBCLIP="$REPO_ROOT/third_party/libclip"
OUT_DIR="$SCRIPT_DIR/../src/generated"

# shellcheck disable=SC1091
source "$REPO_ROOT/third_party/emsdk/emsdk_env.sh"

mkdir -p "$OUT_DIR"

emcc -O2 \
  -I "$LIBCLIP/include" \
  -I "$LIBCLIP/src" \
  -I "$LIBCLIP/third_party/sqlite" \
  -DSQLITE_THREADSAFE=0 -DSQLITE_OMIT_LOAD_EXTENSION -DSQLITE_OMIT_DEPRECATED \
  -DSQLITE_DQS=0 -DSQLITE_DEFAULT_MEMSTATUS=0 \
  "$LIBCLIP/src/clip_util.c" \
  "$LIBCLIP/src/clip_zlib.c" \
  "$LIBCLIP/src/clip_png.c" \
  "$LIBCLIP/src/clip_container.c" \
  "$LIBCLIP/src/clip_offscreen.c" \
  "$LIBCLIP/src/clip_document.c" \
  "$LIBCLIP/src/clip_gradient.c" \
  "$LIBCLIP/src/clip_writer.c" \
  "$LIBCLIP/third_party/sqlite/sqlite3.c" \
  "$SCRIPT_DIR/bridge.c" \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=1 \
  -s EXPORT_NAME=createClipModule \
  -s SINGLE_FILE=1 \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s ENVIRONMENT=web \
  -s EXPORTED_FUNCTIONS='["_malloc","_free",
    "_mini_clip_begin","_mini_clip_add_layer","_mini_clip_write","_mini_clip_output_ptr","_mini_clip_output_size","_mini_clip_error","_mini_clip_free",
    "_mini_clip_open","_mini_clip_canvas_width","_mini_clip_canvas_height","_mini_clip_canvas_dpi",
    "_mini_clip_layer_count","_mini_clip_layer_name","_mini_clip_layer_visible","_mini_clip_layer_opacity","_mini_clip_layer_is_folder","_mini_clip_layer_depth",
    "_mini_clip_layer_clip","_mini_clip_layer_mask_enabled","_mini_clip_layer_composite","_mini_clip_layer_fill_color",
    "_mini_clip_layer_color_rgb","_mini_clip_layer_border_rgb","_mini_clip_layer_border_width",
    "_mini_clip_render_layer","_mini_clip_render_layer_mask","_mini_clip_render_ptr","_mini_clip_render_width","_mini_clip_render_height",
    "_mini_clip_reader_error","_mini_clip_close"]' \
  -s EXPORTED_RUNTIME_METHODS='["ccall","cwrap","HEAPU8"]' \
  -o "$OUT_DIR/clip-wasm.mjs"

echo "Built $OUT_DIR/clip-wasm.mjs"
