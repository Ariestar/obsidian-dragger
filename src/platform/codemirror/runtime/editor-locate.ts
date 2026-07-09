import type { EditorView } from '@codemirror/view';
import { resolveDropTarget as cmResolveDropTarget, lineNumberFromPoint } from 'md-dragger/adapter/codemirror';
import type { Point, PressInput, RuntimeOptions } from 'md-dragger/runtime';
import { DRAG_HANDLE_CLASS } from '../../../shared/dom-selectors';
import type { EditorContext } from './editor-context';

export function codeMirrorLocate(
    view: EditorView,
    _context: EditorContext,
    resolveTargetView: (point: Point) => EditorView | null,
): RuntimeOptions['locate'] {
    return {
        sourceLineFromInput: (input) => sourceLineFromInput(input),
        lineFromPoint: (point) => lineNumberFromPoint(view, point),
        resolveDropTarget: (point, ctx) => {
            // The drop lands in whichever editor the pointer is over — possibly
            // a different file than the drag started in. The resolved view's
            // doc becomes the DropTarget's targetDoc, so cross-document moves
            // emerge without any flag on the host.
            const targetView = resolveTargetView(point);
            if (!targetView) return null;
            return cmResolveDropTarget(targetView, point, ctx.selection, {});
        },
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
