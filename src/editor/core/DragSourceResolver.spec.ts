// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { DragSourceResolver } from './DragSourceResolver';

describe('DragSourceResolver', () => {
    it('prefers DOM position over stale handle data attributes', () => {
        const state = EditorState.create({
            doc: 'alpha\nbeta\n- item\ngamma',
        });
        const handle = document.createElement('span');
        handle.setAttribute('data-block-start', '0');

        const view = {
            state,
            posAtDOM: (node: Node) => {
                if (node === handle) {
                    return state.doc.line(3).from;
                }
                throw new Error('unexpected node');
            },
        } as unknown as EditorView;

        const resolver = new DragSourceResolver(view);
        const block = resolver.getBlockInfoForHandle(handle);
        expect(block).not.toBeNull();
        expect(block?.startLine).toBe(2);
        expect(block?.content).toContain('- item');
    });

    it('falls back to data attributes when DOM lookup fails', () => {
        const state = EditorState.create({
            doc: 'first\nsecond\nthird',
        });
        const handle = document.createElement('span');
        handle.setAttribute('data-block-start', '1');

        const view = {
            state,
            posAtDOM: () => {
                throw new Error('dom lookup failed');
            },
        } as unknown as EditorView;

        const resolver = new DragSourceResolver(view);
        const block = resolver.getBlockInfoForHandle(handle);
        expect(block).not.toBeNull();
        expect(block?.startLine).toBe(1);
        expect(block?.content).toContain('second');
    });

    it('returns null when point lookup hits transient layout-read guard', () => {
        const state = EditorState.create({
            doc: 'alpha\nbeta\ngamma',
        });
        const view = {
            state,
            contentDOM: {
                getBoundingClientRect: () => ({
                    left: 0,
                    top: 0,
                    right: 300,
                    bottom: 120,
                }),
            },
            posAtCoords: () => {
                throw new Error("Reading the editor layout isn't allowed during an update");
            },
        } as unknown as EditorView;

        const resolver = new DragSourceResolver(view);
        const block = resolver.getDraggableBlockAtPoint(20, 30);
        expect(block).toBeNull();
    });
});
