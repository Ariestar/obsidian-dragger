import { platform } from '../../../plugin/platform';
import { DRAG_HANDLE_CLASS, EMBED_HANDLE_CLASS } from '../../../shared/dom-selectors';
import {
    autoScrollEditorNearViewportEdge,
    readPointerInput,
    resolveRangeBoundaryAtPoint,
} from './pointer-hit-test';
import {
    buildRangeSelectionBoundaryFromBlock,
    type RangeSelectionBoundary,
} from '../../../domain/selection/range-selection';
import type { MouseRangeSelectState } from './range-selection-gesture-state';
import type { PipelineAdapter } from './pipeline-adapter';
import type { PointerPressSession, PointerTerminalMode } from './pointer-session';
import {
    MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX,
    MOBILE_DRAG_START_MOVE_THRESHOLD_PX,
    MOUSE_SECONDARY_DRAG_START_MOVE_THRESHOLD_PX,
} from './touch-delay-policy';

export type PointerMoveHost = PipelineAdapter;

export function handlePointerMove(host: PointerMoveHost, e: PointerEvent): void {
    readPointerInput('move', e);
    if (host.pressSession?.selectionToggleBrush) {
        handlePressPendingPointerMove(host, e);
        return;
    }
    switch (host.pipelineState.type) {
        case 'dragging':
            handleDraggingPointerMove(host, e);
            return;
        case 'selecting':
            if (host.rangePointerSession) {
                handleRangeSelectingPointerMove(host, e);
            }
            return;
        case 'holding':
        case 'ready_to_drag':
            handlePressPendingPointerMove(host, e);
            return;
        case 'idle':
            if (host.rangePointerSession) {
                handleRangeSelectingPointerMove(host, e);
            }
            return;
        default:
            return;
    }
}

function handleDraggingPointerMove(host: PointerMoveHost, e: PointerEvent): void {
    const dragState = host.activeDragSession;
    if (!dragState || host.pipelineState.type !== 'dragging') return;
    if (e.pointerId !== dragState.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    host.updateActiveDragPointer(e.clientX, e.clientY, e.pointerType || null);
    const drop = host.resolveActiveDragDropSnapshot(host.pipelineState.drag.selection);
    host.previewActiveDrag({
        pointerId: e.pointerId,
        pointerType: e.pointerType || null,
        drop,
    });
    if (autoScrollDrag(host, dragState)) {
        scheduleDragAutoScroll(host, dragState);
    }
}

function autoScrollDrag(
    host: PointerMoveHost,
    dragState: { pointerId: number }
): boolean {
    if (host.pipelineState.type !== 'dragging') return false;
    const pointer = host.getActiveDragPointer();
    if (!pointer) return false;
    const didScroll = autoScrollEditorNearViewportEdge(
        host.view,
        pointer.clientY,
        host.deps.getAutoScrollEdgeZonePx?.(),
        host.deps.getAutoScrollMaxSpeedPx?.(),
    );
    if (didScroll) {
        const drop = host.resolveActiveDragDropSnapshot(host.pipelineState.drag.selection);
        host.previewActiveDrag({
            pointerId: dragState.pointerId,
            pointerType: pointer.pointerType,
            drop,
        });
    }
    return didScroll;
}

function scheduleDragAutoScroll(host: PointerMoveHost, dragState: { autoScrollFrameId: number | null }): void {
    if (dragState.autoScrollFrameId !== null) return;
    dragState.autoScrollFrameId = window.requestAnimationFrame(() => {
        if (host.pipelineState.type !== 'dragging' || !host.activeDragSession) return;
        const state = host.activeDragSession;
        state.autoScrollFrameId = null;
        if (!autoScrollDrag(host, state)) return;
        scheduleDragAutoScroll(host, state);
    });
}

function handleRangeSelectingPointerMove(host: PointerMoveHost, e: PointerEvent): void {
    const rangeState = host.rangePointerSession;
    if (!rangeState) return;
    if (rangeState.pipelineStarted && host.pipelineState.type !== 'selecting') return;
    if (rangeState.pointerId !== -1 && e.pointerId !== rangeState.pointerId) return;
    handleRangeSelectionPointerMove(host, e, rangeState);
}

function handlePressPendingPointerMove(host: PointerMoveHost, e: PointerEvent): void {
    const pressState = host.pressSession;
    if (!pressState) return;
    if (e.pointerId !== pressState.pointerId) return;

    const previousX = pressState.latestX;
    const previousY = pressState.latestY;
    pressState.latestX = e.clientX;
    pressState.latestY = e.clientY;

    const dx = e.clientX - pressState.startX;
    const dy = e.clientY - pressState.startY;
    const distance = Math.hypot(dx, dy);

    if (!pressState.longPressReady) {
        if (pressState.shortPressSelectionToggle && distance >= pressState.startMoveThresholdPx) {
            const didToggle = toggleBrushTargetsBetween(host, pressState, previousX, previousY, e.clientX, e.clientY);
            if (didToggle) {
                e.preventDefault();
                e.stopPropagation();
                return;
            }
        }
        if (distance > pressState.cancelMoveThresholdPx) {
            host.abortForGestureCancel('press_cancelled', e.pointerType || null);
        }
        return;
    }

    if (distance < pressState.startMoveThresholdPx) return;
    if (host.pipelineState.type !== 'ready_to_drag') return;

    e.preventDefault();
    e.stopPropagation();
    const source = host.pipelineState.hold.target.selection;
    const sourceKind = host.pipelineState.hold.target.source;
    const pointerId = pressState.pointerId;
    host.enterDraggingState(source, pointerId, e.clientX, e.clientY, e.pointerType || null, sourceKind);
}

function toggleBrushTargetsBetween(
    host: PointerMoveHost,
    pressState: PointerPressSession,
    startX: number,
    startY: number,
    clientX: number,
    clientY: number
): boolean {
    const brush = pressState.selectionToggleBrush ?? {
        toggledKeys: new Set<string>(),
    };
    pressState.selectionToggleBrush = brush;
    if (pressState.timeoutId !== null) {
        window.clearTimeout(pressState.timeoutId);
        pressState.timeoutId = null;
    }
    return host.toggleRangeSelectionTargetsBetween(startX, startY, clientX, clientY, brush.toggledKeys);
}

function handleRangeSelectionPointerMove(
    host: PointerMoveHost,
    e: PointerEvent,
    state: MouseRangeSelectState
): void {
    state.latestX = e.clientX;
    state.latestY = e.clientY;
    const pointerType = state.pointerType ?? (e.pointerType || null);
    const distance = Math.hypot(e.clientX - state.startX, e.clientY - state.startY);
    const dx = e.clientX - state.startX;
    const dy = e.clientY - state.startY;

    if (state.pointerId === -1 && platform.isMobile && host.mobile.isMostlyVerticalScrollGesture(dx, dy)) {
        host.finishRangeSelectionSession();
        return;
    }

    if (!state.longPressReady) {
        if (!platform.isMobile) {
            if (distance >= MOUSE_SECONDARY_DRAG_START_MOVE_THRESHOLD_PX) {
                e.preventDefault();
                e.stopPropagation();
                const pointerId = state.pointerId;
                host.clearMouseRangeSelectState();
                host.enterDraggingState(state.sourceSelection, pointerId, e.clientX, e.clientY, pointerType, state.sourceKind);
            }
        } else {
            if (!state.dragReady) {
                if (distance > MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX) {
                    if (state.pipelineStarted) {
                        host.abortForGestureCancel('press_cancelled', pointerType);
                    } else {
                        host.finishRangeSelectionSession();
                    }
                }
                return;
            }
            if (distance >= MOBILE_DRAG_START_MOVE_THRESHOLD_PX) {
                e.preventDefault();
                e.stopPropagation();
                const pointerId = state.pointerId;
                host.clearMouseRangeSelectState();
                host.enterDraggingState(state.sourceSelection, pointerId, e.clientX, e.clientY, pointerType, state.sourceKind);
            }
        }
        return;
    }

    if (shouldStartDesktopSelectedHandleDrag(host, state, distance)) {
        const source = host.resolveBlockSelection({
            kind: 'selection',
            doc: host.view.state.doc,
            blocks: state.baseSelectedBlocks,
            templateBlock: state.sourceSelection.anchorBlock,
        });
        if (source) {
            e.preventDefault();
            e.stopPropagation();
            const pointerId = state.pointerId;
            host.clearMouseRangeSelectState();
            host.enterDraggingState(source, pointerId, e.clientX, e.clientY, pointerType, state.sourceKind);
            return;
        }
    }

    host.activateMouseRangeSelectInterception(state);
    e.preventDefault();
    e.stopPropagation();

    const targetBoundary = resolveHandleRangeBoundaryAtPoint(host, e.clientX, e.clientY)
        ?? resolveRangeBoundaryAtPoint(host.view, e.clientX, e.clientY, (x, y) => host.resolveBlockSelection({ kind: 'point', clientX: x, clientY: y })?.anchorBlock ?? null);
    if (targetBoundary) {
        host.updateMouseRangeSelection(state, targetBoundary);
    }

    autoScrollEditorNearViewportEdge(
        host.view,
        e.clientY,
        host.deps.getAutoScrollEdgeZonePx?.(),
        host.deps.getAutoScrollMaxSpeedPx?.(),
    );
}

function shouldStartDesktopSelectedHandleDrag(
    host: PointerMoveHost,
    state: MouseRangeSelectState,
    distance: number
): boolean {
    if (platform.isMobile) return false;
    if (!state.dragReady || state.sourceKind !== 'handle') return false;
    if (distance < MOUSE_SECONDARY_DRAG_START_MOVE_THRESHOLD_PX) return false;
    if (host.pipelineState.type !== 'selecting') return false;
    return host.pipelineState.selection.rangeState?.operation === 'remove';
}

function resolveHandleRangeBoundaryAtPoint(
    host: PointerMoveHost,
    clientX: number,
    clientY: number
): RangeSelectionBoundary | null {
    if (typeof activeDocument.elementFromPoint !== 'function') {
        return null;
    }
    const hit = activeDocument.elementFromPoint(clientX, clientY);
    if (!hit?.instanceOf(HTMLElement)) return null;

    const handle = hit.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
    if (!handle || handle.classList.contains(EMBED_HANDLE_CLASS)) return null;
    if (!host.view.dom.contains(handle)) return null;

    const source = host.resolveBlockSelection({ kind: 'handle', handle });
    if (!source) return null;
    return buildRangeSelectionBoundaryFromBlock(host.view.state.doc, source.anchorBlock);
}

export function handlePointerUp(host: PipelineAdapter, e: PointerEvent): void {
    readPointerInput('up', e);
    handlePointerTerminal(host, e, 'up');
}

export function handlePointerCancel(host: PipelineAdapter, e: PointerEvent): void {
    readPointerInput('cancel', e);
    handlePointerTerminal(host, e, 'cancel');
}

function handlePointerTerminal(
    host: PipelineAdapter,
    e: PointerEvent,
    mode: PointerTerminalMode
): void {
    if (host.pressSession?.selectionToggleBrush) {
        finishPressPendingPointer(host, e, mode);
        return;
    }
    switch (host.pipelineState.type) {
        case 'dragging':
            finishPointerDrag(host, e, mode === 'up');
            return;
        case 'selecting':
            if (host.rangePointerSession) {
                finishRangeSelectingPointer(host, e, mode);
            }
            return;
        case 'holding':
        case 'ready_to_drag':
            finishPressPendingPointer(host, e, mode);
            return;
        case 'idle':
            if (host.rangePointerSession) {
                finishRangeSelectingPointer(host, e, mode);
            }
            return;
        default:
            return;
    }
}

function finishPointerDrag(host: PipelineAdapter, e: PointerEvent, shouldDrop: boolean): void {
    const state = host.activeDragSession;
    if (!state || host.pipelineState.type !== 'dragging') return;
    if (e.pointerId !== state.pointerId) return;
    e.preventDefault();
    e.stopPropagation();
    if (shouldDrop) {
        host.updateActiveDragPointer(e.clientX, e.clientY, e.pointerType || null);
        const resolved = host.buildActiveDragCommand(host.pipelineState.drag.selection);
        host.commitActiveDrag({
            pointerId: e.pointerId,
            pointerType: e.pointerType || null,
            resolved,
        });
    } else {
        host.cancelActiveDrag({
            pointerId: e.pointerId,
            pointerType: e.pointerType || null,
            reason: 'pointer_cancelled',
        });
    }
    host.cleanupAfterPointerDrag({
        shouldFinishDragSession: true,
        shouldHideDropPreview: true,
        cancelReason: null,
        pointerType: e.pointerType || null,
    });
}

function finishRangeSelectingPointer(
    host: PipelineAdapter,
    e: PointerEvent,
    mode: PointerTerminalMode
): void {
    const rangeState = host.rangePointerSession;
    if (!rangeState) return;
    if (rangeState.pointerId !== -1 && e.pointerId !== rangeState.pointerId) return;
    if (
        mode === 'up'
        && !rangeState.longPressReady
        && host.pipelineState.type === 'idle'
        && shouldOpenBlockTypeMenuFromShortTextTap(host, rangeState.sourceKind)
    ) {
        e.preventDefault();
        e.stopPropagation();
        host.openBlockTypeMenuForTap(rangeState.sourceSelection, e);
        return;
    }
    if (mode === 'up' && !rangeState.longPressReady && !platform.isMobile) {
        e.preventDefault();
        e.stopPropagation();
        host.deps.openBlockTypeMenu?.(rangeState.sourceSelection.anchorBlock, e);
        host.finishRangeSelectionSession();
        return;
    }
    if (host.pipelineState.type !== 'selecting') {
        host.finishRangeSelectionSession();
        return;
    }
    if (mode === 'cancel') {
        if (!rangeState.pipelineStarted) {
            host.finishRangeSelectionSession();
            return;
        }
        host.abortForGestureCancel('pointer_cancelled', e.pointerType || null);
        return;
    }
    if (!rangeState.longPressReady) {
        if (mode === 'up' && !platform.isMobile) {
            e.preventDefault();
            e.stopPropagation();
            host.deps.openBlockTypeMenu?.(rangeState.sourceSelection.anchorBlock, e);
            host.finishRangeSelectionSession();
            return;
        }
        if (rangeState.pipelineStarted) {
            host.abortForGestureCancel('press_cancelled', e.pointerType || null);
        } else {
            host.finishRangeSelectionSession();
        }
        return;
    }
    e.preventDefault();
    e.stopPropagation();
    host.finishRangeSelectionSession();
}

function finishPressPendingPointer(
    host: PipelineAdapter,
    e: PointerEvent,
    mode: PointerTerminalMode
): void {
    const pressState = host.pressSession;
    if (!pressState) return;
    if (e.pointerId !== pressState.pointerId) return;
    if (pressState.selectionToggleBrush) {
        e.preventDefault();
        e.stopPropagation();
        host.finishPointerPressSession();
        return;
    }
    const pressDistance = Math.hypot(
        pressState.latestX - pressState.startX,
        pressState.latestY - pressState.startY
    );
    if (
        mode === 'up'
        && !pressState.longPressReady
        && pressDistance < pressState.startMoveThresholdPx
        && (host.pipelineState.type === 'holding' || host.pipelineState.type === 'ready_to_drag')
        && host.pipelineState.hold.retainedSelection
        && pressState.shortPressSelectionToggle
    ) {
        e.preventDefault();
        e.stopPropagation();
        if (host.toggleRangeSelectionTarget(pressState.shortPressSelectionToggle)) {
            host.finishPointerPressSession();
            return;
        }
    }
    if (
        mode === 'up'
        && !pressState.longPressReady
        && (host.pipelineState.type === 'holding' || host.pipelineState.type === 'ready_to_drag')
        && shouldOpenBlockTypeMenuFromShortTextTap(host, host.pipelineState.hold.target.source)
    ) {
        e.preventDefault();
        e.stopPropagation();
        host.openBlockTypeMenuForTap(host.pipelineState.hold.target.selection, e);
        return;
    }
    host.abortForGestureCancel(mode === 'up' ? 'press_cancelled' : 'pointer_cancelled', e.pointerType || null);
}

function shouldOpenBlockTypeMenuFromShortTextTap(
    host: PipelineAdapter,
    sourceKind: string | null | undefined
): boolean {
    return sourceKind === 'text'
        && host.isMobileDragModeActiveForPointer();
}
