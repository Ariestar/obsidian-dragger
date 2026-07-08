// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { BlockType } from 'md-dragger/domain';
import { createHoverPointerSnapshot } from './hover-pointer-snapshot';
import { HandleVisibilityController } from './handle-visibility-controller';

function createViewStub(): EditorView {
    const root = document.createElement('div');
    root.className = 'cm-editor';
    const content = document.createElement('div');
    root.appendChild(content);
    document.body.appendChild(root);

    Object.defineProperty(content, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
            left: 0,
            top: 0,
            right: 360,
            bottom: 200,
            width: 360,
            height: 200,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        }),
    });

    const state = EditorState.create({ doc: 'alpha\nbeta\ngamma' });
    return {
        dom: root,
        contentDOM: content,
        state,
    } as unknown as EditorView;
}

describe('HandleVisibilityController row hover', () => {
    it('reveals a handle when hovering the row content band, not just text hit points', () => {
        const view = createViewStub();
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('data-block-start', '0');
        view.dom.appendChild(handle);

        const controller = new HandleVisibilityController(view, {
            getBlockInfoForHandle: () => ({
                type: BlockType.Paragraph,
                startLine: 0,
                endLine: 0,
                from: 0,
                to: 5,
                indentLevel: 0,
                content: 'alpha',
            }),
            getLineNumberAtVerticalPosition: () => 1,
            getDraggableBlockAtVerticalPosition: () => ({
                type: BlockType.Paragraph,
                startLine: 0,
                endLine: 0,
                from: 0,
                to: 5,
                indentLevel: 0,
                content: 'alpha',
            }),
            getVisibleHandleForBlockStart: () => handle,
        });

        expect(controller.resolveVisibleHandleFromPointer(createHoverPointerSnapshot(view, 240, 10, 'left'))).toBe(handle);
    });
});
