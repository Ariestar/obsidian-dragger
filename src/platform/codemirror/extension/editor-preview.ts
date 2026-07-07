import type { DragPreview, DraggerRuntimeOptions } from '../../../drag/runtime';
import type { DropIndicatorManager } from '../preview/drop-indicator';
import type { EditorContext } from './editor-context';

export function codeMirrorPreview(
    context: EditorContext,
    dropIndicator: DropIndicatorManager
): NonNullable<DraggerRuntimeOptions['preview']> {
    return (preview) => renderRuntimePreview(context, dropIndicator, preview);
}

function renderRuntimePreview(
    context: EditorContext,
    dropIndicator: DropIndicatorManager,
    preview: DragPreview | null
): void {
    if (!preview || !preview.allowed || preview.targetLineNumber === null) {
        dropIndicator.hide();
        return;
    }
    const indicatorY = context.getInsertionAnchorY(preview.targetLineNumber);
    if (indicatorY === null) {
        dropIndicator.hide();
        return;
    }
    dropIndicator.scheduleRender({
        target: {
            targetLineNumber: preview.targetLineNumber,
            placement: 'before',
        },
        preview: {
            indicatorY,
            lineRect: context.getLineRect(preview.targetLineNumber),
        },
    }, preview.source, null);
}
