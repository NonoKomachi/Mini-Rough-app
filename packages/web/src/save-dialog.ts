export type SaveFormat = "clip" | "psd" | "png" | "jpeg" | "bmp" | "gif";

/** 書き出しサイズ。"mini"/"final"はドキュメント自体のミニラフ/完成サイズにそのまま従うが、
 * "custom"はそのどちらとも独立に、好きなピクセルサイズを直接指定できる(ユーザー要望)。 */
export type SaveSize = { mode: "mini" } | { mode: "final" } | { mode: "custom"; width: number; height: number };

export interface SaveResult {
  format: SaveFormat;
  size: SaveSize;
}

/** ダイアログを開く時点のドキュメントサイズ — カスタムサイズ欄の初期値や、完成/ミニラフの
 * 実ピクセル数を見せるラベルに使う。 */
export interface SaveSizeContext {
  miniWidth: number;
  miniHeight: number;
  finalWidth: number;
  finalHeight: number;
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
  private readonly sizeMiniRadio: HTMLInputElement;
  private readonly sizeCustomRadio: HTMLInputElement;
  private readonly customWidthInput: HTMLInputElement;
  private readonly customHeightInput: HTMLInputElement;
  private readonly customFieldsEl: Element;
  private readonly finalLabelEl: Element;
  private readonly miniLabelEl: Element;
  /** カスタムサイズ欄の縦横比(幅/高さ) — ダイアログを開いた時点のミニラフ解像度から固定する
   * (ユーザー要望: カスタムサイズは縦横比固定)。片方を編集すると、もう片方をこの比率に
   * 合わせて自動的に計算し直す。 */
  private customAspectRatio = 1;
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
        <label><input type="radio" name="save-size" class="size-final" checked /> <span class="final-label">完成サイズ</span></label>
        <label><input type="radio" name="save-size" class="size-mini" /> <span class="mini-label">ミニラフサイズ</span></label>
        <label><input type="radio" name="save-size" class="size-custom" /> カスタムサイズ</label>
        <div class="custom-size-fields disabled">
          <label>幅(px) <input type="number" class="custom-width" min="1" /></label>
          <label>高さ(px) <input type="number" class="custom-height" min="1" /></label>
        </div>
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
    this.sizeMiniRadio = box.querySelector(".size-mini")!;
    this.sizeCustomRadio = box.querySelector(".size-custom")!;
    this.customWidthInput = box.querySelector(".custom-width")!;
    this.customHeightInput = box.querySelector(".custom-height")!;
    this.customFieldsEl = box.querySelector(".custom-size-fields")!;
    this.finalLabelEl = box.querySelector(".final-label")!;
    this.miniLabelEl = box.querySelector(".mini-label")!;

    const updateCustomFieldsUi = () => {
      this.customFieldsEl.classList.toggle("disabled", !this.sizeCustomRadio.checked);
    };
    for (const radio of [this.sizeFinalRadio, this.sizeMiniRadio, this.sizeCustomRadio]) {
      radio.addEventListener("change", updateCustomFieldsUi);
    }

    // 縦横比固定: 片方を編集したら、もう片方をcustomAspectRatioに合わせて自動計算し直す。
    // 編集した側のinput自身は上書きしない(入力中にカーソル位置が飛ぶ/末尾の0が消える等の
    // 違和感を避けるため)。
    this.customWidthInput.addEventListener("input", () => {
      const width = Math.max(1, Math.round(Number(this.customWidthInput.value) || 1));
      this.customHeightInput.value = String(Math.max(1, Math.round(width / this.customAspectRatio)));
    });
    this.customHeightInput.addEventListener("input", () => {
      const height = Math.max(1, Math.round(Number(this.customHeightInput.value) || 1));
      this.customWidthInput.value = String(Math.max(1, Math.round(height * this.customAspectRatio)));
    });

    box.querySelector(".cancel-btn")!.addEventListener("click", () => this.hide());
    box.querySelector(".create-btn")!.addEventListener("click", () => {
      this.onSave({
        format: this.formatSelect.value as SaveFormat,
        size: this.currentSize()
      });
      this.hide();
    });
  }

  private currentSize(): SaveSize {
    if (this.sizeCustomRadio.checked) {
      return {
        mode: "custom",
        width: Math.max(1, Math.round(Number(this.customWidthInput.value) || 1)),
        height: Math.max(1, Math.round(Number(this.customHeightInput.value) || 1))
      };
    }
    return { mode: this.sizeFinalRadio.checked ? "final" : "mini" };
  }

  show(context: SaveSizeContext, onSave: (result: SaveResult) => void): void {
    this.onSave = onSave;
    this.finalLabelEl.textContent = `完成サイズ (${context.finalWidth} × ${context.finalHeight} px)`;
    this.miniLabelEl.textContent = `ミニラフサイズ (${context.miniWidth} × ${context.miniHeight} px)`;
    // カスタム欄の初期値はミニラフ解像度 — 完成サイズ/ミニラフどちらとも独立に、ここから
    // 自由に書き換えて使ってもらう想定(ユーザー要望)。縦横比もこの時点の値で固定する。
    this.customAspectRatio = context.miniWidth / context.miniHeight;
    this.customWidthInput.value = String(context.miniWidth);
    this.customHeightInput.value = String(context.miniHeight);
    this.sizeFinalRadio.checked = true;
    this.customFieldsEl.classList.add("disabled");
    this.overlay.classList.add("visible");
  }

  hide(): void {
    this.overlay.classList.remove("visible");
  }
}
