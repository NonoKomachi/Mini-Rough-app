import { RGBA } from "@mini-rough/core";
import { hsvToRgb, rgbToHex, rgbToHsv, checkeredBackgroundImage } from "./color-utils";

const SIZE = 220;
const CENTER = SIZE / 2;
const R_OUTER = SIZE / 2 - 3;
const R_INNER = R_OUTER - 26;
const SQUARE_HALF = R_INNER / Math.SQRT2;

const PRESET_PALETTE = [
  "#000000",
  "#ffffff",
  "#808080",
  "#ff0000",
  "#ff8000",
  "#ffff00",
  "#00ff00",
  "#00ffff",
  "#0080ff",
  "#0000ff",
  "#8000ff",
  "#ff00ff"
];

interface ValueRow {
  row: HTMLDivElement;
  slider: HTMLInputElement;
  numberInput: HTMLInputElement;
  setValue(v: number): void;
}

function createValueRow(label: string, min: number, max: number, onInput: (value: number) => void): ValueRow {
  const row = document.createElement("div");
  row.className = "value-row";
  const labelEl = document.createElement("span");
  labelEl.className = "value-row-label";
  labelEl.textContent = label;
  const slider = document.createElement("input");
  slider.type = "range";
  slider.min = String(min);
  slider.max = String(max);
  const numberInput = document.createElement("input");
  numberInput.type = "number";
  numberInput.min = String(min);
  numberInput.max = String(max);
  numberInput.className = "value-row-number";

  const handle = (v: number) => {
    const clamped = Math.max(min, Math.min(max, v));
    slider.value = String(clamped);
    numberInput.value = String(Math.round(clamped));
    onInput(clamped);
  };
  slider.addEventListener("input", () => handle(Number(slider.value)));
  numberInput.addEventListener("input", () => handle(Number(numberInput.value) || 0));

  row.appendChild(labelEl);
  row.appendChild(slider);
  row.appendChild(numberInput);
  return {
    row,
    slider,
    numberInput,
    setValue(v: number) {
      slider.value = String(v);
      numberInput.value = String(Math.round(v));
    }
  };
}

/** Hue ring + saturation/value square (left, large) + current color/opacity/HSV/RGB sliders
 * (middle) + an editable swatch palette (right). Used inside ColorDialog. */
export class ColorPicker {
  private hue = 0;
  private sat = 0;
  private val = 0;
  private alpha = 255;

  private readonly onChange: (rgba: RGBA) => void;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private ringBase: ImageData | null = null;
  private readonly currentSwatch: HTMLDivElement;
  private readonly opacityRow: ValueRow;
  private readonly hRow: ValueRow;
  private readonly sRow: ValueRow;
  private readonly vRow: ValueRow;
  private readonly rRow: ValueRow;
  private readonly gRow: ValueRow;
  private readonly bRow: ValueRow;
  private readonly paletteGrid: HTMLDivElement;
  private readonly tempPaletteGrid: HTMLDivElement;
  /** 永続(保存用)パレット — プロジェクトファイルに保存・復元される。 */
  private customSwatches: string[] = [];
  /** 一時パレット — 現在の編集セッションのみ有効(新規作成/「開く」でリセット)。プロジェクト
   * ファイルには保存されるが、新規作成時には空に戻る。 */
  private tempSwatches: string[] = [];
  /** 保存用パレットが変化した(追加/編集/削除)たびに通知 — main.ts側がプロジェクト保存用に
   * 最新状態を保持するために使う。 */
  onCustomSwatchesChange: ((swatches: string[]) => void) | null = null;
  /** 一時パレットが変化した時の通知。 */
  onTempSwatchesChange: ((swatches: string[]) => void) | null = null;
  private dragMode: "ring" | "square" | null = null;

  constructor(container: HTMLElement, onChange: (rgba: RGBA) => void) {
    this.onChange = onChange;

    const layout = document.createElement("div");
    layout.className = "color-panel";

    this.canvas = document.createElement("canvas");
    this.canvas.className = "color-wheel";
    this.canvas.width = SIZE;
    this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext("2d")!;
    layout.appendChild(this.canvas);

    const infoColumn = document.createElement("div");
    infoColumn.className = "color-info-column";

    this.currentSwatch = document.createElement("div");
    this.currentSwatch.className = "current-swatch";
    infoColumn.appendChild(this.currentSwatch);

    // スマホ縦長レイアウトでは、ホイール+現在の色の下に3つのタブ(HSVRGBA/パレット/一時パレット)
    // を置いて切り替える(全部縦に並べるとダイアログが縦に長くなりすぎてスクロールが発生していた
    // ため)。PC(横長)ではタブ自体を非表示にし、各.color-tab-panelを常に全部表示する
    // (CSS側: body.portrait-layout等ではなく画面幅のメディアクエリで切り替える — color-panel自体の
    // 横並び/縦積みと同じ基準)。 */
    const tabBar = document.createElement("div");
    tabBar.className = "color-tab-bar";
    infoColumn.appendChild(tabBar);

    const slidersPanel = document.createElement("div");
    slidersPanel.className = "color-tab-panel";
    slidersPanel.dataset.tab = "sliders";
    infoColumn.appendChild(slidersPanel);

    this.opacityRow = createValueRow("不透明度", 0, 100, (percent) => {
      this.alpha = Math.round((percent / 100) * 255);
      this.updateColor();
    });
    slidersPanel.appendChild(this.opacityRow.row);

    this.hRow = createValueRow("H", 0, 360, (v) => this.onHsvInput(v, this.sat, this.val));
    this.sRow = createValueRow("S", 0, 100, (v) => this.onHsvInput(this.hue, v / 100, this.val));
    this.vRow = createValueRow("V", 0, 100, (v) => this.onHsvInput(this.hue, this.sat, v / 100));
    slidersPanel.appendChild(this.hRow.row);
    slidersPanel.appendChild(this.sRow.row);
    slidersPanel.appendChild(this.vRow.row);

    this.rRow = createValueRow("R", 0, 255, (v) => this.onRgbInput(v, this.currentRgb()[1], this.currentRgb()[2]));
    this.gRow = createValueRow("G", 0, 255, (v) => this.onRgbInput(this.currentRgb()[0], v, this.currentRgb()[2]));
    this.bRow = createValueRow("B", 0, 255, (v) => this.onRgbInput(this.currentRgb()[0], this.currentRgb()[1], v));
    slidersPanel.appendChild(this.rRow.row);
    slidersPanel.appendChild(this.gRow.row);
    slidersPanel.appendChild(this.bRow.row);

    layout.appendChild(infoColumn);

    const paletteColumn = document.createElement("div");
    paletteColumn.className = "palette-column";

    const palettePanel = document.createElement("div");
    palettePanel.className = "color-tab-panel";
    palettePanel.dataset.tab = "palette";
    paletteColumn.appendChild(palettePanel);

    const paletteLabel = document.createElement("div");
    paletteLabel.className = "palette-section-label";
    paletteLabel.textContent = "パレット";
    palettePanel.appendChild(paletteLabel);

    this.paletteGrid = document.createElement("div");
    this.paletteGrid.className = "palette-grid";
    palettePanel.appendChild(this.paletteGrid);

    const tempPanel = document.createElement("div");
    tempPanel.className = "color-tab-panel";
    tempPanel.dataset.tab = "temp";
    paletteColumn.appendChild(tempPanel);

    const tempPaletteLabel = document.createElement("div");
    tempPaletteLabel.className = "palette-section-label";
    tempPaletteLabel.textContent = "一時パレット";
    tempPaletteLabel.title = "現在の編集セッションのみ有効(新規作成/「開く」でリセットされます)";
    tempPanel.appendChild(tempPaletteLabel);

    this.tempPaletteGrid = document.createElement("div");
    this.tempPaletteGrid.className = "palette-grid";
    tempPanel.appendChild(this.tempPaletteGrid);

    layout.appendChild(paletteColumn);

    container.appendChild(layout);

    const tabPanels = [slidersPanel, palettePanel, tempPanel];
    const tabDefs: { tab: string; label: string }[] = [
      { tab: "sliders", label: "HSVRGBA" },
      { tab: "palette", label: "パレット" },
      { tab: "temp", label: "一時パレット" }
    ];
    const tabButtons = tabDefs.map(({ tab, label }) => {
      const btn = document.createElement("button");
      btn.className = "color-tab-btn";
      btn.textContent = label;
      btn.addEventListener("click", () => setActiveTab(tab));
      tabBar.appendChild(btn);
      return { tab, btn };
    });
    function setActiveTab(tab: string): void {
      for (const panel of tabPanels) panel.classList.toggle("active", panel.dataset.tab === tab);
      for (const { tab: t, btn } of tabButtons) btn.classList.toggle("active", t === tab);
    }
    setActiveTab("sliders");

    this.canvas.addEventListener("pointerdown", (e) => {
      this.canvas.setPointerCapture(e.pointerId);
      const p = this.toLocal(e);
      // 正方形は輪の内接円(半径R_INNER)に四隅がちょうど収まるサイズなので、正方形の
      // バウンディングボックスそのもので判定すると、正方形と内接円の間にできる4つの
      // 隙間(特に角の近く)が輪(ring)側の判定になってしまい、正方形の端ぎりぎりに
      // カーソルを合わせにくかった。中心からの距離がR_INNER以内かどうかで判定することで、
      // その隙間も含めた内接円全体を正方形側(値は既存のクランプで自動的に端まで)として扱う。
      this.dragMode = Math.hypot(p.x, p.y) <= R_INNER ? "square" : "ring";
      this.handlePointer(p);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.dragMode || !(e.buttons & 1)) return;
      this.handlePointer(this.toLocal(e));
    });
    this.canvas.addEventListener("pointerup", () => {
      this.dragMode = null;
    });

    this.drawRingBase();
    this.redraw();
    this.renderPalette();
    this.renderTempPalette();
    this.updateColor();
  }

  private currentRgb(): [number, number, number] {
    const [r, g, b] = hsvToRgb(this.hue, this.sat, this.val);
    return [Math.round(r), Math.round(g), Math.round(b)];
  }

  private onHsvInput(h: number, s: number, v: number): void {
    this.hue = h;
    this.sat = s;
    this.val = v;
    this.redraw();
    this.updateColor();
  }

  private onRgbInput(r: number, g: number, b: number): void {
    const [h, s, v] = rgbToHsv(r, g, b);
    this.hue = h;
    this.sat = s;
    this.val = v;
    this.hRow.setValue(h);
    this.sRow.setValue(s * 100);
    this.vRow.setValue(v * 100);
    this.redraw();
    this.updateColor();
  }

  private toLocal(e: PointerEvent): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) * SIZE) / rect.width - CENTER;
    const y = ((e.clientY - rect.top) * SIZE) / rect.height - CENTER;
    return { x, y };
  }

  private handlePointer(p: { x: number; y: number }): void {
    if (this.dragMode === "square") {
      const u = Math.min(1, Math.max(0, (p.x + SQUARE_HALF) / (SQUARE_HALF * 2)));
      const v = Math.min(1, Math.max(0, (p.y + SQUARE_HALF) / (SQUARE_HALF * 2)));
      this.sat = u;
      this.val = 1 - v;
    } else {
      this.hue = ((Math.atan2(p.y, p.x) * 180) / Math.PI + 360) % 360;
    }
    this.hRow.setValue(this.hue);
    this.sRow.setValue(this.sat * 100);
    this.vRow.setValue(this.val * 100);
    this.redraw();
    this.updateColor();
  }

  /** The hue ring: static, independent of the current color. */
  private drawRingBase(): void {
    const img = this.ctx.createImageData(SIZE, SIZE);
    for (let y = 0; y < SIZE; y++) {
      for (let x = 0; x < SIZE; x++) {
        const dx = x - CENTER;
        const dy = y - CENTER;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > R_OUTER || dist < R_INNER) continue;
        const idx = (y * SIZE + x) * 4;
        const hue = ((Math.atan2(dy, dx) * 180) / Math.PI + 360) % 360;
        const [r, g, b] = hsvToRgb(hue, 1, 1);
        img.data[idx] = r;
        img.data[idx + 1] = g;
        img.data[idx + 2] = b;
        img.data[idx + 3] = 255;
      }
    }
    this.ringBase = img;
  }

  /** The saturation/value square for the current hue, plus both markers. Redrawn on every change. */
  private redraw(): void {
    if (!this.ringBase) return;
    this.ctx.putImageData(this.ringBase, 0, 0);

    const side = Math.round(SQUARE_HALF * 2);
    const left = Math.round(CENTER - SQUARE_HALF);
    const top = Math.round(CENTER - SQUARE_HALF);
    const square = this.ctx.createImageData(side, side);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const u = x / (side - 1);
        const v = y / (side - 1);
        const [r, g, b] = hsvToRgb(this.hue, u, 1 - v);
        const idx = (y * side + x) * 4;
        square.data[idx] = r;
        square.data[idx + 1] = g;
        square.data[idx + 2] = b;
        square.data[idx + 3] = 255;
      }
    }
    this.ctx.putImageData(square, left, top);

    // putImageDataは枠を描けないので、正方形の縁専用に白いstrokeを重ねる — 彩度/明度が低い
    // (暗い)角では正方形の色自体が周囲のダイアログ背景に溶けて輪郭が見えなくなるため。
    this.ctx.strokeStyle = "#fff";
    this.ctx.lineWidth = 1;
    this.ctx.strokeRect(left + 0.5, top + 0.5, side - 1, side - 1);

    const angle = (this.hue * Math.PI) / 180;
    const ringR = (R_INNER + R_OUTER) / 2;
    this.drawMarker(CENTER + Math.cos(angle) * ringR, CENTER + Math.sin(angle) * ringR);
    this.drawMarker(left + this.sat * side, top + (1 - this.val) * side);
  }

  private drawMarker(x: number, y: number): void {
    this.ctx.beginPath();
    this.ctx.arc(x, y, 6, 0, Math.PI * 2);
    this.ctx.strokeStyle = "#fff";
    this.ctx.lineWidth = 2;
    this.ctx.stroke();
    this.ctx.beginPath();
    this.ctx.arc(x, y, 6, 0, Math.PI * 2);
    this.ctx.strokeStyle = "#000";
    this.ctx.lineWidth = 1;
    this.ctx.stroke();
  }

  private updateColor(): void {
    const [r, g, b] = this.currentRgb();
    // checkeredBackgroundImage()は「色(alpha込み)のレイヤーを市松模様の上に重ねる」もの —
    // element.style.opacityで要素全体を薄めると、同じ要素のbackground-image(市松模様)まで
    // 一緒に薄まってどの不透明度でも市松が透けて見える・色自体も薄汚れて見える不具合になるので
    // 使わない。alphaはレイヤーのrgba()自体に焼き込む。
    this.currentSwatch.style.backgroundImage = checkeredBackgroundImage(r, g, b, this.alpha);
    this.rRow.setValue(r);
    this.gRow.setValue(g);
    this.bRow.setValue(b);
    this.opacityRow.setValue((this.alpha / 255) * 100);
    this.onChange([r, g, b, this.alpha]);
  }

  /** Syncs the wheel/square/opacity to an externally chosen color (e.g. opening the dialog for a swatch). */
  setColor(rgba: RGBA): void {
    const [h, s, v] = rgbToHsv(rgba[0], rgba[1], rgba[2]);
    this.hue = h;
    this.sat = s;
    this.val = v;
    this.alpha = rgba[3];
    this.hRow.setValue(h);
    this.sRow.setValue(s * 100);
    this.vRow.setValue(v * 100);
    this.redraw();
    this.updateColor();
  }

  private renderPalette(): void {
    this.paletteGrid.innerHTML = "";
    for (const hex of PRESET_PALETTE) {
      const btn = document.createElement("button");
      btn.className = "palette-swatch";
      btn.style.background = hex;
      btn.title = hex;
      btn.addEventListener("click", () => {
        const [r, g, b] = hexToRgb(hex);
        this.setColor([r, g, b, this.alpha]);
      });
      this.paletteGrid.appendChild(btn);
    }
    this.appendEditableSwatches(this.paletteGrid, this.customSwatches, "現在の色をパレットに追加", () => {
      this.renderPalette();
      this.onCustomSwatchesChange?.(this.customSwatches);
    });
  }

  private renderTempPalette(): void {
    this.tempPaletteGrid.innerHTML = "";
    this.appendEditableSwatches(this.tempPaletteGrid, this.tempSwatches, "現在の色を一時パレットに追加", () => {
      this.renderTempPalette();
      this.onTempSwatchesChange?.(this.tempSwatches);
    });
  }

  /** Appends an editable swatch row (click=select, dblclick=update to current color,
   * contextmenu=delete) plus a trailing "+" (add current color) to `grid` — shared by the saved
   * and temp palettes. Index-based (not value-based) so two swatches holding the same hex don't
   * get confused with each other on edit/delete. */
  private appendEditableSwatches(grid: HTMLDivElement, swatches: string[], addTitle: string, onChange: () => void): void {
    swatches.forEach((hex, index) => {
      const btn = document.createElement("button");
      btn.className = "palette-swatch";
      btn.style.background = hex;
      btn.title = `${hex}(ダブルクリックで現在の色に更新/右クリックで削除)`;
      btn.addEventListener("click", () => {
        const [r, g, b] = hexToRgb(hex);
        this.setColor([r, g, b, this.alpha]);
      });
      btn.addEventListener("dblclick", (e) => {
        e.preventDefault();
        const [r, g, b] = this.currentRgb();
        swatches[index] = rgbToHex(r, g, b);
        onChange();
      });
      btn.addEventListener("contextmenu", (e) => {
        e.preventDefault();
        swatches.splice(index, 1);
        onChange();
      });
      grid.appendChild(btn);
    });

    const addBtn = document.createElement("button");
    addBtn.className = "palette-swatch add-swatch";
    addBtn.textContent = "+";
    addBtn.title = addTitle;
    addBtn.addEventListener("click", () => {
      const [r, g, b] = this.currentRgb();
      swatches.push(rgbToHex(r, g, b));
      onChange();
    });
    grid.appendChild(addBtn);
  }

  /** Current saved-palette contents, for persisting to a project file. */
  getCustomSwatches(): string[] {
    return [...this.customSwatches];
  }

  /** Replaces the saved palette (e.g. when restoring from a project file). */
  setCustomSwatches(swatches: string[]): void {
    this.customSwatches = [...swatches];
    this.renderPalette();
  }

  /** Current temp-palette contents, for persisting to a project file. */
  getTempSwatches(): string[] {
    return [...this.tempSwatches];
  }

  /** Replaces the temp palette (e.g. when restoring from a project file, or clearing it on
   * 新規作成/開く). */
  setTempSwatches(swatches: string[]): void {
    this.tempSwatches = [...swatches];
    this.renderTempPalette();
  }
}

function hexToRgb(hex: string): [number, number, number] {
  const match = hex.replace("#", "").match(/../g)!;
  return [parseInt(match[0], 16), parseInt(match[1], 16), parseInt(match[2], 16)];
}
