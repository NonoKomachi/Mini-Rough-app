import { Document, RasterLayer } from "../document";
import { RGBA, StrokeTool } from "./tool";
import { setPixel } from "./raster-utils";
import { pressureToSize, applyPressureSensitivity } from "./pressure";
import { SelectionMask, maskHasSelection, combineMasks, alphaAsMask } from "../selection";

/** Hard edge (no anti-aliasing), full opacity, pressure drives size. */
export class PencilTool implements StrokeTool {
  color: RGBA = [0, 0, 0, 255];
  size = 2;
  /** 1=生の筆圧そのまま、0=常に最大筆圧扱い(筆圧無視)、1超は効果を誇張。設定ダイアログの
   * 「筆圧感知(太さ)」から main.tsがツールインスタンスへ直接設定する。 */
  pressureSensitivity = 1;

  private last: { x: number; y: number } | null = null;

  beginStroke(layer: RasterLayer, x: number, y: number, pressure: number, doc?: Document): void {
    this.last = { x, y };
    this.drawDab(layer, x, y, pressure, doc);
  }

  continueStroke(layer: RasterLayer, x: number, y: number, pressure: number, doc?: Document): void {
    if (!this.last) {
      this.beginStroke(layer, x, y, pressure, doc);
      return;
    }
    const dx = x - this.last.x;
    const dy = y - this.last.y;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / 0.5));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.drawDab(layer, this.last.x + dx * t, this.last.y + dy * t, pressure, doc);
    }
    this.last = { x, y };
  }

  endStroke(): void {
    this.last = null;
  }

  private drawDab(layer: RasterLayer, x: number, y: number, pressure: number, doc?: Document): void {
    const effectivePressure = applyPressureSensitivity(pressure, this.pressureSensitivity);
    const radius = Math.max(0.5, pressureToSize(this.size, effectivePressure) / 2);
    const selMask = doc && maskHasSelection(doc.selectionMask) ? doc.selectionMask : null;
    const alphaMask = layer.alphaLocked ? alphaAsMask(layer.pixels) : null;
    this.stampCircle(layer, x, y, radius, combineMasks(selMask, alphaMask));
  }

  private stampCircle(layer: RasterLayer, cx: number, cy: number, radius: number, mask: SelectionMask | null): void {
    const r2 = radius * radius;
    const minX = Math.floor(cx - radius);
    const maxX = Math.ceil(cx + radius);
    const minY = Math.floor(cy - radius);
    const maxY = Math.ceil(cy + radius);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        if (dx * dx + dy * dy <= r2) setPixel(layer, x, y, this.color, mask);
      }
    }
  }
}
