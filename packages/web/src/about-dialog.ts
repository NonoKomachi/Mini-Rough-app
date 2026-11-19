const APP_NAME = "ミニラフ小町";
const APP_VERSION = "1.0.0";

export class AboutDialog {
  private readonly overlay: HTMLDivElement;

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";

    const box = document.createElement("div");
    box.className = "modal-box";
    box.innerHTML = `
      <img src="./logo.png" alt="製作小町" class="about-logo" />
      <div class="about-title">${APP_NAME}</div>
      <div class="about-version">バージョン ${APP_VERSION}</div>
      <div class="modal-buttons">
        <button type="button" class="create-btn close-btn">閉じる</button>
      </div>
    `;
    this.overlay.appendChild(box);
    document.body.appendChild(this.overlay);

    box.querySelector(".close-btn")!.addEventListener("click", () => this.hide());
  }

  show(): void {
    this.overlay.classList.add("visible");
  }

  hide(): void {
    this.overlay.classList.remove("visible");
  }
}
