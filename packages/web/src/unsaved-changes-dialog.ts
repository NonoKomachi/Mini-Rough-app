export type UnsavedChangesChoice = "save" | "discard" | "cancel";

/** Shown by 「閉じる」 when there are unsaved changes — three-way choice (window.confirm only
 * offers two), so the user can save the project file without having to cancel, go find the
 * ファイル→保存 menu item, and then close again. */
export class UnsavedChangesDialog {
  private readonly overlay: HTMLDivElement;
  private onChoice: (choice: UnsavedChangesChoice) => void = () => {};

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";

    const box = document.createElement("div");
    box.className = "modal-box";
    box.innerHTML = `
      <h2>保存されていない変更があります</h2>
      <p>閉じる前にプロジェクトを保存しますか？</p>
      <div class="modal-buttons">
        <button type="button" class="cancel-btn">キャンセル</button>
        <button type="button" class="discard-btn">保存せずに閉じる</button>
        <button type="button" class="create-btn">保存して閉じる</button>
      </div>
    `;
    this.overlay.appendChild(box);
    document.body.appendChild(this.overlay);

    box.querySelector(".cancel-btn")!.addEventListener("click", () => {
      this.hide();
      this.onChoice("cancel");
    });
    box.querySelector(".discard-btn")!.addEventListener("click", () => {
      this.hide();
      this.onChoice("discard");
    });
    box.querySelector(".create-btn")!.addEventListener("click", () => {
      this.hide();
      this.onChoice("save");
    });
  }

  show(onChoice: (choice: UnsavedChangesChoice) => void): void {
    this.onChoice = onChoice;
    this.overlay.classList.add("visible");
  }

  hide(): void {
    this.overlay.classList.remove("visible");
  }
}
