export const MOBILE_DRAG_LONG_PRESS_MS = 200;
export const MOBILE_SELECTED_RANGE_DRAG_LONG_PRESS_MS = 120;
export const MOBILE_DRAG_START_MOVE_THRESHOLD_PX = 8;
export const MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX = 12;
export const TOUCH_RANGE_SELECT_LONG_PRESS_MS = 900;
export const MIN_TOUCH_RANGE_SELECT_LONG_PRESS_MS = 300;
export const MAX_TOUCH_RANGE_SELECT_LONG_PRESS_MS = 2000;
export const MOUSE_RANGE_SELECT_LONG_PRESS_MS = 500;
export const MOUSE_SECONDARY_DRAG_START_MOVE_THRESHOLD_PX = 4;

export function clampTouchRangeSelectLongPressMs(value: number | undefined): number {
    if (value === undefined || !Number.isFinite(value)) {
        return TOUCH_RANGE_SELECT_LONG_PRESS_MS;
    }
    return Math.max(
        MIN_TOUCH_RANGE_SELECT_LONG_PRESS_MS,
        Math.min(MAX_TOUCH_RANGE_SELECT_LONG_PRESS_MS, Math.round(value))
    );
}
