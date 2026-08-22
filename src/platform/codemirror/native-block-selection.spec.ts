import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { detectBlock, hasBlock } from 'md-dragger/domain';
import { nativeBlockSelection } from './native-block-selection';

function stateWithSelection(doc: string, anchor: number, head: number): EditorState {
    return EditorState.create({ doc, selection: { anchor, head } });
}

function blockAt(state: EditorState, line: number) {
    const block = detectBlock(state.doc, line, { tabSize: 4 });
    if (!block) throw new Error(`No block at line ${line}`);
    return block;
}

describe('nativeBlockSelection', () => {
    it('returns every semantic block in a native multi-block selection', () => {
        const state = stateWithSelection('alpha\n\nbeta', 0, 11);

        expect(nativeBlockSelection(state, blockAt(state, 1), 4)?.blocks).toHaveLength(2);
    });

    it('accepts a nested list handle contained by the native selection', () => {
        const state = stateWithSelection('- parent\n  - child\n\nafter', 0, 20);
        const child = blockAt(state, 2);
        const selection = nativeBlockSelection(state, child, 4);

        expect(selection).not.toBeNull();
        expect(hasBlock(selection!, child)).toBe(true);
    });

    it('returns null when the pressed handle is outside the native selection', () => {
        const state = stateWithSelection('alpha\n\nbeta\n\ngamma', 0, 11);

        expect(nativeBlockSelection(state, blockAt(state, 5), 4)).toBeNull();
    });

    it('returns null for an empty or single-block native selection', () => {
        const empty = stateWithSelection('alpha\n\nbeta', 1, 1);
        const single = stateWithSelection('alpha\n\nbeta', 0, 5);

        expect(nativeBlockSelection(empty, blockAt(empty, 1), 4)).toBeNull();
        expect(nativeBlockSelection(single, blockAt(single, 1), 4)).toBeNull();
    });
});
