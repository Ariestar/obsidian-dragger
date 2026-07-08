import type { EditorView } from '@codemirror/view';
import type { PressInput, RuntimeOptions } from 'md-dragger/runtime';
import { DRAG_HANDLE_CLASS } from '../../../shared/dom-selectors';
import { nativePointerEvent } from '../input/pointer-input-source';
import type { EditorContext } from './editor-context';

export function codeMirrorLocate(
    view: EditorView,
    context: EditorContext
): RuntimeOptions['locate'] {
    return {
        sourceLineFromInput: (input) => sourceLineFromInput(input),
        resolveDropTarget: (point) => {
            const targetLineNumber = context.selection.getLineNumberAtVerticalPosition(
                point.y,
                view.contentDOM.getBoundingClientRect()
            );
            if (targetLineNumber === null) return null;
            return { targetLineNumber, placement: 'before' };
        },
    };
}

function sourceLineFromInput(input: PressInput): number | null {
    const event = nativePointerEvent(input.native);
    const target = event?.target instanceof HTMLElement ? event.target : null;
    const handle = target?.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
    if (!handle) return null;
    const blockStart = Number(handle.getAttribute('data-block-start'));
    return Number.isInteger(blockStart) ? blockStart + 1 : null;
}
