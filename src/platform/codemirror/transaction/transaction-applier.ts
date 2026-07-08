import { EditorView } from '@codemirror/view';
import type { DropCommit } from 'md-dragger/runtime';
import { anchorSelectionBeforeUndoableChange } from './undo-selection-anchor';

export function applyBlockTransaction(
    view: EditorView,
    transaction: DropCommit,
    options?: { anchor?: number; scrollIntoView?: boolean }
): void {
    if (transaction.changes.length === 0) return;
    if (typeof options?.anchor === 'number') {
        anchorSelectionBeforeUndoableChange(view, options.anchor);
    }
    view.dispatch({
        changes: transaction.changes,
        scrollIntoView: options?.scrollIntoView ?? false,
    });
}
