import { EditorView } from '@codemirror/view';
import type { BlockSelection } from '../../../domain/selection/block-selection';

export type ActivePointerDrag = {
    sessionId: string;
    pointerId: number;
    pointerType: string | null;
    autoScrollFrameId: number | null;
};

export type PointerPressSession = {
    sessionId: string;
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
    shortPressSelectionToggle?: BlockSelection;
    selectionToggleBrush?: {
        toggledKeys: Set<string>;
    };
};

export type PointerTerminalMode = 'up' | 'cancel';

export type RangeSelectionPointerSession = import('./range-selection-gesture-state').MouseRangeSelectState;

export class PointerSession {
    private pointerListenersAttached = false;
    private touchBlockerAttached = false;
    private pointerCaptureTarget: Element | null = null;
    private capturedPointerId: number | null = null;

    private readonly onPointerMove: (e: PointerEvent) => void;
    private readonly onPointerUp: (e: PointerEvent) => void;
    private readonly onPointerCancel: (e: PointerEvent) => void;
    private readonly onWindowBlur: () => void;
    private readonly onDocumentVisibilityChange: () => void;
    private readonly onTouchMove: (e: TouchEvent) => void;

    constructor(
        private readonly view: EditorView,
        handlers: {
            onPointerMove: (e: PointerEvent) => void;
            onPointerUp: (e: PointerEvent) => void;
            onPointerCancel: (e: PointerEvent) => void;
            onWindowBlur: () => void;
            onDocumentVisibilityChange: () => void;
            onTouchMove: (e: TouchEvent) => void;
        }
    ) {
        this.onPointerMove = handlers.onPointerMove;
        this.onPointerUp = handlers.onPointerUp;
        this.onPointerCancel = handlers.onPointerCancel;
        this.onWindowBlur = handlers.onWindowBlur;
        this.onDocumentVisibilityChange = handlers.onDocumentVisibilityChange;
        this.onTouchMove = handlers.onTouchMove;
    }

    attachPointerListeners(): void {
        if (this.pointerListenersAttached) return;
        window.addEventListener('pointermove', this.onPointerMove, { passive: false, capture: true });
        window.addEventListener('pointerup', this.onPointerUp, { passive: false, capture: true });
        window.addEventListener('pointercancel', this.onPointerCancel, { passive: false, capture: true });
        window.addEventListener('blur', this.onWindowBlur);
        activeDocument.addEventListener('visibilitychange', this.onDocumentVisibilityChange);
        this.attachTouchBlocker();
        this.pointerListenersAttached = true;
    }

    detachPointerListeners(): void {
        if (!this.pointerListenersAttached) return;
        window.removeEventListener('pointermove', this.onPointerMove, true);
        window.removeEventListener('pointerup', this.onPointerUp, true);
        window.removeEventListener('pointercancel', this.onPointerCancel, true);
        window.removeEventListener('blur', this.onWindowBlur);
        activeDocument.removeEventListener('visibilitychange', this.onDocumentVisibilityChange);
        this.detachTouchBlocker();
        this.pointerListenersAttached = false;
    }

    tryCapturePointer(e: PointerEvent): void {
        this.releasePointerCapture();

        const candidates: Element[] = [this.view.dom];
        const target = e.target;
        if (target instanceof Element && target !== this.view.dom) {
            candidates.push(target);
        }

        for (const candidate of candidates) {
            if (typeof candidate.setPointerCapture !== 'function') continue;
            try {
                candidate.setPointerCapture(e.pointerId);
                this.pointerCaptureTarget = candidate;
                this.capturedPointerId = e.pointerId;
                return;
            } catch {
                // try next capture target
            }
        }
    }

    tryCapturePointerById(pointerId: number): void {
        if (typeof this.view.dom.setPointerCapture !== 'function') return;
        try {
            this.view.dom.setPointerCapture(pointerId);
            this.pointerCaptureTarget = this.view.dom;
            this.capturedPointerId = pointerId;
        } catch {
            // ignore capture failures on unsupported environments
        }
    }

    releasePointerCapture(): void {
        if (!this.pointerCaptureTarget || this.capturedPointerId === null) return;
        if (typeof this.pointerCaptureTarget.releasePointerCapture === 'function') {
            try {
                this.pointerCaptureTarget.releasePointerCapture(this.capturedPointerId);
            } catch {
                // ignore capture release failures
            }
        }
        this.pointerCaptureTarget = null;
        this.capturedPointerId = null;
    }

    private attachTouchBlocker(): void {
        if (this.touchBlockerAttached) return;
        activeDocument.addEventListener('touchmove', this.onTouchMove, { passive: false, capture: true });
        window.addEventListener('touchmove', this.onTouchMove, { passive: false, capture: true });
        this.touchBlockerAttached = true;
    }

    private detachTouchBlocker(): void {
        if (!this.touchBlockerAttached) return;
        activeDocument.removeEventListener('touchmove', this.onTouchMove, true);
        window.removeEventListener('touchmove', this.onTouchMove, true);
        this.touchBlockerAttached = false;
    }
}
