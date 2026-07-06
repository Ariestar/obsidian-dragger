# PRD: Headless Dragger Controller Final Architecture

> Status: Draft
> Date: 2026-07-06
> Scope: `src/drag/pipeline`, `src/drag/controller`, `src/platform/codemirror/input`, npm `./drag` package boundary

## 1. Goal

把 Dragger 做成一个可通过 npm 复用的 headless drag runtime。

最终接入方不需要写平台自己的 controller，也不需要复制 `PipelineAdapter` 这类复杂 adapter。平台只提供：

- input：输入来源。
- inspect：只读事实快照。
- effects：平台副作用。
- rules：可选规则扩展。

controller 负责完整拖拽决策、session 管理和 pipeline event 编排。

```ts
import { DraggerController, defaultMarkdownDragRules } from 'md-dragger/drag';

const dragger = new DraggerController({
  input: {
    onPress,
    onMove,
    onRelease,
    onCancel,
    onEscape,
  },
  inspect: {
    press,
    range,
    drop,
    commit,
    document,
  },
  effects: {
    showDropPreview,
    hideDropPreview,
    showSelection,
    showDragSource,
    applyCommand,
    emitLifecycle,
  },
  rules: defaultMarkdownDragRules({
    allowNestedListDrop: true,
    allowQuoteDrop: true,
    allowCalloutDrop: true,
  }),
  config,
});

dragger.mount();
```

核心原则：

- `DragPipeline` 继续作为平台无关状态机，保持简单好用。
- `DraggerController` 是最终公共 controller，不是 pipeline 包装器。
- 平台只提供事实和副作用，不判断拖拽阶段。
- controller 内部决定 hold、ready、range selection、drag、drop、cancel。
- Markdown drop rule 默认内置，可通过 `rules` 扩展或覆盖。
- rendering、DOM、CodeMirror geometry、Obsidian transaction 留在平台层。
- 直接 `new DraggerController(...)`，不提供重复 factory。
- 不保留降级兼容 wrapper。

## 2. Final Class Model

最终核心只有两个大类。

### 2.1 `DragPipeline`

位置：

```text
src/drag/pipeline/drag-pipeline.ts
```

职责：

- 持有平台无关 pipeline state。
- 接收 `PipelineEvent`。
- 执行 `holding / ready_to_drag / selecting / dragging / idle` 状态转换。
- 产出 `PipelineOutput`。
- 统一 selection、drag、drop、cancel、guard、terminal outputs。

它不关心：

- pointer listener。
- movement threshold。
- long press timer。
- DOM hit-test。
- CodeMirror geometry。
- 平台渲染和平台 transaction。

### 2.2 `DraggerController`

位置：

```text
src/drag/controller/dragger-controller.ts
```

职责：

- 创建并持有 `DragPipeline`。
- 订阅平台归一化输入。
- 管理 press session、range session、active drag session。
- 管理 long press、secondary drag ready、movement threshold。
- 调用 `inspect` 获取只读事实快照。
- 调用 `rules` 判断 drop 合法性。
- 将输入和决策翻译成 `PipelineEvent`。
- 消费 `PipelineOutput` 并调用 `effects`。
- 管理 `mount()` / `destroy()` cleanup。

它不负责：

- pipeline reducer 状态转换本身。
- DOM 查询。
- CodeMirror line/block geometry。
- Obsidian transaction。
- preview rendering。
- 平台 pointer capture 的具体实现。

一句话：

```text
DragPipeline = pipeline event state machine
DraggerController = platform facts + input -> drag decisions -> pipeline events
```

## 3. API Shape

```ts
export class DraggerController<TPreview = unknown> {
  constructor(options: DraggerControllerOptions<TPreview>);

  get state(): PipelineState;

  mount(): void;
  selectRange(range: DraggerRangeStart): void;
  guardUnavailable(guardId: GuardId): void;
  destroy(): void;
}
```

`DraggerControllerOptions` 只是 constructor 参数类型，不是 runtime wrapper，不创建 adapter class。

```ts
export type DraggerControllerOptions<TPreview = unknown> = {
  input: DraggerInputSource;
  inspect: DraggerInspector<TPreview>;
  effects: DraggerEffects<TPreview>;
  rules?: DragRule<TPreview> | DragRule<TPreview>[];
  config?: Partial<DraggerControllerConfig>;
  setTimer?: (callback: () => void, delayMs: number) => DragTimerToken;
  clearTimer?: (token: DragTimerToken) => void;
};
```

不再提供：

- `createDraggerController()`。
- `HostAdapter` / `HostCallbacks`。
- `read`。
- `move`。
- `view`。
- `resolvePress`。
- `resolveCommit`。

这些名字会让平台继续写 controller 逻辑，或把平台能力拆碎后再由 controller 重新拼装。

## 4. Input

`input` 只提供输入来源。平台不传 root，不传 DOM 给 controller，不需要统一 `emit({ type })`。

```ts
export type DraggerInputSource = {
  onPress: (handler: (input: DraggerPressInput) => void) => DraggerDisposable;
  onMove: (handler: (input: DraggerMoveInput) => void) => DraggerDisposable;
  onRelease: (handler: (input: DraggerReleaseInput) => void) => DraggerDisposable;
  onCancel?: (handler: (input: DraggerCancelInput) => void) => DraggerDisposable;
  onEscape?: (handler: () => void) => DraggerDisposable;
};
```

输入数据只包含 controller 做 session 判断所需的事实，以及平台提供给 controller 调用的输入副作用。

```ts
export type DraggerPressInput = {
  point: DragPoint;
  pointer: DragPointer;
  button?: number;
  modifiers?: DragModifiers;
  native?: unknown;
  claim?: () => void;
  capture?: () => void;
  releaseCapture?: () => void;
};

export type DraggerMoveInput = {
  point: DragPoint;
  pointer: DragPointer;
  native?: unknown;
  claim?: () => void;
};

export type DraggerReleaseInput = {
  point: DragPoint;
  pointer: DragPointer;
  native?: unknown;
  claim?: () => void;
  releaseCapture?: () => void;
};

export type DraggerCancelInput = {
  pointer: DragPointer;
  reason: DragCancelReason;
  native?: unknown;
  releaseCapture?: () => void;
};
```

`native` 是平台原始输入上下文的透明透传字段。controller 不读取它，只把它原样传给 `inspect` 和 `effects`，避免平台为了菜单、commit 或调试私藏 last event。

`claim`、`capture`、`releaseCapture` 是可选能力。controller 决定什么时候调用，平台只执行对应事件副作用，例如 `preventDefault / stopPropagation / setPointerCapture / releasePointerCapture`。

## 5. Inspect

`inspect` 是平台只读事实层。这个名字的含义是：controller 检查当前平台状态，但不让平台决定拖拽流程。

平台实现 `inspect` 时只回答：

- 这个点下面是什么。
- 当前 selection 是什么。
- 当前 drop target 周围有哪些文档事实。
- 是否处在平台禁区。

平台不回答：

- 是否应该进入 dragging。
- 是否应该进入 range selection。
- 是否应该 cancel。
- 是否应该发送哪个 pipeline event。

```ts
export type DraggerInspector<TPreview = unknown> = {
  press: (input: DraggerPressInput) => DraggerPressSnapshot;
  drop: (
    input: DraggerMoveInput | DraggerReleaseInput,
    context: DraggerDropInspectContext
  ) => DraggerDropSnapshot<TPreview>;
  commit: (
    input: DraggerReleaseInput,
    context: DraggerDropInspectContext
  ) => DropResolution<TPreview>;
  range?: (
    input: DraggerMoveInput,
    context: DraggerRangeInspectContext
  ) => RangeSelectionBoundary | null;
  document: () => DraggerDocumentSnapshot;
};
```

非 pointer 入口也必须走 controller。比如 toolbar、keyboard command、context menu 想进入 block range selection 时，平台先把当前 editor 状态解析成 `DraggerRangeStart`，再调用：

```ts
dragger.selectRange({
  selection,
  rangeBoundary,
  rangeDoc,
  rangeBoundaryResolver,
  selectedBlocks,
  guardDeps,
});
```

这不是 adapter/factory，也不是平台自己发送 pipeline event；它只是把“range selection start facts”交给 controller，由 controller 完成 selection runtime。

当某个 guard 事实失效时，平台调用：

```ts
dragger.guardUnavailable('mobile-text-drag-mode');
```

`guardId` 是普通字符串事实。controller 不知道 mobile、desktop、CodeMirror 或 Obsidian，只负责结束依赖该 guard 的交互状态。

### 5.1 Press Snapshot

`inspect.press` 返回 press 点位的事实快照。

```ts
export type DraggerPressSnapshot = {
  zone:
    | 'handle'
    | 'text'
    | 'selected_text'
    | 'selection_grip'
    | 'block_menu'
    | 'none';
  block: BlockInfo | null;
  selection: BlockSelection | null;
  passiveSelection?: BlockSelection | null;
  rangeBoundary?: RangeSelectionBoundary | null;
  initialRangeBoundary?: RangeSelectionBoundary | null;
  rangeDoc?: DocLikeWithRange;
  rangeOperation?: RangeSelectionOperation;
  rangeBoundaryResolver?: RangeSelectionBoundaryResolver;
  selectedBlocks?: SelectedBlockRange[];
  blockedReason?: DragCancelReason | null;
};
```

controller 根据这个 snapshot 决定：

- `zone: 'handle'` 是否开始 block drag hold。
- `zone: 'text'` 是否进入 text long press drag 或 block menu。
- `zone: 'selected_text'` 是否拖动 passive selection。
- `zone: 'selection_grip'` 是否进入 range selection。
- `blockedReason` 是否 cancel 或忽略。

### 5.2 Range Snapshot

`inspect.range` 返回当前 move 点位对应的 range boundary。controller 负责判断 session、调用 `selection_start/change/finish`，平台不直接发送 pipeline selection events。

```ts
range(input, context) {
  return resolveRangeSelectionBoundaryAtVerticalPosition(input.point.y);
}
```

### 5.3 Drop Snapshot

`inspect.drop` 返回 drop 点位和文档上下文事实。

```ts
export type DraggerDropSnapshot<TPreview = unknown> = {
  target: DropTarget | null;
  targetLineNumber: number | null;
  placement?: DropTarget['placement'] | null;
  blockBefore?: BlockInfo | null;
  blockAfter?: BlockInfo | null;
  container?: DragContainerSnapshot | null;
  rejectReason?: DragCancelReason | null;
  previewData?: TPreview;
};
```

controller 使用内置 rules 判断最终 `DragDropSnapshot`，并把结果送入 pipeline 的 `drag_start / drag_over / drop`。

### 5.4 Commit Resolution

`inspect.commit` 返回 release 点位对应的最终 drop resolution。它是事实解析，不是 controller 决策：controller 决定何时 commit，平台只根据 release input 和当前 drop context 构造平台正确的 `DropResolution`。

```ts
commit(input, context) {
  return buildBlockCommandAtPoint(
    context.selection,
    input.point.x,
    input.point.y,
    input.pointer.type
  );
}
```

controller 不自己构造 `move` command。这样 CodeMirror/Obsidian 可以保留 cross-editor、cross-document、container validation 等平台事实，而不需要在平台层保存 active point 再绕回 controller。

### 5.5 Document Snapshot

```ts
export type DraggerDocumentSnapshot = {
  lineCount: number;
};
```

后续如果内置 Markdown rules 需要更多只读文档事实，应扩展 snapshot，而不是让平台写 controller 决策。

## 6. Rules

Markdown drop 规则默认内置，平台不需要每次自己写。

```ts
export function defaultMarkdownDragRules(options?: {
  allowNestedListDrop?: boolean;
  allowQuoteDrop?: boolean;
  allowCalloutDrop?: boolean;
  allowCrossDocumentDrop?: boolean;
}): DragRule[];
```

规则只接收 controller 已经拿到的事实快照。

```ts
export type DragRuleContext<TPreview = unknown> = {
  selection: BlockSelection;
  source: HoldTarget['source'];
  document: DraggerDocumentSnapshot;
  drop: DraggerDropSnapshot<TPreview>;
};

export type DragRuleResult = {
  allowed: boolean;
  reason?: DragCancelReason;
};

export type DragRule<TPreview = unknown> = (
  context: DragRuleContext<TPreview>
) => DragRuleResult;
```

平台特殊规则通过 `rules` 扩展，而不是塞回 controller 分支。

```ts
const dragger = new DraggerController({
  input,
  inspect,
  effects,
  rules: [
    ...defaultMarkdownDragRules(),
    obsidianEmbedRules(),
  ],
});
```

如果某个点位天然不可用，例如 table cell、embed、readonly 区域，优先放在 `inspect.press/drop` 的 `blockedReason/rejectReason` 中。这是事实，不是流程决策。

## 7. Effects

`effects` 只执行平台副作用。平台不消费 pipeline state，不决定下一步事件。

```ts
export type DraggerEffects<TPreview = unknown> = {
  showDropPreview?: (
    drop: DraggerDropSnapshot<TPreview>,
    context: DraggerDropEffectContext
  ) => void;
  hideDropPreview?: () => void;
  showSelection?: (selection: BlockSelection | null) => void;
  showDragSource?: (selection: BlockSelection | null) => void;
  applyCommand?: (command: BlockCommand) => void;
  emitLifecycle?: (event: DragLifecycleEvent) => void;
  finishDragSession?: () => void;
  openBlockMenu?: (selection: BlockSelection, input: DraggerPressInput | DraggerReleaseInput) => void;
};
```

controller 内部消费 pipeline outputs：

- `drag_over` -> `effects.showDropPreview(...)` 或 `effects.hideDropPreview()`。
- `selection_changed` -> `effects.showSelection(...)`。
- `drag_source_changed` -> `effects.showDragSource(...)`。
- `command_ready` -> `effects.applyCommand(...)`。
- `lifecycle` -> `effects.emitLifecycle(...)`。
- terminal output -> cleanup + optional `finishDragSession()`。

这样平台不需要写重复的 `switch(output.type)` 胶水。

## 8. What Belongs Where

属于 `DraggerController`：

- mounted input subscription。
- session id generation。
- press session。
- range pointer session。
- active drag session。
- long press timer。
- secondary drag ready timer。
- movement threshold 判断。
- stale pointer/session ignore。
- selected text drag。
- passive selection drag。
- block menu short tap 判断。
- guard unavailable handling。
- input + inspect snapshot + rules -> `PipelineEvent`。
- pipeline output -> `effects`。
- destroy cleanup。

属于平台 `inspect`：

- point -> handle/text/selected_text/selection_grip/block_menu zone。
- point -> block。
- point -> range boundary。
- range selection doc / boundary resolver。
- current passive selection。
- point -> drop target。
- release input + drop context -> drop resolution。
- CodeMirror geometry。
- table cell / embed / readonly 区域事实。
- document line count。

属于平台 `effects`：

- preview rendering。
- range selection visual rendering。
- drag source visual rendering。
- CodeMirror transaction。
- Obsidian command/menu。
- lifecycle event forwarding。
- pointer capture 的具体执行。

属于 `DragPipeline`：

- 单个 pipeline event 的状态转换。
- pipeline outputs。
- terminal output decoration。

## 9. Directory Shape

Final target:

```text
src/drag/
  controller/
    dragger-controller.ts
    dragger-controller-types.ts
    index.ts
  pipeline/
    drag-pipeline.ts
    pipeline-state.ts
    pipeline-output.ts
    pipeline-event.ts
    pipeline-reducer.ts
    pipeline-drop.ts
    pipeline-guard.ts
    pipeline-exit.ts
  rules/
    markdown-drag-rules.ts
    index.ts
  selection/
    block-range-selection.ts
  index.ts
```

No new top-level `drag/runtime`, `drag/adapter`, `drag/ports`, or `drag/host` folders unless a real cohesive domain emerges.

## 10. Public Exports

`src/drag/index.ts` should export:

- `DraggerController`
- `DraggerControllerOptions`
- controller input/inspect/effects/config types
- `defaultMarkdownDragRules`
- existing pipeline public types
- existing selection public types needed by integration

It should not export:

- CodeMirror-specific classes。
- Obsidian-specific settings。
- old compatibility wrappers。
- internal reducer helpers。
- `createDraggerController`。

## 11. Testing Requirements

### Pipeline Tests

`DragPipeline` tests continue to cover pure pipeline event behavior:

- hold start / hold ready。
- selection start/change/finish。
- drag start/over/drop。
- cancel/destroy。
- guard unavailable。
- output decoration。

### Controller Tests

`DraggerController` tests cover platform-neutral decisions:

- press on handle starts hold。
- press on selected text uses passive selection。
- press on selection grip starts range selection。
- hold ready after timer。
- move before ready cancels when threshold exceeded。
- move after ready starts drag。
- drag move calls `inspect.drop` and updates preview。
- release calls drop resolution and `effects.applyCommand`。
- blocked press/drop facts cancel or reject correctly。
- stale pointer events are ignored。
- destroy clears timers and subscriptions。

No jsdom required.

### Platform Tests

CodeMirror platform tests focus only on platform facts and effects:

- DOM event -> controller input。
- DOM/CodeMirror point -> `inspect.press` snapshot。
- DOM/CodeMirror point -> `inspect.drop` snapshot。
- effects -> CodeMirror preview / transaction / lifecycle。

They should not be the primary tests for platform-neutral controller behavior.

### Boundary Tests

Architecture tests should enforce:

- `src/drag` production code does not import CodeMirror, Obsidian, platform, plugin, DOM event types。
- `src/drag/controller` does not import `src/platform`。
- `domain` stays below `drag` and never imports it。

## 12. Success Criteria

This architecture is successful when:

- Platform integrations do not implement controller decisions。
- New platforms only implement input, inspect, effects, and optional rules。
- CodeMirror no longer needs a complex `PipelineAdapter` equivalent。
- `DragPipeline` remains a simple event state machine。
- `DraggerController` owns the full platform-neutral drag runtime。
- Existing Obsidian behavior does not regress。
- No compatibility wrapper layer is kept around。

## 13. Design Guardrails

- If code decides "what drag phase should happen next", it belongs in `DraggerController`。
- If code answers "what is under this point", it belongs in `inspect`。
- If code mutates editor state or renders UI, it belongs in `effects`。
- If code transitions from one pipeline state to another for one pipeline event, it belongs in `DragPipeline`。
- Do not add manager classes unless they own a cohesive concept with independent tests。
- Do not add factory functions that only call `new`。
