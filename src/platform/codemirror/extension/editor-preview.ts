import type { BlockSelection, DropTarget } from 'md-dragger/domain';
import type { DropIndicatorManager } from '../preview/drop-indicator';
import type { EditorContext } from './editor-context';

// Drop-preview projection derived from the pipeline's drag_over output.
// The headless runtime no longer pushes a preview callback; the platform
// projects the indicator from the transition stream itself.
export type DropPreviewInput = {
    source: BlockSelection;
    target: DropTarget | null;
    allowed: boolean;
};

export function renderDropPreview(
    context: EditorContext,
    dropIndicator: DropIndicatorManager,
    preview: DropPreviewInput | null
): void {
    const targetLineNumber = preview?.target?.targetLineNumber ?? null;
    if (!preview || !preview.allowed || targetLineNumber === null) {
        dropIndicator.hide();
        return;
    }
    const indicatorY = context.getInsertionAnchorY(targetLineNumber);
    if (indicatorY === null) {
        dropIndicator.hide();
        return;
    }
    dropIndicator.scheduleRender({
        target: {
            targetLineNumber,
            placement: 'before',
        },
        preview: {
            indicatorY,
            lineRect: context.getLineRect(targetLineNumber),
        },
    }, preview.source, null);
}
