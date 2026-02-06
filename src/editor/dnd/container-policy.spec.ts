import { describe, expect, it } from 'vitest';
import { BlockInfo, BlockType } from '../../types';
import {
    getContainerContextAtInsertion,
    shouldPreventDropIntoDifferentContainer,
    type DetectBlockFn,
} from './container-policy';
import { DocLike, StateWithDoc } from './types';

function createDoc(lines: string[]): DocLike {
    const fromOffsets: number[] = [];
    let offset = 0;
    for (const line of lines) {
        fromOffsets.push(offset);
        offset += line.length + 1;
    }

    return {
        lines: lines.length,
        line: (n: number) => {
            const idx = n - 1;
            const text = lines[idx] ?? '';
            const from = fromOffsets[idx] ?? 0;
            return { text, from, to: from + text.length };
        },
    };
}

function createState(lines: string[]): StateWithDoc {
    return { doc: createDoc(lines) };
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

function mapDetectBlock(map: Record<number, BlockInfo>): DetectBlockFn {
    return (_state, lineNumber) => map[lineNumber] ?? null;
}

describe('container-policy', () => {
    it('prevents dropping external block into list container internals', () => {
        const state = createState(['before', '- parent', '  - child', 'after']);
        const listBlock = createBlock(BlockType.ListItem, 1, 2, '- parent\n  - child');
        const detect = mapDetectBlock({ 2: listBlock, 3: listBlock });
        const sourceBlock = createBlock(BlockType.Paragraph, 0, 0, 'before');

        const prevented = shouldPreventDropIntoDifferentContainer(state, sourceBlock, 3, detect);

        expect(prevented).toBe(true);
    });

    it('allows reordering within same container type', () => {
        const state = createState(['- parent', '  - child']);
        const listBlock = createBlock(BlockType.ListItem, 0, 1, '- parent\n  - child');
        const detect = mapDetectBlock({ 1: listBlock, 2: listBlock });
        const sourceBlock = createBlock(BlockType.ListItem, 0, 0, '- move-me');

        const prevented = shouldPreventDropIntoDifferentContainer(state, sourceBlock, 2, detect);

        expect(prevented).toBe(false);
    });

    it('allows insertion on blank line between two list blocks', () => {
        const state = createState(['- first', '', '- second']);
        const listTop = createBlock(BlockType.ListItem, 0, 0, '- first');
        const listBottom = createBlock(BlockType.ListItem, 2, 2, '- second');
        const detect = mapDetectBlock({ 1: listTop, 3: listBottom });
        const sourceBlock = createBlock(BlockType.Paragraph, 0, 0, 'outside');

        const context = getContainerContextAtInsertion(state, 2, detect);
        const prevented = shouldPreventDropIntoDifferentContainer(state, sourceBlock, 2, detect);

        expect(context).toBeNull();
        expect(prevented).toBe(false);
    });

    it('prevents dropping paragraph into callout body', () => {
        const state = createState(['> [!note] title', '> detail']);
        const calloutBlock = createBlock(BlockType.Callout, 0, 1, '> [!note] title\n> detail');
        const detect = mapDetectBlock({ 1: calloutBlock, 2: calloutBlock });
        const sourceParagraph = createBlock(BlockType.Paragraph, 0, 0, 'outside');

        const prevented = shouldPreventDropIntoDifferentContainer(state, sourceParagraph, 2, detect);

        expect(prevented).toBe(true);
    });
});
