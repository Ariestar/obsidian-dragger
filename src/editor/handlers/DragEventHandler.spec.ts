// @vitest-environment jsdom

import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { BlockInfo, BlockType } from '../../types';
import { DragEventHandler } from './DragEventHandler';

type RectLike = {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    x: number;
    y: number;
    toJSON: () => Record<string, never>;
};

const originalMatchMedia = window.matchMedia;
const originalVibrate = (navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean }).vibrate;

function createRect(left: number, top: number, width: number, height: number): RectLike {
    return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
    };
}

function createBlock(content = '- item'): BlockInfo {
    return {
        type: BlockType.ListItem,
        startLine: 0,
        endLine: 0,
        from: 0,
        to: content.length,
        indentLevel: 0,
        content,
    };
}

function createViewStub(): EditorView {
    const root = document.createElement('div');
    const content = document.createElement('div');
    root.appendChild(content);
    document.body.appendChild(root);

    Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => createRect(0, 0, 400, 200),
    });
    Object.defineProperty(content, 'getBoundingClientRect', {
        configurable: true,
        value: () => createRect(0, 0, 360, 200),
    });

    const doc = {
        lines: 1,
        line: () => ({ text: '- item', from: 0, to: 6 }),
        lineAt: () => ({ number: 1, text: '- item', from: 0, to: 6 }),
    };

    return {
        dom: root,
        contentDOM: content,
        state: { doc },
        coordsAtPos: () => ({ left: 40, right: 120, top: 0, bottom: 20 }),
    } as unknown as EditorView;
}

function dispatchPointer(
    target: EventTarget,
    type: string,
    init: { pointerId: number; pointerType: string; clientX: number; clientY: number; button?: number }
): void {
    const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
    Object.defineProperty(event, 'pointerId', { value: init.pointerId });
    Object.defineProperty(event, 'pointerType', { value: init.pointerType });
    Object.defineProperty(event, 'clientX', { value: init.clientX });
    Object.defineProperty(event, 'clientY', { value: init.clientY });
    Object.defineProperty(event, 'button', { value: init.button ?? 0 });
    target.dispatchEvent(event);
}

beforeEach(() => {
    vi.useFakeTimers();
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: vi.fn().mockImplementation((query: string) => ({
            matches: query === '(hover: none) and (pointer: coarse)',
            media: query,
            onchange: null,
            addEventListener: vi.fn(),
            removeEventListener: vi.fn(),
            addListener: vi.fn(),
            removeListener: vi.fn(),
            dispatchEvent: vi.fn(),
        })),
    });
});

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.useRealTimers();
    Object.defineProperty(window, 'matchMedia', {
        configurable: true,
        writable: true,
        value: originalMatchMedia,
    });
    Object.defineProperty(window.navigator, 'vibrate', {
        configurable: true,
        writable: true,
        value: originalVibrate,
    });
});

describe('DragEventHandler', () => {
    it('starts pointer drag from mobile long-press in left hotzone', () => {
        const view = createViewStub();
        const sourceBlock = createBlock();
        const beginPointerDragSession = vi.fn();
        const finishDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();
        const hideDropIndicator = vi.fn();
        const performDropAtPoint = vi.fn();

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => null,
            getBlockInfoAtPoint: () => sourceBlock,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession,
            scheduleDropIndicatorUpdate,
            hideDropIndicator,
            performDropAtPoint,
        });

        handler.attach();
        dispatchPointer(view.dom, 'pointerdown', {
            pointerId: 1,
            pointerType: 'touch',
            clientX: 32,
            clientY: 10,
        });
        vi.advanceTimersByTime(220);
        dispatchPointer(window, 'pointermove', {
            pointerId: 1,
            pointerType: 'touch',
            clientX: 45,
            clientY: 10,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(scheduleDropIndicatorUpdate).toHaveBeenCalledWith(45, 10, sourceBlock);

        dispatchPointer(window, 'pointerup', {
            pointerId: 1,
            pointerType: 'touch',
            clientX: 45,
            clientY: 10,
        });

        expect(performDropAtPoint).toHaveBeenCalledTimes(1);
        expect(finishDragSession).toHaveBeenCalledTimes(1);
        handler.destroy();
    });

    it('does not start drag when pointerdown is outside hotzone', () => {
        const view = createViewStub();
        const beginPointerDragSession = vi.fn();
        const performDropAtPoint = vi.fn();

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => null,
            getBlockInfoAtPoint: () => createBlock(),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate: vi.fn(),
            hideDropIndicator: vi.fn(),
            performDropAtPoint,
        });

        handler.attach();
        dispatchPointer(view.dom, 'pointerdown', {
            pointerId: 1,
            pointerType: 'touch',
            clientX: 120,
            clientY: 10,
        });
        vi.advanceTimersByTime(260);
        dispatchPointer(window, 'pointermove', {
            pointerId: 1,
            pointerType: 'touch',
            clientX: 140,
            clientY: 10,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 1,
            pointerType: 'touch',
            clientX: 140,
            clientY: 10,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        expect(performDropAtPoint).not.toHaveBeenCalled();
        handler.destroy();
    });

    it('requires long-press before starting drag from handle on mobile and triggers vibration once drag starts', () => {
        const view = createViewStub();
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        view.dom.appendChild(handle);

        const sourceBlock = createBlock();
        const beginPointerDragSession = vi.fn();
        const scheduleDropIndicatorUpdate = vi.fn();
        const vibrate = vi.fn();
        Object.defineProperty(window.navigator, 'vibrate', {
            configurable: true,
            writable: true,
            value: vibrate,
        });

        const handler = new DragEventHandler(view, {
            getDragSourceBlock: () => null,
            getBlockInfoForHandle: () => sourceBlock,
            getBlockInfoAtPoint: () => null,
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            scheduleDropIndicatorUpdate,
            hideDropIndicator: vi.fn(),
            performDropAtPoint: vi.fn(),
        });

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 2,
            pointerType: 'touch',
            clientX: 32,
            clientY: 12,
        });

        dispatchPointer(window, 'pointermove', {
            pointerId: 2,
            pointerType: 'touch',
            clientX: 42,
            clientY: 12,
        });
        expect(beginPointerDragSession).not.toHaveBeenCalled();

        vi.advanceTimersByTime(220);
        dispatchPointer(window, 'pointermove', {
            pointerId: 2,
            pointerType: 'touch',
            clientX: 45,
            clientY: 12,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(scheduleDropIndicatorUpdate).toHaveBeenCalledWith(45, 12, sourceBlock);
        expect(vibrate).toHaveBeenCalledTimes(1);
        handler.destroy();
    });
});
