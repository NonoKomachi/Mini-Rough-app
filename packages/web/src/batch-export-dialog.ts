import { SaveFormat, SaveSize } from "./save-dialog";

export interface BatchExportResult {
  prefix: string;
  start: number;
  digits: number;
  suffix: string;
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

function extensionFor(format: SaveFormat): string {
  return format === "jpeg" ? "jpg" : format;
}

export class BatchExportDialog {
  private readonly overlay: HTMLDivElement;
  private readonly prefixInput: HTMLInputElement;
  private readonly startInput: HTMLInputElement;
  private readonly digitsInput: HTMLInputElement;
  private readonly suffixInput: HTMLInputElement;
  private readonly formatSelect: HTMLSelectElement;
  private readonly sizeFinalRadio: HTMLInputElement;
  private readonly preview: HTMLElement;
  private readonly onExport: (result: BatchExportResult, count: number) => void;
  private count = 0;

  constructor(onExport: (result: BatchExportResult, count: number) => void) {
    this.onExport = onExport;

    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";

    const box = document.createElement("div");
    box.className = "modal-box";
    box.innerHTML = `
      <h2>まとめて書き出し</h2>
      <fieldset>
        <legend>形式</legend>
        <label>ファイル形式 <select class="format"></select></label>
        <label><input type="radio" name="batch-size" class="size-final" checked /> 完成サイズ</label>
        <label><input type="radio" name="batch-size" class="size-mini" /> ミニラフサイズ</label>
      </fieldset>
      <fieldset>
        <legend>ファイル名</legend>
        <label>接頭辞 <input type="text" class="prefix" value="mini-rough" /></label>
        <label>開始番号 <input type="number" class="start" min="0" value="1" /></label>
        <label>桁数 <input type="number" class="digits" min="1" max="6" value="2" /></label>
        <label>接尾詞 <input type="text" class="suffix" value="" /></label>
        <p class="scale-result preview"></p>
      </fieldset>
      <div class="modal-buttons">
        <button type="button" class="cancel-btn">キャンセル</button>
        <button type="button" class="create-btn">保存先を選んで書き出し</button>
      </div>
    `;
    this.overlay.appendChild(box);
    document.body.appendChild(this.overlay);

    this.prefixInput = box.querySelector(".prefix")!;
    this.startInput = box.querySelector(".start")!;
    this.digitsInput = box.querySelector(".digits")!;
    this.suffixInput = box.querySelector(".suffix")!;
    this.preview = box.querySelector(".preview")!;
    this.formatSelect = box.querySelector(".format")!;
    this.sizeFinalRadio = box.querySelector(".size-final")!;

    for (const [value, label] of Object.entries(FORMAT_LABELS)) {
      const opt = document.createElement("option");
      opt.value = value;
      opt.textContent = label;
      this.formatSelect.appendChild(opt);
    }

    for (const el of [this.prefixInput, this.startInput, this.digitsInput, this.suffixInput, this.formatSelect]) {
      el.addEventListener("input", () => this.updatePreview());
    }
    box.querySelectorAll<HTMLInputElement>('input[name="batch-size"]').forEach((el) => {
      el.addEventListener("change", () => this.updatePreview());
    });

    box.querySelector(".cancel-btn")!.addEventListener("click", () => this.hide());
    box.querySelector(".create-btn")!.addEventListener("click", () => {
      this.onExport(this.currentResult(), this.count);
      this.hide();
    });
  }

  private currentResult(): BatchExportResult {
    return {
      prefix: this.prefixInput.value,
      start: Math.max(0, Number(this.startInput.value) || 0),
      digits: Math.max(1, Number(this.digitsInput.value) || 1),
      suffix: this.suffixInput.value,
      format: this.formatSelect.value as SaveFormat,
      size: this.sizeFinalRadio.checked ? { mode: "final" } : { mode: "mini" }
    };
  }

  private updatePreview(): void {
    const r = this.currentResult();
    const ext = extensionFor(r.format);
    const names: string[] = [];
    for (let i = 0; i < Math.min(this.count, 3); i++) {
      names.push(`${r.prefix}${String(r.start + i).padStart(r.digits, "0")}${r.suffix}.${ext}`);
    }
    const more = this.count > 3 ? ` …他${this.count - 3}件` : "";
    this.preview.textContent = names.length ? `${names.join(", ")}${more}` : "";
  }

  show(count: number): void {
    this.count = count;
    this.updatePreview();
    this.overlay.classList.add("visible");
  }

  hide(): void {
    this.overlay.classList.remove("visible");
  }
}
