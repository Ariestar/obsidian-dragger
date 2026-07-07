import { describe, expect, it } from 'vitest';
import { BlockType, type BlockInfo } from '../block/block-types';
import type { DocLikeWithRange } from '../markdown/document-types';
import { createBlockRangeSelectionState, updateBlockRangeSelectionState } from './block-range-selection';

function block(startLine: number, endLine = startLine): BlockInfo {
    return {
        type: BlockType.Paragraph,
        startLine,
        endLine,
        from: startLine,
        to: endLine,
        indentLevel: 0,
        content: `line ${startLine + 1}`,
    };
}

function boundaryFromBlock(blockInfo: BlockInfo) {
    return {
        startLineNumber: blockInfo.startLine + 1,
        endLineNumber: blockInfo.endLine + 1,
        representativeLineNumber: blockInfo.startLine + 1,
    };
}

const doc: DocLikeWithRange = {
    lines: 8,
    length: 80,
    line: (lineNumber) => ({
        number: lineNumber,
        from: lineNumber - 1,
        to: lineNumber - 1,
        text: `line ${lineNumber}`,
        length: 6,
    }),
};

const resolveBoundary = (lineNumber: number) => ({
    startLineNumber: lineNumber,
    endLineNumber: lineNumber,
});

describe('block range selection state', () => {
    it('adds a disjoint range without filling the gap', () => {
        const state = createBlockRangeSelectionState({
            doc,
            anchorBoundary: boundaryFromBlock(block(5)),
            selectedBlocks: [{ startLineNumber: 1, endLineNumber: 1 }],
            operation: 'add',
        });

        expect(state?.selectionBlocks).toEqual([
            { startLineNumber: 1, endLineNumber: 1 },
            { startLineNumber: 6, endLineNumber: 6 },
        ]);
    });

    it('extends only the active range while preserving other selected ranges', () => {
        const state = createBlockRangeSelectionState({
            doc,
            anchorBoundary: boundaryFromBlock(block(5)),
            selectedBlocks: [{ startLineNumber: 1, endLineNumber: 1 }],
            operation: 'add',
        });
        expect(state).not.toBeNull();

        const next = updateBlockRangeSelectionState(state!, {
            docLines: doc.lines,
            target: { startLineNumber: 8, endLineNumber: 8, representativeLineNumber: 8 },
            resolveBoundary,
        });

        expect(next.selectionBlocks).toEqual([
            { startLineNumber: 1, endLineNumber: 1 },
            { startLineNumber: 6, endLineNumber: 6 },
            { startLineNumber: 7, endLineNumber: 7 },
            { startLineNumber: 8, endLineNumber: 8 },
        ]);
    });
});
