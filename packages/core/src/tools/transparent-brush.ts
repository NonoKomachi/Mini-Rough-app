import { RasterLayer } from "../document";
import { RGBA, StrokeTool } from "./tool";
import { StrokeCoverage, applyColorStroke, applyEraseStroke } from "./stroke-buffer";
import { pressureToSize, applyPressureSensitivity } from "./pressure";

/** Same soft edge as BrushTool, but pressure also drives per-dab opacity (light touch = more transparent). */
export class TransparentBrushTool implements StrokeTool {
  color: RGBA = [0, 0, 0, 255];
  size = 8;
  /** 太さに対する筆圧感知(1=生の筆圧、0=無視、1超は誇張)。 */
  pressureSensitivity = 1;
  /** 濃さ(不透明度)に対する筆圧感知 — 太さとは別に調整できる。 */
  opacityPressureSensitivity = 1;

  private coverage: StrokeCoverage | null = null;
  private preStroke: Uint8ClampedArray | null = null;
  private last: { x: number; y: number } | null = null;

  beginStroke(layer: RasterLayer, x: number, y: number, pressure: number): void {
    this.coverage = new StrokeCoverage(layer.width, layer.height);
    this.preStroke = layer.pixels.slice();
    this.last = { x, y };
    this.dab(layer, x, y, pressure);
  }

  continueStroke(layer: RasterLayer, x: number, y: number, pressure: number): void {
    if (!this.coverage || !this.preStroke || !this.last) {
      this.beginStroke(layer, x, y, pressure);
      return;
    }
    const dx = x - this.last.x;
    const dy = y - this.last.y;
    const dist = Math.hypot(dx, dy);
    const steps = Math.max(1, Math.ceil(dist / 0.5));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      this.dab(layer, this.last.x + dx * t, this.last.y + dy * t, pressure);
    }
    this.last = { x, y };
  }

  endStroke(): void {
    this.coverage = null;
    this.preStroke = null;
    this.last = null;
  }

  private dab(layer: RasterLayer, x: number, y: number, pressure: number): void {
    const sizePressure = applyPressureSensitivity(pressure, this.pressureSensitivity);
    const radius = pressureToSize(this.size, sizePressure) / 2;
    const intensity = applyPressureSensitivity(pressure, this.opacityPressureSensitivity);
    this.coverage!.stampSoftCircle(x, y, radius, intensity);
    // "Transparent color" (alpha 0) means erase-with-this-shape rather than a (no-op) transparent paint.
    if (this.color[3] === 0) {
      applyEraseStroke(layer, this.preStroke!, this.coverage!.data, 1);
    } else {
      applyColorStroke(layer, this.preStroke!, this.coverage!.data, this.color, 1);
    }
  }
}
