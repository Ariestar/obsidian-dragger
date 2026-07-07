import { detectBlock } from '../../domain/block/block-detector';
import type { BlockInfo } from '../../domain/block/block-types';
import { createSingleBlockSelection, type BlockSelection } from '../../domain/selection/block-selection';
import type { SelectedBlockRange } from '../../domain/selection/block-ranges';
import {
    buildSelectedBlockRangeFromBlockInfo,
    type RangeSelectionBoundaryResolver,
} from '../../domain/selection/range-selection';
import { createLineParsingContext } from '../../domain/markdown/line-parsing-service';
import { getListContext } from '../../domain/mutation/list-mutation';
import { buildInsertTextForDrop } from '../../domain/mutation/text-mutation-policy';
import { resolveDropRuleAtInsertion } from '../../domain/rules/container-policy-service';
import { planMove, type MoveDeps, type MoveResult } from '../../domain/move/move-plan';
import { moveTx } from '../../domain/transaction/move-blocks';
import { createDragPipeline, type DragPipeline } from '../pipeline/drag-pipeline';
import type { DragDropSnapshot, DropResolution } from '../pipeline/pipeline-drop';
import type { DragCancelReason } from '../pipeline/pipeline-event';
import type { PipelineOutput } from '../pipeline/pipeline-output';
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
    sessionId: string;
    pointer: DragPointer;
    start: DragPoint;
    selection: BlockSelection;
    ready: boolean;
    timer: DragTimerToken | null;
    releaseCapture?: () => void;
};

type ActiveDragSession = {
    sessionId: string;
    pointer: DragPointer;
    selection: BlockSelection;
    targetLineNumber: number | null;
    releaseCapture?: () => void;
};

export class DraggerRuntime {
    private readonly disposables: DraggerDisposable[] = [];
    private readonly pipeline: DragPipeline = createDragPipeline({
        onOutputs: (outputs) => this.handlePipelineOutputs(outputs),
    });
    private pressSession: PressSession | null = null;
    private activeDragSession: ActiveDragSession | null = null;
    private mounted = false;
    private nextSessionNumber = 1;

    constructor(private readonly options: DraggerRuntimeOptions) {}

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
                this.handleCancel(input.pointer, input.releaseCapture);
            }));
        }
        if (this.options.input.onEscape) {
            this.disposables.push(this.options.input.onEscape(() => this.clearSelectionOrCancel()));
        }
    }

    attach(): void {
        this.mount();
    }

    destroy(): void {
        this.clearPressSession();
        this.activeDragSession?.releaseCapture?.();
        this.activeDragSession = null;
        this.pipeline.clear();
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
        this.pipeline.enter({ type: 'guard_unavailable', guardId: _guardId });
    }

    handleMobileDragAvailabilityChanged(mobileDragAvailable: boolean): void {
        if (!mobileDragAvailable) this.clearSelectionOrCancel();
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
        if (isSelectionGesture(input)) {
            this.selectBlock(block, input);
            return;
        }

        input.capture?.();
        this.clearPressSession();
        const sessionId = this.createSessionId();
        const selection = this.resolveDragSelection(block);
        const timer = this.config().longPressMs > 0
            ? this.setTimer(() => this.markPressReady(sessionId, input.pointer), this.config().longPressMs)
            : null;
        this.pressSession = {
            sessionId,
            pointer: input.pointer,
            start: input.point,
            selection,
            ready: this.config().longPressMs <= 0,
            timer,
            releaseCapture: input.releaseCapture,
        };
        this.pipeline.enter({
            type: 'hold_start',
            sessionId,
            target: {
                selection,
                source: isBlockCoveredBySelection(this.currentPassiveSelection(), block) ? 'selected_text' : 'handle',
            },
            pointerType: input.pointer.type,
        });
        if (this.config().longPressMs <= 0) this.markPressReady(sessionId, input.pointer);
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
            sessionId: session.sessionId,
            pointer: input.pointer,
            selection: session.selection,
            targetLineNumber: this.resolveTargetLine(input.point),
            releaseCapture: session.releaseCapture,
        };
        this.clearPressTimer(session);
        this.pressSession = null;
        this.pipeline.enter({
            type: 'drag_start',
            sessionId: session.sessionId,
            drop: this.buildDropSnapshot(session.selection, this.activeDragSession.targetLineNumber),
            pointerType: input.pointer.type,
        });
    }

    private handleDragMove(input: DraggerMoveInput): void {
        const drag = this.activeDragSession;
        if (!drag || !samePointer(drag.pointer, input.pointer)) return;
        input.claim?.();
        drag.targetLineNumber = this.resolveTargetLine(input.point);
        this.pipeline.enter({
            type: 'drag_over',
            sessionId: drag.sessionId,
            drop: this.buildDropSnapshot(drag.selection, drag.targetLineNumber),
            pointerType: input.pointer.type,
        });
    }

    private handleRelease(input: DraggerReleaseInput): void {
        if (this.activeDragSession && samePointer(this.activeDragSession.pointer, input.pointer)) {
            input.claim?.();
            this.drop(input);
            input.releaseCapture?.();
            return;
        }
        if (this.pressSession && samePointer(this.pressSession.pointer, input.pointer)) {
            this.cancel('press_cancelled', input.pointer.type);
        }
    }

    private handleCancel(pointer: DragPointer, releaseCapture?: () => void): void {
        if (this.activeDragSession && samePointer(this.activeDragSession.pointer, pointer)) {
            releaseCapture?.();
            this.cancel('pointer_cancelled', pointer.type);
            return;
        }
        if (this.pressSession && samePointer(this.pressSession.pointer, pointer)) {
            releaseCapture?.();
            this.cancel('pointer_cancelled', pointer.type);
        }
    }

    private drop(input: DraggerReleaseInput): void {
        const drag = this.activeDragSession;
        if (!drag) return;
        drag.targetLineNumber = this.resolveTargetLine(input.point);
        const dropSnapshot = this.buildDropSnapshot(drag.selection, drag.targetLineNumber);
        const planned = this.plan(drag.selection, drag.targetLineNumber);
        if (planned.type === 'ok') {
            const transaction = moveTx(this.options.document.getDoc(), planned.value);
            if ('changes' in transaction) {
                this.pipeline.enter({
                    type: 'drop',
                    sessionId: drag.sessionId,
                    resolution: { type: 'platform_commit', drop: dropSnapshot },
                    pointerType: input.pointer.type,
                });
                this.activeDragSession = null;
                this.options.document.applyChanges(transaction.changes);
                return;
            }
            this.pipeline.enter({
                type: 'drop',
                sessionId: drag.sessionId,
                resolution: this.cancelDrop(dropSnapshot, transaction.reason),
                pointerType: input.pointer.type,
            });
            this.activeDragSession = null;
            return;
        }
        this.pipeline.enter({
            type: 'drop',
            sessionId: drag.sessionId,
            resolution: this.cancelDrop(dropSnapshot, planned.reason),
            pointerType: input.pointer.type,
        });
        this.activeDragSession = null;
    }

    private cancel(reason: DragCancelReason = 'press_cancelled', pointerType: string | null = null): void {
        const sessionId = this.activeDragSession?.sessionId ?? this.pressSession?.sessionId;
        this.clearPressSession();
        this.activeDragSession?.releaseCapture?.();
        this.activeDragSession = null;
        this.pipeline.enter({ type: 'cancel', sessionId, reason, pointerType });
    }

    private clearSelectionOrCancel(): void {
        if (!this.isGestureActive() && this.pipeline.state.type === 'selecting') {
            this.pipeline.enter({ type: 'selection_clear' });
            return;
        }
        this.cancel();
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

    private buildDropSnapshot(selection: BlockSelection, targetLineNumber: number | null): DragDropSnapshot {
        return {
            target: targetLineNumber === null ? null : { targetLineNumber, placement: 'before' },
            rejectReason: targetLineNumber === null
                ? 'no_target'
                : this.dropRejectReason(selection, targetLineNumber),
        };
    }

    private dropRejectReason(selection: BlockSelection, targetLineNumber: number): DragCancelReason | null {
        const planned = this.plan(selection, targetLineNumber);
        if (planned.type === 'ok') return null;
        return isDragCancelReason(planned.reason) ? planned.reason : 'selection_invalid';
    }

    private cancelDrop(drop: DragDropSnapshot, reason: string): DropResolution {
        return {
            type: 'cancel',
            drop,
            reason: isDragCancelReason(reason) ? reason : 'selection_invalid',
        };
    }

    private createSessionId(): string {
        const sessionId = `runtime-${this.nextSessionNumber}`;
        this.nextSessionNumber += 1;
        return sessionId;
    }

    private markPressReady(sessionId: string, pointer: DragPointer): void {
        const session = this.pressSession;
        if (!session || session.sessionId !== sessionId || !samePointer(session.pointer, pointer)) return;
        session.ready = true;
        this.clearPressTimer(session);
        this.pipeline.enter({
            type: 'hold_ready',
            sessionId,
            pointerType: pointer.type,
        });
    }

    private selectBlock(block: BlockInfo, input: DraggerPressInput): void {
        const doc = this.options.document.getDoc();
        const current = this.currentPassiveSelection();
        const selectedBlocks = selectionToSelectedBlocks(current);
        const clickedBoundary = boundaryFromBlock(block);
        const range = {
            type: 'range' as const,
            doc,
            anchorBoundary: input.modifiers?.shiftKey && current
                ? boundaryFromBlock(current.anchorBlock)
                : clickedBoundary,
            initialBoundary: clickedBoundary,
            selectedBlocks,
            operation: input.modifiers?.shiftKey && current ? 'add' as const : undefined,
            resolveBoundary: this.createBoundaryResolver(),
        };

        this.pipeline.enter({
            type: 'selection_start',
            seed: {
                selection: current ?? createSingleBlockSelection(block),
                range,
            },
        });
        this.pipeline.enter({ type: 'selection_finish' });
        if (this.currentPassiveSelection()?.ranges.length === 0) {
            this.pipeline.enter({ type: 'selection_clear' });
        }
    }

    private resolveDragSelection(block: BlockInfo): BlockSelection {
        const current = this.currentPassiveSelection();
        if (isBlockCoveredBySelection(current, block)) {
            return current;
        }
        return createSingleBlockSelection(block);
    }

    private currentPassiveSelection(): BlockSelection | null {
        const state = this.pipeline.state;
        if (state.type !== 'selecting' || state.selection.phase !== 'passive') return null;
        return state.selection.selection;
    }

    private createBoundaryResolver(): RangeSelectionBoundaryResolver {
        return (lineNumber) => {
            const doc = this.options.document.getDoc();
            const block = detectBlock({ doc }, lineNumber, { tabSize: this.config().tabSize });
            return block ? boundaryFromBlock(block) : {
                startLineNumber: lineNumber,
                endLineNumber: lineNumber,
            };
        };
    }

    private handlePipelineOutputs(outputs: PipelineOutput[]): void {
        for (const output of outputs) {
            switch (output.type) {
                case 'selection_changed':
                    this.options.selection?.(output.selection);
                    break;
                case 'drag_over':
                    this.preview({
                        source: output.selection,
                        targetLineNumber: output.drop.target?.targetLineNumber ?? null,
                        allowed: output.drop.rejectReason == null,
                        reason: output.drop.rejectReason ?? null,
                    });
                    break;
                case 'dropped':
                case 'cancelled':
                case 'terminal':
                    this.preview(null);
                    break;
            }
        }
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

function isSelectionGesture(input: DraggerPressInput): boolean {
    return input.modifiers?.shiftKey === true
        || input.modifiers?.ctrlKey === true
        || input.modifiers?.metaKey === true;
}

function selectionToSelectedBlocks(selection: BlockSelection | null): SelectedBlockRange[] {
    if (!selection) return [];
    return selection.ranges.map((range) => ({
        startLineNumber: range.startLine + 1,
        endLineNumber: range.endLine + 1,
    }));
}

function boundaryFromBlock(block: BlockInfo): ReturnType<typeof buildSelectedBlockRangeFromBlockInfo> & {
    representativeLineNumber: number;
} {
    const range = buildSelectedBlockRangeFromBlockInfo(block);
    return {
        ...range,
        representativeLineNumber: range.startLineNumber,
    };
}

function isBlockCoveredBySelection(selection: BlockSelection | null, block: BlockInfo): selection is BlockSelection {
    if (!selection) return false;
    return selection.ranges.some((range) => (
        range.startLine === block.startLine
        && range.endLine === block.endLine
    ));
}

function isDragCancelReason(reason: string): reason is DragCancelReason {
    return reason !== 'empty_selection';
}
