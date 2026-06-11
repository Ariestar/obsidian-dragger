export const zhCn = {
    // Headings
    headingAppearance: '外观',
    headingHandle: '拖拽手柄',
    headingHighlight: '高亮效果',
    headingBehavior: '行为',
    headingMobile: '移动端',

    // Handle color
    handleColor: '手柄颜色',
    handleColorDesc: '跟随主题强调色或自定义颜色',
    optionTheme: '跟随主题色',
    optionCustom: '自定义',

    // Handle visibility
    handleVisibility: '手柄显示模式',
    handleVisibilityDesc: '控制拖拽手柄的显示方式',
    optionHover: '悬停显示',
    optionAlways: '始终显示',
    optionHidden: '隐藏',
    selectionVisualStyle: '拖拽源视觉样式',
    selectionVisualStyleDesc: '统一高亮样式',
    optionBlockSelectionVisualOutline: '纯边框',
    optionBlockSelectionVisualSubtle: '简约高亮',
    optionBlockSelectionVisualFilled: '背景增强',
    enableBlockSelectionHighlight: '拖拽源高亮',
    enableBlockSelectionHighlightDesc: '高亮被拖动的源块',
    enableListDropHighlight: '列表落点高亮',
    enableListDropHighlightDesc: '高亮列表内可放置区域',

    // Handle icon
    handleIcon: '手柄图标',
    handleIconDesc: '选择拖拽手柄的图标样式',
    iconDot: '● 圆点',
    iconGripDots: '⠿ 六点抓手',
    iconGripLines: '☰ 三横线',
    iconSquare: '■ 方块',

    // Handle size
    handleSize: '手柄大小',
    handleSizeDesc: '调整拖拽手柄的大小（像素）',

    // Handle offset
    handleOffset: '手柄横向位置',
    handleOffsetDesc: '向左为负值，向右为正值',
    handleGutterPosition: '手柄所在侧',
    handleGutterPositionDesc: '控制手柄 gutter 显示在编辑器左侧还是右侧',
    optionLeft: '左侧',
    optionRight: '右侧',

    // Indicator color
    indicatorColor: '指示器颜色',
    indicatorColorDesc: '跟随主题强调色或自定义颜色',

    // Multi-line selection
    multiLineSelection: '多行选取',
    multiLineSelectionDesc: '关闭后仅保留单块拖拽，不进入多行选取流程',
    multiLineSelectionLongPressMs: '多选模式长按时长',
    multiLineSelectionLongPressMsDesc: '输入毫秒数（300-2000），移动端长按达到该时长后进入多文本块选择模式',
    disableMobileDragModeAfterDrop: '移动后关闭拖拽模式',
    disableMobileDragModeAfterDropDesc: '开启后，移动端每次成功移动文本块后会自动退出拖拽模式',
    mobileTextLongPressDrag: '移动端文本长按拖拽',
    mobileTextLongPressDragDesc: '移动端在文本整行或块内容区域长按可直接拖拽当前块，无需左侧手柄',
    mobileDragModeToggleLocations: 'Toggle 按钮位置',
    mobileDragModeToggleLocationsDesc: '选择移动端拖拽模式开关显示在哪些入口，可多选或不选',
    optionMobileDragModeToggleViewAction: '视图操作栏',
    optionMobileDragModeToggleToolbarCommand: '底部工具栏',
    enableCrossFileDrag: '跨文件拖拽',
    enableCrossFileDragDesc: '允许将块拖拽到已打开编辑器、内部链接或文件列表笔记中',
    mobileOnlyNotice: '⚠️ 以下设置仅在移动端可修改',

};

export type ZhCnStrings = typeof zhCn;
