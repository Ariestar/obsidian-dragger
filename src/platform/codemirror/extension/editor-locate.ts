import type { EditorView } from '@codemirror/view';
import type { DraggerPressInput, DraggerRuntimeOptions } from '../../../drag/runtime';
import { DRAG_HANDLE_CLASS } from '../../../shared/dom-selectors';
import { nativePointerEvent } from '../input/pointer-input-source';
import type { EditorContext } from './editor-context';

export function codeMirrorLocate(
    view: EditorView,
    context: EditorContext
): DraggerRuntimeOptions['locate'] {
    return {
        sourceLineFromInput: (input) => sourceLineFromInput(input),
        targetLineFromPoint: (point) => context.selection.getLineNumberAtVerticalPosition(
            point.y,
            view.contentDOM.getBoundingClientRect()
        ),
    };
}

function sourceLineFromInput(input: DraggerPressInput): number | null {
    const event = nativePointerEvent(input.native);
    const target = event?.target instanceof HTMLElement ? event.target : null;
    const handle = target?.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
    if (!handle) return null;
    const blockStart = Number(handle.getAttribute('data-block-start'));
    return Number.isInteger(blockStart) ? blockStart + 1 : null;
}
