import type { BlockInfo } from '../../domain/block/block-types';
import type { DropTarget } from '../../domain/command/drop-target';
import type { BlockSelection } from '../../domain/selection/block-selection';
import type { RangeSelectionBoundary } from '../../domain/selection/range-selection';
import type { DragDropSnapshot } from '../pipeline/pipeline-drop';
import type { DragCancelReason } from '../pipeline/pipeline-event';
import type { DragLifecycleEvent } from '../pipeline/pipeline-output';

export type DraggerDisposable = () => void;

export type DragPoint = {
    x: number;
    y: number;
};

export type DragPointer = {
    id: number;
    type: string | null;
};

export type DragTimerToken = ReturnType<typeof setTimeout>;

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

export type DraggerInputListeners = {
    onPress: (handler: (input: DraggerPressInput) => void) => DraggerDisposable;
    onMove: (handler: (input: DraggerMoveInput) => void) => DraggerDisposable;
    onRelease: (handler: (input: DraggerReleaseInput) => void) => DraggerDisposable;
    onCancel?: (handler: (input: DraggerCancelInput) => void) => DraggerDisposable;
    onEscape?: (handler: () => void) => DraggerDisposable;
};

export type DraggerDocumentReader = {
    lineAt: (point: DragPoint) => number | null;
    lineCount: () => number;
    lineText: (lineNumber: number) => string;
    blockAt: (lineNumber: number) => BlockInfo | null;
};

export type DraggerDropContext = {
    selection: BlockSelection;
    pointer: DragPointer;
    lineNumber: number;
};

export type DraggerDropTarget<TPreview = unknown> = {
    lineNumber: number;
    placement: DropTarget['placement'];
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

export type DraggerViewHandlers<TPreview = unknown> = {
    showDropPreview?: (target: DraggerDropTarget<TPreview>, context: DraggerDropContext) => void;
    hideDropPreview?: () => void;
    showSelection?: (selection: BlockSelection | null) => void;
    showDragSource?: (selection: BlockSelection | null) => void;
    emitLifecycle?: (event: DragLifecycleEvent) => void;
    onCancel?: (reason: DragCancelReason) => void;
};

export type DraggerSelectionOptions = {
    getBoundaryAtPoint: (point: DragPoint) => RangeSelectionBoundary | null;
    getDocumentLineCount: () => number;
};

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

export type DraggerResolvedDrop<TPreview = unknown> = {
    context: DraggerDropContext;
    target: DraggerDropTarget<TPreview> | null;
    snapshot: DragDropSnapshot<DraggerDropTarget<TPreview>>;
};
