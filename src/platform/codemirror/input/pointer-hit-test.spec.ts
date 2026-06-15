import { afterEach, describe, expect, it, vi } from 'vitest';
import type { BlockInfo } from '../../../domain/block/block-types';
import {
    autoScrollNearViewportEdge,
    hidePointerDropPreviews,
    buildPointerBlockCommandAtPoint,
    registerPointerHitTestClient,
    resetPointerHitTestForTests,
    resolvePointerDropSnapshotAtPoint,
    showPointerDropPreview,
    type PointerHitTestClient,
} from './pointer-hit-test';

function createClient(name: string, hitRect: { left: number; top: number; right: number; bottom: number }): PointerHitTestClient {
    return {
        containsPoint: (x, y) => x >= hitRect.left && x <= hitRect.right && y >= hitRect.top && y <= hitRect.bottom,
        resolveDropSnapshotAtPoint: vi.fn(() => ({ target: null, rejectReason: null })),
        showDropPreview: vi.fn(),
        hideDropPreview: vi.fn(),
        buildBlockCommandAtPoint: vi.fn(() => ({ type: 'platform_commit', drop: { target: null, rejectReason: null } })),
        applyBlockCommand: vi.fn(),
    } satisfies PointerHitTestClient & { name?: string };
}

function createScroller(top: number, bottom: number, scrollTop = 100): HTMLElement {
    return {
        scrollTop,
        getBoundingClientRect: () => ({
            left: 0,
            top,
            right: 400,
            bottom,
            width: 400,
            height: bottom - top,
            x: 0,
            y: top,
            toJSON: () => ({}),
        }),
    } as HTMLElement;
}

const sourceBlock = { startLine: 1, endLine: 1 } as BlockInfo;

afterEach(() => {
    resetPointerHitTestForTests();
});

describe('pointer-hit-test', () => {
    it('routes drop indicator updates to the client under the pointer and hides the previous target', () => {
        const fallback = createClient('fallback', { left: 0, top: 0, right: 100, bottom: 100 });
        const other = createClient('other', { left: 200, top: 0, right: 300, bottom: 100 });
        registerPointerHitTestClient(fallback);
        registerPointerHitTestClient(other);

        const fallbackDrop = resolvePointerDropSnapshotAtPoint(fallback, 10, 10, sourceBlock, 'mouse');
        showPointerDropPreview(fallback, sourceBlock, fallbackDrop, 'mouse');
        expect(fallback.showDropPreview).toHaveBeenCalledWith(sourceBlock, fallbackDrop, 'mouse');
        expect(other.showDropPreview).not.toHaveBeenCalled();

        const otherDrop = resolvePointerDropSnapshotAtPoint(fallback, 220, 10, sourceBlock, 'mouse');
        showPointerDropPreview(fallback, sourceBlock, otherDrop, 'mouse');
        expect(fallback.hideDropPreview).toHaveBeenCalledTimes(1);
        expect(other.showDropPreview).toHaveBeenCalledWith(sourceBlock, otherDrop, 'mouse');
    });

    it('uses the active target for drop when the pointer leaves registered editors', () => {
        const fallback = createClient('fallback', { left: 0, top: 0, right: 100, bottom: 100 });
        const other = createClient('other', { left: 200, top: 0, right: 300, bottom: 100 });
        registerPointerHitTestClient(fallback);
        registerPointerHitTestClient(other);

        resolvePointerDropSnapshotAtPoint(fallback, 220, 10, sourceBlock, 'mouse');
        buildPointerBlockCommandAtPoint(fallback, sourceBlock, 500, 500, 'mouse');

        expect(other.buildBlockCommandAtPoint).toHaveBeenCalledWith(sourceBlock, 500, 500, 'mouse');
        expect(fallback.buildBlockCommandAtPoint).not.toHaveBeenCalled();
    });

    it('clears all visible target indicators', () => {
        const fallback = createClient('fallback', { left: 0, top: 0, right: 100, bottom: 100 });
        const other = createClient('other', { left: 200, top: 0, right: 300, bottom: 100 });
        registerPointerHitTestClient(fallback);
        registerPointerHitTestClient(other);

        hidePointerDropPreviews();

        expect(fallback.hideDropPreview).toHaveBeenCalledTimes(1);
        expect(other.hideDropPreview).toHaveBeenCalledTimes(1);
    });

    it('scales auto-scroll distance from the configured max speed', () => {
        const slowScroller = createScroller(0, 200);
        const fastScroller = createScroller(0, 200);

        autoScrollNearViewportEdge(slowScroller, 170, 60, 12);
        autoScrollNearViewportEdge(fastScroller, 170, 60, 60);

        expect(slowScroller.scrollTop).toBeCloseTo(106);
        expect(fastScroller.scrollTop).toBeCloseTo(130);
    });
});
