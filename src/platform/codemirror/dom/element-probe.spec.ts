// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import {
    safeCoordsAtPos,
    safePosAtCoords,
    resolveLineNumberFromDomNodes,
    resolveLineNumberAtCoords,
} from './element-probe';

function createRect(left: number, top: number, width: number, height: number): DOMRect {
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

describe('dom-probe', () => {
    it('safeCoordsAtPos returns null when coordsAtPos throws', () => {
        const view = {
            viewport: { from: 0, to: 1000 },
            coordsAtPos: (pos: number) => {
                if (pos === 2) throw new Error('boom');
                return createRect(10, 20, 30, 10);
            },
        } as unknown as EditorView;

        expect(safeCoordsAtPos(view, 1)?.left).toBe(10);
        expect(safeCoordsAtPos(view, 2)).toBeNull();
    });

    it('safePosAtCoords returns null when posAtCoords throws', () => {
        const view = {
            posAtCoords: ({ x }: { x: number; y: number }) => {
                if (x < 0) throw new Error('invalid');
                return 0;
            },
        } as unknown as EditorView;

        expect(safePosAtCoords(view, { x: 20, y: 10 })).toBe(0);
        expect(safePosAtCoords(view, { x: -1, y: 10 })).toBeNull();
    });

    it('resolveLineNumberFromDomNodes uses first valid probe', () => {
        const state = EditorState.create({ doc: 'a\nb\nc' });
        const bad = document.createElement('div');
        const good = document.createElement('div');
        const view = {
            state,
            posAtDOM: (node: Node) => {
                if (node === bad) throw new Error('bad');
                if (node === good) return state.doc.line(2).from;
                throw new Error('unknown');
            },
        } as unknown as EditorView;

        expect(resolveLineNumberFromDomNodes(view, [bad, good])).toBe(2);
    });

    it('resolveLineNumberAtCoords clamps x before lookup', () => {
        const state = EditorState.create({ doc: 'a\nb\nc' });
        let capturedX = -1;
        const view = {
            state,
            posAtCoords: ({ x }: { x: number; y: number }) => {
                capturedX = x;
                return state.doc.line(3).from;
            },
        } as unknown as EditorView;

        const line = resolveLineNumberAtCoords(
            view,
            999,
            40,
            { left: 10, right: 110, top: 0, bottom: 100 },
        );
        expect(capturedX).toBe(108);
        expect(line).toBe(3);
    });
});
