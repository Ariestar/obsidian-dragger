// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import {
    getMainContentLineElementForLine,
} from './line-dom';



describe('line-dom', () => {


    it('resolves line element using domAtPos', () => {
        const state = EditorState.create({ doc: 'a\nb\nc' });
        const content = document.createElement('div');
        const line2 = document.createElement('div');
        line2.className = 'cm-line';
        const textNode = document.createTextNode('b');
        line2.appendChild(textNode);
        content.appendChild(line2);

        const view = {
            state,
            contentDOM: content,
            domAtPos: () => ({ node: textNode, offset: 0 }),
        } as unknown as EditorView;

        expect(getMainContentLineElementForLine(view, 2)).toBe(line2);
    });


});


