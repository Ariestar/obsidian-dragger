# Dragger 1.3.2 Release Notes

2026-06-11

## 中文

### 发布信息

- 版本号：`1.3.2`
- 变更区间：`1.3.1..1.3.2`
- 兼容性：功能更新版本，包含设置面板重构和新增可配置项，建议所有用户升级。

### 变更

#### 1) 设置面板重构

- 设置面板拆分为「外观」和「行为」两个 Tab 页，顶部导航切换，内容不再混在一起。[[6ea13a7](https://github.com/Ariestar/obsidian-dragger/commit/6ea13a7)]
- 外观 Tab 按「拖拽手柄」和「高亮效果」分组；行为 Tab 按通用设置和移动端设置分组。[[6ea13a7](https://github.com/Ariestar/obsidian-dragger/commit/6ea13a7)]
- 所有数值型设置改为「滑块 + 数字输入框 + Reset 按钮」组合，粗调精调兼顾。[[072239a](https://github.com/Ariestar/obsidian-dragger/commit/072239a)]
- 颜色选择器跟随主题时自动显示当前主题强调色，并禁用手动选择。[[6ea13a7](https://github.com/Ariestar/obsidian-dragger/commit/6ea13a7)]
- 移动端设置在桌面端以禁用状态展示，附带提示文字。[[072239a](https://github.com/Ariestar/obsidian-dragger/commit/072239a)]

#### 2) 新增可配置项

- **拖拽启动长按时长**（默认 200ms）：移动端手柄长按多久启动拖拽。[[072239a](https://github.com/Ariestar/obsidian-dragger/commit/072239a)]
- **桌面端长按进入范围选择时长**（默认 260ms）：鼠标长按手柄进入多块选择模式的等待时间。[[072239a](https://github.com/Ariestar/obsidian-dragger/commit/072239a)]
- **自动滚动触发距离**（默认 88px）：拖拽时指针距视口边缘多远开始自动滚动。[[072239a](https://github.com/Ariestar/obsidian-dragger/commit/072239a)]
- **自动滚动最大速度**（默认 22px/帧）：自动滚动每帧最大滚动像素数。[[072239a](https://github.com/Ariestar/obsidian-dragger/commit/072239a)]

#### 3) 默认值调整

- 跨文件拖拽默认开启。[[6ea13a7](https://github.com/Ariestar/obsidian-dragger/commit/6ea13a7)]
- 拖拽模式 Toggle 按钮默认仅显示在视图操作栏。[[072239a](https://github.com/Ariestar/obsidian-dragger/commit/072239a)]

#### 4) Bug 修复

- 修复块类型子菜单（Heading/List）点击选项后不生效的问题。根因：主菜单关闭时同步销毁子菜单，导致 click 事件被中断。[[4f52712](https://github.com/Ariestar/obsidian-dragger/commit/4f52712)]

---

## English

### Release Info

- Version: `1.3.2`
- Changes: `1.3.1..1.3.2`
- Compatibility: feature update with settings redesign and new configurable options; all users are recommended to upgrade.

### Changes

#### 1) Settings Panel Redesign

- Split settings into Appearance / Behavior tabs with top navigation. [[6ea13a7](https://github.com/Ariestar/obsidian-dragger/commit/6ea13a7)]
- Appearance tab groups settings under "Drag handle" and "Highlights"; Behavior tab separates general and mobile settings. [[6ea13a7](https://github.com/Ariestar/obsidian-dragger/commit/6ea13a7)]
- All numeric settings now use a slider + number input + reset button combo. [[072239a](https://github.com/Ariestar/obsidian-dragger/commit/072239a)]
- Color picker shows resolved theme accent color when in theme mode, and disables manual selection. [[6ea13a7](https://github.com/Ariestar/obsidian-dragger/commit/6ea13a7)]
- Mobile settings shown as disabled on desktop with an explanatory notice. [[072239a](https://github.com/Ariestar/obsidian-dragger/commit/072239a)]

#### 2) New Configurable Options

- **Drag start long-press duration** (default 200ms): how long to hold a handle on mobile before drag starts. [[072239a](https://github.com/Ariestar/obsidian-dragger/commit/072239a)]
- **Desktop range-select long-press duration** (default 260ms): how long to hold a handle with mouse before entering multi-block selection. [[072239a](https://github.com/Ariestar/obsidian-dragger/commit/072239a)]
- **Auto-scroll edge zone** (default 88px): distance from viewport edge to trigger auto-scroll while dragging. [[072239a](https://github.com/Ariestar/obsidian-dragger/commit/072239a)]
- **Auto-scroll max speed** (default 22px/frame): maximum pixels scrolled per frame during auto-scroll. [[072239a](https://github.com/Ariestar/obsidian-dragger/commit/072239a)]

#### 3) Default Value Changes

- Cross-file drag now enabled by default. [[6ea13a7](https://github.com/Ariestar/obsidian-dragger/commit/6ea13a7)]
- Drag mode toggle button defaults to view actions only. [[072239a](https://github.com/Ariestar/obsidian-dragger/commit/072239a)]

#### 4) Bug Fixes

- Fixed block type submenu items (Heading/List) not applying conversion on click. Root cause: parent menu hide synchronously destroyed the child menu before its click handler could fire. [[4f52712](https://github.com/Ariestar/obsidian-dragger/commit/4f52712)]
