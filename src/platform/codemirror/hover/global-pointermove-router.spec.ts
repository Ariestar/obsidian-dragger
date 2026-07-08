// @vitest-environment jsdom

import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    registerGlobalPointerMoveClient,
    resetGlobalPointerMoveRouterForTests,
    unregisterGlobalPointerMoveClient,
} from './global-pointermove-router';

function createViewRoot(left: number): EditorView {
    const root = document.createElement('div');
    const child = document.createElement('div');
    root.appendChild(child);
    document.body.appendChild(root);

    Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
            left,
            top: 0,
            right: left + 120,
            bottom: 120,
            width: 120,
            height: 120,
            x: left,
            y: 0,
            toJSON: () => ({}),
        }),
    });

    return {
        dom: root,
    } as unknown as EditorView;
}

function dispatchPointerMove(target: EventTarget, clientX: number, clientY: number): PointerEvent {
    const event = new Event('pointermove', { bubbles: true, cancelable: true }) as PointerEvent;
    Object.defineProperty(event, 'clientX', { value: clientX });
    Object.defineProperty(event, 'clientY', { value: clientY });
    target.dispatchEvent(event);
    return event;
}

afterEach(() => {
    resetGlobalPointerMoveRouterForTests();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('globalPointerMoveRouter', () => {
    it('registers a single document pointermove listener for multiple views', () => {
        const addEventListenerSpy = vi.spyOn(document, 'addEventListener');
        const removeEventListenerSpy = vi.spyOn(document, 'removeEventListener');
        const viewA = createViewRoot(0);
        const viewB = createViewRoot(200);

        const clientA = {
            view: viewA,
            onPointerMove: vi.fn(),
            clearPointerHover: vi.fn(),
        };
        const clientB = {
            view: viewB,
            onPointerMove: vi.fn(),
            clearPointerHover: vi.fn(),
        };

        registerGlobalPointerMoveClient(clientA);
        registerGlobalPointerMoveClient(clientB);

        expect(addEventListenerSpy).toHaveBeenCalledTimes(1);
        expect(addEventListenerSpy).toHaveBeenCalledWith('pointermove', expect.any(Function), { passive: true });

        unregisterGlobalPointerMoveClient(clientA);
        expect(removeEventListenerSpy).not.toHaveBeenCalled();

        unregisterGlobalPointerMoveClient(clientB);
        expect(removeEventListenerSpy).toHaveBeenCalledTimes(1);
        expect(removeEventListenerSpy).toHaveBeenCalledWith('pointermove', expect.any(Function));
    });

    it('routes pointermove to the current view and clears the previous view on switch', () => {
        const viewA = createViewRoot(0);
        const viewB = createViewRoot(200);
        const childA = viewA.dom.firstElementChild as HTMLElement;
        const childB = viewB.dom.firstElementChild as HTMLElement;
        const outside = document.createElement('div');
        document.body.appendChild(outside);

        const clientA = {
            view: viewA,
            onPointerMove: vi.fn(),
            clearPointerHover: vi.fn(),
        };
        const clientB = {
            view: viewB,
            onPointerMove: vi.fn(),
            clearPointerHover: vi.fn(),
        };

        registerGlobalPointerMoveClient(clientA);
        registerGlobalPointerMoveClient(clientB);

        dispatchPointerMove(childA, 20, 20);
        expect(clientA.onPointerMove).toHaveBeenCalledTimes(1);
        expect(clientB.onPointerMove).not.toHaveBeenCalled();
        expect(clientA.clearPointerHover).not.toHaveBeenCalled();

        dispatchPointerMove(childB, 220, 20);
        expect(clientA.clearPointerHover).toHaveBeenCalledTimes(1);
        expect(clientB.onPointerMove).toHaveBeenCalledTimes(1);

        dispatchPointerMove(outside, 500, 20);
        expect(clientB.clearPointerHover).toHaveBeenCalledTimes(1);
    });
});
