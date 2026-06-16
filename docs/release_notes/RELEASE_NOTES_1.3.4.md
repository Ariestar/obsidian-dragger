# Dragger 1.3.4 Release Notes

2026-06-16

## 中文

### 发布信息

- 版本号：`1.3.4`
- 变更区间：`1.3.3..1.3.4`
- 兼容性：交互稳定性维护版本，无破坏性变更；建议使用多选、移动端拖拽或自动滚动设置的用户升级。

### 变更

#### 1) 多选拖拽与滑动选择修复

- 修复多选模式下点击已选中手柄会先取消当前行、长按后又把当前行算回拖拽源的问题。现在短按是单纯 toggle 当前块，长按则保留当前多选集合并进入拖拽。[[74ca0d5](https://github.com/Ariestar/obsidian-dragger/commit/74ca0d5)]
- 滑动经过多选手柄时，现在会 toggle 滑过的所有块；选中与取消选中走同一套选择更新逻辑，避免两端行为不一致。[[3ccd650](https://github.com/Ariestar/obsidian-dragger/commit/3ccd650)] [[52cd15e](https://github.com/Ariestar/obsidian-dragger/commit/52cd15e)]
- 修复滑动取消选中时无法处理后渲染块的问题，包括分割线、表格和 LaTeX/math 块。滑动 toggle 现在使用统一的垂直块边界解析，不再依赖 gutter 位置的点命中。[[52cd15e](https://github.com/Ariestar/obsidian-dragger/commit/52cd15e)]
- 修复多选模式下点击没有手柄的空行后，已选中多行手柄可能暂时消失、滚动后才恢复的问题。[[3dce5db](https://github.com/Ariestar/obsidian-dragger/commit/3dce5db)]
- 调整拖拽手柄 gutter 布局，让手柄与 gutter marker 在水平方向上对齐。[[4955a59](https://github.com/Ariestar/obsidian-dragger/commit/4955a59)] [[3dce5db](https://github.com/Ariestar/obsidian-dragger/commit/3dce5db)]

#### 2) 移动端与拖拽行为修复

- 修复移动端进入拖拽模式命令与选区拖拽相关问题。[[1e1c6c5](https://github.com/Ariestar/obsidian-dragger/commit/1e1c6c5)]
- 自动滚动最大速度设置现在会实际参与拖拽时的滚动计算。[[f048836](https://github.com/Ariestar/obsidian-dragger/commit/f048836)]
- 统一平台检测逻辑，改用 Obsidian `Platform.isMobile` / `Platform.isDesktop`，减少移动端与桌面端判断不一致。[[b061dd2](https://github.com/Ariestar/obsidian-dragger/commit/b061dd2)] [[25a2909](https://github.com/Ariestar/obsidian-dragger/commit/25a2909)]

#### 3) 设置面板维护

- 修复移动端设置面板中空 `setClass('')` 可能导致的崩溃，并整理设置页小标题与导航结构。[[0a8bfb0](https://github.com/Ariestar/obsidian-dragger/commit/0a8bfb0)]
- 集中处理设置迁移和数值 clamp 逻辑，减少设置读取与升级路径里的重复代码。[[24b02c7](https://github.com/Ariestar/obsidian-dragger/commit/24b02c7)]
- 移除移动端工具栏命令的独立位置开关，简化相关设置和命令注册路径。[[d7b8103](https://github.com/Ariestar/obsidian-dragger/commit/d7b8103)]

## English

### Release Info

- Version: `1.3.4`
- Changes: `1.3.3..1.3.4`
- Compatibility: interaction stability maintenance release with no breaking changes; users relying on multi-selection, mobile drag, or auto-scroll settings are recommended to upgrade.

### Changes

#### 1) Multi-Selection Drag and Brush Selection Fixes

- Fixed selected handles in multi-selection mode briefly toggling off on pointer down before long-press drag. A short click now only toggles the current block, while long-press drag keeps the retained multi-selection as the drag source. [[74ca0d5](https://github.com/Ariestar/obsidian-dragger/commit/74ca0d5)]
- Sliding across selected handles now toggles every crossed block. Selection and deselection share the same selection update path to keep both directions consistent. [[3ccd650](https://github.com/Ariestar/obsidian-dragger/commit/3ccd650)] [[52cd15e](https://github.com/Ariestar/obsidian-dragger/commit/52cd15e)]
- Fixed brush deselection for rendered blocks, including dividers, tables, and LaTeX/math blocks. Brush toggle now resolves blocks through a unified vertical boundary path instead of relying on point lookup from the gutter. [[52cd15e](https://github.com/Ariestar/obsidian-dragger/commit/52cd15e)]
- Fixed selected handles temporarily disappearing after clicking an empty line without a handle in multi-selection mode. [[3dce5db](https://github.com/Ariestar/obsidian-dragger/commit/3dce5db)]
- Adjusted drag handle gutter placement so handles align horizontally with the gutter marker. [[4955a59](https://github.com/Ariestar/obsidian-dragger/commit/4955a59)] [[3dce5db](https://github.com/Ariestar/obsidian-dragger/commit/3dce5db)]

#### 2) Mobile and Drag Behavior Fixes

- Fixed issues around the mobile enter-drag-mode command and selection-based dragging. [[1e1c6c5](https://github.com/Ariestar/obsidian-dragger/commit/1e1c6c5)]
- Auto-scroll max speed setting now takes effect during drag scrolling. [[f048836](https://github.com/Ariestar/obsidian-dragger/commit/f048836)]
- Unified platform detection through Obsidian `Platform.isMobile` / `Platform.isDesktop`, reducing inconsistent desktop/mobile branching. [[b061dd2](https://github.com/Ariestar/obsidian-dragger/commit/b061dd2)] [[25a2909](https://github.com/Ariestar/obsidian-dragger/commit/25a2909)]

#### 3) Settings Panel Maintenance

- Fixed a possible crash from empty `setClass('')` calls in mobile settings, and cleaned up settings subheadings and navigation structure. [[0a8bfb0](https://github.com/Ariestar/obsidian-dragger/commit/0a8bfb0)]
- Centralized settings migrations and numeric clamp logic to reduce duplicated upgrade/read paths. [[24b02c7](https://github.com/Ariestar/obsidian-dragger/commit/24b02c7)]
- Removed the separate mobile toolbar command location toggle, simplifying related settings and command registration. [[d7b8103](https://github.com/Ariestar/obsidian-dragger/commit/d7b8103)]
