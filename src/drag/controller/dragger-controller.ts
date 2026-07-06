import { createSingleBlockSelection, type BlockSelection } from '../../domain/selection/block-selection';
import { createDragPipeline, type DragPipeline, type PipelineResult } from '../pipeline/drag-pipeline';
import type { DropResolution } from '../pipeline/pipeline-drop';
import type { DragCancelReason } from '../pipeline/pipeline-event';
import type { PipelineOutput } from '../pipeline/pipeline-output';
import type { HoldTarget, PipelineState } from '../pipeline/pipeline-state';
import type { RangeSelectionBoundaryResolver } from '../../domain/selection/range-selection';
import {
    type DragPoint,
    type DragPointer,
    type DragRule,
    type DragTimerToken,
    type DraggerControllerConfig,
    type DraggerControllerOptions,
    type DraggerDisposable,
    type DraggerDropInspectContext,
    type DraggerDropSnapshot,
    type DraggerMoveInput,
    type DraggerPressInput,
    type DraggerPressSnapshot,
    type DraggerRangeStart,
    type DraggerReleaseInput,
} from './dragger-controller-types';

const DEFAULT_CONFIG: DraggerControllerConfig = {
    longPressMs: 250,
    dragStartMoveThresholdPx: 4,
    dragCancelMoveThresholdPx: 12,
    textLongPressDragEnabled: true,
    multiLineSelectionEnabled: true,
};

type PressSession = {
    sessionId: string;
    pointer: DragPointer;
    start: DragPoint;
    selection: BlockSelection;
    source: HoldTarget['source'];
    guardDeps: string[];
    ready: boolean;
    timer: DragTimerToken | null;
    releaseCapture?: () => void;
};

type ActiveDragSession<TPreview = unknown> = {
    sessionId: string;
    pointer: DragPointer;
    source: HoldTarget['source'];
    drop: DraggerDropSnapshot<TPreview> | null;
    releaseCapture?: () => void;
};

type RangeSession = {
    pointer: DragPointer;
    selection: BlockSelection;
    resolveBoundary?: RangeSelectionBoundaryResolver;
};

export class DraggerController<TPreview = unknown> {
    private readonly pipeline: DragPipeline<TPreview>;
    private readonly disposables: DraggerDisposable[] = [];
    private pressSession: PressSession | null = null;
    private activeDragSession: ActiveDragSession<TPreview> | null = null;
    private rangeSession: RangeSession | null = null;
    private mounted = false;

    constructor(
        private readonly options: DraggerControllerOptions<TPreview>
    ) {
        this.pipeline = createDragPipeline<TPreview>();
    }

    get state(): PipelineState {
        return this.pipeline.state;
    }

    mount(): void {
        if (this.mounted) return;
        this.mounted = true;
        this.disposables.push(this.options.input.onPress((input) => this.handlePress(input)));
        this.disposables.push(this.options.input.onMove((input) => this.handleMove(input)));
        this.disposables.push(this.options.input.onRelease((input) => this.handleRelease(input)));
        if (this.options.input.onCancel) {
            this.disposables.push(this.options.input.onCancel((input) => {
                this.handleCancel(input.pointer, input.reason, input.releaseCapture);
            }));
        }
        if (this.options.input.onEscape) {
            this.disposables.push(this.options.input.onEscape(() => {
                this.cancel('press_cancelled', null);
            }));
        }
    }

    destroy(): void {
        this.clearPressSession();
        this.releaseActiveDragCapture();
        this.rangeSession = null;
        while (this.disposables.length > 0) {
            this.disposables.pop()?.();
        }
        this.mounted = false;
        this.enter({ type: 'destroy' });
        this.options.effects?.hideDropPreview?.();
    }

    guardUnavailable(guardId: string): void {
        this.clearPressSession();
        this.releaseActiveDragCapture();
        this.rangeSession = null;
        this.enter({ type: 'guard_unavailable', guardId });
        this.options.effects?.hideDropPreview?.();
    }

    selectRange(range: DraggerRangeStart): void {
        if (!this.config().multiLineSelectionEnabled) return;
        this.startRange(range);
        this.enter({ type: 'selection_finish' });
    }

    private handlePress(input: DraggerPressInput): void {
        if (input.button !== undefined && input.button !== 0) return;

        const snapshot = this.options.inspect.press(input);
        if (snapshot.blockedReason) {
            this.cancel(snapshot.blockedReason, input.pointer.type);
            return;
        }
        if (snapshot.zone === 'none') return;
        if (snapshot.zone === 'block_menu') {
            const selection = this.resolveSelection(snapshot);
            if (selection) this.options.effects?.openBlockMenu?.(selection, input);
            return;
        }
        if (snapshot.zone === 'selection_grip') {
            this.startRangeSelection(input, snapshot);
            return;
        }

        const source = this.resolveSource(snapshot);
        if (!source) return;
        const selection = this.resolveSelection(snapshot);
        if (!selection) return;
        if (source === 'text' && !this.config().textLongPressDragEnabled) return;

        input.claim?.();
        input.capture?.();
        this.beginPressSession({
            input,
            selection,
            source,
            guardDeps: snapshot.guardDeps ?? [],
            longPressMs: snapshot.longPressMs,
            skipLongPress: snapshot.skipLongPress,
        });
    }

    private beginPressSession(params: {
        input: DraggerPressInput;
        selection: BlockSelection;
        source: HoldTarget['source'];
        guardDeps: string[];
        longPressMs?: number;
        skipLongPress?: boolean;
    }): void {
        this.clearPressSession();
        const sessionId = this.createSessionId();
        const timer = params.skipLongPress
            ? null
            : this.setTimer(
                () => this.markPressReady(sessionId, params.input.pointer),
                params.longPressMs ?? this.config().longPressMs
            );
        this.pressSession = {
            sessionId,
            pointer: params.input.pointer,
            start: params.input.point,
            selection: params.selection,
            source: params.source,
            guardDeps: params.guardDeps,
            ready: params.skipLongPress === true,
            timer,
            releaseCapture: params.input.releaseCapture,
        };
        this.enter({
            type: 'hold_start',
            sessionId,
            target: { selection: params.selection, source: params.source },
            guardDeps: params.guardDeps,
            pointerType: params.input.pointer.type,
        });
        if (params.skipLongPress) {
            this.enter({ type: 'hold_ready', sessionId, pointerType: params.input.pointer.type });
        }
    }

    private handleMove(input: DraggerMoveInput): void {
        if (this.activeDragSession) {
            this.handleDragMove(input);
            return;
        }
        if (this.rangeSession) {
            this.handleRangeMove(input);
            return;
        }
        const session = this.pressSession;
        if (!session || !samePointer(session.pointer, input.pointer)) return;

        const distance = distanceBetween(session.start, input.point);
        if (!session.ready) {
            if (distance > this.config().dragCancelMoveThresholdPx) {
                this.cancel('press_cancelled', input.pointer.type);
            }
            return;
        }
        if (distance < this.config().dragStartMoveThresholdPx) return;

        input.claim?.();
        this.startDrag(input);
    }

    private handleRelease(input: DraggerReleaseInput): void {
        if (this.activeDragSession && samePointer(this.activeDragSession.pointer, input.pointer)) {
            input.claim?.();
            this.drop(input);
            input.releaseCapture?.();
            return;
        }
        if (this.pressSession && samePointer(this.pressSession.pointer, input.pointer)) {
            input.releaseCapture?.();
            this.cancel('press_cancelled', input.pointer.type);
            return;
        }
        if (this.rangeSession && samePointer(this.rangeSession.pointer, input.pointer)) {
            input.releaseCapture?.();
            this.finishRangeSelection();
        }
    }

    private handleCancel(
        pointer: DragPointer,
        reason: DragCancelReason,
        releaseCapture?: () => void
    ): void {
        if (this.activeDragSession && samePointer(this.activeDragSession.pointer, pointer)) {
            releaseCapture?.();
            this.cancel(reason, pointer.type);
            return;
        }
        if (this.pressSession && samePointer(this.pressSession.pointer, pointer)) {
            releaseCapture?.();
            this.cancel(reason, pointer.type);
            return;
        }
        if (this.rangeSession && samePointer(this.rangeSession.pointer, pointer)) {
            releaseCapture?.();
            this.cancel(reason, pointer.type);
        }
    }

    private startRangeSelection(input: DraggerPressInput, snapshot: DraggerPressSnapshot): void {
        if (!this.config().multiLineSelectionEnabled) return;
        const selection = this.resolveSelection(snapshot);
        const anchorBoundary = snapshot.rangeBoundary;
        const doc = snapshot.rangeDoc;
        if (!selection || !anchorBoundary || !doc) return;

        input.claim?.();
        input.capture?.();
        this.rangeSession = {
            pointer: input.pointer,
            selection,
            resolveBoundary: snapshot.rangeBoundaryResolver,
        };
        this.startRange({ ...snapshot, selection });
    }

    private startRange(range: DraggerRangeStart): void {
        const anchorBoundary = range.rangeBoundary;
        const doc = range.rangeDoc;
        if (!anchorBoundary || !doc) return;
        this.enter({
            type: 'selection_start',
            seed: {
                selection: range.selection,
                range: {
                    type: 'range',
                    doc,
                    anchorBoundary,
                    initialBoundary: range.initialRangeBoundary ?? undefined,
                    selectedBlocks: range.selectedBlocks ?? [],
                    operation: range.rangeOperation,
                    resolveBoundary: range.rangeBoundaryResolver,
                },
            },
            guardDeps: range.guardDeps,
        });
    }

    private handleRangeMove(input: DraggerMoveInput): void {
        const session = this.rangeSession;
        if (!session || !samePointer(session.pointer, input.pointer)) return;
        const boundary = this.options.inspect.range?.(input, {
            selection: session.selection,
            pointer: input.pointer,
        });
        if (!boundary || !session.resolveBoundary) return;
        input.claim?.();
        this.enter({
            type: 'selection_change',
            boundary,
            docLines: this.options.inspect.document().lineCount,
            resolveBoundary: session.resolveBoundary,
        });
    }

    private finishRangeSelection(): void {
        if (!this.rangeSession) return;
        this.rangeSession = null;
        this.enter({ type: 'selection_finish' });
    }

    private markPressReady(sessionId: string, pointer: DragPointer): void {
        const session = this.pressSession;
        if (!session || session.sessionId !== sessionId || !samePointer(session.pointer, pointer)) return;
        session.ready = true;
        this.clearPressTimer(session);
        this.enter({ type: 'hold_ready', sessionId, pointerType: pointer.type });
    }

    private startDrag(input: DraggerMoveInput): void {
        const session = this.pressSession;
        if (!session || this.state.type !== 'ready_to_drag') return;
        const drop = this.resolveDrop(input, session.selection, session.source, input.pointer);
        this.activeDragSession = {
            sessionId: session.sessionId,
            pointer: input.pointer,
            source: session.source,
            drop,
            releaseCapture: session.releaseCapture,
        };
        const result = this.enter({
            type: 'drag_start',
            sessionId: session.sessionId,
            drop,
            pointerType: input.pointer.type,
        });
        if (result.current.type !== 'dragging') {
            this.activeDragSession = null;
            return;
        }
        this.clearPressTimer(session);
        this.pressSession = null;
    }

    private handleDragMove(input: DraggerMoveInput): void {
        const drag = this.activeDragSession;
        if (!drag || this.state.type !== 'dragging' || !samePointer(drag.pointer, input.pointer)) return;
        input.claim?.();
        const drop = this.resolveDrop(input, this.state.drag.selection, drag.source, input.pointer);
        drag.drop = drop;
        this.enter({
            type: 'drag_over',
            sessionId: drag.sessionId,
            drop,
            pointerType: input.pointer.type,
        });
    }

    private drop(input: DraggerReleaseInput): void {
        const drag = this.activeDragSession;
        if (!drag || this.state.type !== 'dragging') return;
        const drop = this.resolveDrop(input, this.state.drag.selection, drag.source, input.pointer);
        drag.drop = drop;
        this.enter({
            type: 'drop',
            sessionId: drag.sessionId,
            resolution: this.resolveDropResolution(input, this.state.drag.selection, drag.source, input.pointer, drop),
            pointerType: input.pointer.type,
        });
        this.activeDragSession = null;
        this.options.effects?.hideDropPreview?.();
    }

    private cancel(reason: DragCancelReason, pointerType: string | null): void {
        this.clearPressSession();
        this.releaseActiveDragCapture();
        this.enter({ type: 'cancel', reason, pointerType });
        this.options.effects?.hideDropPreview?.();
    }

    private resolveDrop(
        input: DraggerMoveInput | DraggerReleaseInput,
        selection: BlockSelection,
        source: HoldTarget['source'],
        pointer: DragPointer
    ): DraggerDropSnapshot<TPreview> {
        const context: DraggerDropInspectContext<TPreview> = {
            selection,
            source,
            pointer,
            drop: this.activeDragSession?.drop ?? null,
        };
        const inspected = this.options.inspect.drop(input, context);
        const rejection = this.resolveRuleRejection(selection, source, inspected);
        if (!rejection) return inspected;
        return {
            ...inspected,
            target: null,
            rejectReason: rejection,
        };
    }

    private resolveRuleRejection(
        selection: BlockSelection,
        source: HoldTarget['source'],
        drop: DraggerDropSnapshot<TPreview>
    ): DragCancelReason | null {
        if (drop.rejectReason) return drop.rejectReason;
        if (!drop.target) return 'no_target';
        for (const rule of this.rules()) {
            const result = rule({
                selection,
                source,
                document: this.options.inspect.document(),
                drop,
            });
            if (!result.allowed) return result.reason ?? 'container_policy';
        }
        return null;
    }

    private resolveDropResolution(
        input: DraggerReleaseInput,
        selection: BlockSelection,
        source: HoldTarget['source'],
        pointer: DragPointer,
        drop: DraggerDropSnapshot<TPreview>
    ): DropResolution<TPreview> {
        if (!drop.target) {
            return {
                type: 'cancel',
                drop,
                reason: drop.rejectReason ?? 'no_target',
            };
        }
        return this.options.inspect.commit(input, {
            selection,
            source,
            pointer,
            drop,
        });
    }

    private enter(event: Parameters<DragPipeline<TPreview>['enter']>[0]): PipelineResult<TPreview> {
        const result = this.pipeline.enter(event);
        this.applyOutputs(result.outputs);
        return result;
    }

    private applyOutputs(outputs: PipelineOutput<TPreview>[]): void {
        for (const output of outputs) {
            switch (output.type) {
                case 'drag_over':
                    if (output.drop.target) {
                        this.options.effects?.showDropPreview?.(output.drop, {
                            selection: output.selection,
                            source: this.activeDragSession?.source ?? 'handle',
                            pointer: {
                                id: this.activeDragSession?.pointer.id ?? -1,
                                type: output.pointerType,
                            },
                        });
                    } else {
                        this.options.effects?.hideDropPreview?.();
                    }
                    break;
                case 'selection_changed':
                    this.options.effects?.showSelection?.(output.selection);
                    break;
                case 'drag_source_changed':
                    this.options.effects?.showDragSource?.(output.selection);
                    break;
                case 'command_ready':
                    this.options.effects?.applyCommand?.(output.command);
                    break;
                case 'cancelled':
                    this.options.effects?.hideDropPreview?.();
                    break;
                case 'lifecycle':
                    this.options.effects?.emitLifecycle?.(output.event);
                    break;
                case 'terminal':
                    if (
                        output.reason === 'drop'
                        || output.reason === 'cancel'
                        || output.reason === 'destroy'
                        || output.reason === 'guard_unavailable'
                    ) {
                        this.options.effects?.finishDragSession?.();
                    }
                    break;
                case 'dropped':
                case 'state_changed':
                    break;
            }
        }
    }

    private resolveSelection(snapshot: DraggerPressSnapshot): BlockSelection | null {
        if (snapshot.zone === 'selected_text' && snapshot.passiveSelection) {
            return snapshot.passiveSelection;
        }
        if (snapshot.selection) return snapshot.selection;
        return snapshot.block ? createSingleBlockSelection(snapshot.block) : null;
    }

    private resolveSource(snapshot: DraggerPressSnapshot): HoldTarget['source'] | null {
        if (snapshot.source) return snapshot.source;
        switch (snapshot.zone) {
            case 'handle':
            case 'selection_grip':
                return 'handle';
            case 'text':
                return 'text';
            case 'selected_text':
                return 'selected_text';
            case 'block_menu':
            case 'none':
                return null;
        }
    }

    private clearPressSession(): void {
        if (!this.pressSession) return;
        this.clearPressTimer(this.pressSession);
        this.pressSession.releaseCapture?.();
        this.pressSession = null;
    }

    private releaseActiveDragCapture(): void {
        this.activeDragSession?.releaseCapture?.();
        this.activeDragSession = null;
    }

    private clearPressTimer(session: PressSession): void {
        if (session.timer === null) return;
        this.clearTimer(session.timer);
        session.timer = null;
    }

    private setTimer(callback: () => void, delayMs: number): DragTimerToken {
        if (this.options.setTimer) return this.options.setTimer(callback, delayMs);
        // eslint-disable-next-line obsidianmd/prefer-window-timers
        return setTimeout(callback, delayMs);
    }

    private clearTimer(token: DragTimerToken): void {
        if (this.options.clearTimer) {
            this.options.clearTimer(token);
            return;
        }
        // eslint-disable-next-line obsidianmd/prefer-window-timers
        clearTimeout(token);
    }

    private rules(): DragRule<TPreview>[] {
        if (!this.options.rules) return [];
        return Array.isArray(this.options.rules) ? this.options.rules : [this.options.rules];
    }

    private config(): DraggerControllerConfig {
        return {
            ...DEFAULT_CONFIG,
            ...this.options.config,
        };
    }

    private createSessionId(): string {
        return `drag-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
}

function samePointer(a: DragPointer, b: DragPointer): boolean {
    return a.id === b.id;
}

function distanceBetween(a: DragPoint, b: DragPoint): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
}
