import { renderMarkdown } from "./markdown";

export class HelpDialog {
  private readonly overlay: HTMLDivElement;
  private readonly body: HTMLDivElement;

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";

    const box = document.createElement("div");
    box.className = "modal-box help-dialog-box";
    const title = document.createElement("h2");
    title.textContent = "ヘルプ";
    box.appendChild(title);

    this.body = document.createElement("div");
    this.body.className = "help-body";
    this.body.textContent = "読み込み中…";
    box.appendChild(this.body);

    const buttons = document.createElement("div");
    buttons.className = "modal-buttons";
    const closeBtn = document.createElement("button");
    closeBtn.className = "create-btn";
    closeBtn.textContent = "閉じる";
    closeBtn.addEventListener("click", () => this.hide());
    buttons.appendChild(closeBtn);
    box.appendChild(buttons);

    this.overlay.appendChild(box);
    document.body.appendChild(this.overlay);
  }

  async show(): Promise<void> {
    this.overlay.classList.add("visible");
    try {
      const res = await fetch("./README.md");
      this.body.innerHTML = res.ok ? renderMarkdown(await res.text()) : "README.mdを読み込めませんでした。";
    } catch {
      this.body.textContent = "README.mdを読み込めませんでした。";
    }
  }

  hide(): void {
    this.overlay.classList.remove("visible");
  }
}
