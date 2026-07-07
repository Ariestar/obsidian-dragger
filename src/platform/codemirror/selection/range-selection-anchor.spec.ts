// @vitest-environment jsdom

import { describe, expect, it } from 'vitest';
import {
    buildAnchorSnapshot,
    resolveAnchorSpan,
} from '../preview/range-selection-visual-manager';

function createHandle(lineNumber: number, top: number, calls: { count: number }): HTMLElement {
    const marker = document.createElement('div');
    marker.className = 'cm-gutterElement dnd-handle-gutter-marker';
    const handle = document.createElement('div');
    handle.className = 'dnd-drag-handle';
    handle.setAttribute('data-block-start', String(lineNumber - 1));
    Object.defineProperty(handle, 'getBoundingClientRect', {
        configurable: true,
        value: () => {
            calls.count += 1;
            return {
                left: 20,
                top,
                right: 30,
                bottom: top + 10,
                width: 10,
                height: 10,
                x: 20,
                y: top,
                toJSON: () => ({}),
            };
        },
    });
    marker.appendChild(handle);
    document.body.appendChild(marker);
    return handle;
}

describe('selection anchor snapshot', () => {
    it('reads handle rects once when resolving multiple segments from one snapshot', () => {
        const callsA = { count: 0 };
        const callsB = { count: 0 };
        const callsC = { count: 0 };
        const handleA = createHandle(2, 10, callsA);
        const handleB = createHandle(5, 50, callsB);
        const handleC = createHandle(8, 90, callsC);

        const snapshot = buildAnchorSnapshot([handleA, handleB, handleC]);
        expect(callsA.count).toBe(1);
        expect(callsB.count).toBe(1);
        expect(callsC.count).toBe(1);

        const first = resolveAnchorSpan({
            segment: {
                startLineNumber: 2,
                endLineNumber: 5,
                startBlockLineNumber: 2,
                endBlockLineNumber: 5,
            },
            snapshot,
        });
        const second = resolveAnchorSpan({
            segment: {
                startLineNumber: 8,
                endLineNumber: 8,
                startBlockLineNumber: 8,
                endBlockLineNumber: 8,
            },
            snapshot,
        });

        expect(first).not.toBeNull();
        expect(first?.topY).toBe(15);
        expect(first?.bottomY).toBe(55);
        expect(second).not.toBeNull();
        expect(second?.topY).toBe(95);
        expect(second?.bottomY).toBe(95);
        expect(callsA.count).toBe(1);
        expect(callsB.count).toBe(1);
        expect(callsC.count).toBe(1);
    });
});
