/* mini-rough <-> libclip bridge for WebAssembly.
 *
 * Exposes a tiny flat-parameter API so JS doesn't need to marshal libclip's
 * C structs directly: build a document by adding layers one at a time (in
 * libclip's flat bottom-to-top + depth order, see docs/FORMAT.md / clip.h),
 * then write it to an in-memory buffer that JS reads out of WASM memory.
 */
#include <libclip/clip.h>
#include <stdlib.h>
#include <string.h>

typedef struct {
    clip_write_layer *layers;
    size_t count;
    size_t capacity;
    int width, height;
    double dpi;
    clip_buffer output;
    char error[256];
} MiniClipBuilder;

static char *dup_str(const char *s) {
    size_t len = strlen(s) + 1;
    char *copy = malloc(len);
    if (copy) memcpy(copy, s, len);
    return copy;
}

__attribute__((used)) MiniClipBuilder *mini_clip_begin(int width, int height, double dpi) {
    MiniClipBuilder *b = calloc(1, sizeof(MiniClipBuilder));
    if (!b) return NULL;
    b->width = width;
    b->height = height;
    b->dpi = dpi;
    b->capacity = 8;
    b->layers = calloc(b->capacity, sizeof(clip_write_layer));
    return b;
}

/* kind: 0 = CLIP_WRITE_RASTER, 3 = CLIP_WRITE_FOLDER (see clip.h).
 * `pixels`/`pixels_len` are ignored for folders; otherwise must be exactly
 * width*height*4 straight-alpha RGBA bytes (the canvas-sized, already
 * upscaled layer image). `clip_flag` is CSP's "clip to the layer below"
 * (ignored for folders). `composite` is the CSP LayerComposite blend-mode
 * code (see clip_composite in clip.h); ignored for folders, which are
 * always written as CLIP_COMPOSITE_THROUGH regardless of what's passed —
 * mini-rough's own renderer doesn't implement folder-level blend modes, so
 * exporting anything else would silently misrender in both apps.
 * `mask_pixels`/`mask_pixels_len` are an optional canvas-sized width*height
 * single-channel (luma) mask, replicated into libclip's RGBA mask image;
 * pass NULL/0 for no mask. Returns 0 on failure (bad pixel buffer size / OOM). */
__attribute__((used)) int mini_clip_add_layer(MiniClipBuilder *b, const char *name, int kind, int depth, int visible,
                                              int opacity, int composite, const uint8_t *pixels, int pixels_len,
                                              int clip_flag, const uint8_t *mask_pixels, int mask_pixels_len) {
    if (!b) return 0;
    if (b->count == b->capacity) {
        size_t next_capacity = b->capacity * 2;
        clip_write_layer *grown = realloc(b->layers, next_capacity * sizeof(clip_write_layer));
        if (!grown) return 0;
        b->layers = grown;
        b->capacity = next_capacity;
        memset(&b->layers[b->count], 0, (next_capacity - b->count) * sizeof(clip_write_layer));
    }

    clip_write_layer *layer = &b->layers[b->count];
    memset(layer, 0, sizeof(*layer));
    layer->name = dup_str(name ? name : "");
    layer->kind = kind;
    layer->depth = depth;
    layer->visible = visible;
    layer->opacity = opacity;
    layer->clip = clip_flag;
    layer->composite = (kind == CLIP_WRITE_FOLDER) ? CLIP_COMPOSITE_THROUGH : composite;
    layer->expanded = 1;

    if (kind != CLIP_WRITE_FOLDER) {
        if (!pixels || pixels_len != b->width * b->height * 4) return 0;
        if (!clip_image_init(&layer->pixels, b->width, b->height)) return 0;
        memcpy(layer->pixels.pixels, pixels, (size_t)pixels_len);

        if (mask_pixels && mask_pixels_len == b->width * b->height) {
            if (!clip_image_init(&layer->mask, b->width, b->height)) return 0;
            for (int i = 0; i < b->width * b->height; i++) {
                /* clip_offscreen.c's mask encoder reads the mask value from the ALPHA channel
                 * (see clip__offscreen_encode_ex's "Mask:" comment) — R/G/B are not used for
                 * writing, but are set the same for consistency with how a read-back mask
                 * replicates its single decoded value into every channel. */
                uint8_t v = mask_pixels[i];
                layer->mask.pixels[i * 4 + 0] = v;
                layer->mask.pixels[i * 4 + 1] = v;
                layer->mask.pixels[i * 4 + 2] = v;
                layer->mask.pixels[i * 4 + 3] = v;
            }
            layer->mask_enabled = 1;
        }
    }

    b->count++;
    return 1;
}

/* Assembles the document and writes it to an in-memory .clip image. Returns
 * 0 on failure; call mini_clip_error() for a message. */
__attribute__((used)) int mini_clip_write(MiniClipBuilder *b) {
    if (!b) return 0;
    clip_write_document doc;
    memset(&doc, 0, sizeof(doc));
    doc.width = b->width;
    doc.height = b->height;
    doc.dpi = b->dpi;
    doc.paper_visible = 0; /* keep the canvas transparent; mini-rough has no "paper" concept */
    doc.layers = b->layers;
    doc.layer_count = b->count;
    doc.active_layer = b->count > 0 ? b->count - 1 : 0;

    clip_error err;
    memset(&err, 0, sizeof(err));
    int ok = clip_write_memory(&doc, &b->output, &err);
    if (!ok) {
        strncpy(b->error, err.message, sizeof(b->error) - 1);
    }
    return ok;
}

__attribute__((used)) const uint8_t *mini_clip_output_ptr(MiniClipBuilder *b) {
    return b ? b->output.data : NULL;
}

__attribute__((used)) int mini_clip_output_size(MiniClipBuilder *b) {
    return b ? (int)b->output.size : 0;
}

__attribute__((used)) const char *mini_clip_error(MiniClipBuilder *b) {
    return b ? b->error : "";
}

__attribute__((used)) void mini_clip_free(MiniClipBuilder *b) {
    if (!b) return;
    for (size_t i = 0; i < b->count; i++) {
        free((void *)b->layers[i].name);
        clip_image_free(&b->layers[i].pixels);
        clip_image_free(&b->layers[i].mask);
    }
    free(b->layers);
    clip_buffer_free(&b->output);
    free(b);
}

/* ------------------------------------------------------------------------ */
/* Reading: re-opening a .clip (our own exports, or best-effort for others) */
/* ------------------------------------------------------------------------ */

typedef struct {
    clip_document *doc;
    clip_image scratch; /* reused by mini_clip_render_layer */
    char error[256];
} MiniClipReader;

__attribute__((used)) MiniClipReader *mini_clip_open(const uint8_t *data, int len) {
    MiniClipReader *r = calloc(1, sizeof(MiniClipReader));
    if (!r) return NULL;
    clip_error err;
    memset(&err, 0, sizeof(err));
    if (!clip_document_open_memory(&r->doc, data, (size_t)len, &err)) {
        strncpy(r->error, err.message, sizeof(r->error) - 1);
        free(r);
        return NULL;
    }
    return r;
}

__attribute__((used)) int mini_clip_canvas_width(MiniClipReader *r) {
    return r ? (int)clip_document_canvas(r->doc)->width : 0;
}
__attribute__((used)) int mini_clip_canvas_height(MiniClipReader *r) {
    return r ? (int)clip_document_canvas(r->doc)->height : 0;
}
__attribute__((used)) double mini_clip_canvas_dpi(MiniClipReader *r) {
    return r ? clip_document_canvas(r->doc)->resolution : 0;
}

__attribute__((used)) int mini_clip_layer_count(MiniClipReader *r) {
    return r ? (int)clip_document_layer_count(r->doc) : 0;
}
__attribute__((used)) const char *mini_clip_layer_name(MiniClipReader *r, int index) {
    const clip_layer_info *l = r ? clip_document_layer(r->doc, (size_t)index) : NULL;
    return l ? l->name : "";
}
__attribute__((used)) int mini_clip_layer_visible(MiniClipReader *r, int index) {
    const clip_layer_info *l = r ? clip_document_layer(r->doc, (size_t)index) : NULL;
    return l ? l->visible : 0;
}
/* 0..256 (256 == 100%), matching mini_clip_add_layer's opacity units. */
__attribute__((used)) int mini_clip_layer_opacity(MiniClipReader *r, int index) {
    const clip_layer_info *l = r ? clip_document_layer(r->doc, (size_t)index) : NULL;
    return l ? l->opacity : 256;
}
__attribute__((used)) int mini_clip_layer_is_folder(MiniClipReader *r, int index) {
    const clip_layer_info *l = r ? clip_document_layer(r->doc, (size_t)index) : NULL;
    return l && clip_layer_is_folder(l) ? 1 : 0;
}
/* Nesting depth computed from the tree; 0 = top level. */
__attribute__((used)) int mini_clip_layer_depth(MiniClipReader *r, int index) {
    const clip_layer_info *l = r ? clip_document_layer(r->doc, (size_t)index) : NULL;
    return l ? l->depth : 0;
}
/* "下のレイヤーでクリッピング" flag. */
__attribute__((used)) int mini_clip_layer_clip(MiniClipReader *r, int index) {
    const clip_layer_info *l = r ? clip_document_layer(r->doc, (size_t)index) : NULL;
    return l ? l->clip : 0;
}
__attribute__((used)) int mini_clip_layer_mask_enabled(MiniClipReader *r, int index) {
    const clip_layer_info *l = r ? clip_document_layer(r->doc, (size_t)index) : NULL;
    return l && clip_layer_mask_enabled(l) ? 1 : 0;
}
/* LayerComposite blend-mode code (see clip_composite in clip.h); 0 = Normal. */
__attribute__((used)) int mini_clip_layer_composite(MiniClipReader *r, int index) {
    const clip_layer_info *l = r ? clip_document_layer(r->doc, (size_t)index) : NULL;
    return l ? l->composite : 0;
}

/* CSPの「ベタ塗りレイヤー」(塗りつぶしレイヤー)はGradationFillInfoに単色フラグ(fill)と
 * fill_rgbを持つが、render_mipmap(mini_clip_render_layerが返す画素)自体はおそらく形状(アルファ)
 * だけを持ち、RGB成分は0(つまり描画すると真っ黒)になっている。塗りつぶし色を正しく復元する
 * ための補助。 */
static int decode_fill_rgb_from_blob(const uint8_t *blob, size_t blob_size, uint8_t out_rgb[3]) {
    clip_gradient g;
    if (!blob || !blob_size) return 0;
    if (!clip_gradation_parse(blob, blob_size, &g, NULL)) return 0;
    if (!g.fill) return 0;
    out_rgb[0] = g.fill_rgb[0];
    out_rgb[1] = g.fill_rgb[1];
    out_rgb[2] = g.fill_rgb[2];
    return 1;
}

/* Packed 0xRRGGBB if this layer is a flat ("ベタ塗り") fill layer; -1 otherwise (not a fill
 * layer, a true multi-stop gradient layer, or a parse failure). */
__attribute__((used)) int mini_clip_layer_fill_color(MiniClipReader *r, int index) {
    const clip_layer_info *l = r ? clip_document_layer(r->doc, (size_t)index) : NULL;
    uint8_t rgb[3];
    if (!l || !decode_fill_rgb_from_blob(l->gradation_info, l->gradation_info_size, rgb)) return -1;
    return (rgb[0] << 16) | (rgb[1] << 8) | rgb[2];
}

/* "レイヤーカラー" — packed 0xRRGGBB if enabled, -1 if off.
 * 実機の.clipを調査した結果、`LayerUsePaletteColor`/`effects.layer_color`(docs/FORMAT.mdが
 * "Layer color"としていたフィールド)は実際にレイヤーカラーを設定したレイヤーでも0のままだった。
 * 代わりに`DrawColorEnable`/`DrawColorMain*`(docs上は「Paper(用紙)レイヤー専用」とされていた
 * フィールド)が、レイヤーカラーを設定した通常のラスターレイヤーでも1になっていて、設定した色が
 * そのまま入っていることを実データで確認した。libclipのread_layersが既に
 * `l->draw_color_enable`/`l->draw_color[0..2]`として解析済みなので、ここでは素通しするだけ。 */
__attribute__((used)) int mini_clip_layer_color_rgb(MiniClipReader *r, int index) {
    const clip_layer_info *l = r ? clip_document_layer(r->doc, (size_t)index) : NULL;
    if (!l || !l->draw_color_enable) return -1;
    return (l->draw_color[0] << 16) | (l->draw_color[1] << 8) | l->draw_color[2];
}

/* "境界効果"→"境界線"(LayerEffectInfoのEffectEdgeセクション) — packed 0xRRGGBB if enabled,
 * -1 if off(境界効果が無効、または水彩境界など未対応の種類)。同じくlibclipのread_layersが
 * 既に解析済み(clip_layer_info.effects.border/border_color)。 */
__attribute__((used)) int mini_clip_layer_border_rgb(MiniClipReader *r, int index) {
    const clip_layer_info *l = r ? clip_document_layer(r->doc, (size_t)index) : NULL;
    if (!l || !l->effects.border) return -1;
    return (l->effects.border_color[0] << 16) | (l->effects.border_color[1] << 8) | l->effects.border_color[2];
}

/* 境界線の太さ(px)。mini_clip_layer_border_rgbが-1を返す場合は意味を持たない。 */
__attribute__((used)) double mini_clip_layer_border_width(MiniClipReader *r, int index) {
    const clip_layer_info *l = r ? clip_document_layer(r->doc, (size_t)index) : NULL;
    return (l && l->effects.border) ? l->effects.border_width : 0;
}

/* Renders the layer (canvas-sized RGBA) into the reader's scratch buffer; read it back via
 * mini_clip_render_ptr/width/height before the next render call (it is reused each time). */
__attribute__((used)) int mini_clip_render_layer(MiniClipReader *r, int index) {
    if (!r) return 0;
    const clip_layer_info *l = clip_document_layer(r->doc, (size_t)index);
    if (!l) return 0;
    clip_image_free(&r->scratch);
    clip_error err;
    memset(&err, 0, sizeof(err));
    if (!clip_document_render_layer(r->doc, l, &r->scratch, &err)) {
        strncpy(r->error, err.message, sizeof(r->error) - 1);
        return 0;
    }
    return 1;
}
/* Renders the layer's mask (canvas-sized, mask value in every channel) into the same scratch
 * buffer as mini_clip_render_layer — read it back the same way before the next render call.
 * Call mini_clip_layer_mask_enabled first; this returns 0 (not an error) when the layer has no
 * mask at all. */
__attribute__((used)) int mini_clip_render_layer_mask(MiniClipReader *r, int index) {
    if (!r) return 0;
    const clip_layer_info *l = clip_document_layer(r->doc, (size_t)index);
    if (!l) return 0;
    clip_image_free(&r->scratch);
    clip_error err;
    memset(&err, 0, sizeof(err));
    if (!clip_document_render_layer_mask(r->doc, l, &r->scratch, &err)) {
        strncpy(r->error, err.message, sizeof(r->error) - 1);
        return 0;
    }
    return 1;
}
__attribute__((used)) const uint8_t *mini_clip_render_ptr(MiniClipReader *r) {
    return r ? r->scratch.pixels : NULL;
}
__attribute__((used)) int mini_clip_render_width(MiniClipReader *r) {
    return r ? r->scratch.width : 0;
}
__attribute__((used)) int mini_clip_render_height(MiniClipReader *r) {
    return r ? r->scratch.height : 0;
}

__attribute__((used)) const char *mini_clip_reader_error(MiniClipReader *r) {
    return r ? r->error : "";
}

__attribute__((used)) void mini_clip_close(MiniClipReader *r) {
    if (!r) return;
    clip_image_free(&r->scratch);
    clip_document_close(r->doc);
    free(r);
}
