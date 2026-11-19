// Mini-rough canvases can run up to roughly 500px on the long side (bigger/more detailed
// compositions), so presets go well past the old 64px ceiling.
const PRESET_SIZES = [1, 2, 3, 4, 6, 8, 10, 12, 16, 20, 24, 32, 40, 48, 64, 80, 100, 128, 160, 200, 256, 320, 400, 500];
const MAX_DOT_PX = 40;

export class SizePresetDialog {
  private readonly overlay: HTMLDivElement;
  private onPick: (size: number) => void = () => {};

  constructor() {
    this.overlay = document.createElement("div");
    this.overlay.className = "modal-overlay";

    const box = document.createElement("div");
    box.className = "modal-box";
    const title = document.createElement("h2");
    title.textContent = "ブラシサイズ";
    box.appendChild(title);

    const grid = document.createElement("div");
    grid.className = "size-popup-grid";
    for (const size of PRESET_SIZES) {
      const item = document.createElement("button");
      item.className = "size-popup-item";
      const dot = document.createElement("div");
      dot.className = "size-popup-dot";
      const dotPx = Math.min(MAX_DOT_PX, size);
      dot.style.width = `${dotPx}px`;
      dot.style.height = `${dotPx}px`;
      const label = document.createElement("span");
      label.textContent = `${size}px`;
      item.appendChild(dot);
      item.appendChild(label);
      item.addEventListener("click", () => {
        this.onPick(size);
        this.hide();
      });
      grid.appendChild(item);
    }
    box.appendChild(grid);

    const buttons = document.createElement("div");
    buttons.className = "modal-buttons";
    const cancelBtn = document.createElement("button");
    cancelBtn.textContent = "キャンセル";
    cancelBtn.addEventListener("click", () => this.hide());
    buttons.appendChild(cancelBtn);
    box.appendChild(buttons);

    this.overlay.appendChild(box);
    document.body.appendChild(this.overlay);
  }

  open(onPick: (size: number) => void): void {
    this.onPick = onPick;
    this.overlay.classList.add("visible");
  }

  hide(): void {
    this.overlay.classList.remove("visible");
  }
}
