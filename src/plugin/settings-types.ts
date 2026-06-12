import { DEFAULT_HANDLE_SIZE_PX, MIN_HANDLE_SIZE_PX, MAX_HANDLE_SIZE_PX } from '../shared/constants';

export type HandleVisibilityMode = 'always' | 'hover' | 'hidden';
export type HandleIconStyle = 'dot' | 'grip-dots' | 'grip-lines' | 'square';
export type BlockSelectionVisualStyle = 'outline' | 'subtle' | 'filled';
export type HandleGutterPosition = 'left' | 'right';
export type MobileDragModeToggleLocation = 'view-action' | 'toolbar-command';

export interface DragNDropSettings {
    handleColorMode: 'theme' | 'custom';
    handleColor: string;
    handleVisibility: HandleVisibilityMode;
    handleIcon: HandleIconStyle;
    handleSize: number;
    indicatorColorMode: 'theme' | 'custom';
    indicatorColor: string;
    enableCrossFileDrag: boolean;
    enableMultiLineSelection: boolean;
    multiLineSelectionLongPressMs: number;
    mobileDragLongPressMs: number;
    mouseRangeSelectLongPressMs: number;
    autoScrollEdgeZonePx: number;
    autoScrollMaxSpeedPx: number;
    disableMobileDragModeAfterDrop: boolean;
    enableMobileTextLongPressDrag: boolean;
    mobileDragModeToggleLocations: MobileDragModeToggleLocation[];
    enableBlockSelectionHighlight: boolean;
    enableListDropHighlight: boolean;
    selectionVisualStyle: BlockSelectionVisualStyle;
    handleHorizontalOffsetPx: number;
    handleGutterPosition: HandleGutterPosition;
    /** Internal: persisted settings schema version, managed by settings-migrations. */
    schemaVersion?: number;
}

export const DEFAULT_MULTI_LINE_SELECTION_LONG_PRESS_MS = 900;

/**
 * Valid [min, max, step] ranges for every numeric setting. Single source of
 * truth: the settings UI uses these as slider limits, and settings-migrations
 * uses them to clamp persisted values. Keys must stay in sync with the numeric
 * fields of DragNDropSettings.
 */
export const NUMERIC_SETTING_RANGES = {
    handleSize: { min: MIN_HANDLE_SIZE_PX, max: MAX_HANDLE_SIZE_PX, step: 2 },
    handleHorizontalOffsetPx: { min: -80, max: 80, step: 1 },
    multiLineSelectionLongPressMs: { min: 300, max: 2000, step: 50 },
    mobileDragLongPressMs: { min: 50, max: 800, step: 10 },
    mouseRangeSelectLongPressMs: { min: 50, max: 800, step: 10 },
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
    enableCrossFileDrag: true,
    enableMultiLineSelection: true,
    multiLineSelectionLongPressMs: DEFAULT_MULTI_LINE_SELECTION_LONG_PRESS_MS,
    mobileDragLongPressMs: 200,
    mouseRangeSelectLongPressMs: 260,
    autoScrollEdgeZonePx: 88,
    autoScrollMaxSpeedPx: 22,
    disableMobileDragModeAfterDrop: true,
    enableMobileTextLongPressDrag: true,
    mobileDragModeToggleLocations: ['view-action'],
    enableBlockSelectionHighlight: true,
    enableListDropHighlight: true,
    selectionVisualStyle: 'subtle',
    handleHorizontalOffsetPx: -8,
    handleGutterPosition: 'left',
};
