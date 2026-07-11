import type { EditorView } from '@codemirror/view';
import { resolveDropTarget as cmResolveDropTarget, lineNumberFromPoint } from 'md-dragger/adapter/codemirror';
import type { Point, PressInput, RuntimeOptions } from 'md-dragger/runtime';
import { DRAG_HANDLE_CLASS } from '../../../shared/dom-selectors';
import type { EditorContext } from './editor-context';

export type LocatePlugin = {
    isMobilePlatform(): boolean;
    isMobileDragModeEnabled(): boolean;
};

export function codeMirrorLocate(
    view: EditorView,
    _context: EditorContext,
    resolveTargetView: (point: Point) => EditorView | null,
    plugin: LocatePlugin,
): RuntimeOptions['locate'] {
    return {
        sourceLineFromInput: (input) => sourceLineFromInput(view, input, plugin),
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

// Desktop: only a real handle starts a gesture.
// Mobile + drag mode ON: a press on the content row is treated as a handle
// (row-as-handle). Mobile + drag mode OFF: no press starts a gesture.
function sourceLineFromInput(
    view: EditorView,
    input: PressInput,
    plugin: LocatePlugin,
): number | null {
    const event = input.native instanceof PointerEvent ? input.native : null;
    const target = event?.target instanceof HTMLElement ? event.target : null;

    const handle = target?.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
    if (handle && view.dom.contains(handle)) {
        const blockStart = Number(handle.getAttribute('data-block-start'));
        if (Number.isInteger(blockStart)) return blockStart + 1;
    }

    if (!plugin.isMobilePlatform()) return null;
    if (!plugin.isMobileDragModeEnabled()) return null;

    // Mode on: any press inside this editor's content maps to a line.
    if (target && !view.dom.contains(target)) return null;
    return lineNumberFromPoint(view, input.point);
}
