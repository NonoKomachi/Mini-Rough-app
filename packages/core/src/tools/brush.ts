import { Document, RasterLayer } from "../document";
import { RGBA, StrokeTool } from "./tool";
import { StrokeCoverage, applyColorStroke, applyEraseStroke } from "./stroke-buffer";
import { pressureToSize, applyPressureSensitivity } from "./pressure";
import { maskHasSelection } from "../selection";

/** Soft edge, fixed opacity per dab (pressure drives size only). */
export class BrushTool implements StrokeTool {
  color: RGBA = [0, 0, 0, 255];
  size = 8;
  /** 1=生の筆圧そのまま、0=常に最大筆圧扱い(筆圧無視)、1超は効果を誇張。 */
  pressureSensitivity = 1;

  private coverage: StrokeCoverage | null = null;
  private preStroke: Uint8ClampedArray | null = null;
  private last: { x: number; y: number } | null = null;

  beginStroke(layer: RasterLayer, x: number, y: number, pressure: number, doc?: Document): void {
    this.coverage = new StrokeCoverage(layer.width, layer.height);
    this.preStroke = layer.pixels.slice();
    this.last = { x, y };
    this.dab(layer, x, y, pressure, doc);
  }

  continueStroke(layer: RasterLayer, x: number, y: number, pressure: number, doc?: Document): void {
    if (!this.coverage || !this.preStroke || !this.last) {
      this.beginStroke(layer, x, y, pressure, doc);
      return;
    }
    const dx = x - this.last.x;
    const dy = y - this.last.y;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / 0.5));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.dab(layer, this.last.x + dx * t, this.last.y + dy * t, pressure, doc);
    }
    this.last = { x, y };
  }

  endStroke(): void {
    this.coverage = null;
    this.preStroke = null;
    this.last = null;
  }

  private dab(layer: RasterLayer, x: number, y: number, pressure: number, doc?: Document): void {
    const effectivePressure = applyPressureSensitivity(pressure, this.pressureSensitivity);
    const radius = pressureToSize(this.size, effectivePressure) / 2;
    this.coverage!.stampSoftCircle(x, y, radius, 1);
    const mask = doc && maskHasSelection(doc.selectionMask) ? doc.selectionMask : null;
    // "Transparent color" (alpha 0) means erase-with-this-shape rather than a (no-op) transparent paint.
    if (this.color[3] === 0) {
      applyEraseStroke(layer, this.preStroke!, this.coverage!.data, 1, mask);
    } else {
      applyColorStroke(layer, this.preStroke!, this.coverage!.data, this.color, 1, mask);
    }
  }
}
