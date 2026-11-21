import { NamedPalette } from "./color-picker";
import { ConfirmChoice } from "./confirm-dialog";

export interface PaletteManagerActions {
  setActive(id: string): void;
  add(name: string): void;
  remove(id: string): void;
  rename(id: string, name: string): void;
  moveUp(id: string): void;
  moveDown(id: string): void;
}

/** メニュー「パレット」→「パレットの編集」から開く、パレット一覧の管理ダイアログ。一覧の
 * 追加/削除/改名/並べ替え専用 — 色の追加/削除自体はカラー変更ダイアログの「パレット」タブで行う
 * (このダイアログは常に最新の状態をgetState()で取り直して再描画するだけで、状態そのものは
 * ColorPicker/ColorDialogが持つ)。 */
export class PaletteManagerDialog {
  private readonly overlay: HTMLDivElement;
  private readonly listEl: HTMLDivElement;
  private readonly promptRename: (title: string, defaultValue: string, onResult: (value: string | null) => void) => void;
  private readonly confirm: (message: string, onChoice: (choice: ConfirmChoice) => void) => void;
  private getState: () => { palettes: NamedPalette[]; activeId: string } = () => ({ palettes: [], activeId: "" });
  private actions: PaletteManagerActions = {
    setActive: () => {},
    add: () => {},
    remove: () => {},
    rename: () => {},
    moveUp: () => {},
    moveDown: () => {}
  };

  constructor(
    promptRename: (title: string, defaultValue: string, onResult: (value: string | null) => void) => void,
    confirm: (message: string, onChoice: (choice: ConfirmChoice) => void) => void
  ) {
    this.promptRename = promptRename;
    this.confirm = confirm;

    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";

    const box = document.createElement("div");
    box.className = "modal-box palette-manager-box";
    box.innerHTML = `
      <h2>パレットの編集</h2>
      <div class="palette-manager-list"></div>
      <div class="modal-buttons">
        <button type="button" class="palette-manager-add-btn">+ 新規パレット</button>
        <button type="button" class="cancel-btn">閉じる</button>
      </div>
    `;
    this.listEl = box.querySelector(".palette-manager-list")!;
    box.querySelector(".cancel-btn")!.addEventListener("click", () => this.hide());
    box.querySelector(".palette-manager-add-btn")!.addEventListener("click", () => {
      const count = this.getState().palettes.length;
      this.promptRename("新規パレット名", `パレット${count + 1}`, (name) => {
        if (!name || !name.trim()) return;
        this.actions.add(name.trim());
        this.render();
      });
    });

    this.overlay.appendChild(box);
    document.body.appendChild(this.overlay);
  }

  /** `getState`は呼ぶたびに最新の一覧を返す関数(main.ts側でcolorDialog.getPalettes()等を
   * ラップしたもの) — 行の操作のたびにこちらから呼び直して再描画するので、呼び出し元は
   * このダイアログを開いている間の状態同期を気にしなくて良い。 */
  show(getState: () => { palettes: NamedPalette[]; activeId: string }, actions: PaletteManagerActions): void {
    this.getState = getState;
    this.actions = actions;
    this.render();
    // 全ての.modal-overlayは同じz-indexなので、DOM上で最後の子である方が上に重なる。
    document.body.appendChild(this.overlay);
    this.overlay.classList.add("visible");
  }

  hide(): void {
    this.overlay.classList.remove("visible");
  }

  private render(): void {
    const { palettes, activeId } = this.getState();
    this.listEl.innerHTML = "";
    palettes.forEach((palette, index) => {
      const row = document.createElement("div");
      row.className = "palette-manager-row";
      if (palette.id === activeId) row.classList.add("active");

      const nameBtn = document.createElement("button");
      nameBtn.className = "palette-manager-name";
      nameBtn.textContent = `${palette.name}(${palette.swatches.length}色)`;
      nameBtn.title = "クリックでこのパレットに切り替え/ダブルクリックで名前を変更";
      nameBtn.addEventListener("click", () => {
        this.actions.setActive(palette.id);
        this.render();
      });
      nameBtn.addEventListener("dblclick", () => {
        this.promptRename("パレット名を変更", palette.name, (name) => {
          if (!name || !name.trim()) return;
          this.actions.rename(palette.id, name.trim());
          this.render();
        });
      });
      row.appendChild(nameBtn);

      const upBtn = document.createElement("button");
      upBtn.className = "icon-btn";
      upBtn.textContent = "↑";
      upBtn.title = "上へ";
      upBtn.disabled = index === 0;
      upBtn.addEventListener("click", () => {
        this.actions.moveUp(palette.id);
        this.render();
      });
      row.appendChild(upBtn);

      const downBtn = document.createElement("button");
      downBtn.className = "icon-btn";
      downBtn.textContent = "↓";
      downBtn.title = "下へ";
      downBtn.disabled = index === palettes.length - 1;
      downBtn.addEventListener("click", () => {
        this.actions.moveDown(palette.id);
        this.render();
      });
      row.appendChild(downBtn);

      const deleteBtn = document.createElement("button");
      deleteBtn.className = "icon-btn";
      deleteBtn.textContent = "✕";
      deleteBtn.title = "削除";
      deleteBtn.disabled = palettes.length <= 1;
      deleteBtn.addEventListener("click", () => {
        this.confirm(`パレット「${palette.name}」を削除しますか?`, (choice) => {
          if (choice !== "confirm") return;
          this.actions.remove(palette.id);
          this.render();
        });
      });
      row.appendChild(deleteBtn);

      this.listEl.appendChild(row);
    });
  }
}
