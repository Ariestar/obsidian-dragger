import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { BlockType } from 'md-dragger/domain';
import {
    convertCurrentBlockType,
    copyCurrentBlock,
    cutCurrentBlock,
    deleteCurrentBlock,
} from './block-type-conversion';

describe('block type conversion', () => {
    it('converts the current block to a heading', () => {
        const view = createMutableView('alpha\nbeta', 0);

        const changed = convertCurrentBlockType(view, { type: BlockType.Heading, level: 2 });

        expect(changed).toBe(true);
        expect(view.state.doc.toString()).toBe('## alpha\nbeta');
    });

    it('converts the current block to a level 6 heading', () => {
        const view = createMutableView('alpha\nbeta', 0);

        const changed = convertCurrentBlockType(view, { type: BlockType.Heading, level: 6 });

        expect(changed).toBe(true);
        expect(view.state.doc.toString()).toBe('###### alpha\nbeta');
    });

    it('converts the current list block to an ordered list marker', () => {
        const view = createMutableView('- alpha\n- beta', 0);

        const changed = convertCurrentBlockType(view, { type: BlockType.ListItem, markerType: 'ordered' });

        expect(changed).toBe(true);
        expect(view.state.doc.toString()).toBe('1. alpha\n- beta');
    });

    it('clears the quote marker when converting a quote to a paragraph', () => {
        const view = createMutableView('> alpha\nbeta', 0);

        const changed = convertCurrentBlockType(view, { type: BlockType.Paragraph });

        expect(changed).toBe(true);
        expect(view.state.doc.toString()).toBe('alpha\nbeta');
    });

    it('clears the quote marker before converting a quote to a heading', () => {
        const view = createMutableView('> alpha\nbeta', 0);

        const changed = convertCurrentBlockType(view, { type: BlockType.Heading, level: 3 });

        expect(changed).toBe(true);
        expect(view.state.doc.toString()).toBe('### alpha\nbeta');
    });

    it('clears the quote marker before converting a quote to a list item', () => {
        const view = createMutableView('> alpha\nbeta', 0);

        const changed = convertCurrentBlockType(view, { type: BlockType.ListItem, markerType: 'unordered' });

        expect(changed).toBe(true);
        expect(view.state.doc.toString()).toBe('- alpha\nbeta');
    });

    it('wraps the current block in a fenced code block', () => {
        const view = createMutableView('alpha\nbeta', 0);

        const changed = convertCurrentBlockType(view, { type: BlockType.CodeBlock });

        expect(changed).toBe(true);
        expect(view.state.doc.toString()).toBe('```\nalpha\n```\nbeta');
    });

    it('clears the quote marker before converting a quote to a code block', () => {
        const view = createMutableView('> alpha\nbeta', 0);

        const changed = convertCurrentBlockType(view, { type: BlockType.CodeBlock });

        expect(changed).toBe(true);
        expect(view.state.doc.toString()).toBe('```\nalpha\n```\nbeta');
    });

    it('wraps the current block in a fenced math block', () => {
        const view = createMutableView('x = y\nbeta', 0);

        const changed = convertCurrentBlockType(view, { type: BlockType.MathBlock });

        expect(changed).toBe(true);
        expect(view.state.doc.toString()).toBe('$$\nx = y\n$$\nbeta');
    });

    it('clears code fences before converting a code block to a paragraph', () => {
        const view = createMutableView('```\nalpha\n```', 0);

        const changed = convertCurrentBlockType(view, { type: BlockType.Paragraph });

        expect(changed).toBe(true);
        expect(view.state.doc.toString()).toBe('alpha');
    });

    it('clears math fences before converting a math block to a paragraph', () => {
        const view = createMutableView('$$\nx = y\n$$', 0);

        const changed = convertCurrentBlockType(view, { type: BlockType.Paragraph });

        expect(changed).toBe(true);
        expect(view.state.doc.toString()).toBe('x = y');
    });

    it('deletes the current block and its trailing newline', () => {
        const view = createMutableView('alpha\nbeta\ngamma', 6);

        const changed = deleteCurrentBlock(view);

        expect(changed).toBe(true);
        expect(view.state.doc.toString()).toBe('alpha\ngamma');
    });

    it('deletes the last block and its leading newline', () => {
        const view = createMutableView('alpha\nbeta', 6);

        const changed = deleteCurrentBlock(view);

        expect(changed).toBe(true);
        expect(view.state.doc.toString()).toBe('alpha');
    });

    it('copies the current block text to the clipboard', async () => {
        const view = createMutableView('alpha\nbeta', 0);
        const writeText = mockClipboard();

        const changed = await copyCurrentBlock(view);

        expect(changed).toBe(true);
        expect(writeText).toHaveBeenCalledWith('alpha');
        expect(view.state.doc.toString()).toBe('alpha\nbeta');
    });

    it('cuts the current block text to the clipboard and deletes it', async () => {
        const view = createMutableView('alpha\nbeta', 0);
        const writeText = mockClipboard();

        const changed = await cutCurrentBlock(view);

        expect(changed).toBe(true);
        expect(writeText).toHaveBeenCalledWith('alpha');
        expect(view.state.doc.toString()).toBe('beta');
    });
});

function mockClipboard(): ReturnType<typeof vi.fn> {
    const writeText = vi.fn(async () => undefined);
    Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText },
    });
    return writeText;
}

function createMutableView(doc: string, selectionAnchor: number): EditorView {
    let state = EditorState.create({
        doc,
        selection: { anchor: selectionAnchor },
    });
    return {
        get state() {
            return state;
        },
        dispatch(spec: Parameters<EditorState['update']>[0]) {
            state = state.update(spec).state;
        },
    } as unknown as EditorView;
}
