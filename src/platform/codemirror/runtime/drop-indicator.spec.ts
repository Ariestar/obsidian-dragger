// @vitest-environment jsdom

import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DropIndicatorManager } from './drop-indicator';
import { HIDDEN_CLASS } from '../../../shared/dom-selectors';

function createViewStub(): EditorView {
    const root = document.createElement('div');
    const content = document.createElement('div');
    root.appendChild(content);
    document.body.appendChild(root);
    Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left: 0, top: 0, right: 400, bottom: 200, width: 400, height: 200 }),
    });
    Object.defineProperty(content, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({ left: 0, top: 0, right: 380, bottom: 180, width: 380, height: 180 }),
    });
    return {
        dom: root,
        contentDOM: content,
    } as unknown as EditorView;
}

function dropResult(targetLineNumber: number, preview: { indicatorY: number; lineRect?: { left: number; width: number }; highlightRect?: { top: number; left: number; width: number; height: number } }) {
    return {
        target: {
            targetLineNumber,
            placement: 'before',
        },
        preview,
    } as const;
}

function setupAnimationFrameQueue(): FrameRequestCallback[] {
    const queuedFrames: FrameRequestCallback[] = [];
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation((cb: FrameRequestCallback) => {
        queuedFrames.push(cb);
        return queuedFrames.length;
    });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => { });
    vi.spyOn(window, 'getComputedStyle').mockReturnValue({ paddingRight: '0' } as CSSStyleDeclaration);
    return queuedFrames;
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

describe('DropIndicatorManager', () => {
    it('renders a precomputed drop result without resolving drop', () => {
        const view = createViewStub();
        const onFrameMetrics = vi.fn();
        const queuedFrames = setupAnimationFrameQueue();
        const manager = new DropIndicatorManager(view, { onFrameMetrics });

        manager.scheduleRender(dropResult(1, {
            indicatorY: 10,
            lineRect: { left: 5, width: 100 },
        }), null, 'mouse');
        queuedFrames.shift()?.(0);

        const indicatorEl = document.querySelector('.dnd-drop-indicator');
        expect(indicatorEl?.classList.contains(HIDDEN_CLASS)).toBe(false);
        expect(onFrameMetrics).toHaveBeenCalledWith(expect.objectContaining({ evaluated: true }));

        manager.destroy();
    });

    it('shows list drop highlight when highlightRect is provided', () => {
        const view = createViewStub();
        const queuedFrames = setupAnimationFrameQueue();
        const manager = new DropIndicatorManager(view);

        manager.scheduleRender(dropResult(2, {
            indicatorY: 24,
            lineRect: { left: 8, width: 140 },
            highlightRect: { top: 16, left: 10, width: 180, height: 30 },
        }), null, 'mouse');
        queuedFrames.shift()?.(0);

        const indicatorEl = document.querySelector('.dnd-drop-indicator');
        const highlightEl = document.querySelector('.dnd-drop-highlight');

        expect(indicatorEl?.classList.contains(HIDDEN_CLASS)).toBe(false);
        expect(highlightEl?.classList.contains(HIDDEN_CLASS)).toBe(false);

        manager.destroy();
    });

    it('hides list drop highlight when disabled by setting callback', () => {
        const view = createViewStub();
        const queuedFrames = setupAnimationFrameQueue();
        const manager = new DropIndicatorManager(view, {
            isDropHighlightEnabled: () => false,
        });

        manager.scheduleRender(dropResult(2, {
            indicatorY: 24,
            lineRect: { left: 8, width: 140 },
            highlightRect: { top: 16, left: 10, width: 180, height: 30 },
        }), null, 'mouse');
        queuedFrames.shift()?.(0);

        const indicatorEl = document.querySelector('.dnd-drop-indicator');
        const highlightEl = document.querySelector('.dnd-drop-highlight');

        expect(indicatorEl?.classList.contains(HIDDEN_CLASS)).toBe(false);
        expect(highlightEl?.classList.contains(HIDDEN_CLASS)).toBe(true);

        manager.destroy();
    });

    it('keeps only one editor indicator visible across manager instances', () => {
        const viewA = createViewStub();
        const viewB = createViewStub();
        const queuedFrames = setupAnimationFrameQueue();

        const managerA = new DropIndicatorManager(viewA);
        const managerB = new DropIndicatorManager(viewB);

        managerA.scheduleRender(dropResult(1, {
            indicatorY: 12,
            lineRect: { left: 6, width: 120 },
        }), null, 'mouse');
        queuedFrames.shift()?.(0);

        managerB.scheduleRender(dropResult(2, {
            indicatorY: 26,
            lineRect: { left: 10, width: 140 },
        }), null, 'mouse');
        queuedFrames.shift()?.(16);

        const indicators = Array.from(document.querySelectorAll<HTMLElement>('.dnd-drop-indicator'));
        expect(indicators).toHaveLength(2);
        expect(indicators[0].classList.contains(HIDDEN_CLASS)).toBe(true);
        expect(indicators[1].classList.contains(HIDDEN_CLASS)).toBe(false);

        managerA.destroy();
        managerB.destroy();
    });
});
