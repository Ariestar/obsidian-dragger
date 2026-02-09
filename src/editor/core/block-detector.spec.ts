import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { BlockType } from '../../types';
import { detectBlock, getHeadingSectionRange } from './block-detector';
import { peekCachedLineMap } from './line-map';

function createState(doc: string): EditorState {
    return EditorState.create({ doc });
}

describe('block-detector', () => {
    it('does not absorb following plain text into a list item block', () => {
        const state = createState('- item\nplain text');
        const block = detectBlock(state, 1);

        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.ListItem);
        expect(block?.startLine).toBe(0);
        expect(block?.endLine).toBe(0);
    });

    it('keeps indented continuation inside list item block', () => {
        const state = createState('- item\n  continuation\nplain text');
        const block = detectBlock(state, 1);

        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.ListItem);
        expect(block?.endLine).toBe(1);
    });

    it('keeps indented fenced code descendants inside list item subtree', () => {
        const state = createState('- parent\n  ```ts\n  const x = 1\n  ```\nafter');
        const block = detectBlock(state, 1);

        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.ListItem);
        expect(block?.endLine).toBe(3);
    });

    it('does not absorb following plain text into a task item block', () => {
        const state = createState('- [ ] task\nplain text');
        const block = detectBlock(state, 1);

        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.ListItem);
        expect(block?.endLine).toBe(0);
    });

    it('treats regular blockquote lines as line-level movable blocks', () => {
        const state = createState('> line 1\n> line 2\n> line 3\noutside');
        const block = detectBlock(state, 2);

        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.Blockquote);
        expect(block?.startLine).toBe(1);
        expect(block?.endLine).toBe(1);
    });

    it('treats quote lines with list markers as part of one blockquote container', () => {
        const state = createState('> intro\n> - item\n> continuation');
        const block = detectBlock(state, 2);

        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.Blockquote);
        expect(block?.startLine).toBe(1);
        expect(block?.endLine).toBe(1);
    });

    it('keeps callout as one container block when hit from body lines', () => {
        const state = createState('> [!note] title\n> body line 1\n> body line 2\noutside');
        const block = detectBlock(state, 2);

        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.Callout);
        expect(block?.startLine).toBe(0);
        expect(block?.endLine).toBe(2);
    });

    it('detects horizontal rule block with trailing spaces', () => {
        const state = createState('---   \nnext');
        const block = detectBlock(state, 1);

        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.HorizontalRule);
        expect(block?.startLine).toBe(0);
        expect(block?.endLine).toBe(0);
    });

    it('detects spaced horizontal rule syntax instead of list item', () => {
        const state = createState('- - -\nnext');
        const block = detectBlock(state, 1);

        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.HorizontalRule);
        expect(block?.startLine).toBe(0);
        expect(block?.endLine).toBe(0);
    });

    it('reuses cached block detection result for repeated lookup on same line', () => {
        const state = createState('```ts\nconst x = 1\n```\noutside');
        const first = detectBlock(state, 2);
        const second = detectBlock(state, 2);

        expect(first).not.toBeNull();
        expect(second).not.toBeNull();
        expect(first).toBe(second);
    });

    it('avoids cold line-map build for large-doc list detection and keeps subtree result', () => {
        const filler = Array.from({ length: 30_100 }, (_, i) => `plain ${i}`).join('\n');
        const state = createState(`- parent\n  - child\noutside\n${filler}`);
        expect(peekCachedLineMap(state)).toBeNull();

        const block = detectBlock(state, 1);

        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.ListItem);
        expect(block?.endLine).toBe(1);
        expect(peekCachedLineMap(state)).toBeNull();
    });

    it('keeps eager line-map build on smaller docs for list detection', () => {
        const state = createState('- parent\n  - child\noutside');
        expect(peekCachedLineMap(state)).toBeNull();

        const block = detectBlock(state, 1);

        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.ListItem);
        expect(peekCachedLineMap(state)).not.toBeNull();
    });

    it('keeps unclosed fenced code behavior (only fence start line is code block)', () => {
        const state = createState('```ts\nconst x = 1\nstill code?');
        const startFenceBlock = detectBlock(state, 1);
        const innerLineBlock = detectBlock(state, 2);

        expect(startFenceBlock?.type).toBe(BlockType.CodeBlock);
        expect(startFenceBlock?.startLine).toBe(0);
        expect(startFenceBlock?.endLine).toBe(0);
        expect(innerLineBlock?.type).toBe(BlockType.Paragraph);
    });

    it('keeps plain text between long fenced code blocks out of code range after deep-line lookup', () => {
        const firstCodeLines = Array.from({ length: 1200 }, (_, i) => `const first_${i} = ${i};`);
        const secondCodeLines = Array.from({ length: 1200 }, (_, i) => `const second_${i} = ${i};`);
        const docLines = [
            '```ts',
            ...firstCodeLines,
            '```',
            'middle plain text',
            '```ts',
            ...secondCodeLines,
            '```',
            'tail',
        ];
        const state = createState(docLines.join('\n'));

        const secondBlockProbeLine = firstCodeLines.length + 4 + 800;
        const middleLine = firstCodeLines.length + 3;

        const deepBlock = detectBlock(state, secondBlockProbeLine);
        expect(deepBlock?.type).toBe(BlockType.CodeBlock);

        const middleBlock = detectBlock(state, middleLine);
        expect(middleBlock?.type).toBe(BlockType.Paragraph);
        expect(middleBlock?.startLine).toBe(middleLine - 1);
        expect(middleBlock?.endLine).toBe(middleLine - 1);
    });

    it('returns heading section range until next same-or-higher heading', () => {
        const state = createState('# H1\nparagraph\n## H2\nsub\n# H1-2\ntail');
        const range = getHeadingSectionRange(state.doc, 1);

        expect(range).toEqual({ startLine: 1, endLine: 4 });
    });

    it('returns nested heading section range for child heading', () => {
        const state = createState('# H1\nintro\n## H2\ndetail\n### H3\ndeep\n## H2 next');
        const range = getHeadingSectionRange(state.doc, 3);

        expect(range).toEqual({ startLine: 3, endLine: 6 });
    });
});
