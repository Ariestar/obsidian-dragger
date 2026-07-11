import type { Config, GestureConfig } from 'md-dragger/runtime';
import type { EditorContext } from './editor-context';

type RuntimeConfigPlugin = {
    isMobilePlatform(): boolean;
    isMobileDragModeEnabled(): boolean;
    settings: {
        enableMultiLineSelection: boolean;
        // Mobile: hold this long before a press becomes ready_to_drag.
        mobileDragLongPressMs: number;
        // Desktop (and mobile multi-select): hold this long to enter selecting.
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

// Gesture config for DefaultUx.
//
// Desktop:
//   dragArmMs = 0 → move past threshold starts a drag immediately
//   multiSelectMs = mouseRangeSelectLongPressMs → hold to enter multi-select
//
// Mobile (drag mode on — locate already gates presses):
//   dragArmMs = mobileDragLongPressMs → hold to arm drag
//   multiSelectMs = mouseRangeSelectLongPressMs → longer hold enters multi-select
export function codeMirrorGestureConfig(plugin: RuntimeConfigPlugin): GestureConfig {
    const multiSelectEnabled = plugin.settings.enableMultiLineSelection !== false;
    const multiSelectMs = plugin.settings.mouseRangeSelectLongPressMs;
    if (plugin.isMobilePlatform()) {
        return {
            dragArmMs: plugin.settings.mobileDragLongPressMs,
            multiSelectMs,
            dragStartMoveThresholdPx: 8,
            // Finger jitter while arming must not cancel into a menu.
            // Short tap still cancels on release; move after arm starts a drag.
            dragCancelMoveThresholdPx: Number.POSITIVE_INFINITY,
            multiSelectEnabled,
        };
    }
    return {
        dragArmMs: 0,
        multiSelectMs,
        dragStartMoveThresholdPx: 4,
        dragCancelMoveThresholdPx: Number.POSITIVE_INFINITY,
        multiSelectEnabled,
    };
}
