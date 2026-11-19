export interface NewDocumentResult {
  miniWidth: number;
  miniHeight: number;
  finalWidth: number;
  finalHeight: number;
  dpi: number;
}

type Mode = "direct" | "scale";

export class NewDocumentDialog {
  private readonly overlay: HTMLDivElement;
  private readonly finalWidthInput: HTMLInputElement;
  private readonly finalHeightInput: HTMLInputElement;
  private readonly dpiInput: HTMLInputElement;
  private readonly scaleInput: HTMLInputElement;
  private readonly miniWidthInput: HTMLInputElement;
  private readonly miniHeightInput: HTMLInputElement;
  private readonly directRadio: HTMLInputElement;
  private readonly scaleRadio: HTMLInputElement;
  private readonly onCreate: (result: NewDocumentResult) => void;

  constructor(onCreate: (result: NewDocumentResult) => void) {
    this.onCreate = onCreate;

    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";

    const box = document.createElement("div");
    box.className = "modal-box";
    box.innerHTML = `
      <h2>新規キャンバス</h2>
      <fieldset>
        <legend>完成サイズ(クリスタへの書き出し先)</legend>
        <label>幅(px) <input type="number" class="final-width" min="1" value="3000" /></label>
        <label>高さ(px) <input type="number" class="final-height" min="1" value="2500" /></label>
        <label>dpi <input type="number" class="dpi" min="1" value="350" /></label>
      </fieldset>
      <fieldset>
        <legend>ミニラフ解像度</legend>
        <label><input type="radio" name="res-mode" class="mode-direct" checked /> 直接指定</label>
        <label><input type="radio" name="res-mode" class="mode-scale" /> 完成サイズ×倍率から自動計算</label>
        <div class="direct-fields">
          <label>幅(px) <input type="number" class="mini-width" min="1" value="60" /></label>
          <label>高さ(px) <input type="number" class="mini-height" min="1" value="50" /></label>
        </div>
        <div class="scale-fields">
          <label>倍率(%) <input type="number" class="scale-percent" min="1" max="100" value="2" /></label>
          <p class="scale-result"></p>
        </div>
      </fieldset>
      <div class="modal-buttons">
        <button type="button" class="cancel-btn">キャンセル</button>
        <button type="button" class="create-btn">作成</button>
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

    const scaleResult = box.querySelector(".scale-result")!;
    const updateModeUi = () => {
      const mode = this.currentMode();
      this.miniWidthInput.disabled = mode === "scale";
      this.miniHeightInput.disabled = mode === "scale";
      box.querySelector(".direct-fields")!.classList.toggle("disabled", mode === "scale");
      box.querySelector(".scale-fields")!.classList.toggle("disabled", mode === "direct");
      if (mode === "scale") this.recomputeFromScale(scaleResult);
    };

    this.directRadio.addEventListener("change", updateModeUi);
    this.scaleRadio.addEventListener("change", updateModeUi);
    for (const el of [this.finalWidthInput, this.finalHeightInput, this.scaleInput]) {
      el.addEventListener("input", () => {
        if (this.currentMode() === "scale") this.recomputeFromScale(scaleResult);
      });
    }

    box.querySelector(".cancel-btn")!.addEventListener("click", () => this.hide());
    box.querySelector(".create-btn")!.addEventListener("click", () => this.submit());

    updateModeUi();
  }

  private currentMode(): Mode {
    return this.scaleRadio.checked ? "scale" : "direct";
  }

  private recomputeFromScale(resultEl: Element): void {
    const percent = Math.max(1, Math.min(100, Number(this.scaleInput.value) || 1));
    const miniW = Math.max(1, Math.round((Number(this.finalWidthInput.value) * percent) / 100));
    const miniH = Math.max(1, Math.round((Number(this.finalHeightInput.value) * percent) / 100));
    this.miniWidthInput.value = String(miniW);
    this.miniHeightInput.value = String(miniH);
    resultEl.textContent = `→ ${miniW} × ${miniH} px`;
  }

  private submit(): void {
    this.onCreate({
      miniWidth: Math.max(1, Number(this.miniWidthInput.value) || 1),
      miniHeight: Math.max(1, Number(this.miniHeightInput.value) || 1),
      finalWidth: Math.max(1, Number(this.finalWidthInput.value) || 1),
      finalHeight: Math.max(1, Number(this.finalHeightInput.value) || 1),
      dpi: Math.max(1, Number(this.dpiInput.value) || 350)
    });
    this.hide();
  }

  show(): void {
    this.overlay.classList.add("visible");
  }

  hide(): void {
    this.overlay.classList.remove("visible");
  }
}
