import { TransformInterpolation } from "@mini-rough/core";
import { TransformSession } from "./transform-session";

export interface TransformPanelSizeContext {
  docWidth: number;
  docHeight: number;
  finalWidth: number;
  finalHeight: number;
}

/** Left-side panel (CLIP STUDIO style) shown while a TransformSession is active: numeric
 * width/height/scale/rotation fields plus a basis checkbox that switches whether the
 * width/height-in-px fields read against the mini working resolution or the final export size. */
export class TransformPanel {
  private readonly container: HTMLElement;
  private session: TransformSession | null = null;
  private ctx: TransformPanelSizeContext = { docWidth: 1, docHeight: 1, finalWidth: 1, finalHeight: 1 };

  private readonly titleEl: HTMLDivElement;
  private readonly scaleRotateFields: HTMLDivElement;
  private readonly widthPxInput: HTMLInputElement;
  private readonly heightPxInput: HTMLInputElement;
  private readonly basisCheckbox: HTMLInputElement;
  private readonly scaleXInput: HTMLInputElement;
  private readonly scaleYInput: HTMLInputElement;
  private readonly rotationInput: HTMLInputElement;
  private readonly interpolationSelect: HTMLSelectElement;
  private readonly applyBtn: HTMLButtonElement;
  private readonly cancelBtn: HTMLButtonElement;

  /** 最後に選んだ補間方式 — 次に変形を始める時もこれを初期値にする(ツール設定の感覚で、
   * 変形ごとに毎回選び直さなくて済むように)。 */
  private lastInterpolation: TransformInterpolation = "bilinear";

  onApply: (() => void) | null = null;
  onCancel: (() => void) | null = null;

  constructor(container: HTMLElement) {
    this.container = container;
    container.innerHTML = "";

    this.titleEl = document.createElement("div");
    this.titleEl.className = "transform-panel-header";
    container.appendChild(this.titleEl);

    this.scaleRotateFields = document.createElement("div");

    const sizeRow = document.createElement("div");
    sizeRow.className = "transform-panel-row";
    const sizeLabel = document.createElement("label");
    sizeLabel.textContent = "幅 × 高さ (px)";
    this.widthPxInput = document.createElement("input");
    this.widthPxInput.type = "number";
    this.widthPxInput.min = "1";
    this.heightPxInput = document.createElement("input");
    this.heightPxInput.type = "number";
    this.heightPxInput.min = "1";
    sizeRow.append(sizeLabel, this.widthPxInput, this.heightPxInput);
    this.scaleRotateFields.appendChild(sizeRow);

    const basisRow = document.createElement("div");
    basisRow.className = "transform-panel-row";
    const basisLabel = document.createElement("label");
    basisLabel.textContent = "完成サイズを基準にする";
    this.basisCheckbox = document.createElement("input");
    this.basisCheckbox.type = "checkbox";
    basisRow.append(basisLabel, this.basisCheckbox);
    this.scaleRotateFields.appendChild(basisRow);

    const hint = document.createElement("div");
    hint.className = "transform-panel-hint";
    hint.textContent = "チェックを外すとミニラフ解像度基準のpx数になります。";
    this.scaleRotateFields.appendChild(hint);

    const scaleSection = document.createElement("div");
    scaleSection.className = "transform-panel-section";
    const scaleRow = document.createElement("div");
    scaleRow.className = "transform-panel-row";
    const scaleLabel = document.createElement("label");
    scaleLabel.textContent = "拡大率 横% / 縦%";
    this.scaleXInput = document.createElement("input");
    this.scaleXInput.type = "number";
    this.scaleXInput.min = "1";
    this.scaleYInput = document.createElement("input");
    this.scaleYInput.type = "number";
    this.scaleYInput.min = "1";
    scaleRow.append(scaleLabel, this.scaleXInput, this.scaleYInput);
    scaleSection.appendChild(scaleRow);

    const rotationRow = document.createElement("div");
    rotationRow.className = "transform-panel-row";
    const rotationLabel = document.createElement("label");
    rotationLabel.textContent = "回転角度(°)";
    this.rotationInput = document.createElement("input");
    this.rotationInput.type = "number";
    this.rotationInput.step = "1";
    rotationRow.append(rotationLabel, this.rotationInput);
    scaleSection.appendChild(rotationRow);
    this.scaleRotateFields.appendChild(scaleSection);

    container.appendChild(this.scaleRotateFields);

    const freeHint = document.createElement("div");
    freeHint.className = "transform-panel-hint free-transform-hint";
    freeHint.textContent = "四隅をドラッグして変形し、内側をドラッグして移動してください。";
    container.appendChild(freeHint);

    // 補間方式(CLIP STUDIOの「拡大・縮小・回転」ダイアログ相当) — 拡大縮小・回転・自由変形の
    // どのモードでも効くので、scaleRotateFields(モード別)の外、常時表示の位置に置く。
    const interpRow = document.createElement("div");
    interpRow.className = "transform-panel-row";
    const interpLabel = document.createElement("label");
    interpLabel.textContent = "補間方式";
    this.interpolationSelect = document.createElement("select");
    const interpOptions: { value: TransformInterpolation; label: string }[] = [
      { value: "bilinear", label: "バイリニア(滑らか)" },
      { value: "nearest", label: "ニアレストネイバー(ハード)" }
    ];
    for (const opt of interpOptions) {
      const el = document.createElement("option");
      el.value = opt.value;
      el.textContent = opt.label;
      this.interpolationSelect.appendChild(el);
    }
    interpRow.append(interpLabel, this.interpolationSelect);
    container.appendChild(interpRow);

    const buttons = document.createElement("div");
    buttons.className = "transform-panel-buttons";
    this.applyBtn = document.createElement("button");
    this.applyBtn.className = "transform-apply-btn";
    this.applyBtn.textContent = "適用";
    this.cancelBtn = document.createElement("button");
    this.cancelBtn.textContent = "キャンセル";
    buttons.append(this.applyBtn, this.cancelBtn);
    container.appendChild(buttons);

    this.applyBtn.addEventListener("click", () => this.onApply?.());
    this.cancelBtn.addEventListener("click", () => this.onCancel?.());
    this.widthPxInput.addEventListener("input", () => this.onWidthPxInput());
    this.heightPxInput.addEventListener("input", () => this.onHeightPxInput());
    this.basisCheckbox.addEventListener("change", () => this.refresh());
    this.scaleXInput.addEventListener("input", () => this.onScaleXInput());
    this.scaleYInput.addEventListener("input", () => this.onScaleYInput());
    this.rotationInput.addEventListener("input", () => this.onRotationInput());
    this.interpolationSelect.addEventListener("change", () => this.onInterpolationInput());
  }

  open(session: TransformSession, ctx: TransformPanelSizeContext): void {
    this.session = session;
    this.ctx = ctx;
    session.interpolation = this.lastInterpolation;
    this.titleEl.textContent = session.mode === "free" ? "自由変形" : "拡大・縮小・回転";
    this.scaleRotateFields.style.display = session.mode === "scaleRotate" ? "" : "none";
    this.container.classList.remove("hidden");
    session.preview();
    this.refresh();
  }

  close(): void {
    this.session = null;
    this.container.classList.add("hidden");
  }

  /** Re-reads the session's current parameters into the numeric fields — called after every
   * handle drag so the panel stays live, not just on open. */
  refresh(): void {
    if (!this.session) return;
    this.interpolationSelect.value = this.session.interpolation;
    if (this.session.mode !== "scaleRotate") return;
    const { w, h } = this.session.getRegionSize();
    const basisX = this.basisCheckbox.checked ? this.ctx.finalWidth / this.ctx.docWidth : 1;
    const basisY = this.basisCheckbox.checked ? this.ctx.finalHeight / this.ctx.docHeight : 1;
    this.widthPxInput.value = String(Math.max(1, Math.round(w * this.session.scaleX * basisX)));
    this.heightPxInput.value = String(Math.max(1, Math.round(h * this.session.scaleY * basisY)));
    this.scaleXInput.value = (this.session.scaleX * 100).toFixed(0);
    this.scaleYInput.value = (this.session.scaleY * 100).toFixed(0);
    this.rotationInput.value = ((this.session.rotation * 180) / Math.PI).toFixed(1);
  }

  private onWidthPxInput(): void {
    if (!this.session) return;
    const { w } = this.session.getRegionSize();
    if (!w) return;
    const basisX = this.basisCheckbox.checked ? this.ctx.finalWidth / this.ctx.docWidth : 1;
    const px = Number(this.widthPxInput.value);
    if (!px) return;
    this.session.scaleX = px / basisX / w;
    this.applyAndRefresh();
  }

  private onHeightPxInput(): void {
    if (!this.session) return;
    const { h } = this.session.getRegionSize();
    if (!h) return;
    const basisY = this.basisCheckbox.checked ? this.ctx.finalHeight / this.ctx.docHeight : 1;
    const px = Number(this.heightPxInput.value);
    if (!px) return;
    this.session.scaleY = px / basisY / h;
    this.applyAndRefresh();
  }

  private onScaleXInput(): void {
    if (!this.session) return;
    const pct = Number(this.scaleXInput.value);
    if (!pct) return;
    this.session.scaleX = pct / 100;
    this.applyAndRefresh();
  }

  private onScaleYInput(): void {
    if (!this.session) return;
    const pct = Number(this.scaleYInput.value);
    if (!pct) return;
    this.session.scaleY = pct / 100;
    this.applyAndRefresh();
  }

  private onRotationInput(): void {
    if (!this.session) return;
    const deg = Number(this.rotationInput.value);
    this.session.rotation = (deg * Math.PI) / 180;
    this.applyAndRefresh();
  }

  private onInterpolationInput(): void {
    if (!this.session) return;
    this.lastInterpolation = this.interpolationSelect.value as TransformInterpolation;
    this.session.interpolation = this.lastInterpolation;
    this.applyAndRefresh();
  }

  private applyAndRefresh(): void {
    this.session?.preview();
    this.refresh();
  }
}
