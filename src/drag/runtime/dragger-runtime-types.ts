import type { TextChange } from '../../domain/transaction/block-transaction';
import type { BlockSelection } from '../../domain/selection/block-selection';
import type { DocLikeWithRange } from '../../domain/markdown/document-types';
import type { DragCancelReason } from '../pipeline/pipeline-event';

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

export type DragPreview = {
    source: BlockSelection;
    targetLineNumber: number | null;
    allowed: boolean;
    reason?: DragCancelReason | null;
};

export type DraggerRuntimeConfig = {
    tabSize: number;
    longPressMs: number;
    dragStartMoveThresholdPx: number;
    dragCancelMoveThresholdPx: number;
};

export type DraggerRuntimeConfigInput =
    | Partial<DraggerRuntimeConfig>
    | (() => Partial<DraggerRuntimeConfig>);

export type DraggerRuntimeOptions = {
    input: DraggerInputSource;
    // eslint-disable-next-line obsidianmd/prefer-active-doc
    document: {
        getDoc(): DocLikeWithRange;
        applyChanges(changes: TextChange[]): void;
    };
    locate: {
        sourceLineFromInput(input: DraggerPressInput): number | null;
        targetLineFromPoint(point: DragPoint): number | null;
    };
    preview?: (preview: DragPreview | null) => void;
    selection?: (selection: BlockSelection | null) => void;
    config?: DraggerRuntimeConfigInput;
    setTimer?: (callback: () => void, delayMs: number) => DragTimerToken;
    clearTimer?: (token: DragTimerToken) => void;
};
