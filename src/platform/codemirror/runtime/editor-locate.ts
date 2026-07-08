import type { EditorView } from '@codemirror/view';
import { resolveDropTarget as cmResolveDropTarget } from 'md-dragger/adapter/codemirror';
import type { PressInput, RuntimeOptions } from 'md-dragger/runtime';
import { DRAG_HANDLE_CLASS } from '../../../shared/dom-selectors';
import type { EditorContext } from './editor-context';

export function codeMirrorLocate(
    view: EditorView,
    _context: EditorContext
): RuntimeOptions['locate'] {
    return {
        sourceLineFromInput: (input) => sourceLineFromInput(input),
        resolveDropTarget: (point, ctx) => cmResolveDropTarget(view, point, ctx.selection, {}),
    };
}

function sourceLineFromInput(input: PressInput): number | null {
    const event = input.native instanceof PointerEvent ? input.native : null;
    const target = event?.target instanceof HTMLElement ? event.target : null;
    const handle = target?.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
    if (!handle) return null;
    const blockStart = Number(handle.getAttribute('data-block-start'));
    return Number.isInteger(blockStart) ? blockStart + 1 : null;
}
