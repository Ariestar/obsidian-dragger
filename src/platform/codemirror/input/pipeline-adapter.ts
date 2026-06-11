import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../../domain/block/block-types';
import type { BlockCommand } from '../../../domain/command/block-command';
import type { BlockSelection, RangeSelectionOperation } from '../../../domain/selection/block-selection';
import type { SelectedBlockRange } from '../../../domain/selection/block-ranges';
import type { RangeSelectionBoundary, RangeSelectionBoundaryResolver } from '../../../domain/selection/range-selection';
import { buildRangeSelectionBoundaryFromBlock } from '../../../domain/selection/range-selection';
import type { DragDropSnapshot } from '../../../drag/pipeline/pipeline-drop';
import type { DragCancelReason, GuardId } from '../../../drag/pipeline/pipeline-event';
import { createDragPipeline, type DragPipeline } from '../../../drag/pipeline/drag-pipeline';
import { type HoldTarget, type PipelineState } from '../../../drag/pipeline/pipeline-state';
import type { DragLifecycleEvent, PipelineOutput } from '../../../drag/pipeline/pipeline-output';
import type { PointerDropCommitResolution } from './pointer-hit-test';
import {
    createInitialRangeSelectionState,
    type MouseRangeSelectState,
    resolveRangeSelectConfig,
} from './range-selection-gesture-state';
import {
    isRangeSelectionGripHit as isRangeSelectionGripHitByGrip,
    type RangeSelectionView,
} from '../selection/selection-grip-hit';
import {
    decideEnterMobileSelectionMode,
    decidePointerDown,
    type MobileSelectionModeDecision,
    type PointerDownDecision,
    type PointerSelectionContext,
    type RangeSelectionSessionOptions,
} from './pointer-selection';
import { renderRangeSelectionPreview, RangeSelectionVisualManager } from '../preview/range-selection-visual-manager';
import { InputGuardController } from './input-guards';
import {
    PointerSession,
    type ActivePointerDrag,
    type PointerPressSession,
    type RangeSelectionPointerSession,
} from './pointer-session';
import { readFocusInput, readKeyboardInput, readPointerInput, readVisibilityInput } from './pointer-hit-test';
import {
    isMobileEnvironment as isMobileEnvironmentByInput,
} from './pointer-hit-test';
import { createRangeSelectionBoundaryResolver } from '../selection/block-boundary-resolver';
import { type BlockSelectionRequest } from '../selection/block-selection-resolver';
import {
    INPUT_GUARD_MOBILE_DRAG_GESTURE,
    INPUT_GUARD_MOBILE_SELECTION_GESTURE,
    INPUT_GUARD_MOBILE_SELECTION_PASSIVE,
} from './input-guards';
import { RANGE_SELECTED_HANDLE_CLASS } from '../../../shared/dom-selectors';
import { handlePointerCancel, handlePointerMove, handlePointerUp } from './pointer-drag';
import {
    clampTouchRangeSelectLongPressMs,
    MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX,
    MOBILE_DRAG_LONG_PRESS_MS,
    MOUSE_RANGE_SELECT_LONG_PRESS_MS,
} from './touch-delay-policy';

const GUARD_MOBILE_TEXT_DRAG = 'mobile-text-drag-mode';

export interface PipelineAdapterDeps {
    resolveBlockSelection: (request: BlockSelectionRequest) => BlockSelection | null;
    getVisibleHandleForBlockStart?: (blockStart: number) => HTMLElement | null;
    isBlockInsideRenderedTableCell: (blockInfo: BlockInfo) => boolean;
    isMultiLineSelectionEnabled?: () => boolean;
    getMultiLineSelectionLongPressMs?: () => number;
    getMobileDragLongPressMs?: () => number;
    getMouseRangeSelectLongPressMs?: () => number;
    getAutoScrollEdgeZonePx?: () => number;
    getAutoScrollMaxSpeedPx?: () => number;
    isMobileDragModeEnabled?: () => boolean;
    isMobileTextLongPressDragEnabled?: () => boolean;
    beginPointerDragSession: (source: BlockSelection) => void;
    finishDragSession: () => void;
    resolveDropSnapshotAtPoint: (clientX: number, clientY: number, source: BlockSelection, pointerType: string | null) => DragDropSnapshot;
    buildBlockCommandAtPoint: (source: BlockSelection, clientX: number, clientY: number, pointerType: string | null) => PointerDropCommitResolution;
    pipelineOutputExecutor: PipelineOutputExecutor;
    openBlockTypeMenu?: (blockInfo: BlockInfo, event: MouseEvent | PointerEvent | null) => void;
}

export interface PipelineOutputExecutor<TPreview = unknown> {
    showDropPreview(selection: BlockSelection, drop: DragDropSnapshot<TPreview>, pointerType: string | null): void;
    hideDropPreview(): void;
    applyCommand(command: BlockCommand): void;
    emitLifecycle(event: DragLifecycleEvent): void;
}

export type InteractionCleanupOptions = {
    shouldFinishDragSession?: boolean;
    shouldHideDropPreview?: boolean;
    cancelReason?: DragCancelReason | null;
    pointerType?: string | null;
};

export class PipelineAdapter {
    private readonly pipeline: DragPipeline;
    pressSession: PointerPressSession | null = null;
    activeDragSession: ActivePointerDrag | null = null;
    rangePointerSession: RangeSelectionPointerSession | null = null;
    readonly rangeVisual: RangeSelectionVisualManager;
    readonly mobile: InputGuardController;
    readonly pointer: PointerSession;
    private activeDragPointer: { clientX: number; clientY: number; pointerType: string | null } | null = null;

    private readonly onEditorPointerDown = (e: PointerEvent) => {
        const input = readPointerInput('down', e);
        const target = input.target;
        if (!target) return;

        if (!this.isMultiLineSelectionEnabled()) {
            this.clearRangeSelection();
        }

        this.executePointerDownDecision(
            decidePointerDown(this.buildPointerSelectionContext(), e, target),
            e
        );
    };
    private readonly onLostPointerCapture = (e: PointerEvent) => this.handleLostPointerCapture(e);
    private readonly onWindowKeyDown = (e: KeyboardEvent) => this.handleWindowKeyDown(e);
    private readonly onEnterMobileSelectionMode = (e: Event) => this.handleEnterMobileSelectionMode(e);

    constructor(
        readonly view: EditorView,
        readonly deps: PipelineAdapterDeps
    ) {
        this.pipeline = createDragPipeline({
            onOutputs: (outputs) => this.applyPipelineOutputs(outputs),
        });
        this.rangeVisual = new RangeSelectionVisualManager(
            this.view,
            () => this.refreshRangeSelectionVisual(),
            (blockStart) => this.deps.getVisibleHandleForBlockStart?.(blockStart) ?? null
        );
        this.mobile = new InputGuardController(this.view, (e) => this.handleDocumentFocusIn(e));
        this.pointer = new PointerSession(this.view, {
            onPointerMove: (e) => this.handlePointerMove(e),
            onPointerUp: (e) => this.handlePointerUp(e),
            onPointerCancel: (e) => this.handlePointerCancel(e),
            onWindowBlur: () => this.handleWindowBlur(),
            onDocumentVisibilityChange: () => this.handleDocumentVisibilityChange(),
            onTouchMove: (e) => this.handleTouchMove(e),
        });
    }

    attach(): void {
        const editorDom = this.view.dom;
        editorDom.addEventListener('pointerdown', this.onEditorPointerDown, true);
        editorDom.addEventListener('lostpointercapture', this.onLostPointerCapture, true);
        window.addEventListener('keydown', this.onWindowKeyDown, true);
        editorDom.addEventListener('dnd:enter-mobile-selection-mode', this.onEnterMobileSelectionMode);
    }

    destroy(): void {
        this.resetInteractionSession({ shouldFinishDragSession: true, shouldHideDropPreview: true });
        this.pipeline.enter({ type: 'destroy' });
        this.rangeVisual.destroy();

        const editorDom = this.view.dom;
        editorDom.removeEventListener('pointerdown', this.onEditorPointerDown, true);
        editorDom.removeEventListener('lostpointercapture', this.onLostPointerCapture, true);
        window.removeEventListener('keydown', this.onWindowKeyDown, true);
        editorDom.removeEventListener('dnd:enter-mobile-selection-mode', this.onEnterMobileSelectionMode);
    }

    get pipelineState(): PipelineState {
        return this.pipeline.state;
    }

    isGestureActive(): boolean {
        return this.hasActivePointerSession();
    }

    refreshSelectionVisual(): void {
        if (!this.isMultiLineSelectionEnabled()) {
            this.clearRangeSelection();
            return;
        }
        this.rangeVisual.scheduleRefresh();
    }

    private isMobileEnvironment(): boolean {
        return isMobileEnvironmentByInput();
    }

    private buildPointerSelectionContext(): PointerSelectionContext {
        return {
            view: this.view,
            pipelineState: this.pipelineState,
            hasActiveRangePointerSession: this.rangePointerSession !== null,
            passiveSelectionSource: this.getPassiveSelectionSource(),
            isMobileEnvironment: this.mobile.isMobileEnvironment(),
            isMultiLineSelectionEnabled: this.isMultiLineSelectionEnabled(),
            isMobileTextLongPressDragEnabled: this.deps.isMobileTextLongPressDragEnabled?.() !== false,
            mobileDragLongPressMs: this.deps.getMobileDragLongPressMs?.() ?? MOBILE_DRAG_LONG_PRESS_MS,
            isBlockInsideRenderedTableCell: (blockInfo) => this.deps.isBlockInsideRenderedTableCell(blockInfo),
            resolveBlockSelection: (request) => this.resolveBlockSelection(request),
            canStartDragForPointer: (pointerType, source) => this.canStartDragForPointer(pointerType, source),
            isMobileDragModeActiveForPointer: (pointerType) => this.isMobileDragModeActiveForPointer(pointerType),
            isWithinMobileTextLineOrEmbedArea: (target, clientX, clientY) =>
                this.mobile.isWithinMobileTextLineOrEmbedArea(target, clientX, clientY),
            isSelectionDragGripHit: (target, clientX, clientY, pointerType) =>
                this.isSelectionDragGripHit(target, clientX, clientY, pointerType),
        };
    }

    private executePointerDownDecision(decision: PointerDownDecision, e: PointerEvent): boolean {
        switch (decision.type) {
            case 'none':
                return false;
            case 'handled':
                return true;
            case 'retarget_mobile_range_selection':
                this.retargetMobileRangeSelection(e);
                return true;
            case 'start_press_drag':
                this.beginPressPendingDrag(decision.source, e, decision.options);
                return true;
            case 'start_range_selection':
                if (decision.preventDefault) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                this.beginRangeSelectionSession(decision.source, e, decision.handle, decision.options);
                if (decision.capturePointer) {
                    this.pointer.tryCapturePointer(e);
                    this.pointer.attachPointerListeners();
                }
                if (decision.applySelectionGestureGuard) {
                    this.mobile.applyInputGuardMode(INPUT_GUARD_MOBILE_SELECTION_GESTURE, e.target);
                }
                return true;
            case 'change_selection':
                if (decision.preventDefault) {
                    e.preventDefault();
                    e.stopPropagation();
                }
                this.pipeline.enter({
                    type: 'selection_change',
                    boundary: decision.boundary,
                    docLines: this.view.state.doc.lines,
                    resolveBoundary: createRangeSelectionBoundaryResolver(this.view.state),
                });
                if (decision.capturePointer) {
                    this.pointer.tryCapturePointer(e);
                }
                return true;
        }
    }

    beginRangeSelectionSession(
        source: BlockSelection,
        e: PointerEvent,
        handle: HTMLElement | null,
        options?: RangeSelectionSessionOptions
    ): void {
        void handle;
        const blockInfo = source.anchorBlock;
        const baseBlocksSnapshot = (options?.baseSelectedBlocks ?? this.getPassiveSelectionBlocks())
            .map((block) => ({ ...block }));
        const pointerType = e.pointerType || null;
        const skipLongPress = options?.skipLongPress === true;
        const config = resolveRangeSelectConfig(
            pointerType,
            this.deps.getMouseRangeSelectLongPressMs?.() ?? MOUSE_RANGE_SELECT_LONG_PRESS_MS,
            () => this.getTouchRangeSelectLongPressMs()
        );
        const waitForMouseLongPress = pointerType === 'mouse' && !skipLongPress;
        const initialRangeSelectState = createInitialRangeSelectionState({
            blockInfo,
            sourceSelection: source,
            baseSelectedBlocks: baseBlocksSnapshot,
            initialOperation: options?.initialOperation,
            guardDeps: options?.guardDeps,
            sourceKind: options?.sourceKind,
            anchorBoundary: options?.anchorBoundary,
            initialBoundary: options?.initialBoundary,
            resolveBoundary: options?.resolveBoundary,
            doc: this.view.state.doc,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            pointerType,
        });
        if (!initialRangeSelectState) return;
        initialRangeSelectState.longPressReady = skipLongPress;

        const allowSecondaryDrag = options?.allowSecondaryDrag !== false;
        let dragTimeoutId: number | null = null;
        if (pointerType !== 'mouse' && allowSecondaryDrag) {
            dragTimeoutId = window.setTimeout(() => {
                const state = this.rangePointerSession;
                if (!state) return;
                if (state.pipelineStarted && this.pipelineState.type !== 'selecting') return;
                if (state.pointerId !== e.pointerId) return;
                state.dragReady = true;
                this.activateMouseRangeSelectInterception(state);
            }, this.deps.getMobileDragLongPressMs?.() ?? MOBILE_DRAG_LONG_PRESS_MS);
        }
        if (!waitForMouseLongPress) {
            e.preventDefault();
            e.stopPropagation();
            this.pointer.tryCapturePointer(e);
        }

        const timeoutId = skipLongPress
            ? null
            : window.setTimeout(() => {
                const state = this.rangePointerSession;
                if (!state) return;
                if (state.pipelineStarted && this.pipelineState.type !== 'selecting') return;
                if (state.pointerId !== e.pointerId) return;
                state.longPressReady = true;
                this.startRangeSelectionPipeline(state);
                this.activateMouseRangeSelectInterception(state);
                this.updateMouseRangeSelectionFromLine(state, state.currentLineNumber);
            }, config.longPressMs);

        initialRangeSelectState.isIntercepting = !waitForMouseLongPress;
        initialRangeSelectState.timeoutId = timeoutId;
        initialRangeSelectState.dragTimeoutId = dragTimeoutId;
        this.rangePointerSession = initialRangeSelectState;
        this.pointer.attachPointerListeners();

        if (!options?.deferPipelineStart) {
            this.startRangeSelectionPipeline(initialRangeSelectState);
        }
        if (skipLongPress) {
            initialRangeSelectState.longPressReady = true;
            this.startRangeSelectionPipeline(initialRangeSelectState);
            this.updateMouseRangeSelectionFromLine(initialRangeSelectState, initialRangeSelectState.currentLineNumber);
        }
        if (e.pointerType !== 'mouse' && this.rangePointerSession?.isIntercepting) {
            this.mobile.applyInputGuardMode(INPUT_GUARD_MOBILE_SELECTION_GESTURE, e.target);
        }
    }

    private startRangeSelectionPipeline(state: MouseRangeSelectState): void {
        if (state.pipelineStarted) return;
        state.pipelineStarted = true;
        this.enterRangeSelection({
            sourceSelection: state.sourceSelection,
            anchorBoundary: state.anchorBoundary,
            initialBoundary: state.initialBoundary,
            selectedBlocks: state.baseSelectedBlocks,
            operation: state.initialOperation,
            guardDeps: state.guardDeps,
            resolveBoundary: state.resolveBoundary,
        });
    }

    private enterRangeSelection(options: {
        sourceSelection: BlockSelection;
        anchorBoundary: RangeSelectionBoundary;
        initialBoundary?: RangeSelectionBoundary;
        selectedBlocks: SelectedBlockRange[];
        operation?: RangeSelectionOperation;
        guardDeps?: GuardId[];
        resolveBoundary?: RangeSelectionBoundaryResolver;
    }): void {
        this.pipeline.enter({
            type: 'selection_start',
            seed: {
                selection: options.sourceSelection,
                range: {
                    type: 'range',
                    doc: this.view.state.doc,
                    anchorBoundary: options.anchorBoundary,
                    initialBoundary: options.initialBoundary,
                    selectedBlocks: options.selectedBlocks,
                    operation: options.operation,
                    resolveBoundary: options.resolveBoundary,
                },
            },
            guardDeps: options.guardDeps,
        });
    }

    activateMouseRangeSelectInterception(state: MouseRangeSelectState): void {
        this.pointer.tryCapturePointerById(state.pointerId);
        if (state.isIntercepting) return;
        state.isIntercepting = true;
    }

    beginPressPendingDrag(
        source: BlockSelection,
        e: PointerEvent,
        options?: {
            longPressMs?: number;
            skipLongPress?: boolean;
            sourceKind?: HoldTarget['source'];
        }
    ): void {
        const pointerType = e.pointerType || null;
        const sourceKind = options?.sourceKind ?? 'handle';
        if (!this.canStartDragForPointer(pointerType, sourceKind)) return;

        e.preventDefault();
        e.stopPropagation();
        this.pointer.tryCapturePointer(e);
        if (pointerType !== 'mouse') {
            this.mobile.applyInputGuardMode(INPUT_GUARD_MOBILE_DRAG_GESTURE, e.target);
        }

        const sessionId = this.createSessionId();
        const skipLongPress = options?.skipLongPress === true || options?.longPressMs === 0;
        const longPressMs = options?.longPressMs ?? (pointerType === 'mouse'
            ? (this.deps.getMouseRangeSelectLongPressMs?.() ?? MOUSE_RANGE_SELECT_LONG_PRESS_MS)
            : (this.deps.getMobileDragLongPressMs?.() ?? MOBILE_DRAG_LONG_PRESS_MS));
        const timeoutId = skipLongPress
            ? null
            : window.setTimeout(() => this.markPressReady(sessionId, e.pointerId, pointerType), longPressMs);
        const startMoveThresholdPx = skipLongPress
            ? 2
            : (pointerType === 'mouse' ? 4 : 8);

        this.pressSession = {
            sessionId,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            latestX: e.clientX,
            latestY: e.clientY,
            pointerType,
            longPressReady: skipLongPress,
            timeoutId,
            cancelMoveThresholdPx: MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX,
            startMoveThresholdPx,
        };
        this.pointer.attachPointerListeners();
        this.pipeline.enter({
            type: 'hold_start',
            sessionId,
            target: { selection: source, source: sourceKind },
            guardDeps: this.guardDepsForSource(sourceKind, pointerType),
            pointerType,
        });
        if (skipLongPress) {
            this.pipeline.enter({ type: 'hold_ready', sessionId, pointerType });
        }
    }

    private markPressReady(sessionId: string, pointerId: number, pointerType: string | null): void {
        const state = this.pressSession;
        if (!state || state.sessionId !== sessionId || state.pointerId !== pointerId) return;
        state.longPressReady = true;
        this.pipeline.enter({ type: 'hold_ready', sessionId, pointerType });
    }

    clearPointerPressState(): void {
        const state = this.pressSession;
        if (!state) return;
        if (state.timeoutId !== null) window.clearTimeout(state.timeoutId);
        this.pressSession = null;
    }

    clearMouseRangeSelectState(options?: { preserveVisual?: boolean }): void {
        const hadState = this.rangePointerSession !== null;
        const state = this.rangePointerSession;
        if (state) {
            if (state.timeoutId !== null) window.clearTimeout(state.timeoutId);
            if (state.dragTimeoutId !== null) window.clearTimeout(state.dragTimeoutId);
            this.rangePointerSession = null;
        }
        if (hadState && !options?.preserveVisual) {
            this.refreshRangeSelectionVisual();
        }
    }

    enterDraggingState(
        source: BlockSelection,
        pointerId: number,
        clientX: number,
        clientY: number,
        pointerType: string | null,
        sourceKind: HoldTarget['source'] = 'handle'
    ): void {
        if (!this.canStartDragForPointer(pointerType, sourceKind)) {
            this.resetInteractionSession({ shouldFinishDragSession: false, shouldHideDropPreview: true });
            return;
        }
        const sessionId = this.pipelineState.type === 'ready_to_drag'
            ? this.pipelineState.hold.sessionId
            : (this.pressSession?.sessionId ?? this.createSessionId());
        if (this.pipelineState.type !== 'ready_to_drag') {
            this.pipeline.enter({
                type: 'hold_start',
                sessionId,
                target: { selection: source, source: sourceKind },
                guardDeps: this.guardDepsForSource(sourceKind, pointerType),
                pointerType,
            });
            this.pipeline.enter({ type: 'hold_ready', sessionId, pointerType });
        }
        const drop = this.deps.resolveDropSnapshotAtPoint(clientX, clientY, source, pointerType);
        this.pipeline.enter({ type: 'drag_start', sessionId, drop, pointerType });
        if (this.pipelineState.type !== 'dragging') return;

        if (this.mobile.isMobileEnvironment()) {
            this.mobile.applyInputGuardMode(INPUT_GUARD_MOBILE_DRAG_GESTURE);
            this.mobile.triggerMobileHapticFeedback();
        }
        this.pointer.tryCapturePointerById(pointerId);
        this.pointer.attachPointerListeners();
        this.activeDragPointer = { clientX, clientY, pointerType };
        this.activeDragSession = {
            sessionId,
            pointerId,
            pointerType,
            autoScrollFrameId: null,
        };
        this.deps.beginPointerDragSession(source);
        this.clearPointerPressState();
    }

    private handlePointerMove(e: PointerEvent): void {
        handlePointerMove(this, e);
    }

    cancelDragAutoScroll(dragState: { autoScrollFrameId: number | null }): void {
        if (dragState.autoScrollFrameId === null) return;
        window.cancelAnimationFrame(dragState.autoScrollFrameId);
        dragState.autoScrollFrameId = null;
    }

    updateActiveDragPointer(clientX: number, clientY: number, pointerType: string | null): void {
        this.activeDragPointer = { clientX, clientY, pointerType };
    }

    getActiveDragPointer(): { clientX: number; clientY: number; pointerType: string | null } | null {
        return this.activeDragPointer;
    }

    resolveActiveDragDropSnapshot(selection: BlockSelection): DragDropSnapshot {
        if (!this.activeDragPointer) return { target: null, rejectReason: 'no_target' };
        return this.deps.resolveDropSnapshotAtPoint(
            this.activeDragPointer.clientX,
            this.activeDragPointer.clientY,
            selection,
            this.activeDragPointer.pointerType
        );
    }

    previewActiveDrag(params: {
        pointerId: number;
        pointerType: string | null;
        drop: DragDropSnapshot;
    }): PipelineOutput[] {
        const drag = this.activeDragSession;
        if (!drag || this.pipelineState.type !== 'dragging' || drag.pointerId !== params.pointerId) return [];
        drag.pointerType = params.pointerType || drag.pointerType;
        return this.pipeline.enter({
            type: 'drag_over',
            sessionId: drag.sessionId,
            drop: params.drop,
            pointerType: params.pointerType,
        }).outputs;
    }

    commitActiveDrag(params: {
        pointerId: number;
        pointerType: string | null;
        resolved: PointerDropCommitResolution;
    }): PipelineOutput[] {
        const drag = this.activeDragSession;
        if (!drag || this.pipelineState.type !== 'dragging' || drag.pointerId !== params.pointerId) return [];
        return this.pipeline.enter({
            type: 'drop',
            sessionId: drag.sessionId,
            resolution: params.resolved,
            pointerType: params.pointerType,
        }).outputs;
    }

    cancelActiveDrag(params: {
        pointerId: number;
        pointerType: string | null;
        reason: DragCancelReason;
    }): PipelineOutput[] {
        const drag = this.activeDragSession;
        if (!drag || this.pipelineState.type !== 'dragging' || drag.pointerId !== params.pointerId) return [];
        return this.pipeline.enter({
            type: 'cancel',
            sessionId: drag.sessionId,
            reason: params.reason,
            pointerType: params.pointerType,
        }).outputs;
    }

    buildActiveDragCommand(selection: BlockSelection): PointerDropCommitResolution {
        if (!this.activeDragPointer) {
            return { type: 'cancel', drop: { target: null, rejectReason: 'no_target' }, reason: 'no_target' };
        }
        return this.deps.buildBlockCommandAtPoint(
            selection,
            this.activeDragPointer.clientX,
            this.activeDragPointer.clientY,
            this.activeDragPointer.pointerType
        );
    }

    applyPipelineOutputs(outputs: PipelineOutput[]): void {
        for (const output of outputs) {
            switch (output.type) {
                case 'drag_over':
                    this.deps.pipelineOutputExecutor.showDropPreview(output.selection, output.drop, output.pointerType);
                    break;
                case 'dropped':
                    break;
                case 'cancelled':
                    this.deps.pipelineOutputExecutor.hideDropPreview();
                    break;
                case 'command_ready':
                    this.deps.pipelineOutputExecutor.applyCommand(output.command);
                    break;
                case 'lifecycle':
                    this.deps.pipelineOutputExecutor.emitLifecycle(output.event);
                    break;
                case 'state_changed':
                    break;
                case 'selection_changed':
                    if (output.selection) {
                        this.refreshRangeSelectionVisual();
                    } else {
                        this.rangeVisual.clear();
                    }
                    break;
                case 'drag_source_changed':
                    if (output.selection) {
                        this.rangeVisual.renderDragSourceSelection(output.selection);
                    } else {
                        this.rangeVisual.clear();
                    }
                    break;
                case 'terminal':
                    break;
            }
        }
    }

    updateMouseRangeSelection(state: MouseRangeSelectState, target: RangeSelectionBoundary): void {
        this.pipeline.enter({
            type: 'selection_change',
            boundary: target,
            docLines: this.view.state.doc.lines,
            resolveBoundary: createRangeSelectionBoundaryResolver(this.view.state),
        });
        state.currentLineNumber = target.representativeLineNumber;
        state.selectionGestureStarted = true;
    }

    private updateMouseRangeSelectionFromLine(state: MouseRangeSelectState, lineNumber: number): void {
        const doc = this.view.state.doc;
        const clampedLine = Math.max(1, Math.min(doc.lines, lineNumber));
        const boundary = createRangeSelectionBoundaryResolver(this.view.state)(clampedLine);
        this.updateMouseRangeSelection(state, {
            ...boundary,
            representativeLineNumber: clampedLine,
        });
    }

    retargetMobileRangeSelection(e: PointerEvent): void {
        const state = this.rangePointerSession;
        if (this.pipelineState.type !== 'selecting' || !state || state.pointerType === 'mouse') return;
        state.pointerId = e.pointerId;
        state.startX = e.clientX;
        state.startY = e.clientY;
        state.latestX = e.clientX;
        state.latestY = e.clientY;
        state.longPressReady = true;
        state.dragReady = false;
        state.isIntercepting = true;
        if (state.dragTimeoutId !== null) {
            window.clearTimeout(state.dragTimeoutId);
            state.dragTimeoutId = null;
        }
        e.preventDefault();
        e.stopPropagation();
        this.pointer.tryCapturePointer(e);
    }

    tryStartPassiveSelectionDrag(e: PointerEvent, target: HTMLElement): boolean {
        if (!this.isMultiLineSelectionEnabled()) return false;
        if (e.button !== 0) return false;
        const passiveSource = this.getPassiveSelectionSource();
        if (!passiveSource) return false;

        const pointerType = e.pointerType || null;
        if (!this.isSelectionDragGripHit(target, e.clientX, e.clientY, pointerType)) {
            return false;
        }
        const selectedHandleHit = !!target.closest(`.${RANGE_SELECTED_HANDLE_CLASS}`);
        const sourceKind: HoldTarget['source'] = selectedHandleHit ? 'handle' : 'selected_text';
        if (!this.canStartDragForPointer(pointerType, sourceKind)) return false;

        if (this.pipelineState.type === 'selecting' && this.rangePointerSession) {
            this.retargetMobileRangeSelection(e);
        } else {
            this.beginPressPendingDrag(passiveSource, e, selectedHandleHit
                ? { sourceKind }
                : { sourceKind });
        }
        return true;
    }

    clearRangeSelection(): void {
        if (this.pipelineState.type === 'selecting') {
            this.pipeline.enter({ type: 'selection_clear' });
            return;
        }
        if ((this.pipelineState.type === 'holding' || this.pipelineState.type === 'ready_to_drag') && this.pipelineState.hold.retainedSelection) {
            this.pipeline.enter({ type: 'destroy' });
            return;
        }
        this.rangeVisual.clear();
    }

    handleMobileDragAvailabilityChanged(mobileDragAvailable: boolean): void {
        if (mobileDragAvailable) {
            return;
        }
        const previousState = this.pipelineState;
        this.pipeline.enter({ type: 'guard_unavailable', guardId: GUARD_MOBILE_TEXT_DRAG });
        if (previousState.type !== 'idle' && this.pipelineState.type === 'idle') {
            this.clearTechnicalSessions();
            this.pointer.detachPointerListeners();
            this.pointer.releasePointerCapture();
            this.mobile.clearInputGuardMode();
        }
    }

    getPassiveSelectionSource(): BlockSelection | null {
        const request = this.buildPassiveSelectionRequest();
        if (!request) return null;
        return this.resolveBlockSelection(request);
    }

    getPassiveSelectionBlocks(): SelectedBlockRange[] {
        const selection = this.getPassivePipelineSelection();
        return selection ? selectedBlocksFromSelection(selection) : [];
    }

    private buildPassiveSelectionRequest(): BlockSelectionRequest | null {
        const selection = this.getPassivePipelineSelection();
        if (!selection) return null;
        return {
            kind: 'selection',
            doc: this.view.state.doc,
            blocks: selectedBlocksFromSelection(selection),
            templateBlock: selection.anchorBlock,
        };
    }

    resolveBlockSelection(request: BlockSelectionRequest): BlockSelection | null {
        return this.deps.resolveBlockSelection(request);
    }

    private refreshRangeSelectionVisual(): void {
        renderRangeSelectionPreview(this.pipelineState, this.rangeVisual);
    }

    finishRangeSelectionSession(): void {
        this.clearMouseRangeSelectState({ preserveVisual: true });
        this.pointer.detachPointerListeners();
        this.pointer.releasePointerCapture();
        this.pipeline.enter({ type: 'selection_finish' });
        if (this.mobile.isMobileEnvironment() && this.pipelineState.type === 'selecting') {
            this.mobile.applyInputGuardMode(INPUT_GUARD_MOBILE_SELECTION_PASSIVE);
        } else {
            this.mobile.clearInputGuardMode();
        }
    }

    private getPassivePipelineSelection(): BlockSelection | null {
        return this.pipelineState.type === 'selecting' && this.pipelineState.selection.phase === 'passive'
            ? this.pipelineState.selection.selection
            : null;
    }

    private hasPassivePipelineSelection(): boolean {
        if (this.pipelineState.type === 'selecting' && this.pipelineState.selection.phase === 'passive') return true;
        return (this.pipelineState.type === 'holding' || this.pipelineState.type === 'ready_to_drag')
            && !!this.pipelineState.hold.retainedSelection;
    }

    private buildPassiveSelectionView(): RangeSelectionView | null {
        const selection = this.getPassivePipelineSelection();
        if (!selection) return null;
        return {
            blocks: selectedBlocksFromSelection(selection),
            templateBlock: selection.anchorBlock,
        };
    }

    private isSelectionDragGripHit(
        target: HTMLElement,
        clientX: number,
        clientY: number,
        pointerType: string | null
    ): boolean {
        return isRangeSelectionGripHitByGrip({
            selection: this.buildPassiveSelectionView(),
            target,
            clientX,
            clientY,
            pointerType,
            resolveAnchorSpan: (range) => this.rangeVisual.resolveRangeAnchorSpan(range),
            isWithinMobileDragHotzoneBand: () => true,
        });
    }

    cleanupAfterPointerDrag(options?: InteractionCleanupOptions): void {
        this.resetInteractionSession(options);
    }

    openBlockTypeMenuForTap(selection: BlockSelection, e: MouseEvent | PointerEvent | null): void {
        const pointerType = e && 'pointerType' in e ? (e.pointerType || null) : null;
        this.resetInteractionSession({
            shouldFinishDragSession: false,
            shouldHideDropPreview: false,
            cancelReason: null,
            pointerType,
        });
        if (pointerType === 'mouse') {
            this.deps.openBlockTypeMenu?.(selection.anchorBlock, e);
            return;
        }
        window.setTimeout(() => {
            this.deps.openBlockTypeMenu?.(selection.anchorBlock, null);
        }, 0);
    }

    private handlePointerUp(e: PointerEvent): void {
        handlePointerUp(this, e);
    }

    private handlePointerCancel(e: PointerEvent): void {
        handlePointerCancel(this, e);
    }

    private handleLostPointerCapture(e: PointerEvent): void {
        readPointerInput('lost_capture', e);
        if (!this.hasActivePointerSession()) return;
        this.abortForSessionInterrupted(e.pointerType || null);
    }

    private handleWindowBlur(): void {
        readFocusInput('blur', new FocusEvent('blur'));
        if (!this.hasActivePointerSession()) return;
        this.abortForSessionInterrupted(null);
    }

    private handleDocumentVisibilityChange(e: Event = new Event('visibilitychange')): void {
        const input = readVisibilityInput(e);
        if (input.visibilityState !== 'hidden') return;
        if (!this.hasActivePointerSession()) return;
        this.abortForSessionInterrupted(null);
    }

    private handleWindowKeyDown(e: KeyboardEvent): void {
        const input = readKeyboardInput('keydown', e);
        if (input.key !== 'Escape') return;
        if (!this.clearRangeSelectionForEscape()) return;
        e.preventDefault();
        e.stopPropagation();
    }

    private clearRangeSelectionForEscape(): boolean {
        if (this.pipelineState.type === 'selecting') {
            this.clearMouseRangeSelectState();
            this.pointer.detachPointerListeners();
            this.pointer.releasePointerCapture();
            this.mobile.clearInputGuardMode();
            this.clearRangeSelection();
            return true;
        }
        return false;
    }

    abortForGestureCancel(
        cancelReason: DragCancelReason,
        pointerType: string | null
    ): void {
        this.resetInteractionSession({
            shouldFinishDragSession: false,
            shouldHideDropPreview: false,
            cancelReason,
            pointerType,
        });
    }

    private abortForSessionInterrupted(pointerType: string | null): void {
        this.resetInteractionSession({
            shouldFinishDragSession: true,
            shouldHideDropPreview: true,
            cancelReason: 'session_interrupted',
            pointerType,
        });
    }

    private handleEnterMobileSelectionMode(e: Event): void {
        this.executeMobileSelectionModeDecision(
            decideEnterMobileSelectionMode(this.buildPointerSelectionContext(), e),
            e
        );
    }

    private executeMobileSelectionModeDecision(decision: MobileSelectionModeDecision, e: Event): void {
        if (decision.type === 'none') return;
        if (decision.markEventHandled && e instanceof CustomEvent) {
            (e.detail as { handled?: boolean }).handled = true;
        }
        this.enterRangeSelection({
            sourceSelection: decision.selection,
            anchorBoundary: buildRangeSelectionBoundaryFromBlock(this.view.state.doc, decision.blockInfo),
            selectedBlocks: [],
            operation: 'add',
            guardDeps: [GUARD_MOBILE_TEXT_DRAG],
        });
        this.pipeline.enter({ type: 'selection_finish' });
        this.mobile.applyInputGuardMode(INPUT_GUARD_MOBILE_SELECTION_PASSIVE, e.target);
    }

    private handleDocumentFocusIn(e: FocusEvent): void {
        readFocusInput('focusin', e);
        if (!this.shouldSuppressTextInputForActiveInteraction()) return;
        this.mobile.suppressMobileKeyboard(e.target);
    }

    private handleTouchMove(e: TouchEvent): void {
        if (!this.shouldSuppressScrollForActiveInteraction()) return;
        if (e.cancelable) {
            e.preventDefault();
        }
    }

    private hasActivePointerSession(): boolean {
        if (this.activeDragSession || this.pressSession) return true;
        if (this.pipelineState.type === 'selecting') {
            return !!this.rangePointerSession;
        }
        return false;
    }

    private shouldSuppressTextInputForActiveInteraction(): boolean {
        if (this.pipelineState.type === 'dragging') return true;
        if (this.pipelineState.type === 'selecting') return true;
        if (this.rangePointerSession?.isIntercepting) return true;
        if (this.pressSession) return true;
        return false;
    }

    private shouldSuppressScrollForActiveInteraction(): boolean {
        if (this.pipelineState.type === 'dragging') return true;
        if (this.pipelineState.type === 'selecting') {
            return !!this.rangePointerSession?.isIntercepting;
        }
        if (this.rangePointerSession?.isIntercepting) return true;
        if (this.pressSession) return true;
        return false;
    }

    private resetInteractionSession(options?: InteractionCleanupOptions): void {
        const hadDrag = !!this.activeDragSession || this.pipelineState.type === 'dragging';
        const activeDrag = this.activeDragSession;
        if (activeDrag) this.cancelDragAutoScroll(activeDrag);

        const shouldFinishDragSession = options?.shouldFinishDragSession ?? hadDrag;
        const shouldHideDropPreview = options?.shouldHideDropPreview ?? hadDrag;
        const cancelReason = options?.cancelReason ?? null;
        const pointerType = options?.pointerType ?? null;

        this.clearTechnicalSessions();
        this.pointer.detachPointerListeners();
        this.pointer.releasePointerCapture();
        this.mobile.clearInputGuardMode();

        if (cancelReason) {
            this.pipeline.enter({ type: 'cancel', reason: cancelReason, pointerType });
        } else if (this.pipelineState.type !== 'idle') {
            this.pipeline.enter({ type: 'destroy' });
        }
        if (shouldHideDropPreview) {
            this.deps.pipelineOutputExecutor.hideDropPreview();
        }
        if (hadDrag && shouldFinishDragSession) {
            this.deps.finishDragSession();
        }
        this.activeDragPointer = null;
    }

    isMultiLineSelectionEnabled(): boolean {
        if (!this.deps.isMultiLineSelectionEnabled) return true;
        return this.deps.isMultiLineSelectionEnabled();
    }

    canStartDragForPointer(pointerType: string | null, source: HoldTarget['source'] = 'handle'): boolean {
        if (source === 'command') return true;
        if (pointerType === 'mouse') return true;
        if (!this.mobile.isMobileEnvironment()) return true;
        return this.deps.isMobileDragModeEnabled?.() === true;
    }

    isMobileDragModeActiveForPointer(pointerType: string | null): boolean {
        if (pointerType === 'mouse') return false;
        if (!this.mobile.isMobileEnvironment()) return false;
        return this.deps.isMobileDragModeEnabled?.() === true;
    }

    getTouchRangeSelectLongPressMs(): number {
        return clampTouchRangeSelectLongPressMs(this.deps.getMultiLineSelectionLongPressMs?.());
    }

    private clearTechnicalSessions(): void {
        this.clearPointerPressState();
        if (this.rangePointerSession?.timeoutId !== null && this.rangePointerSession?.timeoutId !== undefined) {
            window.clearTimeout(this.rangePointerSession.timeoutId);
        }
        if (this.rangePointerSession?.dragTimeoutId !== null && this.rangePointerSession?.dragTimeoutId !== undefined) {
            window.clearTimeout(this.rangePointerSession.dragTimeoutId);
        }
        this.rangePointerSession = null;
        this.activeDragSession = null;
    }

    private guardDepsForSource(source: HoldTarget['source'], pointerType: string | null): string[] {
        if ((source === 'text' || source === 'selected_text') && pointerType !== 'mouse' && this.mobile.isMobileEnvironment()) {
            return [GUARD_MOBILE_TEXT_DRAG];
        }
        return [];
    }

    private createSessionId(): string {
        return `drag-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }
}

function selectedBlocksFromSelection(selection: BlockSelection): SelectedBlockRange[] {
    return selection.ranges.map((range) => ({
        startLineNumber: range.startLine + 1,
        endLineNumber: range.endLine + 1,
    }));
}
