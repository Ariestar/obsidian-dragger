import { EditorView } from '@codemirror/view';
import { BlockInfo, DragLifecycleEvent } from '../../types';
import {
    getHandleColumnCenterX,
    getLineNumberElementForLine,
    viewportXToEditorLocalX,
    viewportYToEditorLocalY,
} from '../core/handle-position';
import { detectBlock } from '../block-detector';
import { EMBED_BLOCK_SELECTOR } from '../core/selectors';

const MOBILE_DRAG_LONG_PRESS_MS = 100;
const MOBILE_DRAG_START_MOVE_THRESHOLD_PX = 8;
const MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX = 12;
const MOBILE_DRAG_HOTZONE_LEFT_PX = 24;
const MOBILE_DRAG_HOTZONE_RIGHT_PX = 8;
const MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX = 16;
const MOBILE_GESTURE_LOCK_BODY_CLASS = 'dnd-mobile-gesture-lock';
const MOBILE_GESTURE_LOCK_EDITOR_CLASS = 'dnd-mobile-gesture-lock';
const MOBILE_GESTURE_LOCK_COUNT_ATTR = 'data-dnd-mobile-lock-count';
const TOUCH_RANGE_SELECT_LONG_PRESS_MS = 900;
const MOUSE_RANGE_SELECT_LONG_PRESS_MS = 260;
const MOUSE_RANGE_SELECT_CANCEL_MOVE_THRESHOLD_PX = 12;
const RANGE_SELECTION_GRIP_HIT_PADDING_PX = 20;
const RANGE_SELECTION_GRIP_HIT_X_PADDING_PX = 28;
const RANGE_SELECTED_LINE_CLASS = 'dnd-range-selected-line';
const RANGE_SELECTED_LINE_NUMBER_HIDDEN_CLASS = 'dnd-line-number-grab-hidden';
const RANGE_SELECTED_HANDLE_CLASS = 'dnd-range-selected-handle';
const RANGE_SELECTION_LINK_CLASS = 'dnd-range-selection-link';

type PointerDragState = {
    sourceBlock: BlockInfo;
    pointerId: number;
};

type PointerPressState = {
    sourceBlock: BlockInfo;
    pointerId: number;
    startX: number;
    startY: number;
    latestX: number;
    latestY: number;
    pointerType: string | null;
    longPressReady: boolean;
    timeoutId: number | null;
    cancelMoveThresholdPx: number;
    startMoveThresholdPx: number;
};

type MouseRangeSelectState = {
    sourceBlock: BlockInfo;
    dragSourceBlock: BlockInfo;
    selectedBlock: BlockInfo;
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
    sourceHandle: HTMLElement | null;
    sourceHandleDraggableAttr: string | null;
    anchorStartLineNumber: number;
    anchorEndLineNumber: number;
    currentLineNumber: number;
    committedRangesSnapshot: LineRange[];
    selectionRanges: LineRange[];
};

type RangeSelectionBoundary = {
    startLineNumber: number;
    endLineNumber: number;
    representativeLineNumber: number;
};

type LineRange = {
    startLineNumber: number;
    endLineNumber: number;
};

type RangeSelectConfig = {
    longPressMs: number;
};

type CommittedRangeSelection = {
    selectedBlock: BlockInfo;
    ranges: LineRange[];
};

export interface DragEventHandlerDeps {
    getDragSourceBlock: (e: DragEvent) => BlockInfo | null;
    getBlockInfoForHandle: (handle: HTMLElement) => BlockInfo | null;
    getBlockInfoAtPoint: (clientX: number, clientY: number) => BlockInfo | null;
    isBlockInsideRenderedTableCell: (blockInfo: BlockInfo) => boolean;
    isMultiLineSelectionEnabled?: () => boolean;
    beginPointerDragSession: (blockInfo: BlockInfo) => void;
    finishDragSession: () => void;
    scheduleDropIndicatorUpdate: (clientX: number, clientY: number, dragSource: BlockInfo | null, pointerType: string | null) => void;
    hideDropIndicator: () => void;
    performDropAtPoint: (sourceBlock: BlockInfo, clientX: number, clientY: number, pointerType: string | null) => void;
    onDragLifecycleEvent?: (event: DragLifecycleEvent) => void;
}

export class DragEventHandler {
    private pointerDragState: PointerDragState | null = null;
    private pointerPressState: PointerPressState | null = null;
    private mouseRangeSelectState: MouseRangeSelectState | null = null;
    private pointerListenersAttached = false;
    private touchBlockerAttached = false;
    private focusGuardAttached = false;
    private mobileInteractionLocked = false;
    private pointerCaptureTarget: Element | null = null;
    private capturedPointerId: number | null = null;
    private readonly handledPointerEvents = new WeakSet<Event>();
    private readonly rangeSelectedLineElements = new Set<HTMLElement>();
    private readonly rangeSelectedLineNumberElements = new Set<HTMLElement>();
    private readonly rangeSelectedHandleElements = new Set<HTMLElement>();
    private readonly rangeSelectionLinkEls: HTMLElement[] = [];
    private committedRangeSelection: CommittedRangeSelection | null = null;
    private rangeSelectionScrollContainer: HTMLElement | null = null;
    private rangeSelectionVisualRefreshRafHandle: number | null = null;

    private readonly onEditorPointerDown = (e: PointerEvent) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;
        const pointerType = e.pointerType || null;
        const multiLineSelectionEnabled = this.isMultiLineSelectionEnabled();
        if (!multiLineSelectionEnabled) {
            this.clearCommittedRangeSelection();
        }
        const canHandleCommittedSelection = (
            multiLineSelectionEnabled
            && e.button === 0
            && !this.pointerDragState
            && !this.pointerPressState
            && !this.mouseRangeSelectState
            && !!this.committedRangeSelection
        );

        if (canHandleCommittedSelection && this.isCommittedSelectionGripHit(target, e.clientX, e.clientY, pointerType)) {
            const committedBlock = this.getCommittedSelectionBlock();
            if (committedBlock) {
                this.startPointerPressDrag(committedBlock, e, {
                    skipLongPress: pointerType === 'mouse',
                });
                return;
            }
        }
        if (canHandleCommittedSelection && this.shouldClearCommittedSelectionOnPointerDown(target, e.clientX, pointerType)) {
            this.clearCommittedRangeSelection();
        }

        const handle = target.closest('.dnd-drag-handle') as HTMLElement | null;
        if (handle && !handle.classList.contains('dnd-embed-handle')) {
            this.startPointerDragFromHandle(handle, e);
            return;
        }

        if (!this.shouldStartMobilePressDrag(e)) return;
        if (!this.isWithinMobileDragHotzoneBand(e.clientX)) return;

        // Mobile hotzone hit should be consumed first to avoid editor focus/keyboard side effects.
        e.preventDefault();
        e.stopPropagation();

        const blockInfo = this.deps.getBlockInfoAtPoint(e.clientX, e.clientY);
        if (!blockInfo) return;
        if (this.deps.isBlockInsideRenderedTableCell(blockInfo)) return;
        if (!this.isWithinMobileDragHotzone(blockInfo, e.clientX)) return;
        if (multiLineSelectionEnabled) {
            this.startRangeSelect(blockInfo, e, null);
        } else {
            this.startPointerPressDrag(blockInfo, e);
        }
    };

    private readonly onEditorDragEnter = (e: DragEvent) => {
        if (!this.shouldHandleDrag(e)) return;
        if (this.mouseRangeSelectState && !this.pointerDragState && !this.pointerPressState) {
            this.clearMouseRangeSelectState();
            this.detachPointerListeners();
            this.releasePointerCapture();
        }
        e.preventDefault();
        e.stopPropagation();
        if (e.dataTransfer) {
            e.dataTransfer.dropEffect = 'move';
        }
    };

    private readonly onEditorDragOver = (e: DragEvent) => {
        if (!this.shouldHandleDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (!e.dataTransfer) return;
        e.dataTransfer.dropEffect = 'move';
        this.deps.scheduleDropIndicatorUpdate(e.clientX, e.clientY, this.deps.getDragSourceBlock(e), 'mouse');
    };

    private readonly onEditorDragLeave = (e: DragEvent) => {
        if (!this.shouldHandleDrag(e)) return;
        const rect = this.view.dom.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right ||
            e.clientY < rect.top || e.clientY > rect.bottom) {
            this.deps.hideDropIndicator();
        }
    };

    private readonly onEditorDrop = (e: DragEvent) => {
        if (!this.shouldHandleDrag(e)) return;
        e.preventDefault();
        e.stopPropagation();
        if (!e.dataTransfer) return;
        const sourceBlock = this.deps.getDragSourceBlock(e);
        if (!sourceBlock) return;
        this.deps.performDropAtPoint(sourceBlock, e.clientX, e.clientY, 'mouse');
        this.deps.hideDropIndicator();
        this.deps.finishDragSession();
    };

    private readonly onPointerMove = (e: PointerEvent) => {
        if (this.shouldIgnoreDuplicatePointerEvent(e)) return;
        this.handlePointerMove(e);
    };
    private readonly onPointerUp = (e: PointerEvent) => {
        if (this.shouldIgnoreDuplicatePointerEvent(e)) return;
        this.handlePointerUp(e);
    };
    private readonly onPointerCancel = (e: PointerEvent) => {
        if (this.shouldIgnoreDuplicatePointerEvent(e)) return;
        this.handlePointerCancel(e);
    };
    private readonly onLostPointerCapture = (e: PointerEvent) => this.handleLostPointerCapture(e);
    private readonly onWindowBlur = () => this.handleWindowBlur();
    private readonly onDocumentVisibilityChange = () => this.handleDocumentVisibilityChange();
    private readonly onDocumentFocusIn = (e: FocusEvent) => this.handleDocumentFocusIn(e);
    private readonly onTouchMove = (e: TouchEvent) => this.handleTouchMove(e);
    private readonly onRangeSelectionScroll = () => this.scheduleRangeSelectionVisualRefresh();

    constructor(
        private readonly view: EditorView,
        private readonly deps: DragEventHandlerDeps
    ) { }

    attach(): void {
        const editorDom = this.view.dom;
        editorDom.addEventListener('pointerdown', this.onEditorPointerDown, true);
        editorDom.addEventListener('lostpointercapture', this.onLostPointerCapture, true);
        editorDom.addEventListener('dragenter', this.onEditorDragEnter, true);
        editorDom.addEventListener('dragover', this.onEditorDragOver, true);
        editorDom.addEventListener('dragleave', this.onEditorDragLeave, true);
        editorDom.addEventListener('drop', this.onEditorDrop, true);
        editorDom.addEventListener('focusin', this.onDocumentFocusIn, true);
        this.bindRangeSelectionScrollListener();
    }

    startPointerDragFromHandle(handle: HTMLElement, e: PointerEvent, getBlockInfo?: () => BlockInfo | null): void {
        if (this.pointerDragState || this.pointerPressState || this.mouseRangeSelectState) return;

        const blockInfo = (getBlockInfo ? getBlockInfo() : null)
            ?? this.deps.getBlockInfoForHandle(handle)
            ?? this.deps.getBlockInfoAtPoint(e.clientX, e.clientY);
        if (!blockInfo) return;
        if (this.deps.isBlockInsideRenderedTableCell(blockInfo)) return;

        const multiLineSelectionEnabled = this.isMultiLineSelectionEnabled();
        if (e.pointerType === 'mouse') {
            if (e.button !== 0) return;
            if (!multiLineSelectionEnabled) {
                return;
            }
            this.startRangeSelect(blockInfo, e, handle);
            return;
        }

        if (this.isMobileEnvironment()) {
            if (multiLineSelectionEnabled) {
                this.startRangeSelect(blockInfo, e, handle);
            } else {
                this.startPointerPressDrag(blockInfo, e);
            }
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        this.tryCapturePointer(e);
        this.beginPointerDrag(blockInfo, e.pointerId, e.clientX, e.clientY, e.pointerType || null);
    }

    destroy(): void {
        this.abortPointerSession({ shouldFinishDragSession: true, shouldHideDropIndicator: true });
        this.clearCommittedRangeSelection();
        for (const link of this.rangeSelectionLinkEls) {
            link.remove();
        }
        this.rangeSelectionLinkEls.length = 0;
        this.cancelScheduledRangeSelectionVisualRefresh();
        this.unbindRangeSelectionScrollListener();

        const editorDom = this.view.dom;
        editorDom.removeEventListener('pointerdown', this.onEditorPointerDown, true);
        editorDom.removeEventListener('lostpointercapture', this.onLostPointerCapture, true);
        editorDom.removeEventListener('dragenter', this.onEditorDragEnter, true);
        editorDom.removeEventListener('dragover', this.onEditorDragOver, true);
        editorDom.removeEventListener('dragleave', this.onEditorDragLeave, true);
        editorDom.removeEventListener('drop', this.onEditorDrop, true);
        editorDom.removeEventListener('focusin', this.onDocumentFocusIn, true);
    }

    isGestureActive(): boolean {
        return this.hasActivePointerSession();
    }

    refreshSelectionVisual(): void {
        if (!this.isMultiLineSelectionEnabled()) {
            this.clearCommittedRangeSelection();
            return;
        }
        this.scheduleRangeSelectionVisualRefresh();
    }

    private scheduleRangeSelectionVisualRefresh(): void {
        if (this.rangeSelectionVisualRefreshRafHandle !== null) return;
        this.rangeSelectionVisualRefreshRafHandle = window.requestAnimationFrame(() => {
            this.rangeSelectionVisualRefreshRafHandle = null;
            this.refreshRangeSelectionVisual();
        });
    }

    private cancelScheduledRangeSelectionVisualRefresh(): void {
        if (this.rangeSelectionVisualRefreshRafHandle === null) return;
        window.cancelAnimationFrame(this.rangeSelectionVisualRefreshRafHandle);
        this.rangeSelectionVisualRefreshRafHandle = null;
    }

    private shouldHandleDrag(e: DragEvent): boolean {
        if (!e.dataTransfer) return false;
        return Array.from(e.dataTransfer.types).includes('application/dnd-block');
    }

    private bindRangeSelectionScrollListener(): void {
        this.unbindRangeSelectionScrollListener();
        const scroller = ((this.view as any).scrollDOM as HTMLElement | undefined)
            ?? (this.view.dom.querySelector('.cm-scroller') as HTMLElement | null)
            ?? null;
        if (!scroller) return;
        scroller.addEventListener('scroll', this.onRangeSelectionScroll, { passive: true });
        this.rangeSelectionScrollContainer = scroller;
    }

    private unbindRangeSelectionScrollListener(): void {
        if (!this.rangeSelectionScrollContainer) return;
        this.rangeSelectionScrollContainer.removeEventListener('scroll', this.onRangeSelectionScroll);
        this.rangeSelectionScrollContainer = null;
    }

    private isMobileEnvironment(): boolean {
        const body = document.body;
        if (body?.classList.contains('is-mobile') || body?.classList.contains('is-phone') || body?.classList.contains('is-tablet')) {
            return true;
        }
        if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return false;
        return window.matchMedia('(hover: none) and (pointer: coarse)').matches;
    }

    private shouldStartMobilePressDrag(e: PointerEvent): boolean {
        if (this.pointerDragState || this.pointerPressState || this.mouseRangeSelectState) return false;
        if (e.button !== 0) return false;
        if (e.pointerType === 'mouse') return false;
        if (!this.isMobileEnvironment()) return false;
        return true;
    }

    private isWithinMobileDragHotzoneBand(clientX: number): boolean {
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const left = contentRect.left - MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX;
        const right = contentRect.left
            + MOBILE_DRAG_HOTZONE_LEFT_PX
            + MOBILE_DRAG_HOTZONE_RIGHT_PX
            + MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX;
        return clientX >= left && clientX <= right;
    }

    private isWithinMobileDragHotzone(blockInfo: BlockInfo, clientX: number): boolean {
        const lineNumber = blockInfo.startLine + 1;
        if (lineNumber < 1 || lineNumber > this.view.state.doc.lines) return false;

        const line = this.view.state.doc.line(lineNumber);
        let lineStart: ReturnType<EditorView['coordsAtPos']> | null = null;
        try {
            lineStart = this.view.coordsAtPos(line.from);
        } catch {
            lineStart = null;
        }
        if (!lineStart) return false;

        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const hotzoneLeft = Math.max(
            contentRect.left - MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX,
            lineStart.left - MOBILE_DRAG_HOTZONE_LEFT_PX - MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX
        );
        const hotzoneRight = lineStart.left + MOBILE_DRAG_HOTZONE_RIGHT_PX;
        return clientX >= hotzoneLeft && clientX <= hotzoneRight;
    }

    private getRangeSelectConfig(pointerType: string | null): RangeSelectConfig {
        if (pointerType === 'mouse') {
            return {
                longPressMs: MOUSE_RANGE_SELECT_LONG_PRESS_MS,
            };
        }

        return {
            longPressMs: TOUCH_RANGE_SELECT_LONG_PRESS_MS,
        };
    }

    private startRangeSelect(blockInfo: BlockInfo, e: PointerEvent, handle: HTMLElement | null): void {
        const anchorStartLineNumber = blockInfo.startLine + 1;
        const anchorEndLineNumber = blockInfo.endLine + 1;
        if (
            anchorStartLineNumber < 1
            || anchorEndLineNumber > this.view.state.doc.lines
            || anchorStartLineNumber > anchorEndLineNumber
        ) {
            return;
        }

        const committedRangesSnapshot = this.cloneLineRanges(this.committedRangeSelection?.ranges ?? []);
        const anchorRange = this.normalizeLineRange(anchorStartLineNumber, anchorEndLineNumber);
        const initialRanges = this.mergeLineRanges([...committedRangesSnapshot, anchorRange]);
        const anchorBlock = this.buildDragSourceFromLineRanges(initialRanges, blockInfo);
        const pointerType = e.pointerType || null;
        const config = this.getRangeSelectConfig(pointerType);
        const sourceHandleDraggableAttr = handle?.getAttribute('draggable') ?? null;
        const shouldDeferInterception = pointerType === 'mouse';
        let dragTimeoutId: number | null = null;
        if (pointerType !== 'mouse') {
            dragTimeoutId = window.setTimeout(() => {
                const state = this.mouseRangeSelectState;
                if (!state || state.pointerId !== e.pointerId) return;
                state.dragReady = true;
            }, MOBILE_DRAG_LONG_PRESS_MS);
        }
        if (!shouldDeferInterception) {
            e.preventDefault();
            e.stopPropagation();
            this.tryCapturePointer(e);
            if (handle) {
                handle.setAttribute('draggable', 'false');
            }
        }

        const timeoutId = window.setTimeout(() => {
            const state = this.mouseRangeSelectState;
            if (!state || state.pointerId !== e.pointerId) return;
            state.longPressReady = true;
            this.activateMouseRangeSelectInterception(state);
            this.updateMouseRangeSelectionFromLine(state, state.currentLineNumber);
        }, config.longPressMs);

        this.mouseRangeSelectState = {
            sourceBlock: anchorBlock,
            dragSourceBlock: this.cloneBlockInfo(blockInfo),
            selectedBlock: anchorBlock,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            latestX: e.clientX,
            latestY: e.clientY,
            pointerType,
            dragReady: pointerType === 'mouse',
            longPressReady: false,
            isIntercepting: !shouldDeferInterception,
            timeoutId,
            dragTimeoutId,
            sourceHandle: handle,
            sourceHandleDraggableAttr,
            anchorStartLineNumber,
            anchorEndLineNumber,
            currentLineNumber: anchorEndLineNumber,
            committedRangesSnapshot,
            selectionRanges: initialRanges,
        };
        this.attachPointerListeners();
        this.emitLifecycle({
            state: 'press_pending',
            sourceBlock: blockInfo,
            targetLine: null,
            listIntent: null,
            rejectReason: null,
            pointerType,
        });
    }

    private activateMouseRangeSelectInterception(state: MouseRangeSelectState): void {
        this.tryCapturePointerById(state.pointerId);
        if (state.isIntercepting) return;
        state.isIntercepting = true;
        if (state.sourceHandle) {
            state.sourceHandle.setAttribute('draggable', 'false');
        }
    }

    private startPointerPressDrag(
        blockInfo: BlockInfo,
        e: PointerEvent,
        options?: { skipLongPress?: boolean }
    ): void {
        const pointerType = e.pointerType || null;
        e.preventDefault();
        e.stopPropagation();
        this.tryCapturePointer(e);
        if (pointerType !== 'mouse') {
            this.lockMobileInteraction();
            this.attachFocusGuard();
            this.suppressMobileKeyboard();
        }
        const skipLongPress = options?.skipLongPress === true;
        const longPressMs = pointerType === 'mouse'
            ? MOUSE_RANGE_SELECT_LONG_PRESS_MS
            : MOBILE_DRAG_LONG_PRESS_MS;
        const timeoutId = skipLongPress
            ? null
            : window.setTimeout(() => {
                const state = this.pointerPressState;
                if (!state || state.pointerId !== e.pointerId) return;
                state.longPressReady = true;
            }, longPressMs);
        const startMoveThresholdPx = skipLongPress
            ? 2
            : (pointerType === 'mouse' ? 4 : MOBILE_DRAG_START_MOVE_THRESHOLD_PX);

        this.pointerPressState = {
            sourceBlock: blockInfo,
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
        this.attachPointerListeners();
        this.emitLifecycle({
            state: 'press_pending',
            sourceBlock: blockInfo,
            targetLine: null,
            listIntent: null,
            rejectReason: null,
            pointerType,
        });
    }

    private clearPointerPressState(): void {
        const state = this.pointerPressState;
        if (!state) return;
        if (state.timeoutId !== null) {
            window.clearTimeout(state.timeoutId);
        }
        this.pointerPressState = null;
    }

    private clearMouseRangeSelectState(options?: { preserveVisual?: boolean }): void {
        const state = this.mouseRangeSelectState;
        if (!state) return;
        if (state.timeoutId !== null) {
            window.clearTimeout(state.timeoutId);
        }
        if (state.dragTimeoutId !== null) {
            window.clearTimeout(state.dragTimeoutId);
        }
        if (state.sourceHandle && state.sourceHandle.isConnected) {
            if (state.sourceHandleDraggableAttr === null) {
                state.sourceHandle.removeAttribute('draggable');
            } else {
                state.sourceHandle.setAttribute('draggable', state.sourceHandleDraggableAttr);
            }
        }
        this.mouseRangeSelectState = null;
        if (!options?.preserveVisual) {
            if (this.committedRangeSelection) {
                this.renderRangeSelectionVisual(
                    this.committedRangeSelection.ranges
                );
            } else {
                this.clearRangeSelectionVisual();
            }
        }
    }

    private buildBlockInfoFromLineRange(startLineNumber: number, endLineNumber: number, template: BlockInfo): BlockInfo {
        const doc = this.view.state.doc;
        const safeStart = Math.max(1, Math.min(doc.lines, startLineNumber));
        const safeEnd = Math.max(safeStart, Math.min(doc.lines, endLineNumber));
        const startLine = doc.line(safeStart);
        const endLine = doc.line(safeEnd);
        return {
            type: template.type,
            startLine: safeStart - 1,
            endLine: safeEnd - 1,
            from: startLine.from,
            to: endLine.to,
            indentLevel: template.indentLevel,
            content: doc.sliceString(startLine.from, endLine.to),
        };
    }

    private buildDragSourceFromLineRanges(ranges: LineRange[], template: BlockInfo): BlockInfo {
        const normalizedRanges = this.mergeLineRanges(ranges);
        if (normalizedRanges.length === 0) {
            return this.buildBlockInfoFromLineRange(template.startLine + 1, template.endLine + 1, template);
        }
        if (normalizedRanges.length === 1) {
            const range = normalizedRanges[0];
            return this.buildBlockInfoFromLineRange(range.startLineNumber, range.endLineNumber, template);
        }

        const doc = this.view.state.doc;
        const firstRange = normalizedRanges[0];
        const lastRange = normalizedRanges[normalizedRanges.length - 1];
        const firstLine = doc.line(firstRange.startLineNumber);
        const lastLine = doc.line(lastRange.endLineNumber);
        const content = normalizedRanges.map((range) => {
            const startLine = doc.line(range.startLineNumber);
            const endLine = doc.line(range.endLineNumber);
            const from = startLine.from;
            const to = Math.min(endLine.to + 1, doc.length);
            return doc.sliceString(from, to);
        }).join('');

        return {
            type: template.type,
            startLine: firstRange.startLineNumber - 1,
            endLine: lastRange.endLineNumber - 1,
            from: firstLine.from,
            to: lastLine.to,
            indentLevel: template.indentLevel,
            content,
            compositeSelection: {
                ranges: normalizedRanges.map((range) => ({
                    startLine: range.startLineNumber - 1,
                    endLine: range.endLineNumber - 1,
                })),
            },
        };
    }

    private normalizeLineRange(startLineNumber: number, endLineNumber: number): LineRange {
        const docLines = this.view.state.doc.lines;
        const safeStart = Math.max(1, Math.min(docLines, Math.min(startLineNumber, endLineNumber)));
        const safeEnd = Math.max(1, Math.min(docLines, Math.max(startLineNumber, endLineNumber)));
        return {
            startLineNumber: safeStart,
            endLineNumber: safeEnd,
        };
    }

    private mergeLineRanges(ranges: LineRange[]): LineRange[] {
        const normalized = ranges
            .map((range) => this.normalizeLineRange(range.startLineNumber, range.endLineNumber))
            .sort((a, b) => a.startLineNumber - b.startLineNumber);
        const merged: LineRange[] = [];
        for (const range of normalized) {
            const last = merged[merged.length - 1];
            if (!last || range.startLineNumber > last.endLineNumber + 1) {
                merged.push({ ...range });
                continue;
            }
            if (range.endLineNumber > last.endLineNumber) {
                last.endLineNumber = range.endLineNumber;
            }
        }
        return merged;
    }

    private cloneLineRanges(ranges: LineRange[]): LineRange[] {
        return ranges.map((range) => ({ ...range }));
    }

    private cloneBlockInfo(block: BlockInfo): BlockInfo {
        return {
            ...block,
            compositeSelection: block.compositeSelection
                ? {
                    ranges: block.compositeSelection.ranges.map((range) => ({ ...range })),
                }
                : undefined,
        };
    }

    private beginPointerDrag(
        sourceBlock: BlockInfo,
        pointerId: number,
        clientX: number,
        clientY: number,
        pointerType: string | null
    ): void {
        if (this.isMobileEnvironment()) {
            this.lockMobileInteraction();
            this.attachFocusGuard();
            this.suppressMobileKeyboard();
            this.triggerMobileHapticFeedback();
        }
        this.tryCapturePointerById(pointerId);
        this.attachPointerListeners();
        this.pointerDragState = { sourceBlock, pointerId };
        this.deps.beginPointerDragSession(sourceBlock);
        this.deps.scheduleDropIndicatorUpdate(clientX, clientY, sourceBlock, pointerType);
        this.emitLifecycle({
            state: 'drag_active',
            sourceBlock,
            targetLine: null,
            listIntent: null,
            rejectReason: null,
            pointerType,
        });
    }

    private attachPointerListeners(): void {
        if (this.pointerListenersAttached) return;
        document.addEventListener('pointermove', this.onPointerMove, { passive: false });
        document.addEventListener('pointerup', this.onPointerUp, { passive: false });
        document.addEventListener('pointercancel', this.onPointerCancel, { passive: false });
        window.addEventListener('pointermove', this.onPointerMove, { passive: false, capture: true });
        window.addEventListener('pointerup', this.onPointerUp, { passive: false, capture: true });
        window.addEventListener('pointercancel', this.onPointerCancel, { passive: false, capture: true });
        window.addEventListener('blur', this.onWindowBlur);
        document.addEventListener('visibilitychange', this.onDocumentVisibilityChange);
        this.attachTouchBlocker();
        this.pointerListenersAttached = true;
    }

    private detachPointerListeners(): void {
        if (!this.pointerListenersAttached) return;
        document.removeEventListener('pointermove', this.onPointerMove);
        document.removeEventListener('pointerup', this.onPointerUp);
        document.removeEventListener('pointercancel', this.onPointerCancel);
        window.removeEventListener('pointermove', this.onPointerMove, true);
        window.removeEventListener('pointerup', this.onPointerUp, true);
        window.removeEventListener('pointercancel', this.onPointerCancel, true);
        window.removeEventListener('blur', this.onWindowBlur);
        document.removeEventListener('visibilitychange', this.onDocumentVisibilityChange);
        this.detachTouchBlocker();
        this.pointerListenersAttached = false;
    }

    private handlePointerMove(e: PointerEvent): void {
        const dragState = this.pointerDragState;
        if (dragState && e.pointerId === dragState.pointerId) {
            e.preventDefault();
            e.stopPropagation();
            this.deps.scheduleDropIndicatorUpdate(e.clientX, e.clientY, dragState.sourceBlock, e.pointerType || null);
            return;
        }

        const mouseRangeSelectState = this.mouseRangeSelectState;
        if (mouseRangeSelectState && e.pointerId === mouseRangeSelectState.pointerId) {
            this.handleMouseRangeSelectPointerMove(e, mouseRangeSelectState);
            return;
        }

        const pressState = this.pointerPressState;
        if (!pressState || e.pointerId !== pressState.pointerId) return;

        pressState.latestX = e.clientX;
        pressState.latestY = e.clientY;

        const dx = e.clientX - pressState.startX;
        const dy = e.clientY - pressState.startY;
        const distance = Math.hypot(dx, dy);

        if (!pressState.longPressReady) {
            if (distance > pressState.cancelMoveThresholdPx) {
                this.abortPointerSession({
                    shouldFinishDragSession: false,
                    shouldHideDropIndicator: false,
                    cancelReason: 'press_cancelled',
                    pointerType: e.pointerType || null,
                });
            }
            return;
        }

        if (distance < pressState.startMoveThresholdPx) return;

        e.preventDefault();
        e.stopPropagation();
        const sourceBlock = pressState.sourceBlock;
        const pointerId = pressState.pointerId;
        this.clearCommittedRangeSelection();
        this.clearPointerPressState();
        this.beginPointerDrag(sourceBlock, pointerId, e.clientX, e.clientY, e.pointerType || null);
    }

    private handleMouseRangeSelectPointerMove(e: PointerEvent, state: MouseRangeSelectState): void {
        state.latestX = e.clientX;
        state.latestY = e.clientY;
        const pointerType = state.pointerType ?? (e.pointerType || null);
        const distance = Math.hypot(e.clientX - state.startX, e.clientY - state.startY);

        if (!state.longPressReady) {
            if (pointerType === 'mouse') {
                if (distance > MOUSE_RANGE_SELECT_CANCEL_MOVE_THRESHOLD_PX) {
                    this.abortPointerSession({
                        shouldFinishDragSession: false,
                        shouldHideDropIndicator: false,
                        cancelReason: 'press_cancelled',
                        pointerType,
                    });
                }
            } else {
                if (!state.dragReady) {
                    if (distance > MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX) {
                        this.abortPointerSession({
                            shouldFinishDragSession: false,
                            shouldHideDropIndicator: false,
                            cancelReason: 'press_cancelled',
                            pointerType,
                        });
                    }
                    return;
                }
                if (distance >= MOBILE_DRAG_START_MOVE_THRESHOLD_PX) {
                    e.preventDefault();
                    e.stopPropagation();
                    const sourceBlock = state.dragSourceBlock;
                    const pointerId = state.pointerId;
                    this.clearCommittedRangeSelection();
                    this.clearMouseRangeSelectState();
                    this.beginPointerDrag(sourceBlock, pointerId, e.clientX, e.clientY, pointerType);
                }
            }
            return;
        }

        this.activateMouseRangeSelectInterception(state);
        e.preventDefault();
        e.stopPropagation();

        const targetBoundary = this.resolveTargetBoundaryForRangeSelection(e.clientX, e.clientY);
        if (targetBoundary) {
            this.updateMouseRangeSelection(state, targetBoundary);
        }

        this.maybeAutoScrollRangeSelection(e.clientY);
    }

    private maybeAutoScrollRangeSelection(clientY: number): void {
        const scroller = ((this.view as any).scrollDOM as HTMLElement | undefined)
            ?? (this.view.dom.querySelector('.cm-scroller') as HTMLElement | null)
            ?? null;
        if (!scroller) return;

        const rect = scroller.getBoundingClientRect();
        const edgeZone = 44;
        let delta = 0;
        if (clientY < rect.top + edgeZone) {
            delta = -Math.min(22, ((rect.top + edgeZone) - clientY) * 0.35 + 2);
        } else if (clientY > rect.bottom - edgeZone) {
            delta = Math.min(22, (clientY - (rect.bottom - edgeZone)) * 0.35 + 2);
        }
        if (delta === 0) return;
        scroller.scrollTop += delta;
    }

    private resolveLineNumberForRangeSelection(clientY: number): number | null {
        const doc = this.view.state.doc;
        if (doc.lines <= 0) return null;
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        if (clientY <= contentRect.top) return 1;
        if (clientY >= contentRect.bottom) return doc.lines;

        const probeXs = [
            contentRect.left + 40,
            contentRect.left + 96,
            contentRect.left + Math.max(12, Math.min(160, contentRect.width / 2)),
        ].map((x) => Math.max(contentRect.left + 2, Math.min(contentRect.right - 2, x)));
        for (const x of probeXs) {
            let pos: number | null = null;
            try {
                pos = this.view.posAtCoords({ x, y: clientY });
            } catch {
                pos = null;
            }
            if (pos !== null) {
                const lineNumber = doc.lineAt(pos).number;
                return Math.max(1, Math.min(doc.lines, lineNumber));
            }
        }

        const lineEl = this.getLineElementAtY(clientY);
        if (lineEl && typeof this.view.posAtDOM === 'function') {
            try {
                const pos = this.view.posAtDOM(lineEl, 0);
                const lineNumber = doc.lineAt(pos).number;
                return Math.max(1, Math.min(doc.lines, lineNumber));
            } catch {
                // ignore DOM-pos mapping failures and fall through
            }
        }
        return null;
    }

    private updateMouseRangeSelectionFromLine(state: MouseRangeSelectState, lineNumber: number): void {
        const doc = this.view.state.doc;
        const clampedLine = Math.max(1, Math.min(doc.lines, lineNumber));
        const boundary = this.resolveBlockBoundaryAtLine(clampedLine);
        this.updateMouseRangeSelection(state, {
            ...boundary,
            representativeLineNumber: clampedLine,
        });
    }

    private updateMouseRangeSelection(state: MouseRangeSelectState, target: RangeSelectionBoundary): void {
        state.currentLineNumber = target.representativeLineNumber;
        const {
            startLineNumber: rangeStartLineNumber,
            endLineNumber: rangeEndLineNumber,
        } = this.resolveBlockAlignedLineRange(
            state.anchorStartLineNumber,
            state.anchorEndLineNumber,
            target.startLineNumber,
            target.endLineNumber
        );

        const activeRange = this.normalizeLineRange(rangeStartLineNumber, rangeEndLineNumber);
        state.selectionRanges = this.mergeLineRanges([
            ...state.committedRangesSnapshot,
            activeRange,
        ]);
        state.selectedBlock = this.buildDragSourceFromLineRanges(
            state.selectionRanges,
            state.sourceBlock
        );

        this.renderRangeSelectionVisual(state.selectionRanges);
    }

    private resolveBlockAlignedLineRange(
        anchorStartLineNumber: number,
        anchorEndLineNumber: number,
        targetBlockStartLineNumber: number,
        targetBlockEndLineNumber: number
    ): { startLineNumber: number; endLineNumber: number } {
        const docLines = this.view.state.doc.lines;
        let startLineNumber = Math.max(1, Math.min(docLines, Math.min(anchorStartLineNumber, targetBlockStartLineNumber)));
        let endLineNumber = Math.max(1, Math.min(docLines, Math.max(anchorEndLineNumber, targetBlockEndLineNumber)));

        let changed = true;
        while (changed) {
            changed = false;
            let cursor = startLineNumber;
            while (cursor <= endLineNumber) {
                const boundary = this.resolveBlockBoundaryAtLine(cursor);
                if (boundary.startLineNumber < startLineNumber) {
                    startLineNumber = boundary.startLineNumber;
                    changed = true;
                }
                if (boundary.endLineNumber > endLineNumber) {
                    endLineNumber = boundary.endLineNumber;
                    changed = true;
                }
                cursor = Math.max(cursor + 1, boundary.endLineNumber + 1);
            }
        }

        return { startLineNumber, endLineNumber };
    }

    private resolveTargetBoundaryForRangeSelection(clientX: number, clientY: number): RangeSelectionBoundary | null {
        const doc = this.view.state.doc;
        if (doc.lines <= 0) return null;
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const lineHeight = Math.max(12, Number((this.view as any).defaultLineHeight ?? 20));

        const probeXs = [
            clientX,
            contentRect.left + 6,
            contentRect.left + 40,
            contentRect.left + Math.max(18, Math.min(180, contentRect.width * 0.4)),
        ].map((x) => Math.max(contentRect.left + 2, Math.min(contentRect.right - 2, x)));
        const probeYs = [
            clientY,
            clientY - lineHeight * 0.6,
            clientY + lineHeight * 0.6,
            clientY - lineHeight * 1.2,
            clientY + lineHeight * 1.2,
        ].map((y) => Math.max(contentRect.top + 1, Math.min(contentRect.bottom - 1, y)));

        for (const y of probeYs) {
            const domBoundary = this.resolveDomHitBoundaryForRangeSelection(probeXs, y);
            if (domBoundary) {
                return domBoundary;
            }
            for (const x of probeXs) {
                let block: BlockInfo | null = null;
                try {
                    block = this.deps.getBlockInfoAtPoint(x, y);
                } catch {
                    block = null;
                }
                if (!block) continue;
                const startLineNumber = Math.max(1, Math.min(doc.lines, block.startLine + 1));
                const endLineNumber = Math.max(1, Math.min(doc.lines, block.endLine + 1));
                const representativeLineNumber = Math.max(
                    startLineNumber,
                    Math.min(endLineNumber, doc.lineAt(block.from).number)
                );
                return {
                    startLineNumber,
                    endLineNumber,
                    representativeLineNumber,
                };
            }
        }

        const fallbackLineNumber = this.resolveLineNumberForRangeSelection(clientY);
        if (fallbackLineNumber === null) return null;
        const fallbackBoundary = this.resolveBlockBoundaryAtLine(fallbackLineNumber);
        return {
            ...fallbackBoundary,
            representativeLineNumber: fallbackLineNumber,
        };
    }

    private resolveDomHitBoundaryForRangeSelection(probeXs: number[], clientY: number): RangeSelectionBoundary | null {
        if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
            return null;
        }

        for (const x of probeXs) {
            const hit = document.elementFromPoint(x, clientY) as HTMLElement | null;
            if (!hit || !this.view.dom.contains(hit)) continue;

            const candidates: Node[] = [];
            const pushCandidate = (candidate: Element | null): void => {
                if (!candidate) return;
                if (!candidates.includes(candidate)) {
                    candidates.push(candidate);
                }
            };

            pushCandidate(hit.closest('.cm-line'));
            pushCandidate(hit.closest('.cm-embed-block'));
            pushCandidate(hit.closest(EMBED_BLOCK_SELECTOR));

            for (const candidate of candidates) {
                const lineNumber = this.resolveLineNumberFromDomNode(candidate);
                if (lineNumber === null) continue;
                const boundary = this.resolveBlockBoundaryAtLine(lineNumber);
                return {
                    ...boundary,
                    representativeLineNumber: lineNumber,
                };
            }
        }

        return null;
    }

    private resolveLineNumberFromDomNode(node: Node): number | null {
        if (typeof this.view.posAtDOM !== 'function') return null;
        const doc = this.view.state.doc;
        const probes: Node[] = [node];
        if (node instanceof Element && node.firstChild) {
            probes.push(node.firstChild);
        }

        for (const probe of probes) {
            try {
                const pos = this.view.posAtDOM(probe, 0);
                const lineNumber = doc.lineAt(pos).number;
                return Math.max(1, Math.min(doc.lines, lineNumber));
            } catch {
                // ignore DOM-pos mapping failures and try next probe
            }
        }

        return null;
    }

    private resolveBlockBoundaryAtLine(lineNumber: number): { startLineNumber: number; endLineNumber: number } {
        const doc = this.view.state.doc;
        const clampedLine = Math.max(1, Math.min(doc.lines, lineNumber));
        const block = detectBlock(this.view.state as any, clampedLine);
        if (!block) {
            return {
                startLineNumber: clampedLine,
                endLineNumber: clampedLine,
            };
        }
        return {
            startLineNumber: Math.max(1, block.startLine + 1),
            endLineNumber: Math.min(doc.lines, block.endLine + 1),
        };
    }

    private renderRangeSelectionVisual(ranges: LineRange[]): void {
        const normalizedRanges = this.mergeLineRanges(ranges);
        const nextLineElements = new Set<HTMLElement>();
        const nextLineNumberElements = new Set<HTMLElement>();
        const nextHandleElements = new Set<HTMLElement>();
        const doc = this.view.state.doc;
        const visibleRanges = this.view.visibleRanges ?? [{ from: 0, to: doc.length }];
        for (const range of visibleRanges) {
            let pos = range.from;
            while (pos <= range.to) {
                const line = doc.lineAt(pos);
                const lineNumber = line.number;
                if (this.isLineNumberInRanges(lineNumber, normalizedRanges)) {
                    const lineEl = this.getLineElementForLine(lineNumber);
                    if (lineEl) {
                        nextLineElements.add(lineEl);
                    }
                    const lineNumberEl = getLineNumberElementForLine(this.view, lineNumber);
                    if (lineNumberEl) {
                        nextLineNumberElements.add(lineNumberEl);
                    }
                    const handleEl = this.getInlineHandleForLine(lineNumber);
                    if (handleEl) {
                        nextHandleElements.add(handleEl);
                    }
                }
                pos = line.to + 1;
            }
        }
        this.syncSelectionElements(
            this.rangeSelectedLineElements,
            nextLineElements,
            RANGE_SELECTED_LINE_CLASS
        );
        this.syncSelectionElements(
            this.rangeSelectedLineNumberElements,
            nextLineNumberElements,
            RANGE_SELECTED_LINE_NUMBER_HIDDEN_CLASS
        );
        this.syncSelectionElements(
            this.rangeSelectedHandleElements,
            nextHandleElements,
            RANGE_SELECTED_HANDLE_CLASS
        );
        this.updateRangeSelectionLinks(normalizedRanges);
    }

    private isLineNumberInRanges(lineNumber: number, ranges: LineRange[]): boolean {
        for (const range of ranges) {
            if (lineNumber >= range.startLineNumber && lineNumber <= range.endLineNumber) {
                return true;
            }
        }
        return false;
    }

    private syncSelectionElements(
        current: Set<HTMLElement>,
        next: Set<HTMLElement>,
        className: string
    ): void {
        for (const el of current) {
            if (next.has(el)) continue;
            el.classList.remove(className);
        }
        for (const el of next) {
            if (current.has(el)) continue;
            el.classList.add(className);
        }
        current.clear();
        for (const el of next) {
            current.add(el);
        }
    }

    private clearRangeSelectionVisual(): void {
        for (const lineEl of this.rangeSelectedLineElements) {
            lineEl.classList.remove(RANGE_SELECTED_LINE_CLASS);
        }
        this.rangeSelectedLineElements.clear();

        for (const lineNumberEl of this.rangeSelectedLineNumberElements) {
            lineNumberEl.classList.remove(RANGE_SELECTED_LINE_NUMBER_HIDDEN_CLASS);
        }
        this.rangeSelectedLineNumberElements.clear();

        for (const handleEl of this.rangeSelectedHandleElements) {
            handleEl.classList.remove(RANGE_SELECTED_HANDLE_CLASS);
        }
        this.rangeSelectedHandleElements.clear();

        for (const link of this.rangeSelectionLinkEls) {
            link.style.opacity = '0';
            link.style.pointerEvents = 'none';
        }
    }

    private commitRangeSelection(state: MouseRangeSelectState): void {
        const committedRanges = this.mergeLineRanges(state.selectionRanges);
        const committedBlock = this.buildDragSourceFromLineRanges(committedRanges, state.sourceBlock);
        this.committedRangeSelection = {
            selectedBlock: committedBlock,
            ranges: committedRanges,
        };
        this.renderRangeSelectionVisual(committedRanges);
    }

    private clearCommittedRangeSelection(): void {
        if (!this.committedRangeSelection) return;
        this.committedRangeSelection = null;
        this.clearRangeSelectionVisual();
    }

    private getCommittedSelectionBlock(): BlockInfo | null {
        if (!this.committedRangeSelection) return null;
        return this.cloneBlockInfo(this.committedRangeSelection.selectedBlock);
    }

    private refreshRangeSelectionVisual(): void {
        if (this.mouseRangeSelectState) {
            this.renderRangeSelectionVisual(this.mouseRangeSelectState.selectionRanges);
            return;
        }
        if (this.committedRangeSelection) {
            this.renderRangeSelectionVisual(this.committedRangeSelection.ranges);
        }
    }

    private finishRangeSelectionSession(): void {
        this.clearMouseRangeSelectState({ preserveVisual: true });
        this.detachPointerListeners();
        this.releasePointerCapture();
        this.unlockMobileInteraction();
        this.detachFocusGuard();
        this.emitLifecycle({
            state: 'idle',
            sourceBlock: null,
            targetLine: null,
            listIntent: null,
            rejectReason: null,
            pointerType: null,
        });
    }

    private shouldClearCommittedSelectionOnPointerDown(
        target: HTMLElement,
        clientX: number,
        pointerType: string | null
    ): boolean {
        if (!this.committedRangeSelection) return false;
        if (target.closest(`.${RANGE_SELECTION_LINK_CLASS}`)) return false;
        if (target.closest(`.${RANGE_SELECTED_HANDLE_CLASS}`)) return false;
        if (target.closest('.dnd-drag-handle')) return false;

        if (pointerType && pointerType !== 'mouse') {
            const contentRect = this.view.contentDOM.getBoundingClientRect();
            const outsideHorizontalBlank = clientX < (contentRect.left - MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX)
                || clientX > (contentRect.right + MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX);
            if (outsideHorizontalBlank) {
                return true;
            }
            const inContent = this.view.contentDOM.contains(target) || !!target.closest('.cm-content');
            const inGutter = !!target.closest('.cm-gutters');
            return !inContent && !inGutter;
        }
        const centerX = getHandleColumnCenterX(this.view);
        return clientX > centerX + RANGE_SELECTION_GRIP_HIT_X_PADDING_PX;
    }

    private isCommittedSelectionGripHit(
        target: HTMLElement,
        clientX: number,
        clientY: number,
        pointerType: string | null
    ): boolean {
        const committedSelection = this.committedRangeSelection;
        if (!committedSelection) return false;

        const hitLink = target.closest(`.${RANGE_SELECTION_LINK_CLASS}`);
        if (hitLink) return true;

        const hitHandle = target.closest(`.${RANGE_SELECTED_HANDLE_CLASS}`);
        if (hitHandle) return true;

        if (pointerType && pointerType !== 'mouse') {
            if (!this.isWithinMobileDragHotzoneBand(clientX)) {
                return false;
            }
        } else {
            const centerX = getHandleColumnCenterX(this.view);
            if (Math.abs(clientX - centerX) > RANGE_SELECTION_GRIP_HIT_X_PADDING_PX) {
                return false;
            }
        }

        for (const range of committedSelection.ranges) {
            const startAnchorY = this.getRangeSelectionAnchorY(range.startLineNumber);
            const endAnchorY = this.getRangeSelectionAnchorY(range.endLineNumber);
            if (startAnchorY === null || endAnchorY === null) continue;
            const top = Math.min(startAnchorY, endAnchorY) - RANGE_SELECTION_GRIP_HIT_PADDING_PX;
            const bottom = Math.max(startAnchorY, endAnchorY) + RANGE_SELECTION_GRIP_HIT_PADDING_PX;
            if (clientY >= top && clientY <= bottom) {
                return true;
            }
        }
        return false;
    }

    private updateRangeSelectionLinks(ranges: LineRange[]): void {
        const editorRect = this.view.dom.getBoundingClientRect();
        const centerX = getHandleColumnCenterX(this.view);
        const left = viewportXToEditorLocalX(this.view, centerX);
        const localViewportHeight = Math.max(0, this.view.dom.clientHeight || editorRect.height);

        for (let i = 0; i < ranges.length; i++) {
            const range = ranges[i];
            const startAnchorY = this.getRangeSelectionAnchorY(range.startLineNumber);
            const endAnchorY = this.getRangeSelectionAnchorY(range.endLineNumber);
            const link = this.ensureRangeSelectionLinkEl(i);
            if (startAnchorY === null || endAnchorY === null) {
                link.style.opacity = '0';
                link.style.pointerEvents = 'none';
                continue;
            }
            const topY = Math.min(startAnchorY, endAnchorY);
            const bottomY = Math.max(startAnchorY, endAnchorY);
            const top = viewportYToEditorLocalY(this.view, topY);
            const bottom = viewportYToEditorLocalY(this.view, bottomY);
            const clampedTop = Math.max(0, Math.min(localViewportHeight, top));
            const clampedBottom = Math.max(clampedTop + 2, Math.min(localViewportHeight, bottom));
            link.style.opacity = '1';
            link.style.pointerEvents = 'auto';
            link.style.left = `${left.toFixed(2)}px`;
            link.style.top = `${clampedTop.toFixed(2)}px`;
            link.style.height = `${Math.max(2, clampedBottom - clampedTop).toFixed(2)}px`;
        }
        for (let i = ranges.length; i < this.rangeSelectionLinkEls.length; i++) {
            this.rangeSelectionLinkEls[i].style.opacity = '0';
            this.rangeSelectionLinkEls[i].style.pointerEvents = 'none';
        }
    }

    private ensureRangeSelectionLinkEl(index: number): HTMLElement {
        const existing = this.rangeSelectionLinkEls[index];
        if (existing && existing.isConnected) {
            return existing;
        }
        const link = document.createElement('div');
        link.className = RANGE_SELECTION_LINK_CLASS;
        link.style.opacity = '0';
        this.view.dom.appendChild(link);
        this.rangeSelectionLinkEls[index] = link;
        return link;
    }

    private getRangeSelectionAnchorY(lineNumber: number): number | null {
        const handle = this.getInlineHandleForLine(lineNumber);
        if (handle) {
            const rect = handle.getBoundingClientRect();
            if (rect.height > 0) {
                return rect.top + rect.height / 2;
            }
        }

        const lineNumberEl = getLineNumberElementForLine(this.view, lineNumber);
        if (lineNumberEl) {
            const rect = lineNumberEl.getBoundingClientRect();
            if (rect.height > 0) {
                return rect.top + rect.height / 2;
            }
        }

        const lineEl = this.getLineElementForLine(lineNumber);
        if (lineEl) {
            const rect = lineEl.getBoundingClientRect();
            if (rect.height > 0) {
                return rect.top + rect.height / 2;
            }
        }

        try {
            const line = this.view.state.doc.line(lineNumber);
            const coords = this.view.coordsAtPos(line.from);
            if (coords) {
                return (coords.top + coords.bottom) / 2;
            }
        } catch {
            // ignore anchor fallback errors
        }
        return null;
    }

    private getInlineHandleForLine(lineNumber: number): HTMLElement | null {
        const blockStart = lineNumber - 1;
        if (blockStart < 0) return null;
        const selector = `.dnd-drag-handle[data-block-start="${blockStart}"]`;
        const handles = Array.from(this.view.dom.querySelectorAll(selector)) as HTMLElement[];
        if (handles.length === 0) return null;
        return handles.find((handle) => !handle.classList.contains('dnd-embed-handle')) ?? handles[0] ?? null;
    }

    private getLineElementForLine(lineNumber: number): HTMLElement | null {
        if (lineNumber < 1 || lineNumber > this.view.state.doc.lines) return null;
        if (typeof this.view.domAtPos !== 'function') return null;
        try {
            const line = this.view.state.doc.line(lineNumber);
            const domAtPos = this.view.domAtPos(line.from);
            const base = domAtPos.node.nodeType === Node.TEXT_NODE
                ? domAtPos.node.parentElement
                : domAtPos.node;
            if (!(base instanceof Element)) return null;
            return (base.closest('.cm-line') as HTMLElement | null) ?? null;
        } catch {
            return null;
        }
    }

    private getLineElementAtY(clientY: number): HTMLElement | null {
        const lines = Array.from(this.view.contentDOM.querySelectorAll('.cm-line')) as HTMLElement[];
        if (lines.length === 0) return null;
        let best: HTMLElement | null = null;
        let bestDistance = Number.POSITIVE_INFINITY;
        for (const lineEl of lines) {
            const rect = lineEl.getBoundingClientRect();
            if (clientY >= rect.top && clientY <= rect.bottom) return lineEl;
            const center = (rect.top + rect.bottom) / 2;
            const distance = Math.abs(center - clientY);
            if (distance < bestDistance) {
                bestDistance = distance;
                best = lineEl;
            }
        }
        return best;
    }

    private finishPointerDrag(e: PointerEvent, shouldDrop: boolean): void {
        const state = this.pointerDragState;
        if (!state || e.pointerId !== state.pointerId) return;
        e.preventDefault();
        e.stopPropagation();
        if (shouldDrop) {
            this.deps.performDropAtPoint(state.sourceBlock, e.clientX, e.clientY, e.pointerType || null);
        }
        this.abortPointerSession({
            shouldFinishDragSession: true,
            shouldHideDropIndicator: true,
            cancelReason: shouldDrop ? null : 'pointer_cancelled',
            pointerType: e.pointerType || null,
        });
    }

    private handlePointerUp(e: PointerEvent): void {
        if (this.pointerDragState) {
            this.finishPointerDrag(e, true);
            return;
        }

        const mouseRangeSelectState = this.mouseRangeSelectState;
        if (mouseRangeSelectState && e.pointerId === mouseRangeSelectState.pointerId) {
            if (!mouseRangeSelectState.longPressReady) {
                this.abortPointerSession({
                    shouldFinishDragSession: false,
                    shouldHideDropIndicator: false,
                    cancelReason: 'press_cancelled',
                    pointerType: e.pointerType || null,
                });
                return;
            }
            e.preventDefault();
            e.stopPropagation();
            this.commitRangeSelection(mouseRangeSelectState);
            this.finishRangeSelectionSession();
            return;
        }

        const pressState = this.pointerPressState;
        if (!pressState || e.pointerId !== pressState.pointerId) return;
        this.abortPointerSession({
            shouldFinishDragSession: false,
            shouldHideDropIndicator: false,
            cancelReason: 'press_cancelled',
            pointerType: e.pointerType || null,
        });
    }

    private handlePointerCancel(e: PointerEvent): void {
        if (this.pointerDragState) {
            this.finishPointerDrag(e, false);
            return;
        }

        const mouseRangeSelectState = this.mouseRangeSelectState;
        if (mouseRangeSelectState && e.pointerId === mouseRangeSelectState.pointerId) {
            this.abortPointerSession({
                shouldFinishDragSession: false,
                shouldHideDropIndicator: false,
                cancelReason: 'pointer_cancelled',
                pointerType: e.pointerType || null,
            });
            return;
        }

        const pressState = this.pointerPressState;
        if (!pressState || e.pointerId !== pressState.pointerId) return;
        this.abortPointerSession({
            shouldFinishDragSession: false,
            shouldHideDropIndicator: false,
            cancelReason: 'pointer_cancelled',
            pointerType: e.pointerType || null,
        });
    }

    private shouldIgnoreDuplicatePointerEvent(e: PointerEvent): boolean {
        if (this.handledPointerEvents.has(e)) return true;
        this.handledPointerEvents.add(e);
        return false;
    }

    private handleLostPointerCapture(e: PointerEvent): void {
        if (!this.hasActivePointerSession()) return;
        if (this.capturedPointerId !== null && e.pointerId !== this.capturedPointerId) return;
        this.abortPointerSession({
            shouldFinishDragSession: true,
            shouldHideDropIndicator: true,
            cancelReason: 'session_interrupted',
            pointerType: e.pointerType || null,
        });
    }

    private handleWindowBlur(): void {
        if (!this.hasActivePointerSession()) return;
        this.abortPointerSession({
            shouldFinishDragSession: true,
            shouldHideDropIndicator: true,
            cancelReason: 'session_interrupted',
            pointerType: null,
        });
    }

    private handleDocumentVisibilityChange(): void {
        if (document.visibilityState !== 'hidden') return;
        if (!this.hasActivePointerSession()) return;
        this.abortPointerSession({
            shouldFinishDragSession: true,
            shouldHideDropIndicator: true,
            cancelReason: 'session_interrupted',
            pointerType: null,
        });
    }

    private handleDocumentFocusIn(e: FocusEvent): void {
        if (
            this.committedRangeSelection
            && this.isMobileEnvironment()
            && e.target instanceof HTMLElement
            && this.shouldSuppressFocusTarget(e.target)
        ) {
            this.clearCommittedRangeSelection();
        }
        if (!this.hasActivePointerSession()) return;
        this.suppressMobileKeyboard(e.target);
    }

    private handleTouchMove(e: TouchEvent): void {
        if (!this.hasActivePointerSession()) return;
        if (e.cancelable) {
            e.preventDefault();
        }
    }

    private attachTouchBlocker(): void {
        if (this.touchBlockerAttached) return;
        document.addEventListener('touchmove', this.onTouchMove, { passive: false, capture: true });
        window.addEventListener('touchmove', this.onTouchMove, { passive: false, capture: true });
        this.touchBlockerAttached = true;
    }

    private detachTouchBlocker(): void {
        if (!this.touchBlockerAttached) return;
        document.removeEventListener('touchmove', this.onTouchMove, true);
        window.removeEventListener('touchmove', this.onTouchMove, true);
        this.touchBlockerAttached = false;
    }

    private hasActivePointerSession(): boolean {
        return !!this.pointerDragState || !!this.pointerPressState || !!this.mouseRangeSelectState;
    }

    private suppressMobileKeyboard(target?: EventTarget | null): void {
        const active = (target instanceof HTMLElement ? target : (document.activeElement as HTMLElement | null));
        if (!active) return;
        if (!this.shouldSuppressFocusTarget(active)) return;

        if (typeof active.blur === 'function') {
            active.blur();
        }
        if (typeof window.getSelection === 'function') {
            try {
                window.getSelection()?.removeAllRanges();
            } catch {
                // ignore selection clear failures on limited runtimes
            }
        }
    }

    private shouldSuppressFocusTarget(target: HTMLElement): boolean {
        const isInputControl = target instanceof HTMLInputElement
            || target instanceof HTMLTextAreaElement
            || target.isContentEditable;
        const isEditorContent = target.classList.contains('cm-content')
            || !!target.closest('.cm-content');
        return isInputControl || isEditorContent;
    }

    private attachFocusGuard(): void {
        if (this.focusGuardAttached) return;
        document.addEventListener('focusin', this.onDocumentFocusIn, true);
        this.focusGuardAttached = true;
    }

    private detachFocusGuard(): void {
        if (!this.focusGuardAttached) return;
        document.removeEventListener('focusin', this.onDocumentFocusIn, true);
        this.focusGuardAttached = false;
    }

    private abortPointerSession(options?: {
        shouldFinishDragSession?: boolean;
        shouldHideDropIndicator?: boolean;
        cancelReason?: string | null;
        pointerType?: string | null;
    }): void {
        const sourceBlock = this.pointerDragState?.sourceBlock
            ?? this.pointerPressState?.sourceBlock
            ?? this.mouseRangeSelectState?.selectedBlock
            ?? null;
        const hadDrag = !!this.pointerDragState;
        const shouldFinishDragSession = options?.shouldFinishDragSession ?? hadDrag;
        const shouldHideDropIndicator = options?.shouldHideDropIndicator ?? hadDrag;
        const cancelReason = options?.cancelReason ?? null;
        const pointerType = options?.pointerType ?? null;

        this.pointerDragState = null;
        this.clearPointerPressState();
        this.clearMouseRangeSelectState();
        this.detachPointerListeners();
        this.releasePointerCapture();
        this.unlockMobileInteraction();
        this.detachFocusGuard();

        if (shouldHideDropIndicator) {
            this.deps.hideDropIndicator();
        }
        if (hadDrag && shouldFinishDragSession) {
            this.deps.finishDragSession();
        }
        if (cancelReason && sourceBlock) {
            this.emitLifecycle({
                state: 'cancelled',
                sourceBlock,
                targetLine: null,
                listIntent: null,
                rejectReason: cancelReason,
                pointerType,
            });
        }
        this.emitLifecycle({
            state: 'idle',
            sourceBlock: null,
            targetLine: null,
            listIntent: null,
            rejectReason: null,
            pointerType: null,
        });
    }

    private lockMobileInteraction(): void {
        if (this.mobileInteractionLocked) return;

        const body = document.body;
        const current = Number(body.getAttribute(MOBILE_GESTURE_LOCK_COUNT_ATTR) || '0');
        const next = current + 1;
        body.setAttribute(MOBILE_GESTURE_LOCK_COUNT_ATTR, String(next));
        body.classList.add(MOBILE_GESTURE_LOCK_BODY_CLASS);

        this.view.dom.classList.add(MOBILE_GESTURE_LOCK_EDITOR_CLASS);
        this.mobileInteractionLocked = true;
    }

    private unlockMobileInteraction(): void {
        if (!this.mobileInteractionLocked) return;

        const body = document.body;
        const current = Number(body.getAttribute(MOBILE_GESTURE_LOCK_COUNT_ATTR) || '0');
        const next = Math.max(0, current - 1);
        if (next === 0) {
            body.removeAttribute(MOBILE_GESTURE_LOCK_COUNT_ATTR);
            body.classList.remove(MOBILE_GESTURE_LOCK_BODY_CLASS);
        } else {
            body.setAttribute(MOBILE_GESTURE_LOCK_COUNT_ATTR, String(next));
        }

        this.view.dom.classList.remove(MOBILE_GESTURE_LOCK_EDITOR_CLASS);
        this.mobileInteractionLocked = false;
    }

    private tryCapturePointer(e: PointerEvent): void {
        this.releasePointerCapture();

        const candidates: Element[] = [this.view.dom];
        const target = e.target;
        if (target instanceof Element && target !== this.view.dom) {
            candidates.push(target);
        }

        for (const candidate of candidates) {
            const withPointerCapture = candidate as any;
            if (typeof withPointerCapture.setPointerCapture !== 'function') continue;
            try {
                withPointerCapture.setPointerCapture(e.pointerId);
                this.pointerCaptureTarget = candidate;
                this.capturedPointerId = e.pointerId;
                return;
            } catch {
                // try next capture target
            }
        }
    }

    private tryCapturePointerById(pointerId: number): void {
        const withPointerCapture = this.view.dom as any;
        if (typeof withPointerCapture.setPointerCapture !== 'function') return;
        try {
            withPointerCapture.setPointerCapture(pointerId);
            this.pointerCaptureTarget = this.view.dom;
            this.capturedPointerId = pointerId;
        } catch {
            // ignore capture failures on unsupported runtimes
        }
    }

    private releasePointerCapture(): void {
        if (!this.pointerCaptureTarget || this.capturedPointerId === null) return;
        const target = this.pointerCaptureTarget as any;
        if (typeof target.releasePointerCapture === 'function') {
            try {
                target.releasePointerCapture(this.capturedPointerId);
            } catch {
                // ignore capture release failures
            }
        }
        this.pointerCaptureTarget = null;
        this.capturedPointerId = null;
    }

    private triggerMobileHapticFeedback(): void {
        const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
        if (typeof nav.vibrate !== 'function') return;
        try {
            nav.vibrate(10);
        } catch {
            // ignore unsupported vibration errors
        }
    }

    private emitLifecycle(event: DragLifecycleEvent): void {
        this.deps.onDragLifecycleEvent?.(event);
    }

    private isMultiLineSelectionEnabled(): boolean {
        if (!this.deps.isMultiLineSelectionEnabled) return true;
        return this.deps.isMultiLineSelectionEnabled();
    }
}
