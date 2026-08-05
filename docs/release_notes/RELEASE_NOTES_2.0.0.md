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

- 设置界面从自定义 HTML 迁移到 Obsidian 1.13+ 的原生 declarative settings（分组为 Appearance / Behavior 两个页面），外观与交互由 Obsidian 统一渲染。[[057e538](https://github.com/Ariestar/obsidian-dragger/commit/057e538)] [[ad3c1e1](https://github.com/Ariestar/obsidian-dragger/commit/ad3c1e1)]
- 移动端特定设置项被整合/移除（如移动端工具栏位置开关等），设置项从 12 个精简为 12 个（Appearance 9 项 + Behavior 3 项），部分旧设置项不再提供。

### 变更

#### 1) 表格单元格编辑修复

- 修复 Live Preview 中点击表格单元格会在单元格内出现拖拽手柄并产生缩进的问题（issue #53）。现在单元格嵌套编辑器内完全停用拖拽，表格仍可通过表头行的手柄整块拖拽。[[3f47053](https://github.com/Ariestar/obsidian-dragger/commit/3f47053)]

#### 2) 渲染与交互重构

- 拖放指示器（drop seam）、拖拽高亮改为 CM6 decorations 渲染，滚动/重排时不再依赖 DOM 覆盖层，布局更稳定。[[f26776c](https://github.com/Ariestar/obsidian-dragger/commit/f26776c)] [[56b340c](https://github.com/Ariestar/obsidian-dragger/commit/56b340c)]
- 手柄 gutter 支持配置在行内容左侧或右侧。[[9d86f80](https://github.com/Ariestar/obsidian-dragger/commit/9d86f80)]
- 指针悬停块内容时显示手柄，点击手柄才弹出拖拽菜单，减少误触。[[303fabd](https://github.com/Ariestar/obsidian-dragger/commit/303fabd)] [[9d86f80](https://github.com/Ariestar/obsidian-dragger/commit/9d86f80)]

#### 3) 依赖与工程

- 升级核心引擎 `md-dragger` 到 `2.0.1`（新增视图排除选项 `enabled`，表格修复依赖此能力）。[[816a787](https://github.com/Ariestar/obsidian-dragger/commit/816a787)]
- 采用 `eslint-plugin-obsidianmd` 0.4.1 规则，语言检测改用 Obsidian `getLanguage` API。[[b4726e8](https://github.com/Ariestar/obsidian-dragger/commit/b4726e8)] [[eb3edb0](https://github.com/Ariestar/obsidian-dragger/commit/eb3edb0)]

## English

### Release Info

- Version: `2.0.0`
- Changes: `1.3.4..2.0.0`
- Compatibility: **Breaking change** — the minimum Obsidian version is raised from `1.2.3` to `1.13.0`; the plugin no longer works on older Obsidian. Upgrade Obsidian first if you are on a version below 1.13.

### Breaking Changes

#### 1) Raised Platform Requirement

- Minimum Obsidian version raised from `1.2.3` to `1.13.0` (minAppVersion). Obsidian below 1.13 is no longer supported; upgrade Obsidian before updating the plugin. [[057e538](https://github.com/Ariestar/obsidian-dragger/commit/057e538)]

#### 2) Settings Migrated to Obsidian Native Declarative Settings

- The settings UI moved from custom HTML to Obsidian 1.13+ native declarative settings (grouped into Appearance / Behavior pages), rendered by Obsidian itself. [[057e538](https://github.com/Ariestar/obsidian-dragger/commit/057e538)] [[ad3c1e1](https://github.com/Ariestar/obsidian-dragger/commit/ad3c1e1)]
- Mobile-specific settings were consolidated/removed (e.g. the mobile toolbar position toggle); the setting list is now Appearance 9 items + Behavior 3 items.

### Changes

#### 1) Table Cell Editing Fix

- Fixed drag handles and indentation appearing inside table cells in Live Preview (issue #53). Dragging is now fully dormant inside the nested cell editor, while the table remains draggable as a whole via its header row handle. [[3f47053](https://github.com/Ariestar/obsidian-dragger/commit/3f47053)]

#### 2) Rendering and Interaction Rework

- Drop seam and drag highlight now render as CM6 decorations instead of DOM overlays, staying stable across scroll and reflow. [[f26776c](https://github.com/Ariestar/obsidian-dragger/commit/f26776c)] [[56b340c](https://github.com/Ariestar/obsidian-dragger/commit/56b340c)]
- The handle gutter can be placed on the left or right of block content. [[9d86f80](https://github.com/Ariestar/obsidian-dragger/commit/9d86f80)]
- The handle appears when hovering block content, and the drag menu opens on handle presses only, reducing accidental triggers. [[303fabd](https://github.com/Ariestar/obsidian-dragger/commit/303fabd)] [[9d86f80](https://github.com/Ariestar/obsidian-dragger/commit/9d86f80)]

#### 3) Dependencies and Engineering

- Upgraded the core engine `md-dragger` to `2.0.1` (new view exclusion option `enabled`, which the table fix relies on). [[816a787](https://github.com/Ariestar/obsidian-dragger/commit/816a787)]
- Adopted `eslint-plugin-obsidianmd` 0.4.1 rules; language detection now uses the Obsidian `getLanguage` API. [[b4726e8](https://github.com/Ariestar/obsidian-dragger/commit/b4726e8)] [[eb3edb0](https://github.com/Ariestar/obsidian-dragger/commit/eb3edb0)]
