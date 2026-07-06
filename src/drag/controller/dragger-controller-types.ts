import type { BlockInfo } from '../../domain/block/block-types';
import type { BlockCommand } from '../../domain/command/block-command';
import type { DropTarget } from '../../domain/command/drop-target';
import type { BlockSelection, RangeSelectionOperation } from '../../domain/selection/block-selection';
import type { RangeSelectionBoundary, RangeSelectionBoundaryResolver } from '../../domain/selection/range-selection';
import type { SelectedBlockRange } from '../../domain/selection/block-ranges';
import type { DocLikeWithRange } from '../../domain/markdown/document-types';
import type { InsertionSlotContext } from '../../domain/rules/insertion-rules';
import type { DragDropSnapshot, DropResolution } from '../pipeline/pipeline-drop';
import type { DragCancelReason, GuardId } from '../pipeline/pipeline-event';
import type { DragLifecycleEvent } from '../pipeline/pipeline-output';
import type { HoldTarget } from '../pipeline/pipeline-state';

export type DraggerDisposable = () => void;

export type DragPoint = {
    x: number;
    y: number;
};

export type DragPointer = {
    id: number;
    type: string | null;
};

export type DragModifiers = {
    altKey?: boolean;
    ctrlKey?: boolean;
    metaKey?: boolean;
    shiftKey?: boolean;
};

export type DragTimerToken = ReturnType<typeof setTimeout>;

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

export type DraggerInputSource = {
    onPress: (handler: (input: DraggerPressInput) => void) => DraggerDisposable;
    onMove: (handler: (input: DraggerMoveInput) => void) => DraggerDisposable;
    onRelease: (handler: (input: DraggerReleaseInput) => void) => DraggerDisposable;
    onCancel?: (handler: (input: DraggerCancelInput) => void) => DraggerDisposable;
    onEscape?: (handler: () => void) => DraggerDisposable;
};

export type DraggerPressZone =
    | 'handle'
    | 'text'
    | 'selected_text'
    | 'selection_grip'
    | 'block_menu'
    | 'none';

export type DraggerRangeFacts = {
    rangeBoundary?: RangeSelectionBoundary | null;
    initialRangeBoundary?: RangeSelectionBoundary | null;
    rangeDoc?: DocLikeWithRange;
    rangeOperation?: RangeSelectionOperation;
    rangeBoundaryResolver?: RangeSelectionBoundaryResolver;
    selectedBlocks?: SelectedBlockRange[];
    guardDeps?: GuardId[];
};

export type DraggerRangeStart = DraggerRangeFacts & {
    selection: BlockSelection;
};

export type DraggerPressSnapshot = DraggerRangeFacts & {
    zone: DraggerPressZone;
    block: BlockInfo | null;
    selection: BlockSelection | null;
    passiveSelection?: BlockSelection | null;
    source?: HoldTarget['source'];
    longPressMs?: number;
    skipLongPress?: boolean;
    blockedReason?: DragCancelReason | null;
};

export type DraggerDropSnapshot<TPreview = unknown> = DragDropSnapshot<TPreview> & {
    targetLineNumber?: number | null;
    placement?: DropTarget['placement'] | null;
    blockBefore?: BlockInfo | null;
    blockAfter?: BlockInfo | null;
    markdown?: DraggerMarkdownDropFacts | null;
};

export type DraggerMarkdownDropFacts = {
    slotContext?: InsertionSlotContext | null;
    documentRelation?: 'same_document' | 'different_document' | null;
};

export type DraggerDropInspectContext<TPreview = unknown> = {
    selection: BlockSelection;
    source: HoldTarget['source'];
    pointer: DragPointer;
    drop: DraggerDropSnapshot<TPreview> | null;
};

export type DraggerRangeInspectContext = {
    selection: BlockSelection;
    pointer: DragPointer;
};

export type DraggerDocumentSnapshot = {
    lineCount: number;
};

export type DraggerInspector<TPreview = unknown> = {
    press: (input: DraggerPressInput) => DraggerPressSnapshot;
    drop: (
        input: DraggerMoveInput | DraggerReleaseInput,
        context: DraggerDropInspectContext<TPreview>
    ) => DraggerDropSnapshot<TPreview>;
    commit: (
        input: DraggerReleaseInput,
        context: DraggerDropInspectContext<TPreview>
    ) => DropResolution<TPreview>;
    range?: (
        input: DraggerMoveInput,
        context: DraggerRangeInspectContext
    ) => RangeSelectionBoundary | null;
    document: () => DraggerDocumentSnapshot;
};

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

export type DraggerDropEffectContext = {
    selection: BlockSelection;
    source: HoldTarget['source'];
    pointer: DragPointer;
};

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

export type DraggerControllerConfig = {
    longPressMs: number;
    dragStartMoveThresholdPx: number;
    dragCancelMoveThresholdPx: number;
    textLongPressDragEnabled: boolean;
    multiLineSelectionEnabled: boolean;
};

export type DraggerControllerOptions<TPreview = unknown> = {
    input: DraggerInputSource;
    inspect: DraggerInspector<TPreview>;
    effects?: DraggerEffects<TPreview>;
    rules?: DragRule<TPreview> | DragRule<TPreview>[];
    config?: Partial<DraggerControllerConfig>;
    setTimer?: (callback: () => void, delayMs: number) => DragTimerToken;
    clearTimer?: (token: DragTimerToken) => void;
};
