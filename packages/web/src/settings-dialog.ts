import { AppSettings } from "./app-settings";

/** メニューバーの「設定」から開く環境設定ダイアログ。.mrkの中身ではなくブラウザ単位の好みを
 * 扱うので、保存/読み込みダイアログ群とは独立したこのファイルに置く。項目を変更するたびに
 * 即座にonChangeを呼ぶ(「OK」ボタンで確定する一括適用ではない) — 自動保存の有効/無効のように
 * 今すぐ反映したい設定なので、保留してから一括確定する意味が薄いため。 */
export class SettingsDialog {
  private readonly overlay: HTMLDivElement;
  private readonly autoSaveEnabledCheckbox: HTMLInputElement;
  private readonly autoSaveIntervalInput: HTMLInputElement;
  private readonly defaultLoadMiniRadio: HTMLInputElement;
  private readonly defaultLoadFinalRadio: HTMLInputElement;
  private readonly defaultBrushSizeInput: HTMLInputElement;
  private readonly sizePressureSensitivityInput: HTMLInputElement;
  private readonly opacityPressureSensitivityInput: HTMLInputElement;
  private readonly unsupportedNoticeEl: HTMLElement;
  private onChange: (settings: AppSettings) => void = () => {};
  private current: AppSettings;

  constructor(initial: AppSettings, fileSystemAccessSupported: boolean) {
    this.current = initial;

    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";

    const box = document.createElement("div");
    box.className = "modal-box";
    box.innerHTML = `
      <h2>設定</h2>
      <fieldset>
        <legend>自動保存</legend>
        <label><input type="checkbox" class="auto-save-enabled" /> 一定周期で自動保存する(.mrk)</label>
        <label>周期(分) <input type="number" class="auto-save-interval" min="1" step="1" style="width:4em" /></label>
        <p class="settings-unsupported-notice"></p>
      </fieldset>
      <fieldset>
        <legend>読み込み時のデフォルトサイズ</legend>
        <label><input type="radio" name="settings-default-load-size" class="default-load-mini" /> ミニラフサイズで表示</label>
        <label><input type="radio" name="settings-default-load-size" class="default-load-final" /> 完成サイズで表示</label>
      </fieldset>
      <fieldset>
        <legend>鉛筆の初期サイズ</legend>
        <label>起動時のサイズ(px) <input type="number" class="default-brush-size" min="1" step="1" style="width:4em" /></label>
      </fieldset>
      <fieldset>
        <legend>筆圧感知</legend>
        <label>太さ(%) <input type="number" class="size-pressure-sensitivity" min="0" max="200" step="5" style="width:4em" /></label>
        <label>濃さ(%、透明ブラシのみ) <input type="number" class="opacity-pressure-sensitivity" min="0" max="200" step="5" style="width:4em" /></label>
        <p class="transform-panel-hint">
          0にすると筆圧を無視して常に最大の太さ/濃さになります。100が生の筆圧そのまま(既定)で、
          100を超えると筆圧の効きをより強く誇張します(弱い筆圧がより細く/薄くなる)。
          「濃さ」は透明ブラシの不透明度にのみ効きます(他のツールは太さのみ)。
        </p>
      </fieldset>
      <div class="modal-buttons">
        <button type="button" class="cancel-btn">閉じる</button>
      </div>
    `;
    this.overlay.appendChild(box);
    document.body.appendChild(this.overlay);

    this.autoSaveEnabledCheckbox = box.querySelector(".auto-save-enabled")!;
    this.autoSaveIntervalInput = box.querySelector(".auto-save-interval")!;
    this.defaultLoadMiniRadio = box.querySelector(".default-load-mini")!;
    this.defaultLoadFinalRadio = box.querySelector(".default-load-final")!;
    this.defaultBrushSizeInput = box.querySelector(".default-brush-size")!;
    this.sizePressureSensitivityInput = box.querySelector(".size-pressure-sensitivity")!;
    this.opacityPressureSensitivityInput = box.querySelector(".opacity-pressure-sensitivity")!;
    this.unsupportedNoticeEl = box.querySelector(".settings-unsupported-notice")!;

    if (!fileSystemAccessSupported) {
      this.autoSaveEnabledCheckbox.disabled = true;
      this.autoSaveIntervalInput.disabled = true;
      this.unsupportedNoticeEl.textContent =
        "このブラウザは自動保存(およびアプリを開いた時に前回のファイルを自動で開く機能)に対応していません。";
    }

    this.applyToInputs(this.current);

    const emitChange = (): void => {
      this.current = {
        autoSaveEnabled: this.autoSaveEnabledCheckbox.checked,
        autoSaveIntervalMinutes: Math.max(1, Number(this.autoSaveIntervalInput.value) || 1),
        defaultLoadSize: this.defaultLoadFinalRadio.checked ? "final" : "mini",
        defaultBrushSize: Math.max(1, Number(this.defaultBrushSizeInput.value) || 1),
        sizePressureSensitivityPercent: Math.max(0, Math.min(200, Number(this.sizePressureSensitivityInput.value) || 0)),
        opacityPressureSensitivityPercent: Math.max(0, Math.min(200, Number(this.opacityPressureSensitivityInput.value) || 0))
      };
      this.onChange(this.current);
    };
    this.autoSaveEnabledCheckbox.addEventListener("change", emitChange);
    this.autoSaveIntervalInput.addEventListener("change", emitChange);
    this.defaultLoadMiniRadio.addEventListener("change", emitChange);
    this.defaultLoadFinalRadio.addEventListener("change", emitChange);
    this.defaultBrushSizeInput.addEventListener("change", emitChange);
    this.sizePressureSensitivityInput.addEventListener("change", emitChange);
    this.opacityPressureSensitivityInput.addEventListener("change", emitChange);

    box.querySelector(".cancel-btn")!.addEventListener("click", () => this.hide());
  }

  private applyToInputs(settings: AppSettings): void {
    this.autoSaveEnabledCheckbox.checked = settings.autoSaveEnabled;
    this.autoSaveIntervalInput.value = String(settings.autoSaveIntervalMinutes);
    this.defaultLoadMiniRadio.checked = settings.defaultLoadSize === "mini";
    this.defaultLoadFinalRadio.checked = settings.defaultLoadSize === "final";
    this.defaultBrushSizeInput.value = String(settings.defaultBrushSize);
    this.sizePressureSensitivityInput.value = String(settings.sizePressureSensitivityPercent);
    this.opacityPressureSensitivityInput.value = String(settings.opacityPressureSensitivityPercent);
  }

  /** 設定が変わるたび(ダイアログを開いている間に限らず)呼ばれる。main.ts側で永続化と
   * 自動保存タイマーの再設定を行う。 */
  onSettingsChange(callback: (settings: AppSettings) => void): void {
    this.onChange = callback;
  }

  show(): void {
    this.applyToInputs(this.current);
    this.overlay.classList.add("visible");
  }

  hide(): void {
    this.overlay.classList.remove("visible");
  }
}
