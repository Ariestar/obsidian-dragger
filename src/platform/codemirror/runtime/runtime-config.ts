import type { Config, GestureConfig } from 'md-dragger/runtime';
import type { EditorContext } from './editor-context';

type RuntimeConfigPlugin = {
    isMobilePlatform(): boolean;
    settings: {
        enableMultiLineSelection: boolean;
        mobileDragLongPressMs: number;
        mouseRangeSelectLongPressMs: number;
    };
};

export function codeMirrorRuntimeConfig(
    _plugin: RuntimeConfigPlugin,
    context: EditorContext
): Config {
    return () => ({
        tabSize: context.tabSize,
    });
}

// Gesture config for the runtime's default ux. Drives the long-press →
// range-select gesture: enableMultiLineSelection gates multi-select on/off,
// and the long-press duration is platform-specific (mobile vs desktop).
export function codeMirrorGestureConfig(plugin: RuntimeConfigPlugin): GestureConfig {
    return {
        longPressMs: plugin.isMobilePlatform()
            ? plugin.settings.mobileDragLongPressMs
            : plugin.settings.mouseRangeSelectLongPressMs,
        dragStartMoveThresholdPx: plugin.isMobilePlatform() ? 8 : 4,
        dragCancelMoveThresholdPx: plugin.isMobilePlatform() ? 12 : Number.POSITIVE_INFINITY,
        multiSelectEnabled: plugin.settings.enableMultiLineSelection !== false,
    };
}
