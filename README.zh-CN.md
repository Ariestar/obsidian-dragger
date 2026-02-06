[English](README.md) · [中文](README.zh-CN.md)

# Dragger（Obsidian 插件）

拖拽任意块（段落、标题、列表、引用、Callout、表格、数学块等），像 Notion 一样重新排列内容。

---

## 功能
- 拖拽块级内容：段落 / 标题 / 列表 / 任务 / 引用 / Callout / 表格 / 数学块
- 嵌套拖拽：横向位置决定嵌套层级，纵向位置决定插入行
- 手柄颜色与定位线颜色可配置
- 手柄可常态显示
- 跨文件拖拽（实验性）

---

## 安装

### 社区插件
若已上架：在 Obsidian 中打开 **设置 → 第三方插件 → 浏览**，搜索 **Dragger** 并安装。

### BRAT（Beta 测试）
1. 安装 BRAT 插件
2. 在 BRAT 中添加你的仓库地址
3. 选择最新 Release 安装

### 手动安装
将 Release 里的 main.js、manifest.json、styles.css（如有）放到：
`
.obsidian/plugins/dragger
`
然后在 Obsidian 启用插件。

---

## 使用
- 悬停在块左侧出现拖拽手柄（可设置为常驻显示）
- 拖动手柄到目标位置，看到定位线/高亮后松开
- 嵌套列表/引用：横向位置决定嵌套深度

---

## 设置
- **抓取手柄颜色**：跟随主题色或自定义
- **始终显示拖拽手柄**
- **定位栏颜色**：跟随主题色或自定义
- **跨文件拖拽**（实验性）

---

## 兼容性
- 需要 Obsidian >= 1.0.0
- 仅桌面端（isDesktopOnly: true）

---

## 内部架构（贡献者）
- `src/editor/drag-handle.ts`：插件装配、View 生命周期、事件编排
- `src/editor/dnd/session.ts`：拖拽会话状态与视觉清理
- `src/editor/dnd/selectors.ts`：统一的选择器与 class 常量
- `src/editor/dnd/table-guard.ts`：渲染态表格单元格防护
- `src/editor/dnd/line-parser.ts`：引用/列表/缩进解析
- `src/editor/dnd/container-policy.ts`：容器隔离策略（列表/引用/callout）
- `src/editor/dnd/drop-target.ts`：落点与几何计算
- `src/editor/dnd/block-mutation.ts`：块移动时文本重写与插入文本构建

核心约束：视觉判定与功能判定走同一条策略路径，避免“有定位线但实际不能放”的分叉。

---

## 回归策略
- 使用 Vitest，测试文件位于 `src/**/*.spec.ts`
- 高风险策略模块已覆盖：
  - `line-parser.spec.ts`
  - `table-guard.spec.ts`
  - `container-policy.spec.ts`
  - `block-mutation.spec.ts`
- 建议每次提交前运行：
`
npm run test
npm run typecheck
npm run build
`

---

## 开发
`
npm install
npm run dev
`

构建 Release：
`
npm run build
`

---

## 许可
MIT

---

## 贡献
欢迎提交 PR 和 Issue。

如果这个插件对你有帮助，欢迎点个 Star ⭐
