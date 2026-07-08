// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { createHoverPointerSnapshot } from './hover-pointer-snapshot';

function createViewStub(): EditorView {
    const root = document.createElement('div');
    root.className = 'cm-editor';
    const content = document.createElement('div');
    root.appendChild(content);
    document.body.appendChild(root);

    Object.defineProperty(content, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
            left: 20,
            top: 10,
            right: 220,
            bottom: 110,
            width: 200,
            height: 100,
            x: 20,
            y: 10,
            toJSON: () => ({}),
        }),
    });

    return {
        dom: root,
        contentDOM: content,
        state: EditorState.create({ doc: 'alpha\nbeta' }),
    } as unknown as EditorView;
}

describe('createHoverPointerSnapshot', () => {
    it('uses the configured gutter side to compute the handle interaction band', () => {
        const view = createViewStub();

        const rightSnapshot = createHoverPointerSnapshot(view, 214, 30, 'right');
        const leftSnapshot = createHoverPointerSnapshot(view, 26, 30, 'left');

        expect(rightSnapshot.withinHandleInteractionZone).toBe(true);
        expect(leftSnapshot.withinHandleInteractionZone).toBe(true);
        expect(createHoverPointerSnapshot(view, 26, 30, 'right').withinHandleInteractionZone).toBe(false);
        expect(createHoverPointerSnapshot(view, 214, 30, 'left').withinHandleInteractionZone).toBe(false);
    });
});
