import type { EditorView } from '@codemirror/view';
import type { Doc } from 'md-dragger/domain';
import type { EditorContext } from './editor-context';
import type { DropIndicatorManager } from './drop-indicator';

// A live editor that can receive a drop (same-file or cross-file). Each
// CodeMirror view's drag-driver registers itself here so the view owning an
// active drag can resolve — from a screen point or a Doc identity — which
// other view (or itself) is the target.
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

// Resolve the editor under a screen point. Prefer the topmost DOM node under
// the point that belongs to a registered view (handles overlapping leaves);
// fall back to rect containment.
export function resolveDragTargetAtPoint(x: number, y: number): DragTargetEntry | null {
    const doc = typeof activeDocument !== 'undefined' ? activeDocument : document;
    const stack = typeof doc.elementsFromPoint === 'function'
        ? doc.elementsFromPoint(x, y)
        : [];
    for (const node of stack) {
        if (!(node instanceof Element)) continue;
        for (const entry of entries.values()) {
            if (entry.view.dom === node || entry.view.dom.contains(node)) {
                return entry;
            }
        }
    }
    for (const entry of entries.values()) {
        if (containsPoint(entry.view, x, y)) return entry;
    }
    return null;
}

// Route a DocEdit to the view that currently owns that Text. Cross-file commit
// must use this — not a transient pointer target that may already be cleared
// by the time apply() runs (dropped output hides indicators first).
export function resolveDragTargetByDoc(doc: Doc): DragTargetEntry | null {
    for (const entry of entries.values()) {
        if (entry.view.state.doc === doc) return entry;
    }
    return null;
}

export function resetDragTargetRegistryForTests(): void {
    entries.clear();
}
