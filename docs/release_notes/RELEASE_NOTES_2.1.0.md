# Dragger 2.1.0 Release Notes

2026-10-03

## 中文

最低 Obsidian 版本保持为 **1.13.0**，支持桌面和移动端。

### 新功能

- 在设置中调整块类型弹出菜单的顺序，包括标题、列表、Callout 和自定义分组的子项。复制、剪切和删除操作保持固定。
- 添加独立的 Callout 类型，以及支持内容变量、预设变量和逐行前缀的自定义块模板。菜单、设置和子页面共用块类型定义与翻译。[#104](https://github.com/Ariestar/obsidian-dragger/pull/104)
- 默认手柄采用六点抓手；新增可搜索的自定义图标选择器，与自定义块样式共用原生图标选择界面。[#105](https://github.com/Ariestar/obsidian-dragger/pull/105)

### 修复

- 修正菜单设置中图标的位置、段落图标缺失和子页面排序手柄缺失，支持键盘打开菜单分组。
- 侧栏聚焦时，移动端“切换块类型”仍能使用最近的正文编辑器。[#103](https://github.com/Ariestar/obsidian-dragger/pull/103)
- 改善 Canvas 卡片和弹出窗口中的拖拽、指示线及跨窗口列表嵌套。[#94](https://github.com/Ariestar/obsidian-dragger/pull/94)
- 自定义图标保存失败会明确报告；仅在保存成功后刷新设置页面。

### 依赖

- 更新至 `md-dragger 2.2.0`，发布构建使用 lockfile 固定的 npm 包。

## English

Requires **Obsidian 1.13.0 or later**, with desktop and mobile support.

### Added

- Reorder the block-type popup menu and the entries inside heading, list, Callout, and custom groups. Copy, cut, and delete actions remain fixed.
- A dedicated Callout type and custom block templates with content variables, preset variables, and per-line prefixes. Menus and settings share block definitions and translations. [#104](https://github.com/Ariestar/obsidian-dragger/pull/104)
- A six-dot default handle and a searchable custom icon picker shared with custom block styles. [#105](https://github.com/Ariestar/obsidian-dragger/pull/105)

### Fixed

- Menu settings show icons beside labels, including paragraphs, and expose reorder handles on subpages. Menu groups support keyboard activation.
- The mobile block-type command uses the most-recent root Markdown editor while a sidebar has focus. [#103](https://github.com/Ariestar/obsidian-dragger/pull/103)
- Dragging, drop indicators, and cross-window list nesting work across Canvas cards and pop-out windows. [#94](https://github.com/Ariestar/obsidian-dragger/pull/94)
- Custom icon save failures are reported, and settings refresh only after a successful save.

### Dependencies

- Upgrade to `md-dragger 2.2.0`; release builds consume the lockfile-pinned npm package.
