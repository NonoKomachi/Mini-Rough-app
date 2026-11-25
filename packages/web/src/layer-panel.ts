import { Document, LayerNode, BLEND_MODE_OPTIONS, mergeLayerDown } from "@mini-rough/core";

// 絵文字は機種(OS/フォント)で見た目が変わるため、レイヤーパネルのアイコンも自前のSVGで統一する。
const PAGE_ICON_SVG = `
<svg viewBox="0 0 16 16" width="14" height="14" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 1.5 H10 L13 4.5 V14 A1 1 0 0 1 12 15 H4 A1 1 0 0 1 3 14 V2.5 A1 1 0 0 1 4 1.5 Z" fill="#ffffff" stroke="#333333" stroke-width="1"/>
  <path d="M10 1.5 V4.5 H13" fill="none" stroke="#333333" stroke-width="1"/>
</svg>`;

const FOLDER_ICON_SVG = `
<svg viewBox="0 0 16 16" width="14" height="14" xmlns="http://www.w3.org/2000/svg">
  <path d="M1.5 4 A1 1 0 0 1 2.5 3 H6 L7.3 4.3 H13.5 A1 1 0 0 1 14.5 5.3 V12 A1 1 0 0 1 13.5 13 H2.5 A1 1 0 0 1 1.5 12 Z" fill="#f2c14e" stroke="#333333" stroke-width="1"/>
</svg>`;

const EYE_ICON_SVG = `
<svg viewBox="0 0 16 16" width="14" height="14" xmlns="http://www.w3.org/2000/svg">
  <path d="M1 8 C3 4.5 6 3 8 3 C10 3 13 4.5 15 8 C13 11.5 10 13 8 13 C6 13 3 11.5 1 8 Z" fill="#eeeeee" stroke="#333333" stroke-width="1"/>
  <circle cx="8" cy="8" r="2.3" fill="#333333"/>
</svg>`;

const EYE_OFF_ICON_SVG = `
<svg viewBox="0 0 16 16" width="14" height="14" xmlns="http://www.w3.org/2000/svg">
  <path d="M1 8 C3 4.5 6 3 8 3 C10 3 13 4.5 15 8 C13 11.5 10 13 8 13 C6 13 3 11.5 1 8 Z" fill="none" stroke="#777777" stroke-width="1"/>
  <line x1="1.5" y1="2.5" x2="14.5" y2="13.5" stroke="#333333" stroke-width="1.3"/>
</svg>`;

const MASK_ICON_SVG = `
<svg viewBox="0 0 16 16" width="13" height="13" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="1" width="14" height="14" rx="2" fill="#ffffff" stroke="#333333" stroke-width="1"/>
  <circle cx="8" cy="8" r="4.5" fill="#888888"/>
</svg>`;

// 下のレイヤーへクリッピングしていることを示す、下向きの矢印アイコン。
// CLIP STUDIOのクリッピングアイコンと同じ構図: 2枚の四角がずれて重なり、下(赤)・
// 重なり部分(青)・上の重ならない部分(灰)の3色に見える。
const CLIP_ICON_SVG = `
<svg viewBox="0 0 16 16" width="13" height="13" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="5" width="8" height="8" rx="1" fill="#e24b4a" stroke="#333333" stroke-width="0.6"/>
  <rect x="6" y="3" width="8" height="8" rx="1" fill="#9a9a9a" stroke="#333333" stroke-width="0.6"/>
  <rect x="6" y="5" width="4" height="6" fill="#3b82f6"/>
</svg>`;

// 「透明ピクセルをロック」: 市松模様(透明の表現)+南京錠。CLIP STUDIOの同機能と同じ発想の
// アイコン(錠がかかっている=既存の不透明部分の外には描けない、という意味を示す)。
const ALPHA_LOCK_ICON_SVG = `
<svg viewBox="0 0 16 16" width="13" height="13" xmlns="http://www.w3.org/2000/svg">
  <rect x="1" y="6.5" width="14" height="8" rx="1" fill="#ffffff" stroke="#333333" stroke-width="1"/>
  <rect x="1" y="6.5" width="7" height="4" fill="#bbbbbb"/>
  <rect x="8" y="10.5" width="7" height="4" fill="#bbbbbb"/>
  <path d="M5 7 V4.6 A3 3 0 0 1 11 4.6 V7" fill="none" stroke="#333333" stroke-width="1.3"/>
  <rect x="6.3" y="9" width="3.4" height="3" rx="0.6" fill="#f2c14e" stroke="#333333" stroke-width="0.8"/>
</svg>`;

// フォルダーの開閉トグル。閉じている間は右向き、開いている間は下向きの三角。
const FOLDER_EXPAND_ICON_SVG = `
<svg viewBox="0 0 16 16" width="10" height="10" xmlns="http://www.w3.org/2000/svg">
  <path d="M4 2 L12 8 L4 14 Z" fill="#cccccc"/>
</svg>`;

const FOLDER_COLLAPSE_ICON_SVG = `
<svg viewBox="0 0 16 16" width="10" height="10" xmlns="http://www.w3.org/2000/svg">
  <path d="M2 4 L14 4 L8 12 Z" fill="#cccccc"/>
</svg>`;

// 2枚の用紙が奥行き方向に重なった、一般的な「複製」アイコン。
const DUPLICATE_ICON_SVG = `
<svg viewBox="0 0 16 16" width="13" height="13" xmlns="http://www.w3.org/2000/svg">
  <path d="M5.5 1.5 H10 L12.5 4 V11 A1 1 0 0 1 11.5 12 H5.5 A1 1 0 0 1 4.5 11 V2.5 A1 1 0 0 1 5.5 1.5 Z" fill="#cfcfcf" stroke="#333333" stroke-width="0.8"/>
  <path d="M10 1.5 V4 H12.5" fill="none" stroke="#333333" stroke-width="0.8"/>
  <path d="M2.5 4.5 H7 L9.5 7 V13.5 A1 1 0 0 1 8.5 14.5 H2.5 A1 1 0 0 1 1.5 13.5 V5.5 A1 1 0 0 1 2.5 4.5 Z" fill="#ffffff" stroke="#333333" stroke-width="0.8"/>
  <path d="M7 4.5 V7 H9.5" fill="none" stroke="#333333" stroke-width="0.8"/>
</svg>`;

// 上下2枚の用紙が1枚に統合されることを示す、下向き矢印付きの「結合」アイコン。
const MERGE_DOWN_ICON_SVG = `
<svg viewBox="0 0 16 16" width="13" height="13" xmlns="http://www.w3.org/2000/svg">
  <rect x="2" y="1" width="12" height="4.5" rx="1" fill="#ffffff" stroke="#333333" stroke-width="1"/>
  <rect x="2" y="10.5" width="12" height="4.5" rx="1" fill="#cfcfcf" stroke="#333333" stroke-width="1"/>
  <path d="M8 5.6 V9.4 M5.6 7.2 L8 9.6 L10.4 7.2" fill="none" stroke="#333333" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;

export class LayerPanel {
  private readonly container: HTMLElement;
  private readonly doc: Document;
  private readonly onChange: () => void;
  private readonly onBeforeChange: () => void;
  private readonly promptRename: (title: string, defaultValue: string, onResult: (value: string | null) => void) => void;
  private readonly listEl: HTMLDivElement;
  private readonly opacityInput: HTMLInputElement;
  private readonly opacityValue: HTMLInputElement;
  private readonly blendModeSelect: HTMLSelectElement;
  private readonly maskBtn: HTMLButtonElement;
  private readonly clipBtn: HTMLButtonElement;
  private readonly alphaLockBtn: HTMLButtonElement;
  private readonly duplicateBtn: HTMLButtonElement;
  private readonly mergeDownBtn: HTMLButtonElement;
  /** Set once a drag gesture has moved past the threshold and is actually reordering a layer —
   * null while just tracking a pointerdown that might turn out to be a plain tap/click instead. */
  private draggingId: string | null = null;
  /** id of the row a pointerdown started on, tracked from the moment of pointerdown (before we
   * know whether it'll become a real drag) through to pointerup/pointercancel. */
  private dragCandidateId: string | null = null;
  private dragStartX = 0;
  private dragStartY = 0;
  /** Row metadata keyed by element, refreshed on every render() — lets drag handlers look up
   * whichever row the pointer is CURRENTLY over (via elementFromPoint), not just the row that
   * originally received the pointerdown (pointer capture routes all further events to that row
   * alone, so we can't rely on the hovered row's own listeners firing). */
  private readonly rowMeta = new Map<HTMLElement, { id: string; parentId: string | null; index: number; kind: LayerNode["kind"] }>();
  /** フォルダーの開閉はドキュメントの内容ではなく、このパネルだけの表示状態 — 保存ファイルには
   * 含めない(セッションごとにリセットされる)。既定は全て開いた状態なので、ここにはユーザーが
   * 閉じたフォルダーのidだけが入る。 */
  private readonly collapsedFolderIds = new Set<string>();

  constructor(
    container: HTMLElement,
    doc: Document,
    onChange: () => void,
    onBeforeChange: () => void,
    promptRename: (title: string, defaultValue: string, onResult: (value: string | null) => void) => void
  ) {
    this.container = container;
    this.doc = doc;
    this.onChange = onChange;
    this.onBeforeChange = onBeforeChange;
    this.promptRename = promptRename;

    const header = document.createElement("div");
    header.className = "layer-panel-header";
    header.textContent = "レイヤー";
    this.container.appendChild(header);

    const toolbar = document.createElement("div");
    toolbar.className = "layer-panel-toolbar";

    const addLayerBtn = document.createElement("button");
    addLayerBtn.innerHTML = PAGE_ICON_SVG;
    addLayerBtn.title = "レイヤー追加";
    addLayerBtn.addEventListener("click", () => {
      this.onBeforeChange();
      this.doc.addLayer();
      this.refresh();
    });

    const addFolderBtn = document.createElement("button");
    addFolderBtn.innerHTML = FOLDER_ICON_SVG;
    addFolderBtn.title = "フォルダー追加";
    addFolderBtn.addEventListener("click", () => {
      this.onBeforeChange();
      this.doc.addFolder();
      this.refresh();
    });

    this.maskBtn = document.createElement("button");
    this.maskBtn.innerHTML = MASK_ICON_SVG;
    this.maskBtn.title = "レイヤーマスクを追加/削除";
    this.maskBtn.addEventListener("click", () => {
      const node = this.activeNode();
      if (!node || node.kind !== "layer") return;
      this.onBeforeChange();
      if (node.mask) {
        if (this.doc.maskPaintLayerId === node.id) this.doc.maskPaintLayerId = null;
        node.removeMask();
      } else {
        node.addMask();
      }
      this.refresh();
    });

    this.clipBtn = document.createElement("button");
    this.clipBtn.innerHTML = CLIP_ICON_SVG;
    this.clipBtn.title = "下のレイヤーでクリッピング";
    this.clipBtn.addEventListener("click", () => {
      const node = this.activeNode();
      if (!node || node.kind !== "layer") return;
      this.onBeforeChange();
      node.clipToBelow = !node.clipToBelow;
      this.refresh();
    });

    this.alphaLockBtn = document.createElement("button");
    this.alphaLockBtn.innerHTML = ALPHA_LOCK_ICON_SVG;
    this.alphaLockBtn.title = "透明ピクセルをロック(既に不透明な部分にしか描画/塗りつぶしできなくなります)";
    this.alphaLockBtn.addEventListener("click", () => {
      const node = this.activeNode();
      if (!node || node.kind !== "layer") return;
      this.onBeforeChange();
      node.alphaLocked = !node.alphaLocked;
      this.refresh();
    });

    this.duplicateBtn = document.createElement("button");
    this.duplicateBtn.innerHTML = DUPLICATE_ICON_SVG;
    this.duplicateBtn.title = "レイヤー/フォルダーを複製";
    this.duplicateBtn.addEventListener("click", () => {
      if (!this.doc.activeLayerId) return;
      this.onBeforeChange();
      this.doc.duplicateNode(this.doc.activeLayerId);
      this.refresh();
    });

    this.mergeDownBtn = document.createElement("button");
    this.mergeDownBtn.innerHTML = MERGE_DOWN_ICON_SVG;
    this.mergeDownBtn.title = "下のレイヤーと結合";
    this.mergeDownBtn.addEventListener("click", () => {
      const node = this.activeNode();
      if (!node || node.kind !== "layer") return;
      const below = this.doc.nodeBelow(node.id);
      if (!below || below.kind !== "layer") return;
      this.onBeforeChange();
      mergeLayerDown(this.doc, node.id);
      this.refresh();
    });

    const spacer = document.createElement("span");
    spacer.className = "spacer";

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "✕";
    deleteBtn.title = "現在のレイヤー/フォルダーを削除";
    deleteBtn.addEventListener("click", () => {
      if (!this.doc.activeLayerId) return;
      this.onBeforeChange();
      this.doc.deleteNode(this.doc.activeLayerId);
      this.refresh();
    });

    toolbar.appendChild(addLayerBtn);
    toolbar.appendChild(addFolderBtn);
    toolbar.appendChild(this.maskBtn);
    toolbar.appendChild(this.clipBtn);
    toolbar.appendChild(this.alphaLockBtn);
    toolbar.appendChild(this.duplicateBtn);
    toolbar.appendChild(this.mergeDownBtn);
    toolbar.appendChild(spacer);
    toolbar.appendChild(deleteBtn);
    this.container.appendChild(toolbar);

    const opacityRow = document.createElement("div");
    opacityRow.className = "layer-panel-opacity";
    const opacityLabel = document.createElement("span");
    opacityLabel.textContent = "不透明度";
    this.opacityInput = document.createElement("input");
    this.opacityInput.type = "range";
    this.opacityInput.min = "0";
    this.opacityInput.max = "100";
    // 不透明度は数値でも直接指定できるように、スライダーと相互に同期する編集可能な数値入力にする
    // (以前は読み取り専用のspanだった)。
    this.opacityValue = document.createElement("input");
    this.opacityValue.type = "number";
    this.opacityValue.className = "value";
    this.opacityValue.min = "0";
    this.opacityValue.max = "100";
    this.opacityInput.addEventListener("pointerdown", () => this.onBeforeChange());
    this.opacityInput.addEventListener("input", () => {
      const node = this.activeNode();
      if (!node) return;
      node.opacity = Number(this.opacityInput.value) / 100;
      this.opacityValue.value = this.opacityInput.value;
      this.onChange();
    });
    this.opacityValue.addEventListener("focus", () => this.onBeforeChange());
    this.opacityValue.addEventListener("input", () => {
      const node = this.activeNode();
      if (!node) return;
      const raw = Number(this.opacityValue.value);
      if (!Number.isFinite(raw)) return;
      const pct = Math.max(0, Math.min(100, Math.round(raw)));
      node.opacity = pct / 100;
      this.opacityInput.value = String(pct);
      this.onChange();
    });
    // フォーカスを外した時点で、空欄や範囲外の入力を実際の値へ揃え直す(入力中は上のinput
    // ハンドラが範囲外のままでも一旦許容しているため)。
    this.opacityValue.addEventListener("blur", () => {
      this.opacityValue.value = this.opacityInput.value;
    });
    opacityRow.appendChild(opacityLabel);
    opacityRow.appendChild(this.opacityInput);
    opacityRow.appendChild(this.opacityValue);
    this.container.appendChild(opacityRow);

    const blendModeRow = document.createElement("div");
    blendModeRow.className = "layer-panel-blend-mode";
    const blendModeLabel = document.createElement("span");
    blendModeLabel.textContent = "合成モード";
    this.blendModeSelect = document.createElement("select");
    for (const option of BLEND_MODE_OPTIONS) {
      const optionEl = document.createElement("option");
      optionEl.value = String(option.value);
      optionEl.textContent = option.label;
      this.blendModeSelect.appendChild(optionEl);
    }
    this.blendModeSelect.addEventListener("change", () => {
      const node = this.activeNode();
      if (!node || node.kind !== "layer") return;
      this.onBeforeChange();
      node.blendMode = Number(this.blendModeSelect.value);
      this.onChange();
    });
    blendModeRow.appendChild(blendModeLabel);
    blendModeRow.appendChild(this.blendModeSelect);
    this.container.appendChild(blendModeRow);

    this.listEl = document.createElement("div");
    this.listEl.className = "layer-panel-list";
    this.container.appendChild(this.listEl);

    this.render();
  }

  private activeNode(): LayerNode | undefined {
    const id = this.doc.activeLayerId;
    return id ? this.doc.findNode(id) : undefined;
  }

  private refresh(): void {
    this.render();
    this.onChange();
  }

  /** どのレイヤーをアクティブ/マスク編集対象にするかの切替専用 — 合成結果(表示されている画像)
   * 自体は変わらないので、this.onChange()(= widget.render()、キャンバスの全レイヤー再合成)を
   * 呼ばない。レイヤー数の多い大きな画像では再合成が数百ms〜1秒近くかかることがあり、単に
   * レイヤーを選ぶだけの操作でそれを毎回払うとクリックの度にUIが固まって見える原因になっていた。 */
  private refreshSelectionOnly(): void {
    this.render();
  }

  render(): void {
    this.listEl.innerHTML = "";
    this.rowMeta.clear();
    this.renderNodes(this.doc.layers, null, 0, this.listEl);

    const active = this.activeNode();
    const hasActive = !!active;
    this.opacityInput.disabled = !hasActive;
    this.opacityValue.disabled = !hasActive;
    const pct = hasActive ? Math.round(active!.opacity * 100) : 0;
    this.opacityInput.value = String(pct);
    this.opacityValue.value = hasActive ? String(pct) : "";

    const activeLayer = active?.kind === "layer" ? active : undefined;
    this.maskBtn.disabled = !activeLayer;
    this.clipBtn.disabled = !activeLayer;
    this.alphaLockBtn.disabled = !activeLayer;
    this.duplicateBtn.disabled = !hasActive;
    const belowNode = activeLayer ? this.doc.nodeBelow(activeLayer.id) : undefined;
    this.mergeDownBtn.disabled = !activeLayer || !belowNode || belowNode.kind !== "layer";
    this.maskBtn.classList.toggle("active", !!activeLayer?.mask);
    this.clipBtn.classList.toggle("active", !!activeLayer?.clipToBelow);
    this.alphaLockBtn.classList.toggle("active", !!activeLayer?.alphaLocked);
    this.blendModeSelect.disabled = !activeLayer;
    this.blendModeSelect.value = String(activeLayer?.blendMode ?? 0);
  }

  /** Top-most layer drawn first (nodes are stored bottom-most-first); `parentId` is this array's owner folder (null = root). */
  private renderNodes(nodes: LayerNode[], parentId: string | null, depth: number, parentEl: HTMLElement): void {
    for (let i = nodes.length - 1; i >= 0; i--) {
      const node = nodes[i];
      parentEl.appendChild(this.renderRow(node, parentId, nodes, i, depth));
      if (node.kind === "folder" && !this.collapsedFolderIds.has(node.id)) {
        this.renderNodes(node.children, node.id, depth + 1, parentEl);
      }
    }
  }

  private renderRow(node: LayerNode, parentId: string | null, siblings: LayerNode[], index: number, depth: number): HTMLElement {
    const row = document.createElement("div");
    row.className = "layer-row";
    row.style.paddingLeft = `${depth * 16}px`;
    if (node.id === this.doc.activeLayerId) {
      row.classList.add("active");
    }
    this.rowMeta.set(row, { id: node.id, parentId, index, kind: node.kind });

    if (node.kind === "folder") {
      const collapsed = this.collapsedFolderIds.has(node.id);
      const toggleBtn = document.createElement("button");
      toggleBtn.className = "folder-toggle-btn";
      toggleBtn.innerHTML = collapsed ? FOLDER_EXPAND_ICON_SVG : FOLDER_COLLAPSE_ICON_SVG;
      toggleBtn.title = collapsed ? "フォルダーを開く" : "フォルダーを閉じる";
      toggleBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (collapsed) this.collapsedFolderIds.delete(node.id);
        else this.collapsedFolderIds.add(node.id);
        this.render();
      });
      row.appendChild(toggleBtn);
    } else {
      const toggleSpacer = document.createElement("span");
      toggleSpacer.className = "folder-toggle-spacer";
      row.appendChild(toggleSpacer);
    }

    const visibleBtn = document.createElement("button");
    visibleBtn.className = "icon-btn";
    visibleBtn.innerHTML = node.visible ? EYE_ICON_SVG : EYE_OFF_ICON_SVG;
    visibleBtn.title = "表示切替";
    visibleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      this.onBeforeChange();
      node.visible = !node.visible;
      this.refresh();
    });
    row.appendChild(visibleBtn);

    const nameEl = document.createElement("span");
    nameEl.className = "layer-name";
    const rowIcon = document.createElement("span");
    rowIcon.className = "layer-row-icon";
    rowIcon.innerHTML = node.kind === "folder" ? FOLDER_ICON_SVG : PAGE_ICON_SVG;
    const rowLabel = document.createElement("span");
    rowLabel.textContent = node.name;
    nameEl.appendChild(rowIcon);
    nameEl.appendChild(rowLabel);
    nameEl.addEventListener("click", () => {
      this.doc.activeLayerId = node.id;
      this.refreshSelectionOnly();
    });
    nameEl.addEventListener("dblclick", (e) => {
      e.stopPropagation();
      this.promptRename(node.kind === "folder" ? "フォルダー名を変更" : "レイヤー名を変更", node.name, (next) => {
        if (next && next.trim()) {
          this.onBeforeChange();
          node.name = next.trim();
          this.refreshSelectionOnly();
        }
      });
    });
    row.appendChild(nameEl);

    if (node.kind === "layer" && node.clipToBelow) {
      const clipIndicator = document.createElement("span");
      clipIndicator.className = "clip-indicator";
      clipIndicator.innerHTML = CLIP_ICON_SVG;
      clipIndicator.title = "下のレイヤーでクリッピング中";
      row.appendChild(clipIndicator);
    }

    if (node.kind === "layer" && node.mask) {
      const maskIndicator = document.createElement("button");
      maskIndicator.className = "icon-btn mask-indicator";
      maskIndicator.innerHTML = MASK_ICON_SVG;
      maskIndicator.title = "クリックでマスクを編集";
      if (this.doc.maskPaintLayerId === node.id) maskIndicator.classList.add("active");
      maskIndicator.addEventListener("click", (e) => {
        e.stopPropagation();
        this.doc.activeLayerId = node.id;
        this.doc.maskPaintLayerId = this.doc.maskPaintLayerId === node.id ? null : node.id;
        this.refreshSelectionOnly();
      });
      row.appendChild(maskIndicator);
    }

    // Pointer Events (not native HTML5 drag-and-drop / `draggable`) so reordering works with a
    // pen/stylus, not just the mouse — Chromium doesn't reliably fire dragstart for pointerType
    // "pen", but pointerdown/move/up fire uniformly for mouse, pen, and touch alike.
    row.style.touchAction = "none";
    row.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;
      this.dragCandidateId = node.id;
      this.dragStartX = e.clientX;
      this.dragStartY = e.clientY;
      // setPointerCaptureはここでは呼ばない — Chromeは captured pointer の以降の
      // mouseup/clickをcapture元の要素(row)へ丸ごと retarget するため、pointerdown時点で
      // 無条件にcaptureすると、しきい値未満の「タップ」まで含めて全クリックがrowに吸われ、
      // nameEl/visibleBtn/maskIndicatorなど子要素自身のclickリスナーが一切発火しなくなる
      // (レイヤーをクリックしても選択が切り替わらない、表示切替ボタンが反応しない、等の原因)。
      // ドラッグしきい値を実際に超えた時点(下のpointermove)でのみcaptureする。
    });
    row.addEventListener("pointermove", (e) => {
      if (this.dragCandidateId !== node.id) return;
      if (!this.draggingId) {
        // Below the threshold this is still just a (possible) tap — don't hijack it as a drag,
        // so the plain click-to-select / dblclick-to-rename handlers on nameEl keep working.
        if (Math.hypot(e.clientX - this.dragStartX, e.clientY - this.dragStartY) < 4) return;
        this.draggingId = node.id;
        row.classList.add("dragging");
        row.setPointerCapture(e.pointerId);
      }
      e.preventDefault();
      this.clearDragHints();
      const targetEl = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(".layer-row") as HTMLElement | null;
      if (!targetEl) return;
      const meta = this.rowMeta.get(targetEl);
      if (!meta || meta.id === this.draggingId) return;
      const rect = targetEl.getBoundingClientRect();
      const lowerHalf = e.clientY - rect.top > rect.height / 2;
      targetEl.classList.add(lowerHalf && meta.kind === "folder" ? "drag-over-inside" : lowerHalf ? "drag-over-after" : "drag-over");
    });
    const endDrag = (e: PointerEvent): void => {
      if (this.dragCandidateId !== node.id) return;
      row.releasePointerCapture(e.pointerId);
      this.dragCandidateId = null;
      row.classList.remove("dragging");
      const draggedId = this.draggingId;
      this.draggingId = null;
      this.clearDragHints();
      if (!draggedId) return; // never crossed the drag threshold — treat as a plain tap
      const targetEl = (document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null)?.closest(".layer-row") as HTMLElement | null;
      const meta = targetEl ? this.rowMeta.get(targetEl) : undefined;
      if (!meta || meta.id === draggedId) return;
      this.onBeforeChange();
      const rect = targetEl!.getBoundingClientRect();
      const lowerHalf = e.clientY - rect.top > rect.height / 2;
      if (lowerHalf && meta.kind === "folder") {
        const folderNode = this.doc.findNode(meta.id);
        if (folderNode && folderNode.kind === "folder") this.doc.moveNodeTo(draggedId, meta.id, folderNode.children.length);
      } else {
        this.doc.moveNodeTo(draggedId, meta.parentId, lowerHalf ? meta.index : meta.index + 1);
      }
      this.refresh();
    };
    row.addEventListener("pointerup", endDrag);
    row.addEventListener("pointercancel", endDrag);

    return row;
  }

  private clearDragHints(): void {
    this.listEl.querySelectorAll(".drag-over, .drag-over-after, .drag-over-inside").forEach((el) => {
      el.classList.remove("drag-over", "drag-over-after", "drag-over-inside");
    });
  }
}
