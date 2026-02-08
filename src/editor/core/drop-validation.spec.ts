import { describe, expect, it } from 'vitest';
import { BlockType, type BlockInfo } from '../../types';
import { validateInPlaceDrop } from './drop-validation';
import { parseLineWithQuote } from './line-parsing';

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

describe('drop-validation', () => {
    it('uses insertion matrix to reject invalid container drops', () => {
        const result = validateInPlaceDrop({
            doc: createDoc(['- list item']),
            sourceBlock: createBlock(BlockType.Paragraph, 0, 0, 'plain'),
            targetLineNumber: 1,
            parseLineWithQuote: (line) => parseLineWithQuote(line, 4),
            getListContext: () => null,
            getIndentUnitWidth: () => 2,
            targetContainerType: BlockType.ListItem,
            containerPosition: 'inside',
        });

        expect(result.allowInPlaceIndentChange).toBe(false);
        expect(result.rejectReason).toBe('container_policy');
    });
});
