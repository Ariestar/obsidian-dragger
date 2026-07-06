# PRD: Headless Dragger Controller Final Architecture

> Status: Draft
> Date: 2026-07-06
> Scope: `src/drag/pipeline`, `src/drag/controller`, `src/platform/codemirror/input`, npm `./drag` package boundary

## 1. Goal

把 Dragger 做成一个可通过 npm 复用的 headless drag runtime。

最终接入方不需要写复杂 adapter 类，只需要把平台事实和平台副作用以 callbacks 传给 `DraggerController`：

```ts
import { DraggerController } from 'md-dragger/drag';

const dragger = new DraggerController({
  input: {
    onPress,
    onMove,
    onRelease,
    onCancel,
    onEscape,
  },
  read: {
    lineAt,
    lineCount,
    lineText,
    blockAt,
  },
  canStartDrag,
  move,
  view: {
    showDropPreview,
    hideDropPreview,
    showSelection,
    showDragSource,
    emitLifecycle,
  },
});

dragger.mount();
```

核心原则：

- `DragPipeline` 是现有平台无关状态机，继续保持简单好用。
- `DraggerController` 是通用输入适配器，负责把平台输入翻译成 pipeline events。
- 平台只传 callbacks，不需要实现大 adapter 类。
- `read` 是只读查询接口，不是把整篇文档交给 controller。
- 文档修改只通过平台的 `move` 回调执行。
- 直接 `new DraggerController(...)`，不提供重复 factory。
- 不保留降级兼容 wrapper。
- 不把 Obsidian/CodeMirror 逻辑写进 `src/drag`。

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
- 统一单块、多块、多区域拖拽状态模型。
- 统一 selection、drag、drop、cancel、guard、terminal outputs。

它不关心：

- 点击事件。
- 移动距离。
- long press timer。
- pointer capture。
- DOM hit-test。
- platform listener。

### 2.2 `DraggerController`

位置：

```text
src/drag/controller/dragger-controller.ts
```

职责：

- 创建并持有 `DragPipeline`。
- 监听平台归一化输入。
- 管理 press session、range session、active drag session 等平台无关技术会话。
- 管理 long press、drag ready、movement threshold。
- 根据平台 callbacks 查询事实。
- 将平台输入翻译成 `PipelineEvent`。
- 将 pipeline outputs 分发到 `view` handlers。
- 管理 `mount()` / `destroy()` cleanup。

它不负责：

- pipeline 状态转换本身。
- Markdown/block 纯算法。
- DOM 查询。
- CodeMirror geometry。
- Obsidian transaction。
- 直接修改文档。
- UI rendering。

一句话：

```text
DragPipeline = pipeline event state machine
DraggerController = platform input -> pipeline event adapter
```

## 3. Why This Shape

现有 `DragPipeline` 已经是一个好用状态机。它的问题不是能力弱，而是输入层级较低：调用者必须自己决定什么时候发送：

```text
hold_start
hold_ready
selection_start
selection_change
selection_finish
drag_start
drag_over
drop
cancel
guard_unavailable
destroy
```

现在这层翻译主要散在 `src/platform/codemirror/input/PipelineAdapter`、`pointer-drag.ts`、`pointer-selection.ts`。这些文件里混合了两类逻辑。

平台相关逻辑：

- DOM target 解析。
- CodeMirror line geometry。
- PointerEvent 读取。
- pointer capture。
- preventDefault / stopPropagation。
- focus suppression。
- scroll lock。
- haptic feedback。
- Obsidian menu / command / settings。
- CodeMirror transaction。

平台无关控制逻辑：

- press pending session。
- long press ready。
- drag ready。
- movement threshold。
- range selection gesture。
- active drag session。
- selected text drag。
- passive selection retention。
- stale session ignore。
- terminal cleanup sequencing。

`DraggerController` 要抽的是第二类逻辑。第一类逻辑通过 callbacks 注入。

## 4. Public API

```ts
export class DraggerController<TPreview = unknown> {
  constructor(options: DraggerControllerOptions<TPreview>);

  get state(): PipelineState;

  mount(): void;
  destroy(): void;
}
```

`DraggerControllerOptions` 不是运行时包装，也不是 adapter/ports 对象；它只是 TypeScript 类型，用来描述 `new DraggerController(...)` 直接接收的 callbacks。实现里不要再包一层 options adapter。

```ts
export type DraggerControllerOptions<TPreview = unknown> = {
  input: DraggerInputListeners;
  read: DraggerDocumentReader;
  move: (selection: BlockSelection, target: DraggerDropTarget<TPreview>) => void;
  view?: DraggerViewHandlers<TPreview>;
  selection?: DraggerSelectionOptions;
  canStartDrag?: (point: DragPoint, target: unknown) => boolean;
  isBlockedPoint?: (point: DragPoint) => boolean;
  canDrop?: (
    selection: BlockSelection,
    target: DraggerDropTarget<TPreview>,
    context: DraggerDropContext,
    fallback: DraggerCanDrop<TPreview>
  ) => DraggerDropDecision;
  adjustDropTarget?: (
    selection: BlockSelection,
    target: DraggerDropTarget<TPreview>,
    context: DraggerDropContext
  ) => DraggerDropTarget<TPreview>;
  config?: Partial<DraggerControllerConfig>;
  setTimer?: (callback: () => void, delayMs: number) => DragTimerToken;
  clearTimer?: (token: DragTimerToken) => void;
};
```

必填项只保留拖拽闭环需要的能力：

- `input`：平台输入来源，按 press/move/release/cancel/escape 分开传入。
- `read`：只读文档事实查询。
- `move`：平台执行最终移动。

`read` 不表示 controller 持有整篇文档。它只是一组查询函数，真实文档仍由平台/editor 持有。controller 不直接修改文档；drop 成功时只调用 `move(selection, target)`。

```ts
export type DraggerDocumentReader = {
  lineAt: (point: DragPoint) => number | null;
  lineCount: () => number;
  lineText: (lineNumber: number) => string;
  blockAt: (lineNumber: number) => BlockInfo | null;
};
```

输入不要求传 root，也不暴露统一 `emit`。平台直接提供 controller 需要的输入 listener：press、move、release、cancel、escape。controller 内部知道这些 listener 对应哪类输入，不需要平台重复传 `type: 'press'`。

```ts
export type DraggerInputListeners = {
  onPress: (handler: (input: DraggerPressInput) => void) => DraggerDisposable;
  onMove: (handler: (input: DraggerMoveInput) => void) => DraggerDisposable;
  onRelease: (handler: (input: DraggerReleaseInput) => void) => DraggerDisposable;
  onCancel?: (handler: (input: DraggerCancelInput) => void) => DraggerDisposable;
  onEscape?: (handler: () => void) => DraggerDisposable;
};
```

- 不传 root / target。
- 不传 `emit`。
- 不要求平台有统一 `onPointer`。
- 如果平台已有统一 pointer stream，可以在这些 listener 中做极薄转接。

渲染和 lifecycle 不放进 controller，也不强制塞进一个大 `render()`。`view` 是一组可选 handler，平台可以在不同模块分别实现，贴近现有平台层 pipeline 接入方式。

```ts
export type DraggerViewHandlers<TPreview = unknown> = {
  showDropPreview?: (target: DraggerDropTarget<TPreview>, context: DraggerDropContext) => void;
  hideDropPreview?: () => void;
  showSelection?: (selection: BlockSelection | null) => void;
  showDragSource?: (selection: BlockSelection | null) => void;
  emitLifecycle?: (event: DragLifecycleEvent) => void;
  onCancel?: (reason: DragCancelReason) => void;
};
```

这些 input 都是普通数据形状，不是运行时模块。

```ts
export type DraggerPressInput = {
  point: DragPoint;
  pointer: DragPointer;
  target?: unknown;
};

export type DraggerMoveInput = {
  point: DragPoint;
  pointer: DragPointer;
};

export type DraggerReleaseInput = {
  point: DragPoint;
  pointer: DragPointer;
};

export type DraggerCancelInput = {
  pointer: DragPointer;
  reason: DragCancelReason;
};
```

`target?: unknown` 允许 DOM 平台把原始 target 带给 `canStartDrag`，但 `src/drag` 不能读取 DOM API，只能原样转交。

controller 默认用 `read.lineAt(point)` 和 `read.blockAt(line)` 组装 drag source。如果传了 `canStartDrag`，controller 会先用它判断这个位置是否允许开始拖；不传则默认整行可拖。

controller 默认用 `read.lineAt(point)` 生成 line-based drop target，并用内置 Markdown rules 判断是否合法。复杂平台可以通过顶层可选 callbacks 覆盖差异：

- `isBlockedPoint`：例如 table cell / embed / 不可编辑区域。
- `canDrop`：覆盖或扩展内置 Markdown drop rule。
- `adjustDropTarget`：把 line-based raw target 调整成平台最终 target。

```ts
export type DraggerDropContext = {
  selection: BlockSelection;
  pointer: DragPointer;
  lineNumber: number;
};

export type DraggerDropTarget<TPreview = unknown> = {
  lineNumber: number;
  placement: 'before' | 'after';
  value?: unknown;
  previewData?: TPreview;
  rejectReason?: DragCancelReason | null;
};

export type DraggerDropDecision = {
  allowed: boolean;
  reason?: DragCancelReason;
};

export type DraggerCanDrop<TPreview = unknown> = (
  selection: BlockSelection,
  target: DraggerDropTarget<TPreview>,
  context: DraggerDropContext
) => DraggerDropDecision;
```

多选相关能力单独挂在 `selection` 下。没有多选的平台不用传。

```ts
export type DraggerSelectionOptions = {
  getBoundaryAtPoint: (point: DragPoint) => RangeSelectionBoundary | null;
  getDocumentLineCount: () => number;
};
```

`src/drag` 中不允许出现：

- `PointerEvent`
- `MouseEvent`
- `TouchEvent`
- `HTMLElement`
- `EditorView`
- `window`
- `document`

`config` 是普通对象，不是 wrapper。平台层负责把宿主设置映射成这个对象，controller 合并默认值。

```ts
export type DraggerControllerConfig = {
  multiLineSelectionEnabled: boolean;
  mobileLikeInput: boolean;
  textLongPressDragEnabled: boolean;
  mobileTextDragGuardEnabled: boolean;
  longPressMs: number;
  rangeSelectionLongPressMs: number;
  dragStartMoveThresholdPx: number;
  dragCancelMoveThresholdPx: number;
  mouseRangeSelectLongPressMs: number;
  touchRangeSelectLongPressMs: number;
};
```

`setTimer` / `clearTimer` 只在特殊 runtime 或测试中需要覆盖。默认使用 `globalThis.setTimeout` / `globalThis.clearTimeout`。不提供 `requestAnimationFrame`，渲染和滚动帧属于平台。

## 5. What Belongs in `DraggerController`

`DraggerController` 应该包含所有平台无关输入控制逻辑：

- mounted input subscription。
- session id generation。
- press session。
- range pointer session。
- active drag session。
- long press ready timer。
- secondary drag ready timer。
- movement threshold 判断。
- stale pointer/session ignore。
- guard unavailable handling。
- input -> `PipelineEvent` sequencing。
- pipeline output dispatch。
- destroy cleanup。

它不应该包含：

- `transitionPipelineState` 逻辑。
- selection range merge/subtract 纯算法。
- CodeMirror/DOM hit-test。
- drop target geometry。
- command transaction implementation。
- preview rendering。
- platform settings object。

## 6. What Belongs in Platform Callbacks

平台 callbacks 只回答事实和执行副作用。

Examples:

- `input.onPress`：监听按下输入。
- `input.onMove`：监听移动输入。
- `input.onRelease`：监听释放输入。
- `input.onCancel`：监听取消输入。
- `input.onEscape`：监听 Escape 输入。
- `read.lineAt`：根据坐标返回行号。
- `read.lineCount`：返回文档行数。
- `read.lineText`：返回行文本。
- `read.blockAt`：返回某行所属 block。
- `canStartDrag`：可选，判断按下位置是否允许开始拖。
- `isBlockedPoint`：可选，判断 table cell / embed / 不可编辑区域等禁区。
- `canDrop`：可选，覆盖或扩展内置 Markdown drop rule。
- `adjustDropTarget`：可选，调整 line-based raw target。
- `move`：执行宿主移动操作。
- `view.showDropPreview`：显示 drop preview。
- `view.hideDropPreview`：隐藏 drop preview。
- `view.showSelection`：显示或清除 selection visual。
- `view.showDragSource`：显示或清除 drag source visual。
- `view.emitLifecycle`：转发 lifecycle event。
- `selection.getBoundaryAtPoint`：根据点位解析 range boundary。
- `selection.getDocumentLineCount`：返回文档行数。
- `config`：平台配置映射后的 controller config。

平台 callbacks 不应该决定：

- 是否从 hold 进入 ready。
- 是否从 ready 进入 dragging。
- selected text drag 是否使用整段 passive selection。
- range selection 何时 finish。
- guard unavailable 时哪些 pipeline state 退出。
- terminal outputs 顺序。

controller 不持有完整文档，也不直接修改文档。它只调用 `read.*` 读取必要事实，调用 `move` 把最终写操作交回平台。

## 7. Directory Shape

Final target:

```text
src/drag/
  controller/
    dragger-controller.ts
    dragger-controller-types.ts
    dragger-controller-input.ts
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
  selection/
    block-range-selection.ts
  index.ts
```

No new top-level `drag/input`, `drag/runtime`, `drag/effects`, or `drag/source` folders unless a real cohesive domain emerges.

## 8. Public Exports

`src/drag/index.ts` should export:

- `DraggerController`
- `DraggerControllerOptions`
- controller input/config/output types
- existing pipeline public types
- existing selection public types needed by integration

It should not export:

- CodeMirror-specific classes。
- Obsidian-specific settings。
- old compatibility wrappers。
- internal reducer helpers。
- `createDraggerController`。

Direct construction is the final API.

## 9. Testing Requirements

### Pipeline Tests

`DragPipeline` tests continue to cover pure pipeline event behavior:

- hold start / hold ready。
- selection start/change/finish。
- drag start/over/drop。
- cancel/destroy。
- guard unavailable。
- output decoration。

### Controller Tests

`DraggerController` tests cover input translation:

- press schedules hold ready。
- move before ready cancels when threshold exceeded。
- move after ready starts drag。
- drag move sends drag_over。
- release sends drop。
- pointer cancel sends cancel。
- range selection press/move/release sends selection events。
- selected text drag uses retained passive selection。
- stale pointer events are ignored。
- destroy clears timers and subscription。

No jsdom required.

### Platform Tests

CodeMirror platform tests should focus on callbacks:

- DOM event -> `DraggerInput`。
- DOM target -> resolved press target。
- point -> range boundary。
- point -> drop snapshot。
- pipeline output -> CodeMirror side effect。

They should not be the primary tests for platform-neutral controller behavior.

### Boundary Tests

Architecture tests should enforce:

- `src/drag` top-level dirs are `controller`, `pipeline`, `selection`。
- `src/drag` production code does not import CodeMirror, Obsidian, platform, plugin, DOM event types。
- `domain` stays below `drag` and never imports it。

## 10. Success Criteria

This architecture is successful when:

- `DragPipeline` remains the simple event state machine it is today。
- `DraggerController` removes the complex platform-neutral gesture/session code from CodeMirror platform files。
- Platform integration only passes callbacks to `DraggerController`。
- New platforms do not need to copy `PipelineAdapter`。
- `src/drag` remains headless and testable without jsdom。
- No compatibility wrapper layer is kept around。
- Existing Obsidian behavior does not regress。

## 11. Design Guardrails

- If code transforms normalized input into pipeline events, it belongs in `DraggerController`。
- If code transitions pipeline state from one pipeline event, it belongs in `DragPipeline`。
- If code reads DOM, geometry, host editor state, or settings storage, it belongs in platform callbacks。
- Do not add manager classes unless they own a cohesive concept with independent tests。
- Prefer direct callbacks over nested ports or adapter classes。
- Do not add factory functions that only call `new`。
