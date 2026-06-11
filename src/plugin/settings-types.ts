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
    disableMobileDragModeAfterDrop: boolean;
    enableMobileTextLongPressDrag: boolean;
    mobileDragModeToggleLocations: MobileDragModeToggleLocation[];
    enableBlockSelectionHighlight: boolean;
    enableListDropHighlight: boolean;
    selectionVisualStyle: BlockSelectionVisualStyle;
    handleHorizontalOffsetPx: number;
    handleGutterPosition: HandleGutterPosition;
}
