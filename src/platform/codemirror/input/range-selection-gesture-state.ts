import type { BlockInfo } from '../../../domain/block/block-types';
import type { DocLikeWithRange } from '../../../domain/markdown/document-types';
import type { RangeSelectionBoundary, RangeSelectionBoundaryResolver } from '../../../domain/selection/range-selection';
import type { BlockSelection, RangeSelectionOperation } from '../../../domain/selection/block-selection';
import type { SelectedBlockRange } from '../../../domain/selection/block-ranges';
import type { GuardId } from '../../../drag/pipeline/pipeline-event';
import type { HoldTarget } from '../../../drag/pipeline/pipeline-state';
import { platform } from '../../../plugin/platform';

export type RangeSelectConfig = {
    longPressMs: number;
};

export type MouseRangeSelectState = {
    anchorBlock: BlockInfo;
    sourceSelection: BlockSelection;
    baseSelectedBlocks: SelectedBlockRange[];
    initialOperation?: RangeSelectionOperation;
    guardDeps?: GuardId[];
    sourceKind: HoldTarget['source'];
    anchorBoundary: RangeSelectionBoundary;
    initialBoundary: RangeSelectionBoundary;
    resolveBoundary?: RangeSelectionBoundaryResolver;
    pipelineStarted: boolean;
    selectionGestureStarted: boolean;
    pointerId: number;
    startX: number;
    startY: number;
    latestX: number;
    latestY: number;
    pointerType: string | null;
    dragReady: boolean;
    longPressReady: boolean;
    isIntercepting: boolean;
    timeoutId: number | null;
    dragTimeoutId: number | null;
    currentLineNumber: number;
};

type CreateInitialRangeSelectionStateOptions = {
    blockInfo: BlockInfo;
    sourceSelection: BlockSelection;
    baseSelectedBlocks: SelectedBlockRange[];
    initialOperation?: RangeSelectionOperation;
    guardDeps?: GuardId[];
    sourceKind?: HoldTarget['source'];
    anchorBoundary?: RangeSelectionBoundary;
    initialBoundary?: RangeSelectionBoundary;
    resolveBoundary?: RangeSelectionBoundaryResolver;
    doc: DocLikeWithRange;
    pointerId: number;
    startX: number;
    startY: number;
    pointerType: string | null;
};

export function resolveRangeSelectConfig(
    mouseLongPressMs: number,
    getTouchRangeSelectLongPressMs: () => number
): RangeSelectConfig {
    if (!platform.isMobile) {
        return {
            longPressMs: mouseLongPressMs,
        };
    }

    return {
        longPressMs: getTouchRangeSelectLongPressMs(),
    };
}

export function createInitialRangeSelectionState(
    options: CreateInitialRangeSelectionStateOptions
): MouseRangeSelectState | null {
    const anchorStartLineNumber = options.blockInfo.startLine + 1;
    const anchorEndLineNumber = options.blockInfo.endLine + 1;
    if (
        anchorStartLineNumber < 1
        || anchorEndLineNumber > options.doc.lines
        || anchorStartLineNumber > anchorEndLineNumber
    ) {
        return null;
    }

    const anchorBoundary = options.anchorBoundary ?? {
        startLineNumber: anchorStartLineNumber,
        endLineNumber: anchorEndLineNumber,
        representativeLineNumber: anchorEndLineNumber,
    };
    const initialBoundary = options.initialBoundary ?? anchorBoundary;

    return {
        anchorBlock: options.blockInfo,
        sourceSelection: options.sourceSelection,
        baseSelectedBlocks: options.baseSelectedBlocks,
        initialOperation: options.initialOperation,
        guardDeps: options.guardDeps,
        sourceKind: options.sourceKind ?? 'handle',
        anchorBoundary,
        initialBoundary,
        resolveBoundary: options.resolveBoundary,
        pipelineStarted: false,
        selectionGestureStarted: false,
        pointerId: options.pointerId,
        startX: options.startX,
        startY: options.startY,
        latestX: options.startX,
        latestY: options.startY,
        pointerType: options.pointerType,
        dragReady: !platform.isMobile,
        longPressReady: false,
        isIntercepting: platform.isMobile,
        timeoutId: null,
        dragTimeoutId: null,
        currentLineNumber: initialBoundary.representativeLineNumber,
    };
}
