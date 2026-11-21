import { RGBA } from "@mini-rough/core";
import { hsvToRgb, rgbToHex, rgbToHsv, checkeredBackgroundImage } from "./color-utils";

export interface NamedPalette {
  id: string;
  name: string;
  swatches: string[];
}

function createPaletteId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

/** 最初から存在する唯一の「デフォルトパレット」のid固定値。この値のパレットだけ、下の
 * PRESET_PALETTE(12色の既定スウォッチ)を併せて表示する。新規追加(addPalette)・読み込み
 * (addImportedPalette)したパレットはこのidを持たないため、ユーザー要望通り完全に空の
 * 状態から始まる。 */
export const DEFAULT_PALETTE_ID = "default";

export function createEmptyPalette(name: string): NamedPalette {
  return { id: createPaletteId(), name, swatches: [] };
}

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
  private readonly paletteSelect: HTMLSelectElement;
  private readonly tempPaletteGrid: HTMLDivElement;
  /** 永続(保存用)パレット、複数・名前付き — プロジェクトファイルに保存・復元される。
   * プルダウン(paletteSelect)で切り替える、現在表示中のものがactivePaletteId。 */
  private palettes: NamedPalette[] = [{ id: DEFAULT_PALETTE_ID, name: "パレット1", swatches: [] }];
  private activePaletteId: string = this.palettes[0].id;
  /** 一時パレット — 現在の編集セッションのみ有効(新規作成/「開く」でリセット)。プロジェクト
   * ファイルには保存されるが、新規作成時には空に戻る。 */
  private tempSwatches: string[] = [];
  /** 保存用パレットのリスト・切替・内容のいずれかが変化した(追加/削除/改名/並べ替え/編集/
   * 切替)たびに通知 — main.ts側がプロジェクト保存用に最新状態を保持するために使う。 */
  onPalettesChange: ((palettes: NamedPalette[], activePaletteId: string) => void) | null = null;
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

    // 複数の名前付きパレットをここで切り替える(一覧の追加/削除/改名/並べ替えは「パレット」
    // メニューの「パレットの編集」ダイアログで行う — このプルダウンは切替専用)。
    this.paletteSelect = document.createElement("select");
    this.paletteSelect.className = "palette-select";
    this.paletteSelect.addEventListener("change", () => {
      this.activePaletteId = this.paletteSelect.value;
      this.renderPalette();
      this.notifyPalettesChange();
    });
    palettePanel.appendChild(this.paletteSelect);

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

  private activePalette(): NamedPalette {
    return this.palettes.find((p) => p.id === this.activePaletteId) ?? this.palettes[0];
  }

  private notifyPalettesChange(): void {
    this.onPalettesChange?.(this.palettes, this.activePaletteId);
  }

  private renderPalette(): void {
    this.paletteSelect.innerHTML = "";
    for (const palette of this.palettes) {
      const opt = document.createElement("option");
      opt.value = palette.id;
      opt.textContent = palette.name;
      this.paletteSelect.appendChild(opt);
    }
    this.paletteSelect.value = this.activePaletteId;

    this.paletteGrid.innerHTML = "";
    // 既定の12色プリセットは、最初から存在する「デフォルトパレット」でだけ表示する —
    // 新規追加/読み込みしたパレットは完全に空の状態から始めてほしい、というユーザー要望。
    if (this.activePaletteId === DEFAULT_PALETTE_ID) {
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
    }
    const active = this.activePalette();
    this.appendEditableSwatches(this.paletteGrid, active.swatches, "現在の色をパレットに追加", () => {
      this.renderPalette();
      this.notifyPalettesChange();
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

  /** Current palette list, for persisting to a project file / showing in the palette manager. */
  getPalettes(): NamedPalette[] {
    return this.palettes.map((p) => ({ ...p, swatches: [...p.swatches] }));
  }

  getActivePaletteId(): string {
    return this.activePaletteId;
  }

  /** Replaces the whole palette list (e.g. when restoring from a project file). `palettes` must
   * be non-empty — callers fall back to a single default palette otherwise. */
  setPalettes(palettes: NamedPalette[], activePaletteId: string): void {
    this.palettes =
      palettes.length > 0 ? palettes.map((p) => ({ ...p, swatches: [...p.swatches] })) : [{ id: DEFAULT_PALETTE_ID, name: "パレット1", swatches: [] }];
    this.activePaletteId = this.palettes.some((p) => p.id === activePaletteId) ? activePaletteId : this.palettes[0].id;
    this.renderPalette();
  }

  setActivePaletteId(id: string): void {
    if (!this.palettes.some((p) => p.id === id)) return;
    this.activePaletteId = id;
    this.renderPalette();
    this.notifyPalettesChange();
  }

  /** 新規パレットを追加してアクティブにする。 */
  addPalette(name: string): void {
    const palette = createEmptyPalette(name);
    this.palettes.push(palette);
    this.activePaletteId = palette.id;
    this.renderPalette();
    this.notifyPalettesChange();
  }

  /** 読み込んだパレットファイルの内容を新規パレットとして追加してアクティブにする。既存と同名
   * なら「名前(2)」のように連番を付けて区別する。 */
  addImportedPalette(name: string, swatches: string[]): void {
    const existingNames = new Set(this.palettes.map((p) => p.name));
    let uniqueName = name;
    for (let i = 2; existingNames.has(uniqueName); i++) uniqueName = `${name}(${i})`;
    const palette: NamedPalette = { id: createPaletteId(), name: uniqueName, swatches: [...swatches] };
    this.palettes.push(palette);
    this.activePaletteId = palette.id;
    this.renderPalette();
    this.notifyPalettesChange();
  }

  /** 最後の1つは削除できない(常に最低1つのパレットを保つ)。削除したのがアクティブだった場合は
   * 隣(できれば1つ上、無ければ1つ下)をアクティブにする。 */
  removePalette(id: string): void {
    if (this.palettes.length <= 1) return;
    const index = this.palettes.findIndex((p) => p.id === id);
    if (index === -1) return;
    this.palettes.splice(index, 1);
    if (this.activePaletteId === id) {
      this.activePaletteId = this.palettes[Math.min(index, this.palettes.length - 1)].id;
    }
    this.renderPalette();
    this.notifyPalettesChange();
  }

  renamePalette(id: string, name: string): void {
    const palette = this.palettes.find((p) => p.id === id);
    if (!palette || !name.trim()) return;
    palette.name = name.trim();
    this.renderPalette();
    this.notifyPalettesChange();
  }

  /** パレット一覧(プルダウンの並び順)内で1つ上/下に入れ替える。 */
  movePalette(id: string, direction: "up" | "down"): void {
    const index = this.palettes.findIndex((p) => p.id === id);
    const target = direction === "up" ? index - 1 : index + 1;
    if (index === -1 || target < 0 || target >= this.palettes.length) return;
    [this.palettes[index], this.palettes[target]] = [this.palettes[target], this.palettes[index]];
    this.renderPalette();
    this.notifyPalettesChange();
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
