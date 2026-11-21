/** window.prompt()の代替。Artifactとして公開した際のsandboxed iframe("allow-modals"が
 * 付いていない)では、window.prompt/alert/confirmは呼んでも何もせず無視される(常にnull相当) —
 * ConfirmDialogと同じ.modal-overlay/.modal-box方式の自前ダイアログに置き換える。 */
export class PromptDialog {
  private readonly overlay: HTMLDivElement;
  private readonly titleEl: HTMLHeadingElement;
  private readonly inputEl: HTMLInputElement;
  private onResult: (value: string | null) => void = () => {};

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";

    const box = document.createElement("div");
    box.className = "modal-box";
    box.innerHTML = `
      <h2></h2>
      <input type="text" />
      <div class="modal-buttons">
        <button type="button" class="cancel-btn">キャンセル</button>
        <button type="button" class="create-btn ok-btn">OK</button>
      </div>
    `;
    this.titleEl = box.querySelector("h2")!;
    this.inputEl = box.querySelector("input")!;
    // .modal-box input[type="text"]の既定幅(110px)はレイヤー/フォルダー名の入力には狭すぎるため、
    // このダイアログだけ箱の幅いっぱいまで広げる。
    this.inputEl.style.width = "100%";
    this.inputEl.style.boxSizing = "border-box";
    this.inputEl.style.marginBottom = "4px";
    this.overlay.appendChild(box);
    document.body.appendChild(this.overlay);

    box.querySelector(".cancel-btn")!.addEventListener("click", () => this.cancel());
    box.querySelector(".ok-btn")!.addEventListener("click", () => this.submit());
    this.inputEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        this.submit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        this.cancel();
      }
    });
  }

  show(title: string, defaultValue: string, onResult: (value: string | null) => void): void {
    this.titleEl.textContent = title;
    this.inputEl.value = defaultValue;
    this.onResult = onResult;
    // 既に開いている別のダイアログ(パレット管理ダイアログ等)より手前に出す — 全ての
    // .modal-overlayは同じz-indexなので、DOM上で最後の子である方が上に重なる。これが無いと、
    // パレット管理ダイアログの「+ 新規パレット」から開いた時にこのダイアログが背後に隠れて
    // 見えなくなっていた。
    document.body.appendChild(this.overlay);
    this.overlay.classList.add("visible");
    this.inputEl.focus();
    this.inputEl.select();
  }

  private submit(): void {
    this.hide();
    this.onResult(this.inputEl.value);
  }

  private cancel(): void {
    this.hide();
    this.onResult(null);
  }

  hide(): void {
    this.overlay.classList.remove("visible");
  }
}
