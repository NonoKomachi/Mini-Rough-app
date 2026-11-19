import { Document } from "../document";
import { DragTool } from "./tool";
import { SelectionMask, maskHasSelection, getMaskBounds } from "../selection";

/** CLIP STUDIO-style move: drags either the selected region's content (the selection mask moves
 * along with it) or, with no selection, the whole active layer's pixels — restore-then-redraw
 * each drag step from a pre-drag snapshot, the same pattern BrushTool/GradientTool use for live
 * previews, so repeated small moves during one drag never compound rounding/clipping error. */
export class MoveTool implements DragTool {
  readonly kind = "move" as const;

  private start: { x: number; y: number } | null = null;
  private preDragPixels: Uint8ClampedArray | null = null;
  private preDragMask: SelectionMask | null = null;
  /** Bounding box of the moving content in the pre-drag buffer; null means "no selection — the
   * whole layer moves". */
  private bounds: { x: number; y: number; w: number; h: number } | null = null;

  begin(doc: Document, x: number, y: number): void {
    const layer = doc.getActiveLayer();
    if (!layer) return;
    this.start = { x: Math.floor(x), y: Math.floor(y) };
    this.preDragPixels = layer.pixels.slice();
    const mask = maskHasSelection(doc.selectionMask) ? doc.selectionMask : null;
    this.preDragMask = mask ? mask.slice() : null;
    this.bounds = mask ? getMaskBounds(mask, doc.width, doc.height) : null;
  }

  drag(doc: Document, x: number, y: number): void {
    this.apply(doc, Math.floor(x), Math.floor(y));
  }

  end(_doc: Document): void {
    this.start = null;
    this.preDragPixels = null;
    this.preDragMask = null;
    this.bounds = null;
  }

  private apply(doc: Document, x: number, y: number): void {
    const layer = doc.getActiveLayer();
    if (!layer || !this.start || !this.preDragPixels) return;
    const dx = x - this.start.x;
    const dy = y - this.start.y;
    const { width, height } = doc;

    if (this.preDragMask && this.bounds) {
      this.applySelectionMove(doc, layer.pixels, width, height, dx, dy);
    } else {
      this.applyLayerMove(layer.pixels, width, height, dx, dy);
    }
  }

  /** Moves only the pixels inside the selection; everything outside it is left untouched, and the
   * selection mask itself is re-placed at the new location so it keeps tracking its content. */
  private applySelectionMove(doc: Document, pixels: Uint8ClampedArray, width: number, height: number, dx: number, dy: number): void {
    const preDragPixels = this.preDragPixels!;
    const preDragMask = this.preDragMask!;
    const { x: bx, y: by, w: bw, h: bh } = this.bounds!;
    pixels.set(preDragPixels);
    for (let row = 0; row < bh; row++) {
      for (let col = 0; col < bw; col++) {
        const srcIdx = (by + row) * width + (bx + col);
        if (!preDragMask[srcIdx]) continue;
        const pi = srcIdx * 4;
        pixels[pi] = 0;
        pixels[pi + 1] = 0;
        pixels[pi + 2] = 0;
        pixels[pi + 3] = 0;
      }
    }
    const newMask = new Uint8Array(width * height);
    for (let row = 0; row < bh; row++) {
      const srcY = by + row;
      const dstY = srcY + dy;
      if (dstY < 0 || dstY >= height) continue;
      for (let col = 0; col < bw; col++) {
        const srcX = bx + col;
        const srcIdx = srcY * width + srcX;
        if (!preDragMask[srcIdx]) continue;
        const dstX = srcX + dx;
        if (dstX < 0 || dstX >= width) continue;
        const dstIdx = dstY * width + dstX;
        const srcPi = srcIdx * 4;
        const dstPi = dstIdx * 4;
        pixels[dstPi] = preDragPixels[srcPi];
        pixels[dstPi + 1] = preDragPixels[srcPi + 1];
        pixels[dstPi + 2] = preDragPixels[srcPi + 2];
        pixels[dstPi + 3] = preDragPixels[srcPi + 3];
        newMask[dstIdx] = 255;
      }
    }
    doc.selectionMask = newMask;
  }

  /** Moves the whole layer's pixels; content pushed past an edge is clipped and the vacated side
   * becomes transparent, same as CLIP STUDIO's layer move with no selection. */
  private applyLayerMove(pixels: Uint8ClampedArray, width: number, height: number, dx: number, dy: number): void {
    const preDragPixels = this.preDragPixels!;
    const moved = new Uint8ClampedArray(width * height * 4);
    for (let srcY = 0; srcY < height; srcY++) {
      const dstY = srcY + dy;
      if (dstY < 0 || dstY >= height) continue;
      for (let srcX = 0; srcX < width; srcX++) {
        const dstX = srcX + dx;
        if (dstX < 0 || dstX >= width) continue;
        const srcPi = (srcY * width + srcX) * 4;
        const dstPi = (dstY * width + dstX) * 4;
        moved[dstPi] = preDragPixels[srcPi];
        moved[dstPi + 1] = preDragPixels[srcPi + 1];
        moved[dstPi + 2] = preDragPixels[srcPi + 2];
        moved[dstPi + 3] = preDragPixels[srcPi + 3];
      }
    }
    pixels.set(moved);
  }
}
