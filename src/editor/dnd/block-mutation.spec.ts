import { describe, expect, it, vi } from 'vitest';
import { BlockType } from '../../types';
import { buildInsertText } from './block-mutation';

function createDoc(lines: string[]) {
    return {
        lines: lines.length,
        line: (n: number) => ({ text: lines[n - 1] ?? '' }),
    };
}

describe('block-mutation', () => {
    it.each([BlockType.CodeBlock, BlockType.Table, BlockType.MathBlock])(
        'does not auto-adjust quote depth for %s',
        (type) => {
            const adjustBlockquoteDepth = vi.fn((text: string) => `> ${text}`);
            const adjustListToTargetContext = vi.fn((text: string) => text);
            const result = buildInsertText({
                doc: createDoc(['> quote context']),
                sourceBlockType: type,
                sourceContent: 'content line',
                targetLineNumber: 2,
                getBlockquoteDepthContext: () => 1,
                getContentQuoteDepth: () => 0,
                adjustBlockquoteDepth,
                adjustListToTargetContext,
            });

            expect(adjustBlockquoteDepth).not.toHaveBeenCalled();
            expect(result).toBe('content line\n');
        }
    );

    it('adjusts quote depth for normal paragraph moves', () => {
        const adjustBlockquoteDepth = vi.fn((text: string, targetDepth: number) => `${'> '.repeat(targetDepth)}${text}`);
        const result = buildInsertText({
            doc: createDoc(['> quote context']),
            sourceBlockType: BlockType.Paragraph,
            sourceContent: 'plain',
            targetLineNumber: 2,
            getBlockquoteDepthContext: () => 2,
            getContentQuoteDepth: () => 0,
            adjustBlockquoteDepth,
            adjustListToTargetContext: (text) => text,
        });

        expect(adjustBlockquoteDepth).toHaveBeenCalledWith('plain', 2, 0);
        expect(result).toBe('> > plain\n');
    });

    it('adds leading and trailing blank separation for table rows', () => {
        const result = buildInsertText({
            doc: createDoc(['| a |', '| b |']),
            sourceBlockType: BlockType.Table,
            sourceContent: '| moved |',
            targetLineNumber: 2,
            getBlockquoteDepthContext: () => 0,
            getContentQuoteDepth: () => 0,
            adjustBlockquoteDepth: (text) => text,
            adjustListToTargetContext: (text) => text,
        });

        expect(result).toBe('\n| moved |\n\n');
    });
});
