[![English](https://img.shields.io/badge/lang-English-blue)](README.md) [![中文](https://img.shields.io/badge/lang-中文-red)](README.zh-CN.md)

# Dragger

**像 Notion 一样，在 Obsidian 中拖拽任意块来重新排列内容。**

[![Obsidian](https://img.shields.io/badge/Obsidian-%3E%3D1.13.0-7c3aed?logo=obsidian&logoColor=white)](https://community.obsidian.md/plugins/dragger) [![Obsidian Community Plugin](https://img.shields.io/badge/Obsidian-Community%20Plugin-7c3aed?logo=obsidian&logoColor=white)](https://community.obsidian.md/plugins/dragger) [![npm](https://img.shields.io/npm/v/md-dragger?logo=npm&label=npm)](https://www.npmjs.com/package/md-dragger) ![License](https://img.shields.io/github/license/Ariestar/obsidian-dragger) ![Release](https://img.shields.io/github/v/release/Ariestar/obsidian-dragger) ![Downloads](https://img.shields.io/github/downloads/Ariestar/obsidian-dragger/total?color=blue) ![Stars](https://img.shields.io/github/stars/Ariestar/obsidian-dragger?style=social) ![CI](https://img.shields.io/github/actions/workflow/status/Ariestar/obsidian-dragger/ci.yml?branch=main&label=CI) ![TypeScript](https://img.shields.io/badge/TypeScript-5.9-blue?logo=typescript&logoColor=white) ![Issues](https://img.shields.io/github/issues/Ariestar/obsidian-dragger) [![Ask DeepWiki](https://deepwiki.com/badge.svg)](https://deepwiki.com/Ariestar/obsidian-dragger)

![gif](https://github.com/user-attachments/assets/bfb3ac7d-7dfe-4c24-a428-5d08b49d0654)

## 功能

- 🧱 **块级拖拽** — 段落、标题、列表、任务、引用、Callout、表格、代码块、数学块
- 📐 **嵌套拖拽** — 横向位置控制缩进层级，纵向位置控制插入行
- 🔗 **多行选取拖拽** — 点击或长按选取多行，整组拖动；桌面端选中的 handle 显示为原生 checkbox
- 🎨 **手柄外观可定制** — 4 种图标（圆点 / 六点 / 三横线 / 方块）、可调大小、颜色、横向偏移
- 📍 **可视化落点指示器** — 发光线条精确显示块将被放置的位置
- 📱 **移动端支持** — 长按拖拽模式、底部工具栏块类型转换、拖拽时边缘自动滚动
- ⌨️ **快捷键** — 桌面端按 Escape 退出多选模式
- 🗑️ **块类型菜单含删除** — 从右键菜单转换块类型或删除当前块

## 安装

### 社区插件

打开 **设置 → 第三方插件 → 浏览**，搜索 **Dragger** 并安装。

### 手动安装

从 [最新 Release](https://github.com/Ariestar/obsidian-dragger/releases) 下载 `main.js`、`manifest.json` 和 `styles.css`，复制到：

```
<你的仓库>/.obsidian/plugins/dragger/
```

重启 Obsidian 并启用插件。

## Headless core npm 包

Dragger 同时发布平台无关的 npm core。这个 core 不导入 Obsidian、CodeMirror、DOM event 或编辑器 dispatch API。

```bash
npm install md-dragger
```

稳定入口：

```ts
import { DraggerRuntime } from 'md-dragger/drag';
```

接入其他编辑器平台时，只需要提供输入、文档读写、行定位和预览渲染：

```ts
new DraggerRuntime({
  input,
  document: { getDoc, applyChanges },
  locate: { sourceLineFromInput, targetLineFromPoint },
  preview,
});
```

## 使用

1. **悬停** 在任意块的左侧边缘，显示拖拽手柄
2. **拖动** 手柄到目标位置 — 发光指示器显示块将被插入的位置
3. **松开** 即可完成放置

**嵌套列表与引用：** 拖动时横向移动光标可控制缩进层级。

**多行选取：** 长按（触屏）或点击多个手柄选取范围，然后拖动整个选区。按 **Escape** 退出多选。

**移动端文本长按拖拽：** 开启后，可在文本整行或块内容区域长按直接拖动单个块，无需先去点左侧手柄。

**块类型转换：** 右键点击手柄（桌面端）或使用底部工具栏（移动端）可转换块类型或删除当前块。

> 💡 **提示：** 建议在 Obsidian 设置中开启行号显示 — 手柄会出现在行号栏的位置，操作更直观。

## 设置

| 设置项 | 说明 | 默认值 |
|--------|------|--------|
| **手柄颜色** | 跟随主题强调色或自定义颜色 | 主题色 |
| **手柄显示模式** | 悬停显示 / 始终显示 / 隐藏 | 悬停 |
| **手柄图标** | ● 圆点 / ⠿ 六点抓手 / ☰ 三横线 / ■ 方块 | 六点抓手 |
| **手柄大小** | 12 – 28 px | 20 px |
| **手柄横向偏移** | 向左（−80）或向右（+80）微调位置 | 0 px |
| **指示器颜色** | 跟随主题强调色或自定义颜色 | 主题色 |
| **多行选取** | 启用选取后拖拽的工作流 | 开启 |
| **移动端文本长按拖拽** | 移动端在文本整行或块内容区域长按可直接拖拽单个块 | 开启 |
| **拖拽源视觉样式** | 拖拽源高亮和列表落点高亮共用的样式（纯边框 / 简约高亮 / 背景增强） | 简约高亮 |
| **拖拽源高亮** | 开关拖拽时被拖动块的高亮 | 开启 |
| **列表落点高亮** | 开关列表拖拽落点区域的高亮 | 开启 |

## 兼容性

- Obsidian **≥ 1.0.0**
- 桌面端（Windows、macOS、Linux）+ 移动端（Android 已测试）

## 开发计划

- 多栏布局 — 把块拖到并排的列中
- 更多样式自定义 — 手柄图标、颜色、主题适配
- 交互方式优化 — 更好的视觉反馈、更流畅的手势
- 跨文档拖拽 — 在不同笔记之间移动块

## 开发

```bash
npm install
npm run dev       # 监听模式，热重载
npm run build     # 生产构建
npm run test      # 运行 Vitest 测试套件（229 个测试）
npm run typecheck # TypeScript 类型检查
npm run lint -- --max-warnings=0
```

## 许可

[MIT](LICENSE)

## 贡献

欢迎提交 PR 和 Issue！

如果这个插件对你有帮助，欢迎在 GitHub 点个 ⭐

## 社区

| QQ 群 | 微信赞赏 |
|:------:|:--------:|
| ![QQ 群](assets/qq-group.jpg) | ![微信](assets/wechat_donate.png) |
