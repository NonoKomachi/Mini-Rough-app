import { createId } from "./id";
import type { SelectionMask } from "./selection";
import { BLEND_NORMAL, type BlendMode } from "./blend-modes";

export class RasterLayer {
  readonly kind = "layer" as const;
  readonly id: string;
  readonly width: number;
  readonly height: number;
  name: string;
  visible = true;
  /** 0..1 */
  opacity = 1;
  /** CLIP STUDIO PAINTの合成モード(LayerComposite)と同じ数値コード。既定0=通常。see blend-modes.ts */
  blendMode: BlendMode = BLEND_NORMAL;
  /** RGBA, non-premultiplied, length = width * height * 4 */
  pixels: Uint8ClampedArray;
  /** Optional layer mask: same RGBA pixel-buffer shape as `pixels` (so the existing paint tools
   * can edit it completely unchanged) — only its luma (grayscale, white=visible/black=hidden)
   * matters when compositing, see rendering.ts. null = no mask. */
  mask: Uint8ClampedArray | null = null;
  maskEnabled = true;
  /** "クリッピング": clips this layer's alpha to the nearest non-clipped layer directly below it
   * in the same list (see rendering.ts). */
  clipToBelow = false;
  /** "透明ピクセルをロック": trueの間、描画/塗りつぶしはこのレイヤーが既に不透明な部分にしか
   * 効かない(透明だった場所に新たに不透明なピクセルを作れない)。各ツール側(pencil/brush/
   * eraser/transparent-brush/dot-pen/bucket-fill)がselectionMaskと同じ仕組みで参照する。 */
  alphaLocked = false;

  constructor(name: string, width: number, height: number, id = createId()) {
    this.id = id;
    this.name = name;
    this.width = width;
    this.height = height;
    this.pixels = new Uint8ClampedArray(width * height * 4);
  }

  /** Adds a fully-white (= fully visible) mask, a no-op on the composited result until painted. */
  addMask(): void {
    this.mask = new Uint8ClampedArray(this.width * this.height * 4).fill(255);
    this.maskEnabled = true;
  }

  removeMask(): void {
    this.mask = null;
  }
}

export class LayerFolder {
  readonly kind = "folder" as const;
  readonly id: string;
  name: string;
  visible = true;
  /** 0..1 */
  opacity = 1;
  /** bottom-most first, top-most last */
  children: LayerNode[] = [];

  constructor(name: string, id = createId()) {
    this.id = id;
    this.name = name;
  }
}

export type LayerNode = RasterLayer | LayerFolder;

export class Document {
  readonly width: number;
  readonly height: number;
  /** Target canvas size for .clip export (M6); independent of the mini working resolution. */
  finalWidth: number;
  finalHeight: number;
  /** Print resolution carried through to the exported .clip canvas. */
  dpi: number;
  /** bottom-most first, top-most last */
  layers: LayerNode[] = [];
  activeLayerId: string | null = null;
  /** Current selection (null/all-zero = no selection, i.e. operations apply to the whole layer). */
  selectionMask: SelectionMask | null = null;
  /** When set, paint tools write into this layer's mask instead of its own pixels. */
  maskPaintLayerId: string | null = null;
  private nextLayerNumber = 1;
  private nextFolderNumber = 1;

  constructor(width: number, height: number, finalWidth = width, finalHeight = height, dpi = 350) {
    this.width = width;
    this.height = height;
    this.finalWidth = finalWidth;
    this.finalHeight = finalHeight;
    this.dpi = dpi;
  }

  static createDefault(width: number, height: number, finalWidth = width, finalHeight = height, dpi = 350): Document {
    const doc = new Document(width, height, finalWidth, finalHeight, dpi);
    doc.addLayer();
    return doc;
  }

  findLayer(id: string, nodes: LayerNode[] = this.layers): RasterLayer | undefined {
    const node = this.findNode(id, nodes);
    return node && node.kind === "layer" ? node : undefined;
  }

  findNode(id: string, nodes: LayerNode[] = this.layers): LayerNode | undefined {
    for (const node of nodes) {
      if (node.id === id) return node;
      if (node.kind === "folder") {
        const found = this.findNode(id, node.children);
        if (found) return found;
      }
    }
    return undefined;
  }

  /** Locates the array that directly contains `id` and its index within that array. */
  private findContainer(id: string, nodes: LayerNode[] = this.layers): { array: LayerNode[]; index: number } | undefined {
    const index = nodes.findIndex((n) => n.id === id);
    if (index !== -1) return { array: nodes, index };
    for (const node of nodes) {
      if (node.kind === "folder") {
        const found = this.findContainer(id, node.children);
        if (found) return found;
      }
    }
    return undefined;
  }

  /** The folder a node's parent-of-parent should receive it when outdenting; undefined at root. */
  private findParentFolder(id: string, nodes: LayerNode[] = this.layers, parent?: LayerFolder): LayerFolder | undefined {
    for (const node of nodes) {
      if (node.id === id) return parent;
      if (node.kind === "folder") {
        const found = this.findParentFolder(id, node.children, node);
        if (found !== undefined) return found;
      }
    }
    return undefined;
  }

  private targetArray(parentId: string | null): LayerNode[] | undefined {
    if (parentId === null) return this.layers;
    const parent = this.findNode(parentId);
    return parent && parent.kind === "folder" ? parent.children : undefined;
  }

  private collectDescendantFolderIds(folder: LayerFolder, acc: Set<string> = new Set()): Set<string> {
    acc.add(folder.id);
    for (const child of folder.children) {
      if (child.kind === "folder") this.collectDescendantFolderIds(child, acc);
    }
    return acc;
  }

  findFirstLayer(nodes: LayerNode[] = this.layers): RasterLayer | undefined {
    for (const node of nodes) {
      if (node.kind === "layer") return node;
      if (node.kind === "folder") {
        const found = this.findFirstLayer(node.children);
        if (found) return found;
      }
    }
    return undefined;
  }

  /** Adds a new raster layer to the top of `parentId`'s children (root when omitted) and activates it. */
  addLayer(parentId: string | null = null): RasterLayer {
    const target = this.targetArray(parentId) ?? this.layers;
    const layer = new RasterLayer(`レイヤー${this.nextLayerNumber++}`, this.width, this.height);
    target.push(layer);
    this.activeLayerId = layer.id;
    return layer;
  }

  /** Adds a new folder to the top of `parentId`'s children (root when omitted). */
  addFolder(parentId: string | null = null): LayerFolder {
    const target = this.targetArray(parentId) ?? this.layers;
    const folder = new LayerFolder(`フォルダー${this.nextFolderNumber++}`);
    target.push(folder);
    return folder;
  }

  deleteNode(id: string): void {
    const container = this.findContainer(id);
    if (!container) return;
    container.array.splice(container.index, 1);
    if (this.activeLayerId && !this.findLayer(this.activeLayerId)) {
      this.activeLayerId = this.findFirstLayer()?.id ?? null;
    }
  }

  /**
   * Moves a node one slot toward the top of the visual stack (layers array is bottom-most-first,
   * so "up" means swapping with the sibling at the next-higher index).
   */
  moveUp(id: string): void {
    const container = this.findContainer(id);
    if (!container || container.index >= container.array.length - 1) return;
    const { array, index } = container;
    [array[index], array[index + 1]] = [array[index + 1], array[index]];
  }

  /** Moves a node one slot toward the bottom of the visual stack. */
  moveDown(id: string): void {
    const container = this.findContainer(id);
    if (!container || container.index === 0) return;
    const { array, index } = container;
    [array[index - 1], array[index]] = [array[index], array[index - 1]];
  }

  /** Moves a node into the sibling folder shown directly above it in the list, if there is one. */
  indent(id: string): void {
    const container = this.findContainer(id);
    if (!container || container.index >= container.array.length - 1) return;
    const { array, index } = container;
    const siblingAbove = array[index + 1];
    if (siblingAbove.kind !== "folder") return;
    const node = array[index];
    if (node.kind === "folder" && this.collectDescendantFolderIds(node).has(siblingAbove.id)) return;
    array.splice(index, 1);
    siblingAbove.children.push(node);
  }

  /** Moves a node out of its parent folder to sit just after that folder, one level up. */
  outdent(id: string): void {
    const parentFolder = this.findParentFolder(id);
    if (!parentFolder) return;
    const container = this.findContainer(id);
    const grandContainer = this.findContainer(parentFolder.id);
    if (!container || !grandContainer) return;
    const [node] = container.array.splice(container.index, 1);
    grandContainer.array.splice(grandContainer.index + 1, 0, node);
  }

  /**
   * Moves a node to a specific index within `targetParentId`'s children (root when null); used
   * by drag-and-drop reordering in the layer panel. Returns false (no-op) if the node or target
   * parent doesn't exist, or the move would nest a folder inside its own descendant.
   */
  moveNodeTo(id: string, targetParentId: string | null, targetIndex: number): boolean {
    const container = this.findContainer(id);
    const targetArray = this.targetArray(targetParentId);
    if (!container || !targetArray) return false;
    const node = container.array[container.index];
    if (node.kind === "folder" && targetParentId !== null && this.collectDescendantFolderIds(node).has(targetParentId)) {
      return false;
    }

    container.array.splice(container.index, 1);
    let insertIndex = targetIndex;
    if (container.array === targetArray && container.index < targetIndex) insertIndex -= 1;
    insertIndex = Math.max(0, Math.min(targetArray.length, insertIndex));
    targetArray.splice(insertIndex, 0, node);
    return true;
  }

  getActiveLayer(): RasterLayer | undefined {
    if (!this.activeLayerId) return undefined;
    return this.findLayer(this.activeLayerId);
  }

  /** The sibling that sits directly below `id` in the same parent's children (layers array is
   * bottom-most-first, so that's the element at `index - 1`). undefined when `id` doesn't exist
   * or is already the bottom-most node in its parent. */
  nodeBelow(id: string): LayerNode | undefined {
    const container = this.findContainer(id);
    if (!container || container.index === 0) return undefined;
    return container.array[container.index - 1];
  }

  /** Deep-clones a layer/folder (fresh id, "〜のコピー" name) and inserts it directly above the
   * original in the same parent; activates the clone if it's a layer. Returns the clone, or
   * undefined if `id` doesn't exist. */
  duplicateNode(id: string): LayerNode | undefined {
    const container = this.findContainer(id);
    if (!container) return undefined;
    const node = container.array[container.index];
    const clone = this.cloneWithNewId(node);
    container.array.splice(container.index + 1, 0, clone);
    if (clone.kind === "layer") this.activeLayerId = clone.id;
    return clone;
  }

  private cloneWithNewId(node: LayerNode): LayerNode {
    if (node.kind === "layer") {
      const clone = new RasterLayer(`${node.name}のコピー`, node.width, node.height);
      clone.visible = node.visible;
      clone.opacity = node.opacity;
      clone.blendMode = node.blendMode;
      clone.maskEnabled = node.maskEnabled;
      clone.clipToBelow = node.clipToBelow;
      clone.alphaLocked = node.alphaLocked;
      clone.pixels.set(node.pixels);
      if (node.mask) {
        clone.mask = new Uint8ClampedArray(node.mask.length);
        clone.mask.set(node.mask);
      }
      return clone;
    }
    const clone = new LayerFolder(`${node.name}のコピー`);
    clone.visible = node.visible;
    clone.opacity = node.opacity;
    clone.children = node.children.map((child) => this.cloneWithNewId(child));
    return clone;
  }
}
