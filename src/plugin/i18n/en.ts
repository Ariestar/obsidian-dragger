import type { ZhCnStrings } from './zh-cn';

export const en: ZhCnStrings = {
    headingAppearance: 'Appearance',
    headingBehavior: 'Behavior',

    handleColor: 'Handle color',
    handleColorDesc: 'Follow theme accent or pick a custom color',
    optionTheme: 'Theme',
    optionCustom: 'Custom',

    handleVisibility: 'Handle visibility',
    handleVisibilityDesc: 'Control how drag handles are displayed',
    optionHover: 'Hover',
    optionAlways: 'Always',
    optionHidden: 'Hidden',
    selectionVisualStyle: 'Block selection visual style',
    selectionVisualStyleDesc: 'Shared highlight style',
    optionBlockSelectionVisualOutline: 'Outline only',
    optionBlockSelectionVisualSubtle: 'Subtle highlight',
    optionBlockSelectionVisualFilled: 'Filled highlight',
    enableBlockSelectionHighlight: 'Block selection highlight',
    enableBlockSelectionHighlightDesc: 'Highlight the block being dragged',

    handleIcon: 'Handle icon',
    handleIconDesc: 'Choose the icon style for drag handles',
    iconDot: '● dot',
    iconGripDots: '⠿ grip dots',
    iconGripLines: '☰ grip lines',
    iconSquare: '■ square',

    handleSize: 'Handle size',
    handleSizeDesc: 'Adjust the size of drag handles (px)',

    handleOffset: 'Handle horizontal offset',
    handleOffsetDesc: 'Negative = left, positive = right',
    handleGutterPosition: 'Handle gutter side',
    handleGutterPositionDesc: 'Show the handle gutter on the left or right side of the editor',
    optionLeft: 'Left',
    optionRight: 'Right',

    indicatorColor: 'Indicator color',
    indicatorColorDesc: 'Follow theme accent or pick a custom color',

    multiLineSelection: 'Multi-line selection',
    multiLineSelectionDesc: 'Disable to keep single-block drag only',
    mobileDragLongPressMs: 'Mobile drag arm duration',
    mobileDragLongPressMsDesc: 'On mobile (drag mode on), hold this long before a press can start a drag (ms)',
    mouseRangeSelectLongPressMs: 'Multi-select long-press duration',
    mouseRangeSelectLongPressMsDesc:
        'Hold a handle (or a row in mobile drag mode) this long to enter multi-block selection (ms)',
    autoScrollEdgeZonePx: 'Auto-scroll edge zone',
    autoScrollEdgeZonePxDesc: 'Distance from viewport edge to trigger auto-scroll while dragging (px)',
    autoScrollMaxSpeedPx: 'Auto-scroll max speed',
    autoScrollMaxSpeedPxDesc: 'Maximum pixels scrolled per frame during auto-scroll',
    disableMobileDragModeAfterDrop: 'Disable drag mode after move',
    disableMobileDragModeAfterDropDesc: 'On mobile, automatically exit drag mode after a block is moved successfully',
    mobileTextLongPressDrag: 'Mobile text long-press drag',
    mobileTextLongPressDragDesc:
        'On mobile, long-press a text line or rendered block content to drag the current block directly without using the left handle',
    optionMobileDragModeToggleViewAction: 'View actions',
};
