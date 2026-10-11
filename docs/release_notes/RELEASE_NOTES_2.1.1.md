# Dragger 2.1.1 Release Notes

2026-10-11

## 中文

最低 Obsidian 版本保持为 **1.13.0**，支持桌面和移动端。

### 修复

- **Minimal 主题与居中行宽适配**：修复在 Minimal 主题或使用自定义可读行宽居中排版时，拖拽手柄消失或位移到页面最左边缘的问题。手柄位置直接以实际渲染的 `.cm-line` 为物理事实源进行对齐。[#31](https://github.com/Ariestar/obsidian-dragger/issues/31), [#118](https://github.com/Ariestar/obsidian-dragger/pull/118)
- **拖拽指示线边界裁剪**：放置指示线横线（Drop seam indicator）在居中或全宽容器下严格闭合于文本行右边缘，避免在部分主题下横向穿透到屏幕最右侧。[#118](https://github.com/Ariestar/obsidian-dragger/pull/118)
- **列表拖拽缩进原点校正**：修复居中排版下拖拽列表项时缩进层级判定错位的问题。缩进判断以正文列物理原点为基准，在正文行首微调即可原地向前缩进，无需再向左拖拽横跨大半个屏幕。[md-dragger#107](https://github.com/Ariestar/md-dragger/pull/107)
- **列表延续文本块检测**：保留列表项内部缩进延续文本行的独立块检测与拖拽手柄。[md-dragger#106](https://github.com/Ariestar/md-dragger/pull/106)

### 依赖

- 更新至 `md-dragger 2.2.1`，发布构建使用 lockfile 固定的 npm 包。

## English

Requires **Obsidian 1.13.0 or later**, with desktop and mobile support.

### Fixed

- **Minimal Theme & Centered Line Layouts**: Fix issue where drag handles disappeared or were displaced to the far left margin in Minimal theme or centered readable line width layouts. Handles now align directly to the rendered `.cm-line` physical edge. [#31](https://github.com/Ariestar/obsidian-dragger/issues/31), [#118](https://github.com/Ariestar/obsidian-dragger/pull/118)
- **Drop Indicator Clamping**: Drop seam indicators are strictly clamped to the content line's right boundary (`right: 0`), preventing them from overshooting to the far right edge of the screen in 100%-width containers. [#118](https://github.com/Ariestar/obsidian-dragger/pull/118)
- **List Drop Indent Origin**: Anchor horizontal list drop indentation calculations to the physical content column origin. Outdenting near column 0 now works naturally without requiring the mouse to be dragged across the margin to the far left screen edge. [md-dragger#107](https://github.com/Ariestar/md-dragger/pull/107)
- **List Continuation Block Detection**: Preserve independent block detection and drag handles for continuation lines inside list items. [md-dragger#106](https://github.com/Ariestar/md-dragger/pull/106)

### Dependencies

- Upgrade to `md-dragger 2.2.1`; release builds consume the lockfile-pinned npm package.
