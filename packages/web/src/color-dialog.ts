import { RGBA } from "@mini-rough/core";
import { ColorPicker } from "./color-picker";

export class ColorDialog {
  private readonly overlay: HTMLDivElement;
  private readonly titleEl: HTMLHeadingElement;
  private readonly picker: ColorPicker;
  private onChange: (rgba: RGBA) => void = () => {};

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";

    const box = document.createElement("div");
    box.className = "modal-box color-dialog-box";

    this.titleEl = document.createElement("h2");
    this.titleEl.textContent = "色を変更";
    box.appendChild(this.titleEl);

    const pickerHost = document.createElement("div");
    box.appendChild(pickerHost);
    this.picker = new ColorPicker(pickerHost, (rgba) => this.onChange(rgba));

    const buttons = document.createElement("div");
    buttons.className = "modal-buttons";
    const closeBtn = document.createElement("button");
    closeBtn.className = "create-btn";
    closeBtn.textContent = "閉じる";
    closeBtn.addEventListener("click", () => this.hide());
    buttons.appendChild(closeBtn);
    box.appendChild(buttons);

    this.overlay.appendChild(box);
    document.body.appendChild(this.overlay);
  }

  /** Opens the dialog editing `initial`, calling `onChange` live as the user adjusts it. */
  open(title: string, initial: RGBA, onChange: (rgba: RGBA) => void): void {
    this.titleEl.textContent = title;
    this.onChange = onChange;
    this.picker.setColor(initial);
    this.overlay.classList.add("visible");
  }

  hide(): void {
    this.overlay.classList.remove("visible");
  }

  /** Transparent pass-throughs to the single shared ColorPicker's palette state — used by
   * main.ts to persist/restore palettes with a project file and to reset the temp palette on
   * 新規作成/開く. */
  getCustomSwatches(): string[] {
    return this.picker.getCustomSwatches();
  }

  setCustomSwatches(swatches: string[]): void {
    this.picker.setCustomSwatches(swatches);
  }

  getTempSwatches(): string[] {
    return this.picker.getTempSwatches();
  }

  setTempSwatches(swatches: string[]): void {
    this.picker.setTempSwatches(swatches);
  }

  onPaletteChange(handler: (kind: "custom" | "temp", swatches: string[]) => void): void {
    this.picker.onCustomSwatchesChange = (swatches) => handler("custom", swatches);
    this.picker.onTempSwatchesChange = (swatches) => handler("temp", swatches);
  }
}
