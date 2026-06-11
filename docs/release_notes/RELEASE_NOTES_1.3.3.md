# Dragger 1.3.3 Release Notes

2026-06-11

## 中文

### 发布信息

- 版本号：`1.3.3`
- 变更区间：`1.3.2..1.3.3`
- 兼容性：纯维护版本，无功能变更，建议所有用户升级以恢复客户端更新检测。

### 变更

#### 1) 修复更新检测

- 补充缺失的 `versions.json`，用于映射插件版本与最低 Obsidian 版本。此前缺少该文件导致 Obsidian 客户端无法正确检测到新版本。

#### 2) 新增演示网站

- 在 `examples/site` 下新增插件介绍与体验网站，基于 Astro + Shadcn/UI 构建，内嵌 markdown 编辑器演示。该网站仅用于展示，不影响插件本体。[[37d1c24](https://github.com/Ariestar/obsidian-dragger/commit/37d1c24)]

## English

### Release Info

- Version: `1.3.3`
- Changes: `1.3.2..1.3.3`
- Compatibility: maintenance release only, no functional changes; all users are recommended to upgrade to restore client update detection.

### Changes

#### 1) Fix Update Detection

- Added the missing `versions.json`, which maps plugin versions to their minimum Obsidian version. Its absence previously prevented the Obsidian client from detecting new releases.

#### 2) Add Demo Site

- Added a plugin showcase and playground site under `examples/site`, built with Astro + Shadcn/UI and an embedded markdown editor demo. The site is for showcase only and does not affect the plugin itself. [[37d1c24](https://github.com/Ariestar/obsidian-dragger/commit/37d1c24)]
