import { EditorView } from '@codemirror/view';

export class PointerSessionController {
    private pointerListenersAttached = false;
    private touchBlockerAttached = false;
    private pointerCaptureTarget: Element | null = null;
    private capturedPointerId: number | null = null;
    private readonly handledPointerEvents = new WeakSet<Event>();

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

    shouldIgnoreDuplicatePointerEvent(e: PointerEvent): boolean {
        if (this.handledPointerEvents.has(e)) return true;
        this.handledPointerEvents.add(e);
        return false;
    }

    attachPointerListeners(): void {
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

    detachPointerListeners(): void {
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

    tryCapturePointer(e: PointerEvent): void {
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

    tryCapturePointerById(pointerId: number): void {
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

    releasePointerCapture(): void {
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
}
