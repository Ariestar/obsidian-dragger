import { describe, expect, it } from 'vitest';
import { createBlockSelection } from '../../domain/selection/block-selection';
import { BlockType, type BlockInfo } from '../block/block-types';
import { selfDrop } from './self-drop';
import { getLineMap } from '../markdown/line-map';
import { parseLineWithQuote } from '../markdown/line-parser';

const TAB_SIZE = 4;

function createDoc(lines: string[]) {
    return {
        lines: lines.length,
        line: (n: number) => ({ text: lines[n - 1] ?? '' }),
    };
}

function createBlock(type: BlockType, startLine: number, endLine: number, content: string): BlockInfo {
    return {
        type,
        startLine,
        endLine,
        from: 0,
        to: content.length,
        indentLevel: 0,
        content,
    };
}

function selectionFromBlock(block: BlockInfo, ranges = [{ startLine: block.startLine, endLine: block.endLine }]) {
    return createBlockSelection(block, ranges);
}

describe('selfDrop', () => {
    it('uses insertion matrix to reject invalid container drops', () => {
        const sourceBlock = createBlock(BlockType.Paragraph, 0, 0, 'plain');
        const result = selfDrop({
            doc: createDoc(['- list item']),
            source: selectionFromBlock(sourceBlock),
            targetLineNumber: 1,
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            slotContext: 'inside_list',
        });

        expect(result.allowInPlaceIndentChange).toBe(false);
        expect(result.rejectReason).toBe('inside_list');
    });

    it('keeps result stable when lineMap is provided', () => {
        const state = { doc: createDoc(['- root', '  - child', 'tail']) };
        const sourceBlock = createBlock(BlockType.ListItem, 0, 1, '- root\n  - child');
        const source = selectionFromBlock(sourceBlock);
        const withoutMap = selfDrop({
            doc: state.doc,
            source,
            targetLineNumber: 2,
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => ({ indentWidth: 0, indentRaw: '', markerType: 'unordered' }),
            getIndentUnitWidth: () => 2,
            slotContext: 'inside_list',
            listIntent: {
                mode: 'sibling',
                contextLineNumber: 1,
                targetIndentWidth: 0,
            },
        });
        const withMap = selfDrop({
            doc: state.doc,
            source,
            targetLineNumber: 2,
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => ({ indentWidth: 0, indentRaw: '', markerType: 'unordered' }),
            getIndentUnitWidth: () => 2,
            slotContext: 'inside_list',
            lineMap: getLineMap(state, { tabSize: TAB_SIZE }),
            listIntent: {
                mode: 'sibling',
                contextLineNumber: 1,
                targetIndentWidth: 0,
            },
        });

        expect(withMap).toEqual(withoutMap);
    });

    it('treats disjoint source gaps as valid drop targets', () => {
        const sourceBlock = createBlock(BlockType.ListItem, 1, 6, '- a\n- z');
        const source = selectionFromBlock(sourceBlock, [
            { startLine: 1, endLine: 1 },
            { startLine: 6, endLine: 6 },
        ]);

        const inGap = selfDrop({
            doc: createDoc(['0', 'a', 'b', 'c', 'd', 'e', 'z', 'tail']),
            source,
            targetLineNumber: 4,
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
        });
        expect(inGap.inSelfRange).toBe(false);
        expect(inGap.allowInPlaceIndentChange).toBe(false);

        const inSelectedRange = selfDrop({
            doc: createDoc(['0', 'a', 'b', 'c', 'd', 'e', 'z', 'tail']),
            source,
            targetLineNumber: 2,
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
        });
        expect(inSelectedRange.inSelfRange).toBe(true);
        expect(inSelectedRange.rejectReason).toBe('self_range_blocked');
    });

    it('treats contiguous ranges like a single block for in-place indent changes', () => {
        const sourceBlock = createBlock(BlockType.ListItem, 0, 1, '- root\n  - child');
        const source = selectionFromBlock(sourceBlock, [
            { startLine: 0, endLine: 0 },
            { startLine: 1, endLine: 1 },
        ]);

        const result = selfDrop({
            doc: createDoc(['- root', '  - child', 'after']),
            source,
            targetLineNumber: 3,
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            listIntent: {
                contextLineNumber: 3,
                targetIndentWidth: 4,
            },
        });

        expect(result.inSelfRange).toBe(true);
        expect(result.allowInPlaceIndentChange).toBe(true);
        expect(result.rejectReason).toBeUndefined();
    });

    it('blocks in-place list indent when a source contains non-list content', () => {
        const sourceBlock = createBlock(BlockType.ListItem, 0, 2, '- root\nparagraph\n- child');
        const source = selectionFromBlock(sourceBlock, [
            { startLine: 0, endLine: 0 },
            { startLine: 1, endLine: 1 },
            { startLine: 2, endLine: 2 },
        ]);

        const result = selfDrop({
            doc: createDoc(['- root', 'paragraph', '- child', 'after']),
            source,
            targetLineNumber: 4,
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            listIntent: {
                contextLineNumber: 4,
                targetIndentWidth: 2,
            },
        });

        expect(result.inSelfRange).toBe(true);
        expect(result.allowInPlaceIndentChange).toBe(false);
        expect(result.rejectReason).toBe('self_range_blocked');
    });
});
