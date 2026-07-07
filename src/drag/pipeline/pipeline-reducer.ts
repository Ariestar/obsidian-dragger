import type { PipelineEvent } from './pipeline-event';
import {
    buildIdleLifecycleEvent,
    buildPressPendingLifecycleEvent,
    type PipelineOutput,
} from './pipeline-output';
import type { BlockSelection } from '../../domain/selection/block-selection';
import {
    createBlockRangeSelectionState,
    updateBlockRangeSelectionState,
    type BlockRangeSelectionState,
} from '../../domain/selection/block-range-selection';
import { drop, dragOver, startDragDrop } from './pipeline-drop';
import { clearSelection, cancelPipeline, destroyPipeline, exitForUnavailableGuard } from './pipeline-exit';
import { withGuardDeps } from './pipeline-guard';
import { IDLE_PIPELINE_STATE, type PipelineState } from './pipeline-state';

export type PipelineTransitionResult<TPreview = unknown> = {
    state: PipelineState;
    outputs: PipelineOutput<TPreview>[];
};

export function transitionPipelineState<TPreview>(
    state: PipelineState,
    event: PipelineEvent<TPreview>
): PipelineTransitionResult<TPreview> {
    switch (event.type) {
        case 'hold_start':
            return onHoldStart(state, event);
        case 'hold_ready':
            return onHoldReady(state, event);
        case 'selection_start':
            return onSelectionStart(state, event);
        case 'selection_change':
            return onSelectionChange(state, event);
        case 'selection_finish':
            return onSelectionFinish(state);
        case 'selection_clear':
            return clearSelection(state);
        case 'drag_start':
            return onDragStart(state, event);
        case 'drag_over':
            return onDragOver(state, event);
        case 'drop':
            return onDrop(state, event);
        case 'cancel':
            return cancelPipeline(state, event.reason, event.pointerType ?? null);
        case 'guard_unavailable':
            return exitForUnavailableGuard(state, event.guardId);
        case 'destroy':
            return destroyPipeline();
    }
}

function onHoldStart<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'hold_start' }>
): PipelineTransitionResult<TPreview> {
    const next: PipelineState = {
        type: 'holding',
        hold: {
            sessionId: event.sessionId,
            target: event.target,
            guardDeps: withGuardDeps(event.guardDeps),
            ...(state.type === 'selecting' && state.selection.phase === 'passive'
                ? { retainedSelection: state.selection }
                : {}),
        },
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
            { type: 'lifecycle', event: buildPressPendingLifecycleEvent(event.target.selection, event.pointerType ?? null, false) },
        ],
    };
}

function onHoldReady<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'hold_ready' }>
): PipelineTransitionResult<TPreview> {
    if (state.type !== 'holding' || state.hold.sessionId !== event.sessionId) {
        return { state, outputs: [] };
    }
    const next: PipelineState = {
        type: 'ready_to_drag',
        hold: state.hold,
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
            { type: 'lifecycle', event: buildPressPendingLifecycleEvent(state.hold.target.selection, event.pointerType ?? null, true) },
        ],
    };
}

function onSelectionStart<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'selection_start' }>
): PipelineTransitionResult<TPreview> {
    const rangeState = createSelectionRangeState(event.seed);
    if (event.seed.range && !rangeState) {
        return { state, outputs: [] };
    }
    const selectionRangeState = rangeState ?? undefined;
    const selection = rangeState
        ? buildSelectionFromRangeState(event.seed.selection, rangeState.selectionBlocks)
        : event.seed.selection;
    const next: PipelineState = {
        type: 'selecting',
        selection: {
            selection,
            phase: 'adjusting',
            guardDeps: withGuardDeps(event.guardDeps),
            rangeState: selectionRangeState,
        },
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
            { type: 'selection_changed', selection },
        ],
    };
}

function createSelectionRangeState(
    seed: Extract<PipelineEvent, { type: 'selection_start' }>['seed']
): BlockRangeSelectionState | null | undefined {
    if (!seed.range) return undefined;
    return createBlockRangeSelectionState(seed.range);
}

function onSelectionChange<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'selection_change' }>
): PipelineTransitionResult<TPreview> {
    if (state.type !== 'selecting') {
        return { state, outputs: [] };
    }
    if (!state.selection.rangeState || event.docLines === undefined || !event.resolveBoundary) {
        return { state, outputs: [] };
    }

    const rangeState = updateBlockRangeSelectionState(state.selection.rangeState, {
        docLines: event.docLines,
        target: event.boundary,
        resolveBoundary: event.resolveBoundary,
    });
    const selection = buildSelectionFromRangeState(state.selection.selection, rangeState.selectionBlocks);
    const next: PipelineState = {
        type: 'selecting',
        selection: {
            ...state.selection,
            selection,
            phase: 'adjusting',
            rangeState,
        },
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
            { type: 'selection_changed', selection },
        ],
    };
}

function buildSelectionFromRangeState(
    base: BlockSelection,
    blocks: Array<{ startLineNumber: number; endLineNumber: number }>
): BlockSelection {
    return {
        ...base,
        ranges: blocks.map((block) => ({
            startLine: block.startLineNumber - 1,
            endLine: block.endLineNumber - 1,
        })),
    };
}

function onSelectionFinish<TPreview>(state: PipelineState): PipelineTransitionResult<TPreview> {
    if (state.type !== 'selecting') {
        return { state, outputs: [] };
    }
    const next: PipelineState = {
        type: 'selecting',
        selection: {
            ...state.selection,
            phase: 'passive',
        },
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
            { type: 'selection_changed', selection: next.selection.selection },
        ],
    };
}

function onDragStart<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'drag_start' }>
): PipelineTransitionResult<TPreview> {
    if (state.type !== 'ready_to_drag' || state.hold.sessionId !== event.sessionId) {
        return { state, outputs: [] };
    }
    const next: PipelineState = {
        type: 'dragging',
        drag: {
            sessionId: event.sessionId,
            selection: state.hold.target.selection,
            drop: event.drop,
            guardDeps: state.hold.guardDeps,
        },
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
            ...startDragDrop({
                selection: next.drag.selection,
                drop: event.drop,
                pointerType: event.pointerType ?? null,
            }),
        ],
    };
}

function onDragOver<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'drag_over' }>
): PipelineTransitionResult<TPreview> {
    if (state.type !== 'dragging' || state.drag.sessionId !== event.sessionId) {
        return { state, outputs: [] };
    }
    const next: PipelineState = {
        type: 'dragging',
        drag: {
            ...state.drag,
            drop: event.drop,
        },
    };
    return {
        state: next,
        outputs: [
            { type: 'state_changed', state: next },
            ...dragOver({
                selection: next.drag.selection,
                drop: event.drop,
                pointerType: event.pointerType ?? null,
            }),
        ],
    };
}

function onDrop<TPreview>(
    state: PipelineState,
    event: Extract<PipelineEvent<TPreview>, { type: 'drop' }>
): PipelineTransitionResult<TPreview> {
    if (state.type !== 'dragging' || state.drag.sessionId !== event.sessionId) {
        return { state, outputs: [] };
    }
    return {
        state: IDLE_PIPELINE_STATE,
        outputs: [
            { type: 'state_changed', state: IDLE_PIPELINE_STATE },
            ...drop({
                selection: state.drag.selection,
                resolution: event.resolution,
                pointerType: event.pointerType ?? null,
            }),
            { type: 'lifecycle', event: buildIdleLifecycleEvent() },
        ],
    };
}
