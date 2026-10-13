import { EditorState, type Extension } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { BlockType } from 'md-dragger/domain';
import { mockEditorInfoField } from '../test-setup';
import {
    convertCurrentBlockType,
    copyBlockLink,
    copyCurrentBlock,
    cutCurrentBlock,
    deleteCurrentBlock,
} from './block-type-commands';

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

    it('switches callout type in-place without adding extra quote lines', () => {
        const view = createMutableView('> [!note]\n> line 1\n> line 2', 0);

        const changed = convertCurrentBlockType(view, {
            template: '> [!tip]\n${content}',
            linePrefix: '> ',
        });

        expect(changed).toBe(true);
        expect(view.state.doc.toString()).toBe('> [!tip]\n> line 1\n> line 2');
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

    it.each(['note', 'tip', 'warning'])('converts the current block to a %s callout template', (type) => {
        const view = createMutableView('alpha\nbeta', 0);

        const changed = convertCurrentBlockType(view, {
            template: `> [!${type}]\n\${content}`,
            linePrefix: '> ',
        });

        expect(changed).toBe(true);
        expect(view.state.doc.toString()).toBe(`> [!${type}]\n> alpha\nbeta`);
    });

    it('converts the current block to a custom HTML div with variables', () => {
        const view = createMutableView('card content\nother block', 0);

        const changed = convertCurrentBlockType(view, {
            template: '<div class="${class}">\n${content}\n</div>',
            variables: { class: 'my-card' },
        });

        expect(changed).toBe(true);
        expect(view.state.doc.toString()).toBe('<div class="my-card">\ncard content\n</div>\nother block');
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

    it('copies existing block ID as link without modifying document', async () => {
        const view = createMutableView('alpha ^my-id\nbeta', 0);
        const writeText = mockClipboard();

        const link = await copyBlockLink(view);

        expect(link).toBe('[[#^my-id]]');
        expect(writeText).toHaveBeenCalledWith('[[#^my-id]]');
        expect(view.state.doc.toString()).toBe('alpha ^my-id\nbeta');
    });

    it('generates and appends a block ID if block has none, copying link', async () => {
        const view = createMutableView('alpha\nbeta', 0);
        const writeText = mockClipboard();

        const link = await copyBlockLink(view);

        expect(link).toMatch(/^\[\[#\^[a-z0-9]{6}\]\]$/);
        expect(writeText).toHaveBeenCalledWith(link);
        const id = link?.slice(4, -2);
        expect(view.state.doc.toString()).toBe(`alpha ^${id}\nbeta`);
    });

    it('uses file basename and fileManager when available', async () => {
        const mockFile = { basename: 'My Note' };
        const mockFileManager = {
            generateMarkdownLink: vi.fn(
                (file: { basename: string }, _src: string, subpath: string) => `[[${file.basename}${subpath}]]`,
            ),
        };
        const view = createMutableView('alpha ^my-id\nbeta', 0, [
            mockEditorInfoField.init(() => ({ file: mockFile, app: { fileManager: mockFileManager } })),
        ]);
        const writeText = mockClipboard();

        const link = await copyBlockLink(view);

        expect(link).toBe('[[My Note#^my-id]]');
        expect(mockFileManager.generateMarkdownLink).toHaveBeenCalledWith(mockFile, '', '#^my-id');
        expect(writeText).toHaveBeenCalledWith('[[My Note#^my-id]]');
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

function createMutableView(doc: string, selectionAnchor: number, extensions?: Extension): EditorView {
    let state = EditorState.create({
        doc,
        selection: { anchor: selectionAnchor },
        extensions,
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
