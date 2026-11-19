export type SaveFormat = "clip" | "psd" | "png" | "jpeg" | "bmp" | "gif";
export type SaveSize = "final" | "mini";

export interface SaveResult {
  format: SaveFormat;
  size: SaveSize;
}

const FORMAT_LABELS: Record<SaveFormat, string> = {
  clip: ".clip (CLIP STUDIO)",
  psd: ".psd (Photoshop)",
  png: ".png",
  jpeg: ".jpg",
  bmp: ".bmp",
  gif: ".gif"
};

export class SaveDialog {
  private readonly overlay: HTMLDivElement;
  private readonly formatSelect: HTMLSelectElement;
  private readonly sizeFinalRadio: HTMLInputElement;
  private onSave: (result: SaveResult) => void = () => {};

  constructor(title = "出力") {
    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";

    const box = document.createElement("div");
    box.className = "modal-box";
    box.innerHTML = `
      <h2>${title}</h2>
      <fieldset>
        <legend>形式</legend>
        <label>ファイル形式 <select class="format"></select></label>
      </fieldset>
      <fieldset>
        <legend>サイズ</legend>
        <label><input type="radio" name="save-size" class="size-final" checked /> 完成サイズ</label>
        <label><input type="radio" name="save-size" class="size-mini" /> ミニラフサイズ</label>
      </fieldset>
      <div class="modal-buttons">
        <button type="button" class="cancel-btn">キャンセル</button>
        <button type="button" class="create-btn">保存</button>
      </div>
    `;
    this.overlay.appendChild(box);
    document.body.appendChild(this.overlay);

    this.formatSelect = box.querySelector(".format")!;
    for (const [value, label] of Object.entries(FORMAT_LABELS)) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      this.formatSelect.appendChild(opt);
    }
    this.sizeFinalRadio = box.querySelector(".size-final")!;

    box.querySelector(".cancel-btn")!.addEventListener("click", () => this.hide());
    box.querySelector(".create-btn")!.addEventListener("click", () => {
      this.onSave({
        format: this.formatSelect.value as SaveFormat,
        size: this.sizeFinalRadio.checked ? "final" : "mini"
      });
      this.hide();
    });
  }

  show(onSave: (result: SaveResult) => void): void {
    this.onSave = onSave;
    this.overlay.classList.add("visible");
  }

  hide(): void {
    this.overlay.classList.remove("visible");
  }
}
