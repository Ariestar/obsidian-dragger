# Dragger 2.0.0 Release Notes

2026-08-05

## 中文

### 发布信息

- 版本号：`2.0.0`
- 变更区间：`1.3.4..2.0.0`
- 兼容性：**破坏性变更**——最低 Obsidian 版本从 `1.2.3` 提升至 `1.13.0`，旧版本 Obsidian 无法再使用本插件。升级前请确认你的 Obsidian 版本。

### 破坏性变更

#### 1) 平台要求提升

- 最低 Obsidian 版本从 `1.2.3` 提升到 `1.13.0`（minAppVersion）。`1.13` 以下版本的 Obsidian 不再支持，请先升级 Obsidian 再更新插件。[[057e538](https://github.com/Ariestar/obsidian-dragger/commit/057e538)]

#### 2) 设置页迁移到 Obsidian 原生 declarative settings

- 设置界面从自定义 HTML 迁移到 Obsidian 1.13+ 的原生 declarative settings，外观与交互由 Obsidian 统一渲染。[[057e538](https://github.com/Ariestar/obsidian-dragger/commit/057e538)] [[ad3c1e1](https://github.com/Ariestar/obsidian-dragger/commit/ad3c1e1)]
- **已移除的设置项**（设置项从 21 项调整为 19 项）：
  - `enableCrossFileDrag`——跨文件拖拽改为始终可用，不再需要开关；
  - `enableListDropHighlight`——列表拖放高亮改为始终渲染；
  - `multiLineSelectionLongPressMs`——并入统一的长按时长设置（`mouseRangeSelectLongPressMs`）；
  - `mobileDragModeToggleLocations`——移动端工具栏位置开关移除。
- **新增设置项**：`mobileDragModeToggleEnabled`（移动端拖拽模式开关）。
- 升级提示：若旧设置文件中包含上述已移除项，它们会被忽略，不会报错。

### 新特性

#### 1) 多选拖拽（长按多选 + 拖拽源视觉）

- 长按手柄进入多选拖拽，被选中的多个块作为整体拖拽源，拖拽时保留多选视觉。[[ed4d7a9](https://github.com/Ariestar/obsidian-dragger/commit/ed4d7a9)] [[7364226](https://github.com/Ariestar/obsidian-dragger/commit/7364226)]
- 桌面与移动端统一了"按住进入多选、移动开始拖拽"的双阶段手势计时。[[7364226](https://github.com/Ariestar/obsidian-dragger/commit/7364226)]
- 选择高亮与复选框渲染改为从引擎的选区行范围派生、以 CM6 decorations 绘制，滚动与重排时保持稳定，不再依赖 DOM 覆盖层。[[1fb0e71](https://github.com/Ariestar/obsidian-dragger/commit/1fb0e71)] [[a133292](https://github.com/Ariestar/obsidian-dragger/commit/a133292)] [[90e747c](https://github.com/Ariestar/obsidian-dragger/commit/90e747c)]

#### 2) 块类型菜单交互重构

- 手柄上点击即可打开块类型菜单（桌面悬停显示手柄、按下打开菜单）。[[dfce575](https://github.com/Ariestar/obsidian-dragger/commit/dfce575)] [[9d86f80](https://github.com/Ariestar/obsidian-dragger/commit/9d86f80)]
- 菜单定位改为以手柄所在行为准，不再跟随编辑器光标。[[b750b6b](https://github.com/Ariestar/obsidian-dragger/commit/b750b6b)] [[f683b5a](https://github.com/Ariestar/obsidian-dragger/commit/f683b5a)]
- 嵌套的块类型分组改为页面式导航，桌面悬停打开、点击应用，替代原来的双层弹层。[[08427d0](https://github.com/Ariestar/obsidian-dragger/commit/08427d0)] [[12e843a](https://github.com/Ariestar/obsidian-dragger/commit/12e843a)] [[2ee1d75](https://github.com/Ariestar/obsidian-dragger/commit/2ee1d75)]
- 移动端菜单稳定性：仅在松开手指时打开菜单、拖拽阶段锁定滚动与页面平移，避免菜单与拖拽互相干扰。[[db8fdfc](https://github.com/Ariestar/obsidian-dragger/commit/db8fdfc)] [[9050843](https://github.com/Ariestar/obsidian-dragger/commit/9050843)] [[1e2f7fa](https://github.com/Ariestar/obsidian-dragger/commit/1e2f7fa)]

#### 3) 跨文件拖拽

- 跨文件拖拽提交按文档身份（Doc）路由，可将块拖到其他打开的笔记中；`enableCrossFileDrag` 开关已移除，功能始终可用。[[19e6744](https://github.com/Ariestar/obsidian-dragger/commit/19e6744)] [[4db7f81](https://github.com/Ariestar/obsidian-dragger/commit/4db7f81)]

### 修复

#### 1) 表格单元格编辑冲突（issue #53）

- 修复 Live Preview 中点击表格单元格会在单元格内出现拖拽手柄并产生缩进的问题。现在单元格嵌套编辑器内完全停用拖拽（引擎新增视图排除选项 `enabled`），表格仍可通过表头行的手柄整块拖拽。[[3f47053](https://github.com/Ariestar/obsidian-dragger/commit/3f47053)]

#### 2) 拖放指示器与几何对齐

- 拖放指示器（drop seam）改为零布局的 CM6 decoration 渲染，滚动/重排时不再依赖 DOM 覆盖层。[[f26776c](https://github.com/Ariestar/obsidian-dragger/commit/f26776c)] [[56b340c](https://github.com/Ariestar/obsidian-dragger/commit/56b340c)]
- 列表缩进步长改为从 Obsidian 渲染 token 读取，拖放指示器渲染在缩进后的目标位置，行距左边缘与列表标记/缩进对齐一致。[[7b9d734](https://github.com/Ariestar/obsidian-dragger/commit/7b9d734)] [[9552596](https://github.com/Ariestar/obsidian-dragger/commit/9552596)] [[e646ae9](https://github.com/Ariestar/obsidian-dragger/commit/e646ae9)]
- 拖拽中光标样式在视图销毁时正确清理。[[efc0e83](https://github.com/Ariestar/obsidian-dragger/commit/efc0e83)]

#### 3) 移动端

- 拖拽模式下抑制原生文本选择，避免拖拽与选中互相干扰。[[1e2f7fa](https://github.com/Ariestar/obsidian-dragger/commit/1e2f7fa)]
- 边缘自动滚动改走适配层的滚动端口，与 Obsidian 编辑器滚动协同。[[0cb4e56](https://github.com/Ariestar/obsidian-dragger/commit/0cb4e56)]

### 工程与依赖

- 正式消费 `md-dragger` npm 包（`^2.0.1`），删除仓库内 vendored 拷贝，平台层改用引擎提供的适配器与运行时。[[2b134c5](https://github.com/Ariestar/obsidian-dragger/commit/2b134c5)] [[d2832e2](https://github.com/Ariestar/obsidian-dragger/commit/d2832e2)]
- 迁移到 pnpm，接入 biome 格式化，开启 `verbatimModuleSyntax`。[[29b84cd](https://github.com/Ariestar/obsidian-dragger/commit/29b84cd)] [[f02fa50](https://github.com/Ariestar/obsidian-dragger/commit/f02fa50)]
- 语言检测改用 Obsidian `getLanguage` API，界面翻译接入中文等语言。[[eb3edb0](https://github.com/Ariestar/obsidian-dragger/commit/eb3edb0)]
- 采用 `eslint-plugin-obsidianmd` 0.4.1 规则。[[b4726e8](https://github.com/Ariestar/obsidian-dragger/commit/b4726e8)]

## English

### Release Info

- Version: `2.0.0`
- Changes: `1.3.4..2.0.0`
- Compatibility: **Breaking change** — the minimum Obsidian version is raised from `1.2.3` to `1.13.0`; the plugin no longer works on older Obsidian. Upgrade Obsidian first if you are on a version below 1.13.

### Breaking Changes

#### 1) Raised Platform Requirement

- Minimum Obsidian version raised from `1.2.3` to `1.13.0` (minAppVersion). Obsidian below 1.13 is no longer supported; upgrade Obsidian before updating the plugin. [[057e538](https://github.com/Ariestar/obsidian-dragger/commit/057e538)]

#### 2) Settings Migrated to Obsidian Native Declarative Settings

- The settings UI moved from custom HTML to Obsidian 1.13+ native declarative settings, rendered by Obsidian itself. [[057e538](https://github.com/Ariestar/obsidian-dragger/commit/057e538)] [[ad3c1e1](https://github.com/Ariestar/obsidian-dragger/commit/ad3c1e1)]
- **Removed settings** (the list changed from 21 to 19 items):
  - `enableCrossFileDrag` — cross-file dragging is now always available;
  - `enableListDropHighlight` — the list drop highlight is now always rendered;
  - `multiLineSelectionLongPressMs` — merged into the unified long-press duration (`mouseRangeSelectLongPressMs`);
  - `mobileDragModeToggleLocations` — mobile toolbar position toggle removed.
- **New setting**: `mobileDragModeToggleEnabled` (mobile drag-mode toggle).
- Upgrade note: leftover removed keys in an old settings file are ignored silently.

### New Features

#### 1) Multi-Select Drag (Long-Press Multi-Select + Drag-Source Visuals)

- Long-pressing a handle enters multi-select drag; the selected blocks form a single drag source with retained visuals. [[ed4d7a9](https://github.com/Ariestar/obsidian-dragger/commit/ed4d7a9)] [[7364226](https://github.com/Ariestar/obsidian-dragger/commit/7364226)]
- Desktop and mobile share a unified two-phase gesture timing (press to select, move to drag). [[7364226](https://github.com/Ariestar/obsidian-dragger/commit/7364226)]
- Selection highlight and checkboxes are now derived from the engine's selection line ranges and drawn as CM6 decorations, staying stable across scroll and reflow instead of relying on DOM overlays. [[1fb0e71](https://github.com/Ariestar/obsidian-dragger/commit/1fb0e71)] [[a133292](https://github.com/Ariestar/obsidian-dragger/commit/a133292)] [[90e747c](https://github.com/Ariestar/obsidian-dragger/commit/90e747c)]

#### 2) Block-Type Menu Interaction Rework

- Tapping a handle opens the block-type menu (handle on hover, menu on press). [[dfce575](https://github.com/Ariestar/obsidian-dragger/commit/dfce575)] [[9d86f80](https://github.com/Ariestar/obsidian-dragger/commit/9d86f80)]
- The menu is positioned by the handle's line instead of the editor cursor. [[b750b6b](https://github.com/Ariestar/obsidian-dragger/commit/b750b6b)] [[f683b5a](https://github.com/Ariestar/obsidian-dragger/commit/f683b5a)]
- Nested block-type groups use page-style navigation (hover to open, click to apply) instead of a stacked double popover. [[08427d0](https://github.com/Ariestar/obsidian-dragger/commit/08427d0)] [[12e843a](https://github.com/Ariestar/obsidian-dragger/commit/12e843a)] [[2ee1d75](https://github.com/Ariestar/obsidian-dragger/commit/2ee1d75)]
- Mobile menu stability: the menu opens only on pointer-up, and scroll/pan are locked during drag so the menu and drag do not interfere. [[db8fdfc](https://github.com/Ariestar/obsidian-dragger/commit/db8fdfc)] [[9050843](https://github.com/Ariestar/obsidian-dragger/commit/9050843)] [[1e2f7fa](https://github.com/Ariestar/obsidian-dragger/commit/1e2f7fa)]

#### 3) Cross-File Drag

- Cross-file drag commits are routed by document identity; blocks can be dragged into other open notes, and the `enableCrossFileDrag` toggle has been removed since the feature is always on. [[19e6744](https://github.com/Ariestar/obsidian-dragger/commit/19e6744)] [[4db7f81](https://github.com/Ariestar/obsidian-dragger/commit/4db7f81)]

### Fixes

#### 1) Table Cell Editing Conflict (issue #53)

- Fixed drag handles and indentation appearing inside table cells in Live Preview. Dragging is now fully dormant inside the nested cell editor (the engine gained a view exclusion option `enabled`), while the table remains draggable as a whole via its header row handle. [[3f47053](https://github.com/Ariestar/obsidian-dragger/commit/3f47053)]

#### 2) Drop Indicator and Geometry Alignment

- The drop seam now renders as a zero-layout CM6 decoration instead of a DOM overlay, staying stable across scroll and reflow. [[f26776c](https://github.com/Ariestar/obsidian-dragger/commit/f26776c)] [[56b340c](https://github.com/Ariestar/obsidian-dragger/commit/56b340c)]
- List indent steps are read from Obsidian rendering tokens, the drop indicator renders at the indented target, and line-band left edges align consistently with list markers/indent. [[7b9d734](https://github.com/Ariestar/obsidian-dragger/commit/7b9d734)] [[9552596](https://github.com/Ariestar/obsidian-dragger/commit/9552596)] [[e646ae9](https://github.com/Ariestar/obsidian-dragger/commit/e646ae9)]
- The dragging cursor class is cleared when a view is destroyed. [[efc0e83](https://github.com/Ariestar/obsidian-dragger/commit/efc0e83)]

#### 3) Mobile

- Native text selection is suppressed in drag mode so selection and dragging do not fight each other. [[1e2f7fa](https://github.com/Ariestar/obsidian-dragger/commit/1e2f7fa)]
- Edge auto-scroll now goes through the adapter scroll port, coordinating with the Obsidian editor scroll. [[0cb4e56](https://github.com/Ariestar/obsidian-dragger/commit/0cb4e56)]

### Engineering and Dependencies

- Now consumes the `md-dragger` npm package (`^2.0.1`), removing the vendored copy; the platform layer uses the engine's adapter and runtime. [[2b134c5](https://github.com/Ariestar/obsidian-dragger/commit/2b134c5)] [[d2832e2](https://github.com/Ariestar/obsidian-dragger/commit/d2832e2)]
- Migrated to pnpm, adopted biome formatting, and enabled `verbatimModuleSyntax`. [[29b84cd](https://github.com/Ariestar/obsidian-dragger/commit/29b84cd)] [[f02fa50](https://github.com/Ariestar/obsidian-dragger/commit/f02fa50)]
- Language detection now uses the Obsidian `getLanguage` API; UI translations include Chinese. [[eb3edb0](https://github.com/Ariestar/obsidian-dragger/commit/eb3edb0)]
- Adopted `eslint-plugin-obsidianmd` 0.4.1 rules. [[b4726e8](https://github.com/Ariestar/obsidian-dragger/commit/b4726e8)]
