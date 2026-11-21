export type ConfirmChoice = "confirm" | "cancel";

/** window.confirm()の代替。Artifactとして公開した際のsandboxed iframe("allow-modals"が
 * 付いていない)では、window.confirm/alert/promptは呼んでも何もせず無視され、常にfalsy相当の
 * 値を返す — バリエーション削除のような破壊的操作の確認がこの環境では一切効かなくなって
 * しまっていた(「キャンセル」を選んだのと同じ扱いになり、削除が実行されない)。
 * UnsavedChangesDialogと同じ.modal-overlay/.modal-box方式の自前ダイアログに置き換える。 */
export class ConfirmDialog {
  private readonly overlay: HTMLDivElement;
  private readonly titleEl: HTMLHeadingElement;
  private readonly messageEl: HTMLParagraphElement;
  private readonly confirmBtn: HTMLButtonElement;
  private onChoice: (choice: ConfirmChoice) => void = () => {};

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";

    const box = document.createElement("div");
    box.className = "modal-box";
    box.innerHTML = `
      <h2></h2>
      <p></p>
      <div class="modal-buttons">
        <button type="button" class="cancel-btn">キャンセル</button>
        <button type="button" class="create-btn confirm-btn"></button>
      </div>
    `;
    this.titleEl = box.querySelector("h2")!;
    this.messageEl = box.querySelector("p")!;
    this.confirmBtn = box.querySelector(".confirm-btn")!;
    this.overlay.appendChild(box);
    document.body.appendChild(this.overlay);

    box.querySelector(".cancel-btn")!.addEventListener("click", () => {
      this.hide();
      this.onChoice("cancel");
    });
    this.confirmBtn.addEventListener("click", () => {
      this.hide();
      this.onChoice("confirm");
    });
  }

  show(
    message: string,
    onChoice: (choice: ConfirmChoice) => void,
    options?: { title?: string; confirmLabel?: string }
  ): void {
    this.titleEl.textContent = options?.title ?? "確認";
    this.messageEl.textContent = message;
    this.confirmBtn.textContent = options?.confirmLabel ?? "OK";
    this.onChoice = onChoice;
    // 既に開いている別のダイアログ(パレット管理ダイアログ等)より手前に出す — 全ての
    // .modal-overlayは同じz-indexなので、DOM上で最後の子である方が上に重なる。
    document.body.appendChild(this.overlay);
    this.overlay.classList.add("visible");
  }

  hide(): void {
    this.overlay.classList.remove("visible");
  }
}
