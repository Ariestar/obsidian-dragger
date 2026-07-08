import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { BlockType } from 'md-dragger/domain';
import { buildSelectionFromSelectedBlocks } from './block-selection-resolver';

function templateForLine(state: EditorState, lineNumber: number) {
    const line = state.doc.line(lineNumber);
    return {
        type: BlockType.Paragraph,
        startLine: lineNumber - 1,
        endLine: lineNumber - 1,
        from: line.from,
        to: line.to,
        indentLevel: 0,
        content: line.text,
    };
}

describe('block-selection-ranges', () => {
    it('treats contiguous selected blocks as a single combined block selection', () => {
        const state = EditorState.create({ doc: 'a\nb\nc\nd' });
        const source = buildSelectionFromSelectedBlocks(
            state.doc,
            [
                { startLineNumber: 2, endLineNumber: 2 },
                { startLineNumber: 3, endLineNumber: 3 },
            ],
            templateForLine(state, 2)
        );
        expect(source).not.toBeNull();

        expect(source!.anchorBlock.startLine).toBe(1);
        expect(source!.anchorBlock.endLine).toBe(2);
        expect(source!.anchorBlock.content).toBe('b\nc');
        expect(source!.ranges).toEqual([{ startLine: 1, endLine: 2 }]);
    });

    it('keeps disjoint segments in BlockSelection.ranges', () => {
        const state = EditorState.create({ doc: 'a\nb\nc\nd\ne' });
        const source = buildSelectionFromSelectedBlocks(
            state.doc,
            [
                { startLineNumber: 2, endLineNumber: 2 },
                { startLineNumber: 4, endLineNumber: 4 },
            ],
            templateForLine(state, 2)
        );
        expect(source).not.toBeNull();

        expect(source!.anchorBlock.startLine).toBe(1);
        expect(source!.anchorBlock.endLine).toBe(1);
        expect(source!.anchorBlock.content).toBe('b');
        expect(source!.ranges).toEqual([
            { startLine: 1, endLine: 1 },
            { startLine: 3, endLine: 3 },
        ]);
    });
});
