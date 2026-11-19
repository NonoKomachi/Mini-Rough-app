import { Document, LayerFolder, LayerNode, RasterLayer } from "./document";

export interface LayerSnapshot {
  layers: LayerNode[];
  activeLayerId: string | null;
}

function cloneNode(node: LayerNode): LayerNode {
  if (node.kind === "layer") {
    const clone = new RasterLayer(node.name, node.width, node.height, node.id);
    clone.visible = node.visible;
    clone.opacity = node.opacity;
    clone.pixels.set(node.pixels);
    return clone;
  }
  const clone = new LayerFolder(node.name, node.id);
  clone.visible = node.visible;
  clone.opacity = node.opacity;
  clone.children = node.children.map(cloneNode);
  return clone;
}

export function snapshotLayers(doc: Document): LayerSnapshot {
  return { layers: doc.layers.map(cloneNode), activeLayerId: doc.activeLayerId };
}

/** Applies a snapshot onto `doc` (cloning again first, so later edits never corrupt stored history). */
export function restoreLayers(doc: Document, snapshot: LayerSnapshot): void {
  doc.layers = snapshot.layers.map(cloneNode);
  doc.activeLayerId = snapshot.activeLayerId;
}

const HISTORY_LIMIT = 50;

/** One undo/redo stack per document (each variant keeps its own — see VariantGrid). */
export class UndoStack {
  private undoList: LayerSnapshot[] = [];
  private redoList: LayerSnapshot[] = [];

  /** Call before any mutating action, passing a *pre*-mutation snapshot. */
  pushUndo(snapshot: LayerSnapshot): void {
    this.undoList.push(snapshot);
    if (this.undoList.length > HISTORY_LIMIT) this.undoList.shift();
    this.redoList = [];
  }

  canUndo(): boolean {
    return this.undoList.length > 0;
  }

  canRedo(): boolean {
    return this.redoList.length > 0;
  }

  /** Pass the document's *current* snapshot; returns the snapshot to restore, or undefined if empty. */
  undo(current: LayerSnapshot): LayerSnapshot | undefined {
    const prev = this.undoList.pop();
    if (!prev) return undefined;
    this.redoList.push(current);
    return prev;
  }

  redo(current: LayerSnapshot): LayerSnapshot | undefined {
    const next = this.redoList.pop();
    if (!next) return undefined;
    this.undoList.push(current);
    return next;
  }
}
