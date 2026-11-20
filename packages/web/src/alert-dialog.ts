/** window.alert()の代替。Artifactとして公開した際のsandboxed iframe("allow-modals"が
 * 付いていない)では、window.alert/confirm/promptは呼んでも何もせず無視される(エラー内容が
 * 何も表示されないまま終わる) — ConfirmDialogと同じ.modal-overlay/.modal-box方式の
 * 自前ダイアログに置き換える。 */
export class AlertDialog {
  private readonly overlay: HTMLDivElement;
  private readonly messageEl: HTMLParagraphElement;
  private onClose: () => void = () => {};

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";

    const box = document.createElement("div");
    box.className = "modal-box";
    box.innerHTML = `
      <p></p>
      <div class="modal-buttons">
        <button type="button" class="create-btn ok-btn">OK</button>
      </div>
    `;
    this.messageEl = box.querySelector("p")!;
    // window.alert()と同じく、メッセージ中の改行(ファイル一覧の列挙など)をそのまま
    // 改行として見せる。
    this.messageEl.style.whiteSpace = "pre-line";
    this.overlay.appendChild(box);
    document.body.appendChild(this.overlay);

    box.querySelector(".ok-btn")!.addEventListener("click", () => {
      this.hide();
      this.onClose();
    });
  }

  show(message: string, onClose: () => void = () => {}): void {
    this.messageEl.textContent = message;
    this.onClose = onClose;
    this.overlay.classList.add("visible");
  }

  hide(): void {
    this.overlay.classList.remove("visible");
  }
}
