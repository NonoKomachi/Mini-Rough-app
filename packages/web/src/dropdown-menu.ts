/** A single shared pulldown menu panel, repositioned under whichever menu-bar button opened it. */
export class DropdownMenu {
  private readonly menuEl: HTMLDivElement;
  private anchor: HTMLElement | null = null;

  constructor() {
    this.menuEl = document.createElement("div");
    this.menuEl.className = "dropdown-menu";
    document.body.appendChild(this.menuEl);

    document.addEventListener("pointerdown", (e) => {
      const target = e.target as Node;
      if (this.anchor && !this.menuEl.contains(target) && target !== this.anchor && !this.anchor.contains(target)) {
        this.close();
      }
    });
  }

  /** Opens (or, if already open for the same button, closes) the menu anchored under `button`. */
  toggle(button: HTMLElement, build: (container: HTMLElement, menu: DropdownMenu) => void): void {
    if (this.anchor === button && this.menuEl.classList.contains("open")) {
      this.close();
      return;
    }
    this.menuEl.innerHTML = "";
    build(this.menuEl, this);
    const rect = button.getBoundingClientRect();
    this.menuEl.style.left = `${rect.left}px`;
    this.menuEl.style.top = `${rect.bottom}px`;
    this.menuEl.classList.add("open");
    this.anchor = button;
    button.classList.add("open");
  }

  /** `hint` renders faintly on the right (e.g. a keyboard shortcut like "Ctrl+D"), purely
   * informational — it does not register the shortcut itself. */
  addItem(container: HTMLElement, label: string, onClick: () => void, hint?: string): HTMLButtonElement {
    const btn = document.createElement("button");
    btn.className = "dropdown-item";
    const labelEl = document.createElement("span");
    labelEl.textContent = label;
    btn.appendChild(labelEl);
    if (hint) {
      const hintEl = document.createElement("span");
      hintEl.className = "dropdown-item-hint";
      hintEl.textContent = hint;
      btn.appendChild(hintEl);
    }
    btn.addEventListener("click", () => {
      onClick();
      this.close();
    });
    container.appendChild(btn);
    return btn;
  }

  close(): void {
    this.menuEl.classList.remove("open");
    this.anchor?.classList.remove("open");
    this.anchor = null;
  }
}
