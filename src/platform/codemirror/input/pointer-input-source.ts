import type { EditorView } from '@codemirror/view';
import type { DraggerInputSource } from '../../../drag/runtime';
import { readPointerInput } from './pointer-hit-test';

/**
 * DOM pointer/keyboard events → normalized DraggerInputSource. Pure plumbing:
 * no drag logic, no hit-testing, no class state.
 */
export function createPointerInputSource(view: EditorView): DraggerInputSource {
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

/** Unwrap the transparent `native` passthrough field into the original PointerEvent. */
export function nativePointerEvent(value: unknown): PointerEvent | null {
    if (!value || typeof value !== 'object') return null;
    return 'pointerId' in value && 'clientX' in value && 'clientY' in value
        ? value as PointerEvent
        : null;
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
