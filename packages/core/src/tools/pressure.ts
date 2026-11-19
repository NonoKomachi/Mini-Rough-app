/** Maps pen pressure (0..1) to an effective size, with a floor so light touches stay visible. */
export function pressureToSize(baseSize: number, pressure: number, minFactor = 0.15): number {
  const p = Math.min(1, Math.max(0, pressure));
  return baseSize * (minFactor + (1 - minFactor) * p);
}

/** Blends raw pen pressure toward/away from "always full pressure" (1) by `sensitivity` —
 * at sensitivity=1 pressure passes through unchanged; at 0 every stroke behaves as if pressure
 * were always 1 (pressure has no effect at all, i.e. ignored); above 1 the effect is amplified
 * (exaggerates how much a given pressure drop shrinks/fades the stroke, beyond what the raw
 * value alone would). Each pressure-aware tool keeps its own `pressureSensitivity` (size) and,
 * for TransparentBrushTool, a separate `opacityPressureSensitivity` — so "how strongly pressure
 * affects width" and "how strongly it affects opacity" can be tuned independently. `sensitivity`
 * itself isn't clamped (so values above 1 amplify), but the result always is, since it feeds
 * back into pressure-shaped math (pressureToSize, stroke opacity) that assumes a 0..1 input. */
export function applyPressureSensitivity(pressure: number, sensitivity: number): number {
  const p = Math.min(1, Math.max(0, pressure));
  const s = Math.max(0, sensitivity);
  return Math.min(1, Math.max(0, 1 - s * (1 - p)));
}
