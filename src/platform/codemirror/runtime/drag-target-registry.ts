import type { EditorView } from '@codemirror/view';
import type { EditorContext } from './editor-context';
import type { DropIndicatorManager } from './drop-indicator';

// A live editor that can receive a cross-file drop. Each CodeMirror view's
// drag-driver registers itself here, so the view owning an active drag can
// resolve — from a screen point — which other view (or itself) the pointer
// is over, and borrow that view's context + drop indicator for rendering.
export interface DragTargetEntry {
    view: EditorView;
    context: EditorContext;
    dropIndicator: DropIndicatorManager;
}

const entries = new Map<HTMLElement, DragTargetEntry>();

function containsPoint(view: EditorView, x: number, y: number): boolean {
    const rect = view.dom.getBoundingClientRect();
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

export function registerDragTarget(entry: DragTargetEntry): () => void {
    const root = entry.view.dom;
    entries.set(root, entry);
    return () => {
        entries.delete(root);
    };
}

export function resolveDragTargetAtPoint(x: number, y: number): DragTargetEntry | null {
    for (const entry of entries.values()) {
        if (containsPoint(entry.view, x, y)) return entry;
    }
    return null;
}

export function resetDragTargetRegistryForTests(): void {
    entries.clear();
}
