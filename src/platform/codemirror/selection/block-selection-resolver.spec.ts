// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BlockSelectionResolver } from './block-selection-resolver';
import { BlockType } from '../../../domain/block/block-types';

const originalElementFromPoint = (document as Document & {
    elementFromPoint?: (x: number, y: number) => Element | null;
}).elementFromPoint;

function createRect(left: number, top: number, width: number, height: number): DOMRect {
    return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        writable: true,
        value: originalElementFromPoint,
    });
});

describe('BlockSelectionResolver', () => {
    it('prefers handle data attributes over DOM overlay mapping', () => {
        const state = EditorState.create({
            doc: 'alpha\nbeta\n- item\ngamma',
        });
        const handle = document.createElement('span');
        handle.setAttribute('data-block-start', '2');

        const view = {
            state,
            posAtDOM: (node: Node) => {
                if (node === handle) {
                    return state.doc.line(1).from;
                }
                throw new Error('unexpected node');
            },
        } as unknown as EditorView;

        const resolver = new BlockSelectionResolver(view);
        const block = resolver.getBlockInfoForHandle(handle);
        expect(block).not.toBeNull();
        expect(block?.startLine).toBe(2);
        expect(block?.content).toContain('- item');
    });

    it('returns null when handle data attributes are missing', () => {
        const state = EditorState.create({
            doc: 'alpha\nbeta\n- item\ngamma',
        });
        const handle = document.createElement('span');

        const view = {
            state,
            posAtDOM: () => state.doc.line(3).from,
        } as unknown as EditorView;

        const resolver = new BlockSelectionResolver(view);
        const block = resolver.getBlockInfoForHandle(handle);
        expect(block).toBeNull();
    });

    it('does not downgrade handle source requests to point resolution', () => {
        const state = EditorState.create({
            doc: 'alpha\nbeta\n- item\ngamma',
        });
        const handle = document.createElement('span');

        const view = {
            state,
            contentDOM: {
                getBoundingClientRect: () => ({
                    left: 0,
                    top: 0,
                    right: 300,
                    bottom: 120,
                }),
            },
            posAtCoords: () => state.doc.line(3).from,
        } as unknown as EditorView;

        const resolver = new BlockSelectionResolver(view);
        const source = resolver.resolveSelection({ kind: 'handle', handle });
        expect(source).toBeNull();
    });

    it('resolves block source requests without re-detecting by point', () => {
        const state = EditorState.create({ doc: 'alpha\nbeta' });
        const block = {
            type: BlockType.Paragraph,
            startLine: 1,
            endLine: 1,
            from: state.doc.line(2).from,
            to: state.doc.line(2).to,
            indentLevel: 0,
            content: 'beta',
        };
        const view = { state } as unknown as EditorView;

        const resolver = new BlockSelectionResolver(view);
        const source = resolver.resolveSelection({ kind: 'block', block });
        expect(source).toEqual({
            anchorBlock: block,
            focusBlock: block,
            ranges: [{ startLine: 1, endLine: 1 }],
        });
    });

    it('resolves native editor selections from a nested handle inside the selected blocks', () => {
        const baseState = EditorState.create({
            doc: '- parent\n  - nested\n    - deep\nparagraph\ntail',
        });
        const state = baseState.update({
            selection: {
                anchor: baseState.doc.line(2).from,
                head: baseState.doc.line(4).to,
            },
        }).state;
        const handle = document.createElement('span');
        handle.setAttribute('data-block-start', '1');

        const view = { state } as unknown as EditorView;

        const resolver = new BlockSelectionResolver(view);
        const source = resolver.resolveSelection({ kind: 'native-selection', handle });
        expect(source).not.toBeNull();
        expect(source?.ranges).toEqual([{ startLine: 1, endLine: 3 }]);
        expect(source?.anchorBlock.startLine).toBe(1);
        expect(source?.anchorBlock.content).toBe('  - nested\n    - deep\nparagraph');
    });

    it('ignores native editor selections when the grabbed handle is outside the selection', () => {
        const baseState = EditorState.create({
            doc: '- parent\n  - nested\n    - deep\nparagraph\ntail',
        });
        const state = baseState.update({
            selection: {
                anchor: baseState.doc.line(2).from,
                head: baseState.doc.line(4).to,
            },
        }).state;
        const handle = document.createElement('span');
        handle.setAttribute('data-block-start', '0');

        const view = { state } as unknown as EditorView;

        const resolver = new BlockSelectionResolver(view);
        expect(resolver.resolveSelection({ kind: 'native-selection', handle })).toBeNull();
    });

    it('keeps single-line native text selections on the normal handle drag path', () => {
        const baseState = EditorState.create({
            doc: 'alpha beta\ngamma',
        });
        const state = baseState.update({
            selection: {
                anchor: baseState.doc.line(1).from,
                head: baseState.doc.line(1).from + 5,
            },
        }).state;
        const handle = document.createElement('span');
        handle.setAttribute('data-block-start', '0');

        const view = { state } as unknown as EditorView;

        const resolver = new BlockSelectionResolver(view);
        expect(resolver.resolveSelection({ kind: 'native-selection', handle })).toBeNull();
    });

    it('uses data attributes when DOM lookup fails', () => {
        const state = EditorState.create({
            doc: 'first\nsecond\nthird',
        });
        const handle = document.createElement('span');
        handle.setAttribute('data-block-start', '1');

        const view = {
            state,
            posAtDOM: () => {
                throw new Error('dom lookup failed');
            },
        } as unknown as EditorView;

        const resolver = new BlockSelectionResolver(view);
        const block = resolver.getBlockInfoForHandle(handle);
        expect(block).not.toBeNull();
        expect(block?.startLine).toBe(1);
        expect(block?.content).toContain('second');
    });

    it('resolves a block from vertical position without requiring a text hit at the current x', () => {
        const state = EditorState.create({
            doc: 'alpha\nbeta\ngamma',
        });
        const view = {
            state,
            documentTop: 0,
            contentDOM: {
                getBoundingClientRect: () => ({
                    left: 0,
                    top: 0,
                    right: 300,
                    bottom: 120,
                }),
            },
            lineBlockAtHeight: (height: number) => ({
                from: state.doc.line(height < 40 ? 2 : 3).from,
                to: state.doc.line(height < 40 ? 2 : 3).to,
                top: height < 40 ? 20 : 40,
                bottom: height < 40 ? 40 : 60,
                height: 20,
                type: 0,
                widget: null,
                widgetLineBreaks: 0,
                length: state.doc.line(height < 40 ? 2 : 3).length,
            }),
        } as unknown as EditorView;

        const resolver = new BlockSelectionResolver(view);
        const block = resolver.getDraggableBlockAtVerticalPosition(30);
        expect(block).not.toBeNull();
        expect(block?.startLine).toBe(1);
        expect(block?.content).toContain('beta');
    });

    it('returns null when point lookup hits transient layout-read guard', () => {
        const state = EditorState.create({
            doc: 'alpha\nbeta\ngamma',
        });
        const view = {
            state,
            contentDOM: {
                getBoundingClientRect: () => ({
                    left: 0,
                    top: 0,
                    right: 300,
                    bottom: 120,
                }),
            },
            posAtCoords: () => {
                throw new Error("Reading the editor layout isn't allowed during an update");
            },
        } as unknown as EditorView;

        const resolver = new BlockSelectionResolver(view);
        const block = resolver.getDraggableBlockAtPoint(20, 30);
        expect(block).toBeNull();
    });

    it('resolves rendered callout block from embed hit before coordinate point lookup', () => {
        const state = EditorState.create({
            doc: '> [!note] title\n> body\nafter',
        });
        const root = document.createElement('div');
        const content = document.createElement('div');
        root.appendChild(content);
        document.body.appendChild(root);
        const embed = document.createElement('div');
        embed.className = 'cm-callout';
        root.appendChild(embed);

        Object.defineProperty(root, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(0, 0, 360, 220),
        });
        Object.defineProperty(content, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(0, 0, 340, 180),
        });
        Object.defineProperty(embed, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(40, 50, 220, 60),
        });
        Object.defineProperty(document, 'elementFromPoint', {
            configurable: true,
            writable: true,
            value: vi.fn(() => embed),
        });

        const view = {
            state,
            dom: root,
            contentDOM: content,
            posAtCoords: () => state.doc.line(3).from,
            posAtDOM: (node: Node) => {
                if (node === embed) {
                    return state.doc.line(1).from;
                }
                throw new Error('unexpected node');
            },
        } as unknown as EditorView;

        const resolver = new BlockSelectionResolver(view);
        const block = resolver.getDraggableBlockAtPoint(110, 76);
        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.Callout);
        expect(block?.startLine).toBe(0);
        expect(block?.endLine).toBe(1);
    });

    it('uses coordinate-based point resolution when embed direct hit misses', () => {
        const state = EditorState.create({
            doc: '$$\nx^2\n$$\nafter',
        });
        const root = document.createElement('div');
        const content = document.createElement('div');
        root.appendChild(content);
        document.body.appendChild(root);
        const math = document.createElement('div');
        math.className = 'MathJax';
        root.appendChild(math);

        Object.defineProperty(root, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(0, 0, 360, 260),
        });
        Object.defineProperty(content, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(0, 0, 340, 200),
        });
        Object.defineProperty(math, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(36, 90, 240, 52),
        });
        Object.defineProperty(document, 'elementFromPoint', {
            configurable: true,
            writable: true,
            value: vi.fn(() => null),
        });

        const view = {
            state,
            dom: root,
            contentDOM: content,
            posAtCoords: () => state.doc.line(4).from,
            posAtDOM: (node: Node) => {
                if (node === math) {
                    return state.doc.line(2).from;
                }
                throw new Error('unexpected node');
            },
        } as unknown as EditorView;

        const resolver = new BlockSelectionResolver(view);
        const block = resolver.getDraggableBlockAtPoint(120, 102);
        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.Paragraph);
        expect(block?.startLine).toBe(3);
        expect(block?.endLine).toBe(3);
    });

    it('resolves horizontal rule from rendered line hit when posAtCoords drifts', () => {
        const state = EditorState.create({
            doc: 'first\n---\nthird',
        });
        const root = document.createElement('div');
        const content = document.createElement('div');
        content.className = 'cm-content';
        root.appendChild(content);
        document.body.appendChild(root);

        const line1 = document.createElement('div');
        line1.className = 'cm-line';
        const line2 = document.createElement('div');
        line2.className = 'cm-line';
        const hr = document.createElement('hr');
        hr.className = 'cm-hr';
        line2.appendChild(hr);
        const line3 = document.createElement('div');
        line3.className = 'cm-line';
        content.append(line1, line2, line3);

        Object.defineProperty(root, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(0, 0, 360, 220),
        });
        Object.defineProperty(content, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(0, 0, 340, 180),
        });
        Object.defineProperty(document, 'elementFromPoint', {
            configurable: true,
            writable: true,
            value: vi.fn(() => hr),
        });

        const view = {
            state,
            dom: root,
            contentDOM: content,
            posAtCoords: () => state.doc.line(1).from,
            posAtDOM: (node: Node) => {
                if (node === line1) return state.doc.line(1).from;
                if (node === line2) return state.doc.line(2).from;
                if (node === line3) return state.doc.line(3).from;
                throw new Error('unexpected node');
            },
        } as unknown as EditorView;

        const resolver = new BlockSelectionResolver(view);
        const block = resolver.getDraggableBlockAtPoint(120, 56);
        expect(block).not.toBeNull();
        expect(block?.type).toBe(BlockType.HorizontalRule);
        expect(block?.startLine).toBe(1);
        expect(block?.endLine).toBe(1);
    });
});
