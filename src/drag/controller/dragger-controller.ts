import { createSingleBlockSelection, type BlockSelection } from '../../domain/selection/block-selection';
import type { DropTarget } from '../../domain/command/drop-target';
import { createDragPipeline, type DragPipeline, type PipelineResult } from '../pipeline/drag-pipeline';
import type { DropResolution } from '../pipeline/pipeline-drop';
import type { DragCancelReason } from '../pipeline/pipeline-event';
import type { PipelineOutput } from '../pipeline/pipeline-output';
import type { HoldTarget, PipelineState } from '../pipeline/pipeline-state';
import {
    type DragPoint,
    type DragPointer,
    type DragTimerToken,
    type DraggerCanDrop,
    type DraggerControllerConfig,
    type DraggerControllerOptions,
    type DraggerDisposable,
    type DraggerDropContext,
    type DraggerDropDecision,
    type DraggerDropTarget,
    type DraggerMoveInput,
    type DraggerPressInput,
    type DraggerReleaseInput,
    type DraggerResolvedDrop,
} from './dragger-controller-types';

const DEFAULT_CONFIG: DraggerControllerConfig = {
    multiLineSelectionEnabled: true,
    mobileLikeInput: false,
    textLongPressDragEnabled: true,
    mobileTextDragGuardEnabled: false,
    longPressMs: 250,
    rangeSelectionLongPressMs: 300,
    dragStartMoveThresholdPx: 4,
    dragCancelMoveThresholdPx: 12,
    mouseRangeSelectLongPressMs: 250,
    touchRangeSelectLongPressMs: 450,
};

type PressSession = {
    sessionId: string;
    pointer: DragPointer;
    start: DragPoint;
    latest: DragPoint;
    selection: BlockSelection;
    source: HoldTarget['source'];
    ready: boolean;
    timer: DragTimerToken | null;
};

type ActiveDragSession = {
    sessionId: string;
    pointer: DragPointer;
    latest: DragPoint;
};

export class DraggerController<TPreview = unknown> {
    private readonly pipeline: DragPipeline<DraggerDropTarget<TPreview>>;
    private readonly disposables: DraggerDisposable[] = [];
    private pressSession: PressSession | null = null;
    private activeDragSession: ActiveDragSession | null = null;
    private mounted = false;

    constructor(
        private readonly options: DraggerControllerOptions<TPreview>
    ) {
        this.pipeline = createDragPipeline<DraggerDropTarget<TPreview>>();
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
                this.handleCancel(input.pointer, input.reason);
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
        this.activeDragSession = null;
        while (this.disposables.length > 0) {
            this.disposables.pop()?.();
        }
        this.mounted = false;
        this.enter({ type: 'destroy' });
        this.options.view?.hideDropPreview?.();
    }

    private handlePress(input: DraggerPressInput): void {
        if (this.options.isBlockedPoint?.(input.point)) return;
        if (this.options.canStartDrag && !this.options.canStartDrag(input.point, input.target)) return;

        const reader = this.options.read;
        const lineNumber = reader.lineAt(input.point);
        if (lineNumber === null) return;
        const block = reader.blockAt(lineNumber);
        if (!block) return;

        this.clearPressSession();
        const selection = createSingleBlockSelection(block);
        const sessionId = this.createSessionId();
        const source = this.resolveHoldSource(input.target);
        const timer = this.setTimer(() => this.markPressReady(sessionId, input.pointer), this.config().longPressMs);
        this.pressSession = {
            sessionId,
            pointer: input.pointer,
            start: input.point,
            latest: input.point,
            selection,
            source,
            ready: false,
            timer,
        };
        this.enter({
            type: 'hold_start',
            sessionId,
            target: { selection, source },
            pointerType: input.pointer.type,
        });
    }

    private handleMove(input: DraggerMoveInput): void {
        if (this.activeDragSession) {
            this.handleDragMove(input);
            return;
        }
        if (!this.pressSession || !samePointer(this.pressSession.pointer, input.pointer)) return;
        this.pressSession.latest = input.point;
        const distance = distanceBetween(this.pressSession.start, input.point);
        const config = this.config();
        if (!this.pressSession.ready) {
            if (distance > config.dragCancelMoveThresholdPx) {
                this.cancel('press_cancelled', input.pointer.type);
            }
            return;
        }
        if (distance < config.dragStartMoveThresholdPx) return;
        this.startDrag(input);
    }

    private handleRelease(input: DraggerReleaseInput): void {
        if (this.activeDragSession && samePointer(this.activeDragSession.pointer, input.pointer)) {
            this.activeDragSession.latest = input.point;
            this.drop(input);
            return;
        }
        if (this.pressSession && samePointer(this.pressSession.pointer, input.pointer)) {
            this.cancel('press_cancelled', input.pointer.type);
        }
    }

    private handleCancel(pointer: DragPointer, reason: DragCancelReason): void {
        if (this.activeDragSession && samePointer(this.activeDragSession.pointer, pointer)) {
            this.cancel(reason, pointer.type);
            return;
        }
        if (this.pressSession && samePointer(this.pressSession.pointer, pointer)) {
            this.cancel(reason, pointer.type);
        }
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
        const resolved = this.resolveDrop(input.point, session.selection, input.pointer);
        const result = this.enter({
            type: 'drag_start',
            sessionId: session.sessionId,
            drop: resolved.snapshot,
            pointerType: input.pointer.type,
        });
        if (result.current.type !== 'dragging') return;
        this.activeDragSession = {
            sessionId: session.sessionId,
            pointer: input.pointer,
            latest: input.point,
        };
        this.clearPressSession();
    }

    private handleDragMove(input: DraggerMoveInput): void {
        const drag = this.activeDragSession;
        if (!drag || this.state.type !== 'dragging' || !samePointer(drag.pointer, input.pointer)) return;
        drag.latest = input.point;
        const resolved = this.resolveDrop(input.point, this.state.drag.selection, input.pointer);
        this.enter({
            type: 'drag_over',
            sessionId: drag.sessionId,
            drop: resolved.snapshot,
            pointerType: input.pointer.type,
        });
    }

    private drop(input: DraggerReleaseInput): void {
        const drag = this.activeDragSession;
        if (!drag || this.state.type !== 'dragging') return;
        const resolved = this.resolveDrop(input.point, this.state.drag.selection, input.pointer);
        this.enter({
            type: 'drop',
            sessionId: drag.sessionId,
            resolution: this.buildDropResolution(this.state.drag.selection, resolved),
            pointerType: input.pointer.type,
        });
        this.activeDragSession = null;
        this.options.view?.hideDropPreview?.();
    }

    private cancel(reason: DragCancelReason, pointerType: string | null): void {
        this.clearPressSession();
        this.activeDragSession = null;
        this.enter({ type: 'cancel', reason, pointerType });
        this.options.view?.hideDropPreview?.();
    }

    private resolveDrop(point: DragPoint, selection: BlockSelection, pointer: DragPointer): DraggerResolvedDrop<TPreview> {
        const lineNumber = this.options.read.lineAt(point);
        if (lineNumber === null) {
            return {
                context: { selection, pointer, lineNumber: 0 },
                target: null,
                snapshot: { target: null, rejectReason: 'no_target' },
            };
        }

        const context = { selection, pointer, lineNumber };
        const rawTarget: DraggerDropTarget<TPreview> = {
            lineNumber,
            placement: 'before',
        };
        const adjusted = this.options.adjustDropTarget?.(selection, rawTarget, context) ?? rawTarget;
        const decision = this.resolveDropDecision(selection, adjusted, context);
        if (!decision.allowed) {
            return {
                context,
                target: adjusted,
                snapshot: {
                    target: null,
                    rejectReason: decision.reason ?? adjusted.rejectReason ?? 'no_target',
                    previewData: adjusted,
                },
            };
        }
        return {
            context,
            target: adjusted,
            snapshot: {
                target: toDropTarget(adjusted),
                rejectReason: null,
                previewData: adjusted,
            },
        };
    }

    private resolveDropDecision(
        selection: BlockSelection,
        target: DraggerDropTarget<TPreview>,
        context: DraggerDropContext
    ): DraggerDropDecision {
        const fallback: DraggerCanDrop<TPreview> = () => ({
            allowed: target.rejectReason === null || target.rejectReason === undefined,
            reason: target.rejectReason ?? undefined,
        });
        return this.options.canDrop?.(selection, target, context, fallback) ?? fallback(selection, target, context);
    }

    private buildDropResolution(
        selection: BlockSelection,
        resolved: DraggerResolvedDrop<TPreview>
    ): DropResolution<DraggerDropTarget<TPreview>> {
        if (!resolved.target || !resolved.snapshot.target) {
            return {
                type: 'cancel',
                drop: resolved.snapshot,
                reason: resolved.snapshot.rejectReason,
            };
        }
        return {
            type: 'command',
            drop: resolved.snapshot,
            command: {
                type: 'move',
                selection,
                target: resolved.snapshot.target,
            },
        };
    }

    private enter(
        event: Parameters<DragPipeline<DraggerDropTarget<TPreview>>['enter']>[0]
    ): PipelineResult<DraggerDropTarget<TPreview>> {
        const result = this.pipeline.enter(event);
        this.applyOutputs(result.outputs);
        return result;
    }

    private applyOutputs(outputs: PipelineOutput<DraggerDropTarget<TPreview>>[]): void {
        for (const output of outputs) {
            switch (output.type) {
                case 'drag_over': {
                    const fallbackTarget = output.drop.target
                        ? fromDropTarget<TPreview>(output.drop.target)
                        : null;
                    const viewTarget = output.drop.previewData ?? fallbackTarget;
                    if (viewTarget) {
                        this.options.view?.showDropPreview?.(viewTarget, {
                            selection: output.selection,
                            pointer: { id: -1, type: output.pointerType },
                            lineNumber: viewTarget.lineNumber,
                        });
                    } else {
                        this.options.view?.hideDropPreview?.();
                    }
                    break;
                }
                case 'selection_changed':
                    this.options.view?.showSelection?.(output.selection);
                    break;
                case 'drag_source_changed':
                    this.options.view?.showDragSource?.(output.selection);
                    break;
                case 'command_ready':
                    if (output.command.type === 'move') {
                        this.options.move(output.command.selection, fromDropTarget<TPreview>(output.command.target));
                    }
                    break;
                case 'cancelled':
                    this.options.view?.onCancel?.(output.reason);
                    this.options.view?.hideDropPreview?.();
                    break;
                case 'lifecycle':
                    this.options.view?.emitLifecycle?.(output.event);
                    break;
                case 'dropped':
                case 'state_changed':
                case 'terminal':
                    break;
            }
        }
    }

    private clearPressSession(): void {
        if (!this.pressSession) return;
        this.clearPressTimer(this.pressSession);
        this.pressSession = null;
    }

    private clearPressTimer(session: PressSession): void {
        if (session.timer === null) return;
        this.clearTimer(session.timer);
        session.timer = null;
    }

    private setTimer(callback: () => void, delayMs: number): DragTimerToken {
        if (this.options.setTimer) return this.options.setTimer(callback, delayMs);
        // Headless drag cannot depend on Obsidian's active window; platforms can override this timer.
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

    private config(): DraggerControllerConfig {
        return {
            ...DEFAULT_CONFIG,
            ...this.options.config,
        };
    }

    private resolveHoldSource(_target: unknown): HoldTarget['source'] {
        return 'handle';
    }

    private createSessionId(): string {
        return `drag-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
}

function toDropTarget<TPreview>(target: DraggerDropTarget<TPreview>): DropTarget {
    return {
        targetLineNumber: target.lineNumber,
        placement: target.placement,
    };
}

function fromDropTarget<TPreview>(target: DropTarget): DraggerDropTarget<TPreview> {
    return {
        lineNumber: target.targetLineNumber,
        placement: target.placement,
    };
}

function samePointer(a: DragPointer, b: DragPointer): boolean {
    return a.id === b.id;
}

function distanceBetween(a: DragPoint, b: DragPoint): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
}
