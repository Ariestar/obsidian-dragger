import type { EditorView } from '@codemirror/view';
import type { App } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { BlockType } from 'md-dragger/domain';
import { createBlockFoldStateManager } from './block-fold-state';

function createLineElement(options?: {
    classes?: string[];
}): {
    classList: { contains: (className: string) => boolean };
    closest: (selector: string) => unknown;
    querySelector: () => unknown;
} {
    const classes = new Set(options?.classes ?? []);
    const element = {
        classList: {
            contains: (className: string) => classes.has(className),
        },
        closest: (selector: string) => selector === '.cm-line' ? element : null,
        querySelector: () => null,
    };
    return element;
}

describe('createBlockFoldStateManager', () => {
    it('captures only collapsed list lines inside a list block', () => {
        const lineElements = new Map<number, ReturnType<typeof createLineElement>>([
            [2, createLineElement({ classes: ['is-collapsed'] })],
            [3, createLineElement()],
            [4, createLineElement({ classes: ['is-collapsed'] })],
        ]);
        const view = {
            state: {
                doc: {
                    line: (lineNumber: number) => ({
                        from: lineNumber * 10,
                        text: lineNumber === 3 ? 'continuation' : '- item',
                    }),
                },
            },
            lineBlockAt: (pos: number) => ({ from: pos }),
            domAtPos: (pos: number) => {
                const lineNumber = Math.floor(pos / 10);
                return { node: lineElements.get(lineNumber) ?? createLineElement() };
            },
        } as unknown as EditorView;
        const manager = createBlockFoldStateManager({
            app: {
                workspace: {
                    getLeavesOfType: () => [],
                },
            } as unknown as App,
            parseLineWithQuote: (line) => ({
                text: line,
                quotePrefix: '',
                quoteDepth: 0,
                rest: line,
                isListItem: /^\s*[-*+]\s/.test(line),
                indentRaw: '',
                indentWidth: 0,
                marker: '- ',
                markerType: 'unordered',
                content: line,
            }),
        });

        const state = manager.capture(view, {
            type: BlockType.ListItem,
            startLine: 1,
            endLine: 3,
            from: 0,
            to: 0,
            indentLevel: 0,
            content: '- parent\ncontinuation\n- sibling',
        });

        expect(state).toEqual({
            collapsedRelativeLineOffsets: [0, 2],
        });
    });

    it('captures collapsed heading lines inside a heading block', () => {
        const lineElements = new Map<number, ReturnType<typeof createLineElement>>([
            [1, createLineElement({ classes: ['is-collapsed'] })],
            [2, createLineElement()],
            [3, createLineElement()],
            [4, createLineElement()],
            [5, createLineElement({ classes: ['is-collapsed'] })],
        ]);
        const view = {
            state: {
                doc: {
                    line: (lineNumber: number) => ({
                        from: lineNumber * 10,
                        text: ['# parent', 'body', '## child', 'child body', '### grandchild'][lineNumber - 1] ?? '',
                    }),
                },
            },
            lineBlockAt: (pos: number) => ({ from: pos }),
            domAtPos: (pos: number) => {
                const lineNumber = Math.floor(pos / 10);
                return { node: lineElements.get(lineNumber) ?? createLineElement() };
            },
        } as unknown as EditorView;
        const manager = createBlockFoldStateManager({
            app: {
                workspace: {
                    getLeavesOfType: () => [],
                },
            } as unknown as App,
            parseLineWithQuote: (line) => ({
                text: line,
                quotePrefix: '',
                quoteDepth: 0,
                rest: line,
                isListItem: /^\s*[-*+]\s/.test(line),
                indentRaw: '',
                indentWidth: 0,
                marker: '- ',
                markerType: 'unordered',
                content: line,
            }),
        });

        const state = manager.capture(view, {
            type: BlockType.Heading,
            startLine: 0,
            endLine: 4,
            from: 0,
            to: 0,
            indentLevel: 0,
            content: '# parent\nbody\n## child\nchild body\n### grandchild',
        });

        expect(state).toEqual({
            collapsedRelativeLineOffsets: [0, 4],
        });
    });
});
