export interface CanvasSizeResult {
  miniWidth: number;
  miniHeight: number;
  finalWidth: number;
  finalHeight: number;
  dpi: number;
}

type Mode = "direct" | "scale";

export class CanvasSizeDialog {
  private readonly overlay: HTMLDivElement;
  private readonly finalWidthInput: HTMLInputElement;
  private readonly finalHeightInput: HTMLInputElement;
  private readonly dpiInput: HTMLInputElement;
  private readonly scaleInput: HTMLInputElement;
  private readonly miniWidthInput: HTMLInputElement;
  private readonly miniHeightInput: HTMLInputElement;
  private readonly directRadio: HTMLInputElement;
  private readonly scaleRadio: HTMLInputElement;
  private readonly scaleResultEl: Element;
  private readonly titleEl: HTMLElement;
  private readonly applyBtn: HTMLButtonElement;
  private onApply: (result: CanvasSizeResult) => void = () => {};

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";

    const box = document.createElement("div");
    box.className = "modal-box";
    box.innerHTML = `
      <h2>キャンバスサイズ</h2>
      <fieldset>
        <legend>完成サイズ</legend>
        <label>幅(px) <input type="number" class="final-width" min="1" /></label>
        <label>高さ(px) <input type="number" class="final-height" min="1" /></label>
        <label>dpi <input type="number" class="dpi" min="1" /></label>
      </fieldset>
      <fieldset>
        <legend>ミニラフ解像度</legend>
        <label><input type="radio" name="size-mode" class="mode-direct" checked /> 直接指定</label>
        <label><input type="radio" name="size-mode" class="mode-scale" /> 完成サイズ×倍率から自動計算</label>
        <div class="direct-fields">
          <label>幅(px) <input type="number" class="mini-width" min="1" /></label>
          <label>高さ(px) <input type="number" class="mini-height" min="1" /></label>
        </div>
        <div class="scale-fields">
          <label>倍率(%) <input type="number" class="scale-percent" min="1" max="100" value="2" /></label>
          <p class="scale-result"></p>
        </div>
      </fieldset>
      <div class="modal-buttons">
        <button type="button" class="cancel-btn">キャンセル</button>
        <button type="button" class="create-btn">適用</button>
      </div>
    `;
    this.overlay.appendChild(box);
    document.body.appendChild(this.overlay);

    this.finalWidthInput = box.querySelector(".final-width")!;
    this.finalHeightInput = box.querySelector(".final-height")!;
    this.dpiInput = box.querySelector(".dpi")!;
    this.scaleInput = box.querySelector(".scale-percent")!;
    this.miniWidthInput = box.querySelector(".mini-width")!;
    this.miniHeightInput = box.querySelector(".mini-height")!;
    this.directRadio = box.querySelector(".mode-direct")!;
    this.scaleRadio = box.querySelector(".mode-scale")!;
    this.scaleResultEl = box.querySelector(".scale-result")!;
    this.titleEl = box.querySelector("h2")!;
    this.applyBtn = box.querySelector(".create-btn")!;

    const updateModeUi = () => {
      const mode = this.currentMode();
      this.miniWidthInput.disabled = mode === "scale";
      this.miniHeightInput.disabled = mode === "scale";
      box.querySelector(".direct-fields")!.classList.toggle("disabled", mode === "scale");
      box.querySelector(".scale-fields")!.classList.toggle("disabled", mode === "direct");
      if (mode === "scale") this.recomputeFromScale();
    };

    this.directRadio.addEventListener("change", updateModeUi);
    this.scaleRadio.addEventListener("change", updateModeUi);
    for (const el of [this.finalWidthInput, this.finalHeightInput, this.scaleInput]) {
      el.addEventListener("input", () => {
        if (this.currentMode() === "scale") this.recomputeFromScale();
      });
    }

    box.querySelector(".cancel-btn")!.addEventListener("click", () => this.hide());
    box.querySelector(".create-btn")!.addEventListener("click", () => this.submit());

    updateModeUi();
  }

  private currentMode(): Mode {
    return this.scaleRadio.checked ? "scale" : "direct";
  }

  private recomputeFromScale(): void {
    const percent = Math.max(1, Math.min(100, Number(this.scaleInput.value) || 1));
    const miniW = Math.max(1, Math.round((Number(this.finalWidthInput.value) * percent) / 100));
    const miniH = Math.max(1, Math.round((Number(this.finalHeightInput.value) * percent) / 100));
    this.miniWidthInput.value = String(miniW);
    this.miniHeightInput.value = String(miniH);
    this.scaleResultEl.textContent = `→ ${miniW} × ${miniH} px`;
  }

  private submit(): void {
    this.onApply({
      miniWidth: Math.max(1, Number(this.miniWidthInput.value) || 1),
      miniHeight: Math.max(1, Number(this.miniHeightInput.value) || 1),
      finalWidth: Math.max(1, Number(this.finalWidthInput.value) || 1),
      finalHeight: Math.max(1, Number(this.finalHeightInput.value) || 1),
      dpi: Math.max(1, Number(this.dpiInput.value) || 350)
    });
    this.hide();
  }

  show(
    initial: CanvasSizeResult,
    onApply: (result: CanvasSizeResult) => void,
    labels?: { title?: string; applyLabel?: string }
  ): void {
    this.onApply = onApply;
    this.titleEl.textContent = labels?.title ?? "キャンバスサイズ";
    this.applyBtn.textContent = labels?.applyLabel ?? "適用";
    this.finalWidthInput.value = String(initial.finalWidth);
    this.finalHeightInput.value = String(initial.finalHeight);
    this.dpiInput.value = String(initial.dpi);
    this.miniWidthInput.value = String(initial.miniWidth);
    this.miniHeightInput.value = String(initial.miniHeight);
    this.directRadio.checked = true;
    this.scaleRadio.checked = false;
    this.miniWidthInput.disabled = false;
    this.miniHeightInput.disabled = false;
    this.overlay.classList.add("visible");
  }

  hide(): void {
    this.overlay.classList.remove("visible");
  }
}
