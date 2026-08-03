import { DEFAULT_HANDLE_SIZE_PX, MIN_HANDLE_SIZE_PX, MAX_HANDLE_SIZE_PX } from '../shared/constants';

export type HandleVisibilityMode = 'always' | 'hover' | 'hidden';
export type HandleIconStyle = 'dot' | 'grip-dots' | 'grip-lines' | 'square';
export type BlockSelectionVisualStyle = 'outline' | 'subtle' | 'filled';
export type HandleGutterPosition = 'left' | 'right';

export interface DragNDropSettings {
    handleColorMode: 'theme' | 'custom';
    handleColor: string;
    handleVisibility: HandleVisibilityMode;
    handleIcon: HandleIconStyle;
    handleSize: number;
    indicatorColorMode: 'theme' | 'custom';
    indicatorColor: string;
    enableMultiLineSelection: boolean;
    // Mobile: hold this long before a press becomes ready_to_drag.
    mobileDragLongPressMs: number;
    // Hold this long to enter multi-select (desktop + mobile).
    mouseRangeSelectLongPressMs: number;
    autoScrollEdgeZonePx: number;
    autoScrollMaxSpeedPx: number;
    disableMobileDragModeAfterDrop: boolean;
    enableMobileTextLongPressDrag: boolean;
    mobileDragModeToggleEnabled: boolean;
    enableBlockSelectionHighlight: boolean;
    enableListDropHighlight: boolean;
    selectionVisualStyle: BlockSelectionVisualStyle;
    handleHorizontalOffsetPx: number;
    handleGutterPosition: HandleGutterPosition;
    /** Internal: persisted settings schema version, managed by settings-migrations. */
    schemaVersion?: number;
}

/**
 * Valid [min, max, step] ranges for every numeric setting. Single source of
 * truth: the settings UI uses these as slider limits, and settings-migrations
 * uses them to clamp persisted values. Keys must stay in sync with the numeric
 * fields of DragNDropSettings.
 */
export const NUMERIC_SETTING_RANGES = {
    handleSize: { min: MIN_HANDLE_SIZE_PX, max: MAX_HANDLE_SIZE_PX, step: 2 },
    handleHorizontalOffsetPx: { min: -80, max: 80, step: 1 },
    mobileDragLongPressMs: { min: 50, max: 800, step: 10 },
    mouseRangeSelectLongPressMs: { min: 50, max: 2000, step: 10 },
    autoScrollEdgeZonePx: { min: 20, max: 200, step: 4 },
    autoScrollMaxSpeedPx: { min: 4, max: 60, step: 2 },
} as const satisfies Record<string, { min: number; max: number; step: number }>;

export type NumericSettingKey = keyof typeof NUMERIC_SETTING_RANGES;

export const DEFAULT_SETTINGS: DragNDropSettings = {
    handleColorMode: 'theme',
    handleColor: '#8a8a8a',
    handleVisibility: 'hover',
    handleIcon: 'grip-dots',
    handleSize: DEFAULT_HANDLE_SIZE_PX,
    indicatorColorMode: 'theme',
    indicatorColor: '#7a7a7a',
    enableMultiLineSelection: true,
    mobileDragLongPressMs: 200,
    // Slightly longer than drag-arm so multi-select is intentional, not accidental.
    mouseRangeSelectLongPressMs: 700,
    autoScrollEdgeZonePx: 60,
    autoScrollMaxSpeedPx: 12,
    disableMobileDragModeAfterDrop: true,
    enableMobileTextLongPressDrag: true,
    mobileDragModeToggleEnabled: true,
    enableBlockSelectionHighlight: true,
    enableListDropHighlight: true,
    selectionVisualStyle: 'subtle',
    handleHorizontalOffsetPx: -8,
    handleGutterPosition: 'left',
};
