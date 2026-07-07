import type { DraggerRuntimeConfigInput } from '../../../drag/runtime';
import type { EditorContext } from './editor-context';

type RuntimeConfigPlugin = {
    isMobilePlatform(): boolean;
    settings: {
        mobileDragLongPressMs: number;
        mouseRangeSelectLongPressMs: number;
    };
};

export function codeMirrorRuntimeConfig(
    plugin: RuntimeConfigPlugin,
    context: EditorContext
): DraggerRuntimeConfigInput {
    return () => ({
        tabSize: context.tabSize,
        longPressMs: plugin.isMobilePlatform()
            ? plugin.settings.mobileDragLongPressMs
            : plugin.settings.mouseRangeSelectLongPressMs,
        dragStartMoveThresholdPx: plugin.isMobilePlatform() ? 8 : 4,
        dragCancelMoveThresholdPx: plugin.isMobilePlatform() ? 12 : Number.POSITIVE_INFINITY,
    });
}
