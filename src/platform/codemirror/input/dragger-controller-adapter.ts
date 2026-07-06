import type { EditorView } from '@codemirror/view';
import { BlockType, type BlockInfo } from '../../../domain/block/block-types';
import type { BlockCommand } from '../../../domain/command/block-command';
import type { BlockSelection } from '../../../domain/selection/block-selection';
import {
    groupSelectedBlocksIntoSegments,
    type SelectedBlockRange,
} from '../../../domain/selection/block-ranges';
import { buildRangeSelectionBoundaryFromBlock, type RangeSelectionBoundary } from '../../../domain/selection/range-selection';
import {
    DraggerController,
    type DraggerControllerConfig,
    type DraggerInputSource,
    type DraggerPressInput,
    type DraggerRangeStart,
} from '../../../drag/controller';
import type { DragDropSnapshot } from '../../../drag/pipeline/pipeline-drop';
import type { DragLifecycleEvent } from '../../../drag/pipeline/pipeline-output';
import type { PipelineState } from '../../../drag/pipeline/pipeline-state';
import {
    DRAG_HANDLE_CLASS,
    EMBED_HANDLE_CLASS,
    MOBILE_SELECTION_RESIZE_HANDLE_CLASS,
    RANGE_SELECTED_HANDLE_CLASS,
} from '../../../shared/dom-selectors';
import { renderRangeSelectionPreview, RangeSelectionVisualManager } from '../preview/range-selection-visual-manager';
import type { BlockSelectionRequest } from '../selection/block-selection-resolver';
import { createRangeSelectionBoundaryResolver, resolveRangeSelectionBoundaryAtVerticalPosition } from '../selection/block-boundary-resolver';
import type { PointerDropCommitResolution } from './pointer-hit-test';
import { readPointerInput } from './pointer-hit-test';
import {
    MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX,
    MOBILE_DRAG_LONG_PRESS_MS,
    MOBILE_DRAG_START_MOVE_THRESHOLD_PX,
    MOUSE_RANGE_SELECT_LONG_PRESS_MS,
} from './touch-delay-policy';

const GUARD_MOBILE_TEXT_DRAG = 'mobile-text-drag-mode';

export interface DraggerControllerAdapterDeps {
    resolveBlockSelection: (request: BlockSelectionRequest) => BlockSelection | null;
    getVisibleHandleForBlockStart?: (blockStart: number) => HTMLElement | null;
    isBlockInsideRenderedTableCell: (blockInfo: BlockInfo) => boolean;
    isMultiLineSelectionEnabled?: () => boolean;
    isMobileInput?: () => boolean;
    isMobileDragModeEnabled?: () => boolean;
    isMobileTextLongPressDragEnabled?: () => boolean;
    getMobileDragLongPressMs?: () => number;
    getMouseRangeSelectLongPressMs?: () => number;
    resolveDropSnapshotAtPoint: (clientX: number, clientY: number, source: BlockSelection, pointerType: string | null) => DragDropSnapshot;
    buildBlockCommandAtPoint: (source: BlockSelection, clientX: number, clientY: number, pointerType: string | null) => PointerDropCommitResolution;
    output: DraggerControllerOutput;
    openBlockTypeMenu?: (blockInfo: BlockInfo, event: MouseEvent | PointerEvent | null) => void;
}

export interface DraggerControllerOutput<TPreview = unknown> {
    showDropPreview(selection: BlockSelection, drop: DragDropSnapshot<TPreview>, pointerType: string | null): void;
    hideDropPreview(): void;
    applyCommand(command: BlockCommand): void;
    emitLifecycle(event: DragLifecycleEvent): void;
    beginDragSession(source: BlockSelection): void;
    finishDragSession(): void;
}

export class DraggerControllerAdapter {
    private readonly controller: DraggerController;
    private readonly rangeVisual: RangeSelectionVisualManager;
    private readonly onEnterSelectionMode = (event: Event) => this.handleEnterSelectionMode(event);

    constructor(
        readonly view: EditorView,
        readonly deps: DraggerControllerAdapterDeps
    ) {
        this.rangeVisual = new RangeSelectionVisualManager(
            this.view,
            () => this.refreshSelectionVisual(),
            (blockStart) => this.deps.getVisibleHandleForBlockStart?.(blockStart) ?? null
        );
        this.controller = new DraggerController({
            input: createPointerInputSource(this.view),
            inspect: {
                press: (input) => this.inspectPress(input),
                drop: (input, context) => this.deps.resolveDropSnapshotAtPoint(
                    input.point.x,
                    input.point.y,
                    context.selection,
                    input.pointer.type
                ),
                commit: (input, context) => this.deps.buildBlockCommandAtPoint(
                    context.selection,
                    input.point.x,
                    input.point.y,
                    input.pointer.type
                ),
                document: () => ({ lineCount: this.view.state.doc.lines }),
                range: (input) => resolveRangeSelectionBoundaryAtVerticalPosition(this.view, input.point.y),
            },
            effects: {
                showDropPreview: (drop, context) =>
                    this.deps.output.showDropPreview(context.selection, drop, context.pointer.type),
                hideDropPreview: () => this.deps.output.hideDropPreview(),
                showSelection: () => this.refreshSelectionVisual(),
                showDragSource: (selection) => {
                    if (selection) {
                        this.rangeVisual.renderDragSourceSelection(selection);
                    } else {
                        this.rangeVisual.clear();
                    }
                },
                applyCommand: (command) => this.deps.output.applyCommand(command),
                emitLifecycle: (event) => {
                    if (event.type === 'drag_started' && event.source) {
                        this.deps.output.beginDragSession(event.source);
                    }
                    this.deps.output.emitLifecycle(event);
                },
                finishDragSession: () => this.deps.output.finishDragSession(),
                openBlockMenu: (selection, input) => {
                    this.deps.openBlockTypeMenu?.(
                        selection.anchorBlock,
                        this.isMobileInput() ? null : nativePointerEvent(input.native)
                    );
                },
            },
            config: () => this.controllerConfig(),
        });
    }

    attach(): void {
        this.controller.mount();
        this.view.dom.addEventListener('dnd:enter-mobile-selection-mode', this.onEnterSelectionMode);
    }

    destroy(): void {
        this.view.dom.removeEventListener('dnd:enter-mobile-selection-mode', this.onEnterSelectionMode);
        this.controller.destroy();
        this.rangeVisual.destroy();
    }

    get pipelineState(): PipelineState {
        return this.controller.state;
    }

    isGestureActive(): boolean {
        return this.controller.state.type !== 'idle';
    }

    refreshSelectionVisual(): void {
        renderRangeSelectionPreview(this.controller.state, this.rangeVisual);
    }

    handleMobileDragAvailabilityChanged(mobileDragAvailable: boolean): void {
        if (mobileDragAvailable) return;
        this.controller.guardUnavailable(GUARD_MOBILE_TEXT_DRAG);
    }

    private inspectPress(input: DraggerPressInput) {
        const event = nativePointerEvent(input.native);
        const target = event?.target instanceof HTMLElement ? event.target : null;
        if (!target) return noPressTarget();

        const resize = this.inspectResizeHandlePress(target);
        if (resize) return resize;

        const selectedHandle = target.closest<HTMLElement>(`.${RANGE_SELECTED_HANDLE_CLASS}`);
        if (selectedHandle) {
            return {
                target: {
                    kind: 'selected' as const,
                    activation: this.isMobileInput() ? undefined : { type: 'immediate' as const },
                },
            };
        }

        const handle = target.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
        if (handle && !handle.classList.contains(EMBED_HANDLE_CLASS)) {
            return this.inspectHandlePress(input, handle);
        }
        return this.inspectTextPress(input);
    }

    private handleEnterSelectionMode(event: Event): void {
        if (!this.isMobileInput()) return;
        if (!this.isMultiLineSelectionEnabled()) return;
        if (this.controller.state.type !== 'idle') return;
        if (this.deps.isMobileDragModeEnabled?.() !== true) return;

        const selection = this.resolveCursorSelection();
        if (!selection) return;
        if (this.deps.isBlockInsideRenderedTableCell(selection.anchorBlock)) return;

        if (event instanceof CustomEvent && event.detail && typeof event.detail === 'object') {
            (event.detail as { handled?: boolean }).handled = true;
        }
        this.controller.selectRange(this.rangeStartForSelection(selection, {
            guardDeps: [GUARD_MOBILE_TEXT_DRAG],
            rangeOperation: 'add',
        }));
    }

    private inspectHandlePress(input: DraggerPressInput, handle: HTMLElement) {
        if (this.isMobileInput() && this.deps.isMobileDragModeEnabled?.() !== true) {
            return noPressTarget();
        }
        const selection = this.deps.resolveBlockSelection({ kind: 'handle', handle });
        if (!selection) return noPressTarget();
        if (this.deps.isBlockInsideRenderedTableCell(selection.anchorBlock)) {
            return noPressTarget(selection.anchorBlock);
        }
        if (this.shouldStartHandleRangeSelection(input)) {
            const boundary = {
                startLineNumber: selection.anchorBlock.startLine + 1,
                endLineNumber: selection.anchorBlock.endLine + 1,
                representativeLineNumber: selection.anchorBlock.endLine + 1,
            };
            return {
                target: {
                    kind: 'range_grip' as const,
                    block: selection.anchorBlock,
                    ...this.rangeStartForSelection(selection, {
                        rangeBoundary: boundary,
                        guardDeps: this.isMobileInput() ? [GUARD_MOBILE_TEXT_DRAG] : undefined,
                        rangeOperation: this.isMobileInput() ? 'add' : undefined,
                    }),
                },
            };
        }
        return {
            target: {
                kind: 'handle' as const,
                block: selection.anchorBlock,
                selection,
                activation: this.isMobileInput()
                    ? { type: 'hold' as const, delayMs: this.deps.getMobileDragLongPressMs?.() ?? MOBILE_DRAG_LONG_PRESS_MS }
                    : { type: 'immediate' as const },
            },
        };
    }

    private inspectTextPress(input: DraggerPressInput) {
        if (!this.isMobileInput()) return noPressTarget();
        if (this.deps.isMobileDragModeEnabled?.() !== true) return noPressTarget();
        if (this.deps.isMobileTextLongPressDragEnabled?.() === false) return noPressTarget();

        const selection = this.deps.resolveBlockSelection({
            kind: 'point',
            clientX: input.point.x,
            clientY: input.point.y,
        });
        if (!selection) return noPressTarget();
        if (this.deps.isBlockInsideRenderedTableCell(selection.anchorBlock)) {
            return noPressTarget(selection.anchorBlock);
        }
        return {
            target: {
                kind: 'text' as const,
                block: selection.anchorBlock,
                selection,
            },
        };
    }

    private isMobileInput(): boolean {
        return this.deps.isMobileInput?.() === true;
    }

    private isMultiLineSelectionEnabled(): boolean {
        return this.deps.isMultiLineSelectionEnabled?.() !== false;
    }

    private controllerConfig(): Partial<DraggerControllerConfig> {
        return {
            longPressMs: this.isMobileInput()
                ? (this.deps.getMobileDragLongPressMs?.() ?? MOBILE_DRAG_LONG_PRESS_MS)
                : (this.deps.getMouseRangeSelectLongPressMs?.() ?? MOUSE_RANGE_SELECT_LONG_PRESS_MS),
            dragStartMoveThresholdPx: this.isMobileInput() ? MOBILE_DRAG_START_MOVE_THRESHOLD_PX : 4,
            dragCancelMoveThresholdPx: this.isMobileInput() ? MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX : Number.POSITIVE_INFINITY,
            textLongPressDragEnabled: this.deps.isMobileTextLongPressDragEnabled?.() !== false,
            multiLineSelectionEnabled: this.isMultiLineSelectionEnabled(),
        };
    }

    private shouldStartHandleRangeSelection(input: DraggerPressInput): boolean {
        if (!this.isMultiLineSelectionEnabled()) return false;
        if (this.isMobileInput()) return true;
        return input.modifiers?.shiftKey === true;
    }

    private inspectResizeHandlePress(target: HTMLElement) {
        if (!this.isMobileInput()) return null;
        const passiveSelection = this.passiveSelection();
        if (!passiveSelection) return null;
        const handleEl = target.closest<HTMLElement>(`.${MOBILE_SELECTION_RESIZE_HANDLE_CLASS}`);
        if (!handleEl) return null;

        const rawHandle = handleEl.getAttribute('data-dnd-mobile-selection-handle');
        if (rawHandle !== 'top' && rawHandle !== 'bottom') return null;

        const targetSegment = readSelectedBlockRange(handleEl);
        if (!targetSegment) return null;
        const selectedBlocks = selectedBlocksFromSelection(passiveSelection);
        const selectedSegment = groupSelectedBlocksIntoSegments(this.view.state.doc.lines, selectedBlocks)
            .find((segment) => (
                segment.startLineNumber === targetSegment.startLineNumber
                && segment.endLineNumber === targetSegment.endLineNumber
            ));
        if (!selectedSegment) return null;

        const baseSelectedBlocks = selectedBlocks.filter((block) => (
            block.endLineNumber < selectedSegment.startLineNumber
            || block.startLineNumber > selectedSegment.endLineNumber
        ));
        const fixedBoundary = boundaryFromSelectedBlockRange(
            rawHandle === 'top'
                ? {
                    startLineNumber: selectedSegment.endLineNumber,
                    endLineNumber: selectedSegment.endLineNumber,
                }
                : {
                    startLineNumber: selectedSegment.startLineNumber,
                    endLineNumber: selectedSegment.startLineNumber,
                }
        );
        const movingBoundary = boundaryFromSelectedBlockRange(
            rawHandle === 'top'
                ? {
                    startLineNumber: selectedSegment.startLineNumber,
                    endLineNumber: selectedSegment.startLineNumber,
                }
                : {
                    startLineNumber: selectedSegment.endLineNumber,
                    endLineNumber: selectedSegment.endLineNumber,
                }
        );

        return {
            target: {
                kind: 'range_grip' as const,
                block: passiveSelection.anchorBlock,
                ...this.rangeStartForSelection(passiveSelection, {
                    rangeBoundary: fixedBoundary,
                    initialRangeBoundary: movingBoundary,
                    selectedBlocks: baseSelectedBlocks,
                    rangeOperation: 'add',
                    guardDeps: [GUARD_MOBILE_TEXT_DRAG],
                }),
            },
        };
    }

    private passiveSelection(): BlockSelection | null {
        const state = this.controller.state;
        return state.type === 'selecting' && state.selection.phase === 'passive'
            ? state.selection.selection
            : null;
    }

    private resolveCursorSelection(): BlockSelection | null {
        const line = this.view.state.doc.lineAt(this.view.state.selection.main.head);
        const boundary = createRangeSelectionBoundaryResolver(this.view.state)(line.number);
        const startLine = this.view.state.doc.line(boundary.startLineNumber);
        const endLine = this.view.state.doc.line(boundary.endLineNumber);
        return this.deps.resolveBlockSelection({
            kind: 'block',
            block: {
                type: BlockType.Paragraph,
                startLine: boundary.startLineNumber - 1,
                endLine: boundary.endLineNumber - 1,
                from: startLine.from,
                to: endLine.to,
                indentLevel: 0,
                content: this.view.state.doc.sliceString(startLine.from, endLine.to),
            },
        });
    }

    private rangeStartForSelection(
        selection: BlockSelection,
        overrides: Partial<{
            rangeBoundary: RangeSelectionBoundary;
            initialRangeBoundary: RangeSelectionBoundary;
            selectedBlocks: SelectedBlockRange[];
            rangeOperation: 'add' | 'remove';
            guardDeps: string[];
        }> = {}
    ): DraggerRangeStart {
        return {
            selection,
            rangeBoundary: overrides.rangeBoundary ?? buildRangeSelectionBoundaryFromBlock(this.view.state.doc, selection.anchorBlock),
            initialRangeBoundary: overrides.initialRangeBoundary,
            rangeDoc: this.view.state.doc,
            rangeOperation: overrides.rangeOperation,
            rangeBoundaryResolver: createRangeSelectionBoundaryResolver(this.view.state),
            selectedBlocks: overrides.selectedBlocks ?? [],
            guardDeps: overrides.guardDeps,
        };
    }
}

function noPressTarget(block: BlockInfo | null = null) {
    return {
        target: {
            kind: 'none' as const,
            block,
        },
    };
}

function createPointerInputSource(view: EditorView): DraggerInputSource {
    return {
        onPress: (handler) => {
            const listener = (event: PointerEvent) => {
                const input = readPointerInput('down', event);
                handler({
                    point: { x: input.clientX, y: input.clientY },
                    pointer: { id: input.pointerId, type: input.pointerType },
                    button: input.button,
                    modifiers: { shiftKey: input.shiftKey },
                    native: event,
                    claim: () => claimPointerEvent(event),
                    capture: () => capturePointer(view.dom, event.pointerId),
                    releaseCapture: () => releasePointerCapture(view.dom, event.pointerId),
                });
            };
            view.dom.addEventListener('pointerdown', listener, true);
            return () => view.dom.removeEventListener('pointerdown', listener, true);
        },
        onMove: (handler) => {
            const listener = (event: PointerEvent) => {
                const input = readPointerInput('move', event);
                handler({
                    point: { x: input.clientX, y: input.clientY },
                    pointer: { id: input.pointerId, type: input.pointerType },
                    native: event,
                    claim: () => claimPointerEvent(event),
                });
            };
            window.addEventListener('pointermove', listener, { passive: false, capture: true });
            return () => window.removeEventListener('pointermove', listener, true);
        },
        onRelease: (handler) => {
            const listener = (event: PointerEvent) => {
                const input = readPointerInput('up', event);
                handler({
                    point: { x: input.clientX, y: input.clientY },
                    pointer: { id: input.pointerId, type: input.pointerType },
                    native: event,
                    claim: () => claimPointerEvent(event),
                    releaseCapture: () => releasePointerCapture(view.dom, event.pointerId),
                });
            };
            window.addEventListener('pointerup', listener, { passive: false, capture: true });
            return () => window.removeEventListener('pointerup', listener, true);
        },
        onCancel: (handler) => {
            const listener = (event: PointerEvent) => {
                const input = readPointerInput('cancel', event);
                handler({
                    pointer: { id: input.pointerId, type: input.pointerType },
                    reason: 'pointer_cancelled',
                    native: event,
                    releaseCapture: () => releasePointerCapture(view.dom, event.pointerId),
                });
            };
            window.addEventListener('pointercancel', listener, { passive: false, capture: true });
            return () => window.removeEventListener('pointercancel', listener, true);
        },
        onEscape: (handler) => {
            const listener = (event: KeyboardEvent) => {
                if (event.key !== 'Escape') return;
                handler();
                event.preventDefault();
                event.stopPropagation();
            };
            window.addEventListener('keydown', listener, true);
            return () => window.removeEventListener('keydown', listener, true);
        },
    };
}

function claimPointerEvent(event: PointerEvent): void {
    event.preventDefault();
    event.stopPropagation();
}

function capturePointer(target: HTMLElement, pointerId: number): void {
    if (typeof target.setPointerCapture !== 'function') return;
    try {
        target.setPointerCapture(pointerId);
    } catch {
        // ignore unsupported capture targets
    }
}

function releasePointerCapture(target: HTMLElement, pointerId: number): void {
    if (typeof target.releasePointerCapture !== 'function') return;
    try {
        target.releasePointerCapture(pointerId);
    } catch {
        // ignore unsupported capture targets
    }
}

function nativePointerEvent(value: unknown): PointerEvent | null {
    if (!value || typeof value !== 'object') return null;
    return 'pointerId' in value && 'clientX' in value && 'clientY' in value
        ? value as PointerEvent
        : null;
}

function selectedBlocksFromSelection(selection: BlockSelection): SelectedBlockRange[] {
    return selection.ranges.map((range) => ({
        startLineNumber: range.startLine + 1,
        endLineNumber: range.endLine + 1,
    }));
}

function readSelectedBlockRange(handleEl: HTMLElement): SelectedBlockRange | null {
    const startLineNumber = Number(handleEl.getAttribute('data-dnd-mobile-selection-start-line'));
    const endLineNumber = Number(handleEl.getAttribute('data-dnd-mobile-selection-end-line'));
    if (!Number.isInteger(startLineNumber) || !Number.isInteger(endLineNumber)) return null;
    if (startLineNumber < 1 || endLineNumber < startLineNumber) return null;
    return { startLineNumber, endLineNumber };
}

function boundaryFromSelectedBlockRange(block: SelectedBlockRange): RangeSelectionBoundary {
    return {
        startLineNumber: block.startLineNumber,
        endLineNumber: block.endLineNumber,
        representativeLineNumber: block.endLineNumber,
    };
}
