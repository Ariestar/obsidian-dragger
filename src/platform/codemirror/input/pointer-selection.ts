import type { EditorView } from '@codemirror/view';
import { BlockType, type BlockInfo } from '../../../domain/block/block-types';
import type { BlockSelection, RangeSelectionOperation } from '../../../domain/selection/block-selection';
import {
    groupSelectedBlocksIntoSegments,
    type SelectedBlockRange,
} from '../../../domain/selection/block-ranges';
import type {
    RangeSelectionBoundary,
    RangeSelectionBoundaryResolver,
} from '../../../domain/selection/range-selection';
import {
    buildRangeSelectionBoundaryFromBlock,
} from '../../../domain/selection/range-selection';
import type { GuardId } from '../../../drag/pipeline/pipeline-event';
import type { HoldTarget, PipelineState } from '../../../drag/pipeline/pipeline-state';
import { createRangeSelectionBoundaryResolver } from '../selection/block-boundary-resolver';
import type { BlockSelectionRequest } from '../selection/block-selection-resolver';
import {
    DRAG_HANDLE_CLASS,
    EMBED_HANDLE_CLASS,
    MOBILE_SELECTION_RESIZE_HANDLE_CLASS,
    RANGE_SELECTED_HANDLE_CLASS,
} from '../../../shared/dom-selectors';
import {
    shouldStartMobilePressDrag as shouldStartMobilePressDragByInput,
} from './pointer-hit-test';
import {
    MOBILE_DRAG_LONG_PRESS_MS,
    MOBILE_SELECTED_RANGE_DRAG_LONG_PRESS_MS,
} from './touch-delay-policy';

export type RangeSelectionSessionOptions = {
    skipLongPress?: boolean;
    initialOperation?: RangeSelectionOperation;
    guardDeps?: GuardId[];
    sourceKind?: HoldTarget['source'];
    baseSelectedBlocks?: SelectedBlockRange[];
    anchorBoundary?: RangeSelectionBoundary;
    initialBoundary?: RangeSelectionBoundary;
    resolveBoundary?: RangeSelectionBoundaryResolver;
    deferPipelineStart?: boolean;
    allowSecondaryDrag?: boolean;
};

export type PointerSelectionContext = {
    readonly view: EditorView;
    readonly pipelineState: PipelineState;
    readonly hasActiveRangePointerSession: boolean;
    readonly passiveSelectionSource: BlockSelection | null;
    readonly isMobileEnvironment: boolean;
    readonly isMultiLineSelectionEnabled: boolean;
    readonly isMobileTextLongPressDragEnabled: boolean;
    readonly isBlockInsideRenderedTableCell: (blockInfo: BlockInfo) => boolean;
    readonly resolveBlockSelection: (request: BlockSelectionRequest) => BlockSelection | null;
    readonly canStartDragForPointer: (pointerType: string | null, source: HoldTarget['source']) => boolean;
    readonly isMobileDragModeActiveForPointer: (pointerType: string | null) => boolean;
    readonly isWithinMobileTextLineOrEmbedArea: (target: HTMLElement | null, clientX: number, clientY: number) => boolean;
    readonly isSelectionDragGripHit: (target: HTMLElement, clientX: number, clientY: number, pointerType: string | null) => boolean;
};

export type PointerDownDecision =
    | { type: 'none' }
    | { type: 'handled' }
    | { type: 'retarget_mobile_range_selection' }
    | {
        type: 'start_range_selection';
        source: BlockSelection;
        handle: HTMLElement | null;
        options?: RangeSelectionSessionOptions;
        preventDefault?: boolean;
        capturePointer?: boolean;
        applySelectionGestureGuard?: boolean;
    }
    | {
        type: 'start_press_drag';
        source: BlockSelection;
        options?: {
            longPressMs?: number;
            skipLongPress?: boolean;
            sourceKind?: HoldTarget['source'];
        };
    }
    | {
        type: 'change_selection';
        boundary: RangeSelectionBoundary;
        preventDefault?: boolean;
        capturePointer?: boolean;
    };

export type MobileSelectionModeDecision =
    | { type: 'none' }
    | {
        type: 'start_mobile_selection_mode';
        selection: BlockSelection;
        blockInfo: BlockInfo;
        markEventHandled: boolean;
    };

type PointerPlatform = 'desktop' | 'mobile';

type PointerInputPolicy = {
    platform: PointerPlatform;
    pointerType: string | null;
    canResizeSelection: boolean;
    canUseTextLongPress: boolean;
    handleLongPressMs: number;
};

export function decidePointerDown(
    context: PointerSelectionContext,
    e: PointerEvent,
    target: HTMLElement
): PointerDownDecision {
    const policy = resolvePointerInputPolicy(context, e);
    const resize = decideSelectionResize(context, e, target, policy);
    if (resize.type !== 'none') return resize;

    const passiveDrag = decidePassiveSelectionDrag(context, e, target);
    if (passiveDrag.type !== 'none') return passiveDrag;

    const handle = target.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
    if (handle && !handle.classList.contains(EMBED_HANDLE_CLASS)) {
        return decideHandlePointerDown(context, e, handle, policy);
    }

    const textRange = decideTextRangeSelection(context, e, target, policy);
    if (textRange.type !== 'none') return textRange;
    if (isPassiveSelectionActive(context)) return { type: 'none' };
    return decideTextLongPressDrag(context, e, target, policy);
}

export function decideEnterMobileSelectionMode(
    context: PointerSelectionContext,
    e: Event
): MobileSelectionModeDecision {
    if (!context.isMobileEnvironment) return { type: 'none' };
    if (!context.isMultiLineSelectionEnabled) return { type: 'none' };
    if (context.pipelineState.type !== 'idle') return { type: 'none' };

    const line = context.view.state.doc.lineAt(context.view.state.selection.main.head);
    const boundaryAtCursor = createRangeSelectionBoundaryResolver(context.view.state)(line.number);
    const startLine = context.view.state.doc.line(boundaryAtCursor.startLineNumber);
    const endLine = context.view.state.doc.line(boundaryAtCursor.endLineNumber);
    return decideEnterMobileSelectionModeFromBlock(context, {
        type: BlockType.Paragraph,
        startLine: boundaryAtCursor.startLineNumber - 1,
        endLine: boundaryAtCursor.endLineNumber - 1,
        from: startLine.from,
        to: endLine.to,
        indentLevel: 0,
        content: context.view.state.doc.sliceString(startLine.from, endLine.to),
    }, e);
}

function decideEnterMobileSelectionModeFromBlock(
    context: PointerSelectionContext,
    blockInfo: BlockInfo,
    e: Event
): MobileSelectionModeDecision {
    if (!context.isMobileEnvironment) return { type: 'none' };
    if (!context.isMultiLineSelectionEnabled) return { type: 'none' };
    if (!context.canStartDragForPointer('touch', 'text')) return { type: 'none' };
    if (
        context.pipelineState.type !== 'idle'
        && context.pipelineState.type !== 'holding'
        && context.pipelineState.type !== 'ready_to_drag'
    ) {
        return { type: 'none' };
    }
    if (context.isBlockInsideRenderedTableCell(blockInfo)) return { type: 'none' };

    const selection = context.resolveBlockSelection({ kind: 'block', block: blockInfo });
    if (!selection) return { type: 'none' };

    return {
        type: 'start_mobile_selection_mode',
        selection,
        blockInfo,
        markEventHandled: e instanceof CustomEvent && !!e.detail && typeof e.detail === 'object',
    };
}

function resolvePointerInputPolicy(context: PointerSelectionContext, e: PointerEvent): PointerInputPolicy {
    const pointerType = e.pointerType || null;
    const platform = pointerType !== 'mouse' && context.isMobileEnvironment ? 'mobile' : 'desktop';
    return {
        platform,
        pointerType,
        canResizeSelection: platform === 'mobile',
        canUseTextLongPress: platform === 'mobile',
        handleLongPressMs: platform === 'desktop' ? 0 : MOBILE_DRAG_LONG_PRESS_MS,
    };
}

function isPassiveSelectionActive(context: PointerSelectionContext): boolean {
    return context.pipelineState.type === 'selecting'
        && context.pipelineState.selection.phase === 'passive';
}

function decideSelectionResize(
    context: PointerSelectionContext,
    e: PointerEvent,
    target: HTMLElement,
    policy: PointerInputPolicy
): PointerDownDecision {
    if (!policy.canResizeSelection) return { type: 'none' };
    if (context.pipelineState.type !== 'selecting' || context.pipelineState.selection.phase !== 'passive') return { type: 'none' };

    const handleEl = target.closest<HTMLElement>(`.${MOBILE_SELECTION_RESIZE_HANDLE_CLASS}`);
    if (!handleEl) return { type: 'none' };

    const rawHandle = handleEl.getAttribute('data-dnd-mobile-selection-handle');
    if (rawHandle !== 'top' && rawHandle !== 'bottom') return { type: 'none' };

    const targetSegment = readMobileSelectionHandleBlock(handleEl);
    if (!targetSegment) return { type: 'none' };
    return decideRangeSelectionFromMobileResizeHandle(context, rawHandle, targetSegment);
}

function decideRangeSelectionFromMobileResizeHandle(
    context: PointerSelectionContext,
    handle: 'top' | 'bottom',
    targetSegment: SelectedBlockRange
): PointerDownDecision {
    if (context.pipelineState.type !== 'selecting') return { type: 'none' };
    const selectedBlocks = selectedBlocksFromPipeline(context.pipelineState);
    if (selectedBlocks.length === 0) return { type: 'none' };
    const selectedSegment = groupSelectedBlocksIntoSegments(context.view.state.doc.lines, selectedBlocks)
        .find((segment) => (
            segment.startLineNumber === targetSegment.startLineNumber
            && segment.endLineNumber === targetSegment.endLineNumber
        ));
    if (!selectedSegment) return { type: 'none' };

    const baseSelectedBlocks = selectedBlocks.filter((block) => (
        block.endLineNumber < selectedSegment.startLineNumber
        || block.startLineNumber > selectedSegment.endLineNumber
    ));

    const fixedBoundary = buildMobileSelectionResizeBoundary(selectedSegment, handle === 'top' ? 'end' : 'start');
    const movingBoundary = buildMobileSelectionResizeBoundary(selectedSegment, handle === 'top' ? 'start' : 'end');
    return {
        type: 'start_range_selection',
        source: context.pipelineState.selection.selection,
        handle: null,
        preventDefault: true,
        capturePointer: true,
        applySelectionGestureGuard: true,
        options: {
            skipLongPress: true,
            initialOperation: 'add',
            guardDeps: ['mobile-text-drag-mode'],
            sourceKind: 'handle',
            baseSelectedBlocks,
            anchorBoundary: fixedBoundary,
            initialBoundary: movingBoundary,
            resolveBoundary: createRangeSelectionBoundaryResolver(context.view.state),
        },
    };
}

function decidePassiveSelectionDrag(
    context: PointerSelectionContext,
    e: PointerEvent,
    target: HTMLElement
): PointerDownDecision {
    if (!context.isMultiLineSelectionEnabled) return { type: 'none' };
    if (e.button !== 0) return { type: 'none' };
    const passiveSource = context.passiveSelectionSource;
    if (!passiveSource) return { type: 'none' };

    const pointerType = e.pointerType || null;
    const selectedHandleHit = !!target.closest(`.${RANGE_SELECTED_HANDLE_CLASS}`);
    if (pointerType === 'mouse' && selectedHandleHit) return { type: 'none' };
    if (!context.isSelectionDragGripHit(target, e.clientX, e.clientY, pointerType)) {
        return { type: 'none' };
    }
    const sourceKind: HoldTarget['source'] = selectedHandleHit ? 'handle' : 'selected_text';
    if (!context.canStartDragForPointer(pointerType, sourceKind)) return { type: 'none' };

    if (context.pipelineState.type === 'selecting' && context.hasActiveRangePointerSession) {
        return { type: 'retarget_mobile_range_selection' };
    }
    const longPressMs = pointerType !== 'mouse' && context.isMobileEnvironment
        ? MOBILE_SELECTED_RANGE_DRAG_LONG_PRESS_MS
        : undefined;
    return {
        type: 'start_press_drag',
        source: passiveSource,
        options: { sourceKind, longPressMs },
    };
}

function decideHandlePointerDown(
    context: PointerSelectionContext,
    e: PointerEvent,
    handle: HTMLElement,
    policy: PointerInputPolicy
): PointerDownDecision {
    if (e.button !== 0) return { type: 'none' };
    if (policy.platform === 'mobile') {
        const append = decideRangeSelectionFromHandleWhileSelecting(context, handle, e);
        if (append.type !== 'none') return append;
        const retarget = decideRetargetRangeSelectionFromHandleWhileSelecting(context, handle, e);
        if (retarget.type !== 'none') return retarget;
    }

    const source = context.resolveBlockSelection({ kind: 'handle', handle });
    if (!source) return { type: 'handled' };
    const blockInfo = source.anchorBlock;
    if (context.isBlockInsideRenderedTableCell(blockInfo)) return { type: 'handled' };

    const rangePolicy = resolveHandleRangeSelectionPolicy(context, e, policy);
    if (rangePolicy) {
        return {
            type: 'start_range_selection',
            source,
            handle,
            options: rangePolicy,
            preventDefault: policy.handleLongPressMs === 0,
        };
    }

    return {
        type: 'start_press_drag',
        source,
        options: {
            sourceKind: 'handle',
            longPressMs: policy.handleLongPressMs,
        },
    };
}

function resolveHandleRangeSelectionPolicy(
    context: PointerSelectionContext,
    e: PointerEvent,
    policy: PointerInputPolicy
): RangeSelectionSessionOptions | null {
    if (!context.isMultiLineSelectionEnabled) return null;
    if (policy.platform === 'mobile') {
        if (isPassiveSelectionActive(context)) return { skipLongPress: true };
        return { deferPipelineStart: true, guardDeps: ['mobile-text-drag-mode'], sourceKind: 'handle' };
    }
    return isPassiveSelectionActive(context) || e.shiftKey
        ? { skipLongPress: true }
        : { deferPipelineStart: true };
}

function decideRangeSelectionFromHandleWhileSelecting(
    context: PointerSelectionContext,
    handle: HTMLElement,
    e: PointerEvent
): PointerDownDecision {
    if (context.pipelineState.type !== 'selecting' || context.pipelineState.selection.phase !== 'passive') return { type: 'none' };
    if (e.pointerType === 'mouse') return { type: 'none' };
    if (targetIsInsideMobileSelection(handle)) return { type: 'none' };

    const source = context.resolveBlockSelection({ kind: 'handle', handle });
    if (!source) return { type: 'none' };
    return decideRangeSelectionThroughSharedSession(context, source, {
        skipLongPress: true,
    });
}

function decideRangeSelectionThroughSharedSession(
    context: PointerSelectionContext,
    source: BlockSelection,
    options?: Pick<RangeSelectionSessionOptions, 'skipLongPress' | 'deferPipelineStart' | 'allowSecondaryDrag' | 'sourceKind'>
): PointerDownDecision {
    if (context.pipelineState.type !== 'selecting' || context.pipelineState.selection.phase !== 'passive') return { type: 'none' };
    const blockInfo = source.anchorBlock;
    if (context.isBlockInsideRenderedTableCell(blockInfo)) return { type: 'none' };

    return {
        type: 'start_range_selection',
        source,
        handle: null,
        options: {
            ...options,
            initialOperation: 'add',
            guardDeps: ['mobile-text-drag-mode'],
        },
    };
}

function decideTextRangeSelection(
    context: PointerSelectionContext,
    e: PointerEvent,
    target: HTMLElement,
    policy: PointerInputPolicy
): PointerDownDecision {
    if (!isPassiveSelectionActive(context)) return { type: 'none' };
    if (!policy.canUseTextLongPress) return { type: 'none' };
    if (!shouldStartMobilePressDragByInput(e)) return { type: 'none' };
    if (!context.canStartDragForPointer(e.pointerType || null, 'text')) return { type: 'none' };
    if (!context.isMobileTextLongPressDragEnabled) return { type: 'none' };
    if (!context.isWithinMobileTextLineOrEmbedArea(target, e.clientX, e.clientY)) return { type: 'none' };

    const source = context.resolveBlockSelection({ kind: 'point', clientX: e.clientX, clientY: e.clientY });
    if (!source) return { type: 'none' };
    return decideRangeSelectionThroughSharedSession(context, source, {
        deferPipelineStart: true,
        allowSecondaryDrag: false,
        sourceKind: 'text',
    });
}

function decideRetargetRangeSelectionFromHandleWhileSelecting(
    context: PointerSelectionContext,
    handle: HTMLElement,
    e: PointerEvent
): PointerDownDecision {
    if (context.pipelineState.type !== 'selecting') return { type: 'none' };
    if (e.pointerType === 'mouse') return { type: 'none' };

    const source = context.resolveBlockSelection({ kind: 'handle', handle });
    if (!source) return { type: 'none' };
    const blockInfo = source.anchorBlock;
    if (context.isBlockInsideRenderedTableCell(blockInfo)) return { type: 'none' };

    return {
        type: 'change_selection',
        boundary: buildRangeSelectionBoundaryFromBlock(context.view.state.doc, blockInfo),
        preventDefault: true,
        capturePointer: true,
    };
}

function decideTextLongPressDrag(
    context: PointerSelectionContext,
    e: PointerEvent,
    target: HTMLElement,
    policy: PointerInputPolicy
): PointerDownDecision {
    if (!policy.canUseTextLongPress) return { type: 'none' };
    if (!shouldStartMobilePressDrag(context, e)) return { type: 'none' };
    if (!context.canStartDragForPointer(e.pointerType || null, 'text')) return { type: 'none' };

    const inTextLineOrEmbedArea = context.isMobileTextLongPressDragEnabled
        && context.isWithinMobileTextLineOrEmbedArea(target, e.clientX, e.clientY);
    if (!inTextLineOrEmbedArea) return { type: 'none' };

    const source = context.resolveBlockSelection({ kind: 'point', clientX: e.clientX, clientY: e.clientY });
    if (!source) return { type: 'none' };
    const blockInfo = source.anchorBlock;
    if (context.isBlockInsideRenderedTableCell(blockInfo)) return { type: 'none' };

    if (context.isMultiLineSelectionEnabled) {
        return {
            type: 'start_range_selection',
            source,
            handle: null,
            options: {
                deferPipelineStart: true,
                guardDeps: ['mobile-text-drag-mode'],
                sourceKind: 'text',
            },
        };
    }

    return {
        type: 'start_press_drag',
        source,
        options: { sourceKind: 'text' },
    };
}

function targetIsInsideMobileSelection(target: HTMLElement): boolean {
    return !!target.closest(`.${RANGE_SELECTED_HANDLE_CLASS}`);
}

function shouldStartMobilePressDrag(context: PointerSelectionContext, e: PointerEvent): boolean {
    if (context.pipelineState.type !== 'idle') return false;
    if (!context.isMobileEnvironment) return false;
    return shouldStartMobilePressDragByInput(e);
}

function buildMobileSelectionResizeBoundary(
    block: SelectedBlockRange,
    edge: 'start' | 'end'
): RangeSelectionBoundary {
    const lineNumber = edge === 'start' ? block.startLineNumber : block.endLineNumber;
    return {
        startLineNumber: lineNumber,
        endLineNumber: lineNumber,
        representativeLineNumber: lineNumber,
    };
}

function readMobileSelectionHandleBlock(handleEl: HTMLElement): SelectedBlockRange | null {
    const startLineNumber = Number(handleEl.getAttribute('data-dnd-mobile-selection-start-line'));
    const endLineNumber = Number(handleEl.getAttribute('data-dnd-mobile-selection-end-line'));
    if (!Number.isInteger(startLineNumber) || !Number.isInteger(endLineNumber)) return null;
    if (startLineNumber < 1 || endLineNumber < startLineNumber) return null;
    return { startLineNumber, endLineNumber };
}

function selectedBlocksFromPipeline(state: PipelineState): SelectedBlockRange[] {
    if (state.type !== 'selecting') return [];
    return selectedBlocksFromSelection(state.selection.selection);
}

function selectedBlocksFromSelection(selection: BlockSelection): SelectedBlockRange[] {
    return selection.ranges.map((range) => ({
        startLineNumber: range.startLine + 1,
        endLineNumber: range.endLine + 1,
    }));
}
