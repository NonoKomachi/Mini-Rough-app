import { AppSettings } from "./app-settings";
import { DriveAccountState } from "./google-drive";

export interface DriveActions {
  connect(): void;
  disconnect(): void;
  changeFolder(): void;
  reauthorize(): void;
}

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
  private readonly driveStatusEl: HTMLElement;
  private readonly driveConnectBtn: HTMLButtonElement;
  private readonly driveChangeFolderBtn: HTMLButtonElement;
  private readonly driveDisconnectBtn: HTMLButtonElement;
  private readonly driveReauthorizeBtn: HTMLButtonElement;
  private readonly driveActions: DriveActions;
  private readonly driveConfigured: boolean;
  private onChange: (settings: AppSettings) => void = () => {};
  private current: AppSettings;

  constructor(initial: AppSettings, fileSystemAccessSupported: boolean, driveConfigured: boolean, driveActions: DriveActions) {
    this.current = initial;
    this.driveActions = driveActions;
    this.driveConfigured = driveConfigured;

    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";

    const box = document.createElement("div");
    box.className = "modal-box settings-dialog-box";
    box.innerHTML = `
      <h2>設定</h2>
      <div class="settings-layout">
        <div class="settings-sidebar">
          <button type="button" class="settings-nav-btn active" data-panel="save">保存</button>
          <button type="button" class="settings-nav-btn" data-panel="display">表示</button>
          <button type="button" class="settings-nav-btn" data-panel="tools">ツール</button>
        </div>
        <div class="settings-panels">
          <div class="settings-panel active" data-panel="save">
            <fieldset>
              <legend>自動保存</legend>
              <label><input type="checkbox" class="auto-save-enabled" /> 一定周期で自動保存する(.mrk)</label>
              <label>周期(分) <input type="number" class="auto-save-interval" min="1" step="1" style="width:4em" /></label>
              <p class="settings-unsupported-notice"></p>
            </fieldset>
            <fieldset>
              <legend>Google Drive連携</legend>
              <p class="drive-status"></p>
              <div class="modal-buttons" style="margin-top:0">
                <button type="button" class="drive-connect-btn">連携する</button>
                <button type="button" class="drive-reauthorize-btn">再ログイン</button>
                <button type="button" class="drive-change-folder-btn">フォルダを変更</button>
                <button type="button" class="drive-disconnect-btn">連携を解除</button>
              </div>
              <p class="transform-panel-hint">
                連携すると、パレット・環境設定・作業中のプロジェクトをGoogle Drive上の「ミニラフ小町」
                フォルダへ自動で同期します(編集のたびに数秒後、バックグラウンドで)。別の端末で同じ
                アカウントで連携すると、同じ内容が引き継がれます。
              </p>
            </fieldset>
          </div>
          <div class="settings-panel" data-panel="display">
            <fieldset>
              <legend>読み込み時のデフォルトサイズ</legend>
              <label><input type="radio" name="settings-default-load-size" class="default-load-mini" /> ミニラフサイズで表示</label>
              <label><input type="radio" name="settings-default-load-size" class="default-load-final" /> 完成サイズで表示</label>
            </fieldset>
          </div>
          <div class="settings-panel" data-panel="tools">
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
          </div>
        </div>
      </div>
      <div class="modal-buttons">
        <button type="button" class="cancel-btn">閉じる</button>
      </div>
    `;
    this.overlay.appendChild(box);
    document.body.appendChild(this.overlay);

    const navButtons = Array.from(box.querySelectorAll<HTMLButtonElement>(".settings-nav-btn"));
    const panels = Array.from(box.querySelectorAll<HTMLDivElement>(".settings-panel"));
    for (const btn of navButtons) {
      btn.addEventListener("click", () => {
        for (const b of navButtons) b.classList.toggle("active", b === btn);
        for (const panel of panels) panel.classList.toggle("active", panel.dataset.panel === btn.dataset.panel);
      });
    }

    this.autoSaveEnabledCheckbox = box.querySelector(".auto-save-enabled")!;
    this.autoSaveIntervalInput = box.querySelector(".auto-save-interval")!;
    this.defaultLoadMiniRadio = box.querySelector(".default-load-mini")!;
    this.defaultLoadFinalRadio = box.querySelector(".default-load-final")!;
    this.defaultBrushSizeInput = box.querySelector(".default-brush-size")!;
    this.sizePressureSensitivityInput = box.querySelector(".size-pressure-sensitivity")!;
    this.opacityPressureSensitivityInput = box.querySelector(".opacity-pressure-sensitivity")!;
    this.unsupportedNoticeEl = box.querySelector(".settings-unsupported-notice")!;
    this.driveStatusEl = box.querySelector(".drive-status")!;
    this.driveConnectBtn = box.querySelector(".drive-connect-btn")!;
    this.driveReauthorizeBtn = box.querySelector(".drive-reauthorize-btn")!;
    this.driveChangeFolderBtn = box.querySelector(".drive-change-folder-btn")!;
    this.driveDisconnectBtn = box.querySelector(".drive-disconnect-btn")!;
    this.driveConnectBtn.addEventListener("click", () => this.driveActions.connect());
    this.driveReauthorizeBtn.addEventListener("click", () => this.driveActions.reauthorize());
    this.driveChangeFolderBtn.addEventListener("click", () => this.driveActions.changeFolder());
    this.driveDisconnectBtn.addEventListener("click", () => this.driveActions.disconnect());

    if (!driveConfigured) {
      this.driveStatusEl.textContent = "この配信ではGoogle Drive連携を利用できません(未設定)。";
      for (const btn of [this.driveConnectBtn, this.driveReauthorizeBtn, this.driveChangeFolderBtn, this.driveDisconnectBtn]) {
        btn.style.display = "none";
      }
    }

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

  /** Google Driveから設定を取り込んだ時など、外部要因でAppSettingsが変わった時に使う —
   * emitChange(onChange呼び出し)は発火しない(無限ループ防止、呼び出し元が既に保存済みのため)。 */
  setSettings(settings: AppSettings): void {
    this.current = settings;
    this.applyToInputs(settings);
  }

  /** main.ts側がgoogle-drive.tsのonDriveStateChangeから受け取った最新状態をそのまま渡す —
   * ダイアログが開いていない間の状態変化も反映できるよう、表示ボタンの出し分けだけでなく
   * ステータス文言もここで作る。 */
  updateDriveState(state: DriveAccountState): void {
    if (!this.driveConfigured) return;
    if (!state.connected) {
      this.driveStatusEl.textContent = "未連携";
    } else if (state.needsReauth) {
      this.driveStatusEl.textContent = `${state.email}(再ログインが必要です)`;
    } else {
      this.driveStatusEl.textContent = `連携済み: ${state.email}(フォルダ: ${state.folderName})`;
    }
    this.driveConnectBtn.style.display = state.connected ? "none" : "";
    this.driveReauthorizeBtn.style.display = state.connected && state.needsReauth ? "" : "none";
    this.driveChangeFolderBtn.style.display = state.connected ? "" : "none";
    this.driveDisconnectBtn.style.display = state.connected ? "" : "none";
  }

  show(): void {
    this.applyToInputs(this.current);
    this.overlay.classList.add("visible");
  }

  hide(): void {
    this.overlay.classList.remove("visible");
  }
}
