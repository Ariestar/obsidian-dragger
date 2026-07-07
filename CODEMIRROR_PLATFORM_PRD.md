# PRD: CodeMirror Platform Layer Runtime Integration

> Status: Draft  
> Date: 2026-07-07  
> Scope: `src/platform/codemirror`

## 1. Goal

把 `src/platform/codemirror` 收敛成 `DraggerRuntime` 的 CodeMirror 平台接入层。

这一层只负责把 CodeMirror/DOM/Obsidian 的事实传给 runtime，并执行 CodeMirror 侧的 UI 和文档副作用。拖拽控制流、source block 解析、drop 合法性、move transaction 规划都由 `DraggerRuntime` 和 `domain` 完成。

目标接入形态固定为：

```ts
new DraggerRuntime({
  input,
  document: {
    getDoc,
    applyChanges,
  },
  locate: {
    sourceLineFromInput,
    targetLineFromPoint,
  },
  preview,
});
```

CodeMirror 层不能再实现自己的 drag controller、drop command builder、pipeline adapter 或兼容 wrapper。

## 2. Non-Goals

- 不重命名所有目录。
- 不把 `preview/` 删除；它是平台视觉层，应保留。
- 不在 CodeMirror 层复制 `DraggerRuntime` 的状态机。
- 不让平台返回 `BlockSelection`、`DropSnapshot`、`Command`、`PipelineOutput`。
- 不保留旧 adapter 兼容入口。
- 不为了跨编辑器或外部文件 drop 污染普通 CodeMirror runtime 主路径。
- 不把 DOM、CodeMirror、Obsidian 类型引入 `src/drag`。

## 3. Layer Boundary

### 3.1 `drag/runtime`

负责：

- 订阅归一化 input。
- 管理 press / ready / dragging / cancel / drop session。
- 根据 `sourceLineFromInput` 找 source line。
- 根据文档检测 source block。
- 内部统一单块和范围为 `BlockSelection`。
- 根据 `targetLineFromPoint` 找 drop line。
- 计算 preview 是否 allowed。
- 规划 move transaction。
- 调用 `document.applyChanges(changes)`。

不负责：

- DOM 事件监听。
- CodeMirror view dispatch 细节。
- handle DOM 查询。
- drop indicator DOM 渲染。
- hover handle 显示。
- Obsidian 设置读取。

### 3.2 `platform/codemirror`

负责：

- 把 PointerEvent / KeyboardEvent 归一化成 `DraggerInputSource`。
- 把 CodeMirror 文档暴露为 `getDoc()`。
- 把 runtime 产生的 `TextChange[]` 应用到 `view.dispatch`。
- 把 press input 定位到 source line。
- 把 pointer point 定位到 target line。
- 根据 runtime preview 渲染 drop indicator。
- 渲染 drag handle、hover handle、source visual。
- 同步 editor root class、gutter、settings update、view lifecycle。

不负责：

- 判断拖拽阶段。
- 构造 move command。
- 规划 block transaction。
- 判断 self-range / container policy。
- 保存 active drag business state。
- 暴露旧 adapter API。

## 4. Directory Responsibilities

保留当前顶层目录名：

```text
src/platform/codemirror/
  extension/
  input/
  preview/
  selection/
  transaction/
```

### 4.1 `extension/`

定位：CodeMirror extension composition root。

保留职责：

- `editor-extension.ts`: 导出 Obsidian/CodeMirror extension。
- `drag-driver.ts`: CodeMirror ViewPlugin 薄壳。
- `editor-lifecycle.ts`: mount / destroy 订阅。
- `editor-update.ts`: viewport/doc/settings update 后刷新平台 UI。
- `editor-dom-sync.ts`: editor root class 和属性同步。
- `handle-gutter-extension.ts`, `gutter.ts`: handle gutter 接入。
- `global-pointermove-router.ts`: 多 editor hover pointer move 路由。
- `hover-pointer-snapshot.ts`, `hover-pointer-types.ts`: hover 区域计算。
- `semantic-refresh-scheduler.ts`: 语义刷新调度。

目标：

- `drag-driver.ts` 只负责组装 CodeMirror 平台对象和生命周期。
- `drag-driver.ts` 不再包含 drop resolver、command builder、command applier。
- `drag-driver.ts` 可以创建 `DraggerRuntime`，但 constructor 不应继续膨胀。

建议文件内拆分，不改大目录名：

```text
extension/
  drag-driver.ts
  editor-document.ts
  editor-locate.ts
  editor-preview.ts
  runtime-config.ts
```

说明：

- 这些文件仍属于 `extension/`，不是新增抽象层。
- `runtime-options.ts` 只返回 `DraggerRuntimeOptions`，不创建 wrapper class。
- 如果坚持更少文件，也可以把这些函数留在 `drag-driver.ts` 下方，但必须保持职责清楚。

### 4.2 `input/`

定位：浏览器输入到 `DraggerInputSource` 的归一化层。

保留职责：

- `pointer-input-source.ts`: 监听 pointer / keyboard，输出 runtime input。
- `input-guards.ts`: 移动端 contenteditable、focus、scroll lock 等平台副作用。
- `mobile-input-hit-test.ts`: 移动端触摸区域判断。
- `touch-delay-policy.ts`: 移动端延迟策略。

硬规则：

- `input/` 可以读 DOM event。
- `input/` 可以执行 `preventDefault`、`stopPropagation`、pointer capture。
- `input/` 不可以保存 drag business state。
- `input/` 不可以构造 drop command。
- `input/` 不可以返回 `BlockSelection` 给 runtime；source 统一通过 line number。

### 4.3 `preview/`

定位：CodeMirror 平台视觉层，保留。

保留职责：

- `drop-indicator.ts`: 渲染 drop indicator 和 optional highlight。
- `handle-renderer.ts`: 渲染 gutter handle。
- `handle-visibility-controller.ts`: 控制 hover/active handle 可见性。
- `source-line-visual.ts`: source line / source embed visual class。
- `range-selection-visual-manager.ts`: 如果 range selection 功能保留，负责 range visual。

目标：

- `preview/` 只消费 view model，不参与 drag 决策。
- `drop-indicator.ts` 不再依赖旧 `drop/drop-validation`。
- `drop-indicator.ts` 的输入应来自 runtime preview 转换后的平台 view model。

目标接口示例：

```ts
type CodeMirrorDropPreview = {
  allowed: boolean;
  targetLineNumber: number | null;
  indicatorY?: number;
  lineRect?: { left: number; width: number };
  highlightRect?: { top: number; left: number; width: number; height: number };
};
```

runtime preview 到 CodeMirror preview 的转换在 `extension/editor-preview.ts` 或 `drag-driver.ts` 中完成。

硬规则：

- `preview/` 可以操作 DOM class 和绝对定位元素。
- `preview/` 不可以调用 `view.dispatch` 修改文档。
- `preview/` 不可以判断 drop 是否 allowed；它只按输入渲染。
- `preview/` 不可以保存 runtime session state。

### 4.4 `selection/`

定位：CodeMirror 几何和 DOM 到 line/block 信息的定位层。

保留职责：

- `geometry.ts`: line、block、insertion anchor 的几何辅助。
- `rect-calculator.ts`: CodeMirror coords/rect 计算。
- `block-selection-resolver.ts`: 当前仍用于 handle hover、embed/block line 定位。
- `block-boundary-resolver.ts`, `selection-grip-hit.ts`: 仅在 range selection 保留时继续使用。

目标：

- 主拖拽路径只需要两个 locator：
  - `sourceLineFromInput(input): number | null`
  - `targetLineFromPoint(point): number | null`
- `selection/` 可以提供这些 locator 的底层函数。
- `selection/` 不再作为拖拽 selection owner。

硬规则：

- `selection/` 可以调用 CodeMirror geometry API。
- `selection/` 可以调用 domain 的纯 block detector。
- `selection/` 不可以保存 `selecting` / `dragging` 状态。
- `selection/` 不可以计算最终 move transaction。

### 4.5 `transaction/`

定位：CodeMirror 文档变更应用层。

保留职责：

- `transaction-applier.ts`: 应用 `BlockTransaction` 或 `TextChange[]` 到 CodeMirror。
- `undo-selection-anchor.ts`: undo anchor 相关辅助。

目标：

```ts
document: {
  getDoc: () => view.state.doc,
  applyChanges: (changes) => view.dispatch({ changes }),
}
```

如需保留 undo anchor，可以在 `applyChanges` 内部调用 `transaction-applier.ts`，但不能重新引入 command pipeline。

## 5. Target Flow

### 5.1 Mount

```text
editor-extension
  -> ViewPlugin instance
  -> create CodeMirror platform objects
  -> new DraggerRuntime(options)
  -> runtime.mount()
```

### 5.2 Press

```text
PointerEvent
  -> pointer-input-source
  -> DraggerPressInput
  -> runtime
  -> locate.sourceLineFromInput(input)
  -> runtime detectBlock(doc, line)
```

CodeMirror 只负责从 handle DOM 上读出 source line。runtime 负责 block detection。

### 5.3 Move

```text
PointerEvent
  -> pointer-input-source
  -> DraggerMoveInput
  -> runtime
  -> locate.targetLineFromPoint(point)
  -> runtime computes allowed/reason
  -> preview(DragPreview)
  -> preview/drop-indicator render
```

### 5.4 Release

```text
PointerEvent
  -> pointer-input-source
  -> DraggerReleaseInput
  -> runtime
  -> plan move transaction
  -> document.applyChanges(changes)
  -> preview(null)
```

## 6. Required Public Shape Inside CodeMirror Layer

CodeMirror driver should read like this:

```ts
this.dragRuntime = new DraggerRuntime({
  input: createPointerInputSource(view),
  document: codeMirrorDocument(view),
  locate: codeMirrorLocate(view, context),
  preview: codeMirrorPreview(context, dropIndicator),
  config: codeMirrorRuntimeConfig(plugin, context),
});
```

These helpers are allowed because they are plain object builders, not runtime wrappers:

- `codeMirrorDocument`
- `codeMirrorLocate`
- `codeMirrorPreview`
- `codeMirrorRuntimeConfig`

They must not:

- instantiate another controller。
- hide runtime state。
- expose old adapter API。
- perform drag decisions。

## 7. Migration Plan

### Phase 1: Thin Driver

- Keep folder names.
- Extract runtime option pieces from `drag-driver.ts`.
- Keep `preview/` as visual layer.
- `drag-driver.ts` should not import old drop resolver or `transaction/move-command-applier.ts`.
- Run `npm run typecheck`.

Acceptance:

- `drag-driver.ts` is mostly lifecycle wiring.
- Runtime constructor call is visually obvious.
- No old adapter or command builder in driver.

### Phase 2: Preview Type Cleanup

- Change `preview/drop-indicator.ts` to stop importing old drop validation DTOs.
- Introduce a small preview view model in `preview/` or `extension/editor-preview.ts`.
- Convert `DragPreview` to this view model before rendering.

Acceptance:

- `preview/` has no dependency on `drop/` DTOs.
- Drop indicator can be reused by runtime preview directly.

### Phase 3: Retire Old Drop Main Path

- Remove normal drag path references to `drop/`.
- Keep or migrate list-specific geometry only if a real feature needs it.
- Mark external/cross-editor-only code explicitly if not deleted.

Acceptance:

- Old drop resolver is deleted or no longer part of ordinary runtime drag.
- Architecture tests can assert `drag-driver.ts` does not import `../drop`.

### Phase 4: Transaction Simplification

- Make `document.applyChanges` the only normal mutation path.
- Keep `transaction-applier.ts` only for CodeMirror dispatch/undo helpers.
- Delete old cross-editor command applier unless a new runtime-compatible design is introduced.

Acceptance:

- Ordinary drag move does not build `BlockCommand` in CodeMirror layer.
- `move-command-applier.ts` is not present in the normal CodeMirror integration.

## 8. Architecture Rules

- `src/drag` must not import `src/platform/codemirror`。
- `src/platform/codemirror/extension/drag-driver.ts` must not import `../drop`。
- `src/platform/codemirror/extension/drag-driver.ts` must not import `../transaction/move-command-applier`。
- `src/platform/codemirror/input/pointer-input-source.ts` is allowed to import runtime input types。
- `src/platform/codemirror/preview` is allowed to import runtime preview types or local preview view models。
- `preview/` must not import old drop validation DTOs。
- `selection/` must not import runtime internals。
- `transaction/` must not decide drag lifecycle。

## 9. Success Criteria

This refactor is successful when:

- A new Markdown platform can understand the CodeMirror integration by reading one runtime constructor call。
- CodeMirror integration code answers only four questions:
  - Where do input events come from?
  - How do I read/write the document?
  - How do I locate source/target lines?
  - How do I render preview?
- `preview/` remains as the CodeMirror visual layer and is not renamed away。
- Old drop resolver, active-drag registry, pointer-hit-test registry, external-file drop bridge, and old command applier are not part of normal drag。
- `npm run typecheck` passes。

## 10. Open Questions

- 是否继续支持跨 editor 拖拽？如果支持，应放在 external/cross-editor 专用模块，不进入普通 runtime 主路径。
- list 横向缩进 intent 是否是当前版本必须保留的功能？如果是，应作为 `targetLineFromPoint` 的扩展能力设计，而不是恢复旧 drop resolver。
- range selection 是否继续在本轮保留？如果保留，必须通过 runtime 的统一 `BlockSelection` 模型推进，而不是平台自建 selection 状态机。
