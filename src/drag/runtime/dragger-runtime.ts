import { detectBlock } from '../../domain/block/block-detector';
import { createSingleBlockSelection, type BlockSelection } from '../../domain/selection/block-selection';
import { createLineParsingContext } from '../../domain/markdown/line-parsing-service';
import { getListContext } from '../../domain/mutation/list-mutation';
import { buildInsertTextForDrop } from '../../domain/mutation/text-mutation-policy';
import { resolveDropRuleAtInsertion } from '../../domain/rules/container-policy-service';
import { planMove, type MoveDeps, type MoveResult } from '../../domain/move/move-plan';
import { moveTx } from '../../domain/transaction/move-blocks';
import type { DragCancelReason } from '../pipeline/pipeline-event';
import type { PipelineState } from '../pipeline/pipeline-state';
import {
    type DragPoint,
    type DragPointer,
    type DragTimerToken,
    type DraggerRuntimeConfig,
    type DraggerRuntimeOptions,
    type DraggerDisposable,
    type DraggerMoveInput,
    type DraggerPressInput,
    type DraggerReleaseInput,
} from './dragger-runtime-types';

const DEFAULT_CONFIG: DraggerRuntimeConfig = {
    tabSize: 4,
    longPressMs: 250,
    dragStartMoveThresholdPx: 4,
    dragCancelMoveThresholdPx: 12,
};

type PressSession = {
    pointer: DragPointer;
    start: DragPoint;
    selection: BlockSelection;
    ready: boolean;
    timer: DragTimerToken | null;
    releaseCapture?: () => void;
};

type ActiveDragSession = {
    pointer: DragPointer;
    selection: BlockSelection;
    targetLineNumber: number | null;
    releaseCapture?: () => void;
};

export class DraggerRuntime {
    private readonly disposables: DraggerDisposable[] = [];
    private pressSession: PressSession | null = null;
    private activeDragSession: ActiveDragSession | null = null;
    private mounted = false;
    private idleState: PipelineState = { type: 'idle' };

    constructor(private readonly options: DraggerRuntimeOptions) {}

    get state(): PipelineState {
        if (this.activeDragSession) {
            return {
                type: 'dragging',
                drag: {
                    sessionId: 'runtime-drag',
                    selection: this.activeDragSession.selection,
                    drop: this.buildDropSnapshot(this.activeDragSession.targetLineNumber),
                    guardDeps: [],
                },
            };
        }
        if (this.pressSession?.ready) {
            return {
                type: 'ready_to_drag',
                hold: {
                    sessionId: 'runtime-press',
                    target: { selection: this.pressSession.selection, source: 'handle' },
                    guardDeps: [],
                },
            };
        }
        if (this.pressSession) {
            return {
                type: 'holding',
                hold: {
                    sessionId: 'runtime-press',
                    target: { selection: this.pressSession.selection, source: 'handle' },
                    guardDeps: [],
                },
            };
        }
        return this.idleState;
    }

    mount(): void {
        if (this.mounted) return;
        this.mounted = true;
        this.disposables.push(this.options.input.onPress((input) => this.handlePress(input)));
        this.disposables.push(this.options.input.onMove((input) => this.handleMove(input)));
        this.disposables.push(this.options.input.onRelease((input) => this.handleRelease(input)));
        if (this.options.input.onCancel) {
            this.disposables.push(this.options.input.onCancel((input) => {
                this.handleCancel(input.pointer, input.releaseCapture);
            }));
        }
        if (this.options.input.onEscape) {
            this.disposables.push(this.options.input.onEscape(() => this.cancel()));
        }
    }

    attach(): void {
        this.mount();
    }

    destroy(): void {
        this.clearPressSession();
        this.activeDragSession?.releaseCapture?.();
        this.activeDragSession = null;
        while (this.disposables.length > 0) {
            this.disposables.pop()?.();
        }
        this.mounted = false;
        this.preview(null);
    }

    refreshSelectionVisual(): void {
        // Selection visuals are a platform concern in the minimal runtime API.
    }

    guardUnavailable(_guardId: string): void {
        this.cancel();
    }

    handleMobileDragAvailabilityChanged(mobileDragAvailable: boolean): void {
        if (!mobileDragAvailable) this.cancel();
    }

    isGestureActive(): boolean {
        return this.pressSession !== null || this.activeDragSession !== null;
    }

    private handlePress(input: DraggerPressInput): void {
        if (input.button !== undefined && input.button !== 0) return;

        const doc = this.options.document.getDoc();
        const lineNumber = this.options.locate.sourceLineFromInput(input);
        if (lineNumber === null) return;

        const block = detectBlock({ doc }, lineNumber, { tabSize: this.config().tabSize });
        if (!block) return;

        input.claim?.();
        input.capture?.();
        this.clearPressSession();
        const selection = createSingleBlockSelection(block);
        const timer = this.setTimer(() => {
            if (!this.pressSession || !samePointer(this.pressSession.pointer, input.pointer)) return;
            this.pressSession.ready = true;
            this.clearPressTimer(this.pressSession);
        }, this.config().longPressMs);
        this.pressSession = {
            pointer: input.pointer,
            start: input.point,
            selection,
            ready: this.config().longPressMs <= 0,
            timer: this.config().longPressMs <= 0 ? null : timer,
            releaseCapture: input.releaseCapture,
        };
        if (this.config().longPressMs <= 0) this.clearTimer(timer);
    }

    private handleMove(input: DraggerMoveInput): void {
        if (this.activeDragSession) {
            this.handleDragMove(input);
            return;
        }

        const session = this.pressSession;
        if (!session || !samePointer(session.pointer, input.pointer)) return;

        const distance = distanceBetween(session.start, input.point);
        if (!session.ready) {
            if (distance > this.config().dragCancelMoveThresholdPx) this.cancel();
            return;
        }
        if (distance < this.config().dragStartMoveThresholdPx) return;

        input.claim?.();
        this.activeDragSession = {
            pointer: input.pointer,
            selection: session.selection,
            targetLineNumber: this.resolveTargetLine(input.point),
            releaseCapture: session.releaseCapture,
        };
        this.clearPressTimer(session);
        this.pressSession = null;
        this.renderDragPreview();
    }

    private handleDragMove(input: DraggerMoveInput): void {
        const drag = this.activeDragSession;
        if (!drag || !samePointer(drag.pointer, input.pointer)) return;
        input.claim?.();
        drag.targetLineNumber = this.resolveTargetLine(input.point);
        this.renderDragPreview();
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
            this.cancel();
        }
    }

    private handleCancel(pointer: DragPointer, releaseCapture?: () => void): void {
        if (this.activeDragSession && samePointer(this.activeDragSession.pointer, pointer)) {
            releaseCapture?.();
            this.cancel();
            return;
        }
        if (this.pressSession && samePointer(this.pressSession.pointer, pointer)) {
            releaseCapture?.();
            this.cancel();
        }
    }

    private drop(input: DraggerReleaseInput): void {
        const drag = this.activeDragSession;
        if (!drag) return;
        drag.targetLineNumber = this.resolveTargetLine(input.point);
        const planned = this.plan(drag.selection, drag.targetLineNumber);
        if (planned.type === 'ok') {
            const transaction = moveTx(this.options.document.getDoc(), planned.value);
            if ('changes' in transaction) {
                this.options.document.applyChanges(transaction.changes);
            }
        }
        this.activeDragSession = null;
        this.preview(null);
    }

    private cancel(): void {
        this.clearPressSession();
        this.activeDragSession?.releaseCapture?.();
        this.activeDragSession = null;
        this.preview(null);
    }

    private renderDragPreview(): void {
        const drag = this.activeDragSession;
        if (!drag) return;
        const planned = this.plan(drag.selection, drag.targetLineNumber);
        this.preview({
            source: drag.selection,
            targetLineNumber: drag.targetLineNumber,
            allowed: planned.type === 'ok',
            reason: planned.type === 'reject' && isDragCancelReason(planned.reason) ? planned.reason : null,
        });
    }

    private preview(value: Parameters<NonNullable<DraggerRuntimeOptions['preview']>>[0]): void {
        this.options.preview?.(value);
    }

    private resolveTargetLine(point: DragPoint): number | null {
        const lineNumber = this.options.locate.targetLineFromPoint(point);
        if (lineNumber === null) return null;
        const doc = this.options.document.getDoc();
        return Math.max(1, Math.min(doc.lines, lineNumber));
    }

    private plan(selection: BlockSelection, targetLineNumber: number | null): MoveResult {
        if (targetLineNumber === null) return { type: 'reject', reason: 'no_target' };
        const doc = this.options.document.getDoc();
        const tabSize = this.config().tabSize;
        const lineParsing = createLineParsingContext(tabSize);
        return planMove({
            doc,
            selection,
            target: { targetLineNumber, placement: 'before' },
            deps: this.moveDeps(doc, lineParsing),
        });
    }

    private moveDeps(
        doc: ReturnType<DraggerRuntimeOptions['document']['getDoc']>,
        lineParsing: ReturnType<typeof createLineParsingContext>
    ): MoveDeps {
        return {
            tabSize: this.config().tabSize,
            slotAt: (sourceBlock, lineNumber, options) =>
                resolveDropRuleAtInsertion({ doc }, sourceBlock, lineNumber, options),
            parseLine: lineParsing.parseLine,
            listCtx: (activeDoc, lineNumber) => getListContext(activeDoc, lineNumber, lineParsing.parseLine),
            indentUnit: (sample) => lineParsing.getIndentUnitWidth(sample),
            insertText: (activeDoc, sourceBlock, lineNumber, sourceContent, listIntent) =>
                buildInsertTextForDrop({
                    lineParsing,
                    doc: activeDoc,
                    sourceBlock,
                    targetLineNumber: lineNumber,
                    sourceContent,
                    listIntent,
                }),
        };
    }

    private buildDropSnapshot(targetLineNumber: number | null) {
        return {
            target: targetLineNumber === null ? null : { targetLineNumber, placement: 'before' as const },
            rejectReason: targetLineNumber === null ? 'no_target' as const : null,
        };
    }

    private clearPressSession(): void {
        if (!this.pressSession) return;
        this.clearPressTimer(this.pressSession);
        this.pressSession.releaseCapture?.();
        this.pressSession = null;
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

    private config(): DraggerRuntimeConfig {
        const config = typeof this.options.config === 'function'
            ? this.options.config()
            : this.options.config;
        return {
            ...DEFAULT_CONFIG,
            ...config,
        };
    }
}

function samePointer(a: DragPointer, b: DragPointer): boolean {
    return a.id === b.id;
}

function distanceBetween(a: DragPoint, b: DragPoint): number {
    return Math.hypot(b.x - a.x, b.y - a.y);
}

function isDragCancelReason(reason: string): reason is DragCancelReason {
    return reason !== 'empty_selection';
}
