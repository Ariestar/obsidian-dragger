import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../types';

const MOBILE_DRAG_LONG_PRESS_MS = 200;
const MOBILE_DRAG_START_MOVE_THRESHOLD_PX = 8;
const MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX = 12;
const MOBILE_DRAG_HOTZONE_LEFT_PX = 24;
const MOBILE_DRAG_HOTZONE_RIGHT_PX = 8;
const MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX = 16;
const MOBILE_GESTURE_LOCK_BODY_CLASS = 'dnd-mobile-gesture-lock';
const MOBILE_GESTURE_LOCK_EDITOR_CLASS = 'dnd-mobile-gesture-lock';
const MOBILE_GESTURE_LOCK_COUNT_ATTR = 'data-dnd-mobile-lock-count';

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
    longPressReady: boolean;
    timeoutId: number | null;
};

export interface DragEventHandlerDeps {
    getDragSourceBlock: (e: DragEvent) => BlockInfo | null;
    getBlockInfoForHandle: (handle: HTMLElement) => BlockInfo | null;
    getBlockInfoAtPoint: (clientX: number, clientY: number) => BlockInfo | null;
    isBlockInsideRenderedTableCell: (blockInfo: BlockInfo) => boolean;
    beginPointerDragSession: (blockInfo: BlockInfo) => void;
    finishDragSession: () => void;
    scheduleDropIndicatorUpdate: (clientX: number, clientY: number, dragSource: BlockInfo | null) => void;
    hideDropIndicator: () => void;
    performDropAtPoint: (sourceBlock: BlockInfo, clientX: number, clientY: number) => void;
}

export class DragEventHandler {
    private pointerDragState: PointerDragState | null = null;
    private pointerPressState: PointerPressState | null = null;
    private pointerListenersAttached = false;
    private touchBlockerAttached = false;
    private focusGuardAttached = false;
    private mobileInteractionLocked = false;
    private pointerCaptureTarget: Element | null = null;
    private capturedPointerId: number | null = null;
    private readonly handledPointerEvents = new WeakSet<Event>();

    private readonly onEditorPointerDown = (e: PointerEvent) => {
        const target = e.target as HTMLElement | null;
        if (!target) return;

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

        this.startPointerPressDrag(blockInfo, e);
    };

    private readonly onEditorDragEnter = (e: DragEvent) => {
        if (!this.shouldHandleDrag(e)) return;
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
        this.deps.scheduleDropIndicatorUpdate(e.clientX, e.clientY, this.deps.getDragSourceBlock(e));
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
        this.deps.performDropAtPoint(sourceBlock, e.clientX, e.clientY);
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
    }

    startPointerDragFromHandle(handle: HTMLElement, e: PointerEvent, getBlockInfo?: () => BlockInfo | null): void {
        if (e.pointerType === 'mouse') return;
        if (this.pointerDragState || this.pointerPressState) return;

        const blockInfo = getBlockInfo ? getBlockInfo() : this.deps.getBlockInfoForHandle(handle);
        if (!blockInfo) return;
        if (this.deps.isBlockInsideRenderedTableCell(blockInfo)) return;

        if (this.isMobileEnvironment()) {
            e.preventDefault();
            e.stopPropagation();
            this.startPointerPressDrag(blockInfo, e);
            return;
        }

        e.preventDefault();
        e.stopPropagation();
        this.tryCapturePointer(e);
        this.beginPointerDrag(blockInfo, e.pointerId, e.clientX, e.clientY);
    }

    destroy(): void {
        this.abortPointerSession({ shouldFinishDragSession: true, shouldHideDropIndicator: true });

        const editorDom = this.view.dom;
        editorDom.removeEventListener('pointerdown', this.onEditorPointerDown, true);
        editorDom.removeEventListener('lostpointercapture', this.onLostPointerCapture, true);
        editorDom.removeEventListener('dragenter', this.onEditorDragEnter, true);
        editorDom.removeEventListener('dragover', this.onEditorDragOver, true);
        editorDom.removeEventListener('dragleave', this.onEditorDragLeave, true);
        editorDom.removeEventListener('drop', this.onEditorDrop, true);
    }

    private shouldHandleDrag(e: DragEvent): boolean {
        if (!e.dataTransfer) return false;
        return Array.from(e.dataTransfer.types).includes('application/dnd-block');
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
        if (this.pointerDragState || this.pointerPressState) return false;
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
        const lineStart = this.view.coordsAtPos(line.from);
        if (!lineStart) return false;

        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const hotzoneLeft = Math.max(
            contentRect.left - MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX,
            lineStart.left - MOBILE_DRAG_HOTZONE_LEFT_PX - MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX
        );
        const hotzoneRight = lineStart.left + MOBILE_DRAG_HOTZONE_RIGHT_PX;
        return clientX >= hotzoneLeft && clientX <= hotzoneRight;
    }

    private startPointerPressDrag(blockInfo: BlockInfo, e: PointerEvent): void {
        e.preventDefault();
        e.stopPropagation();
        this.tryCapturePointer(e);
        this.lockMobileInteraction();
        this.attachFocusGuard();
        this.suppressMobileKeyboard();

        const timeoutId = window.setTimeout(() => {
            const state = this.pointerPressState;
            if (!state || state.pointerId !== e.pointerId) return;
            state.longPressReady = true;
        }, MOBILE_DRAG_LONG_PRESS_MS);

        this.pointerPressState = {
            sourceBlock: blockInfo,
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            latestX: e.clientX,
            latestY: e.clientY,
            longPressReady: false,
            timeoutId,
        };
        this.attachPointerListeners();
    }

    private clearPointerPressState(): void {
        const state = this.pointerPressState;
        if (!state) return;
        if (state.timeoutId !== null) {
            window.clearTimeout(state.timeoutId);
        }
        this.pointerPressState = null;
    }

    private beginPointerDrag(sourceBlock: BlockInfo, pointerId: number, clientX: number, clientY: number): void {
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
        this.deps.scheduleDropIndicatorUpdate(clientX, clientY, sourceBlock);
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
            this.deps.scheduleDropIndicatorUpdate(e.clientX, e.clientY, dragState.sourceBlock);
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
            if (distance > MOBILE_DRAG_CANCEL_MOVE_THRESHOLD_PX) {
                this.abortPointerSession({
                    shouldFinishDragSession: false,
                    shouldHideDropIndicator: false,
                });
            }
            return;
        }

        if (distance < MOBILE_DRAG_START_MOVE_THRESHOLD_PX) return;

        e.preventDefault();
        e.stopPropagation();
        const sourceBlock = pressState.sourceBlock;
        const pointerId = pressState.pointerId;
        this.clearPointerPressState();
        this.beginPointerDrag(sourceBlock, pointerId, e.clientX, e.clientY);
    }

    private finishPointerDrag(e: PointerEvent, shouldDrop: boolean): void {
        const state = this.pointerDragState;
        if (!state || e.pointerId !== state.pointerId) return;
        e.preventDefault();
        e.stopPropagation();
        if (shouldDrop) {
            this.deps.performDropAtPoint(state.sourceBlock, e.clientX, e.clientY);
        }
        this.abortPointerSession({
            shouldFinishDragSession: true,
            shouldHideDropIndicator: true,
        });
    }

    private handlePointerUp(e: PointerEvent): void {
        if (this.pointerDragState) {
            this.finishPointerDrag(e, true);
            return;
        }

        const pressState = this.pointerPressState;
        if (!pressState || e.pointerId !== pressState.pointerId) return;
        this.abortPointerSession({
            shouldFinishDragSession: false,
            shouldHideDropIndicator: false,
        });
    }

    private handlePointerCancel(e: PointerEvent): void {
        if (this.pointerDragState) {
            this.finishPointerDrag(e, false);
            return;
        }

        const pressState = this.pointerPressState;
        if (!pressState || e.pointerId !== pressState.pointerId) return;
        this.abortPointerSession({
            shouldFinishDragSession: false,
            shouldHideDropIndicator: false,
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
        });
    }

    private handleWindowBlur(): void {
        if (!this.hasActivePointerSession()) return;
        this.abortPointerSession({
            shouldFinishDragSession: true,
            shouldHideDropIndicator: true,
        });
    }

    private handleDocumentVisibilityChange(): void {
        if (document.visibilityState !== 'hidden') return;
        if (!this.hasActivePointerSession()) return;
        this.abortPointerSession({
            shouldFinishDragSession: true,
            shouldHideDropIndicator: true,
        });
    }

    private handleDocumentFocusIn(e: FocusEvent): void {
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
        return !!this.pointerDragState || !!this.pointerPressState;
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
    }): void {
        const hadDrag = !!this.pointerDragState;
        const shouldFinishDragSession = options?.shouldFinishDragSession ?? hadDrag;
        const shouldHideDropIndicator = options?.shouldHideDropIndicator ?? hadDrag;

        this.pointerDragState = null;
        this.clearPointerPressState();
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
}
