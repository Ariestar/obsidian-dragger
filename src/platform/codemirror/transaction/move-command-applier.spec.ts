import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { BlockInfo, BlockType } from '../../../domain/block/block-types';
import { createBlockSelection, type BlockSelection } from '../../../domain/selection/block-selection';
import { buildInsertTextForDrop } from '../../../domain/mutation/text-mutation-policy';
import { applyMoveCommand, type MoveCommandApplierDeps, type MoveCommandParams } from './move-command-applier';
import { createLineParsingContext } from '../../../domain/markdown/line-parsing-service';
import { parseLineWithQuote } from '../../../domain/markdown/line-parser';
import { getListContext } from '../../../domain/mutation/list-mutation';
import { createMoveCommand } from '../../../domain/command/move-command';
import type { DropTarget, ListDropTarget } from '../../../domain/command/drop-target';

function dropTarget(targetLineNumber: number, listIntent?: Partial<ListDropTarget>): DropTarget {
    return {
        targetLineNumber,
        placement: 'before',
        listIntent: listIntent ? { mode: 'sibling', ...listIntent } : undefined,
    };
}

function createBlockFromLine(doc: EditorState['doc'], lineNumber: number): BlockInfo {
    const line = doc.line(lineNumber);
    return {
        type: BlockType.Paragraph,
        startLine: lineNumber - 1,
        endLine: lineNumber - 1,
        from: line.from,
        to: line.to,
        indentLevel: 0,
        content: line.text,
    };
}

function createListBlock(doc: EditorState['doc'], startLine: number, endLine: number): BlockInfo {
    const start = doc.line(startLine);
    const end = doc.line(endLine);
    return {
        type: BlockType.ListItem,
        startLine: startLine - 1,
        endLine: endLine - 1,
        from: start.from,
        to: end.to,
        indentLevel: 0,
        content: doc.sliceString(start.from, end.to),
    };
}

function createHeadingBlock(doc: EditorState['doc'], startLine: number, endLine: number): BlockInfo {
    const start = doc.line(startLine);
    const end = doc.line(endLine);
    return {
        type: BlockType.Heading,
        startLine: startLine - 1,
        endLine: endLine - 1,
        from: start.from,
        to: end.to,
        indentLevel: 0,
        content: doc.sliceString(start.from, end.to),
    };
}

function selectionFromBlock(block: BlockInfo, ranges = [{ startLine: block.startLine, endLine: block.endLine }]) {
    return createBlockSelection(block, ranges);
}

function createMutableView(state: EditorState): {
    view: EditorView;
    dispatch: ReturnType<typeof vi.fn>;
    getState: () => EditorState;
} {
    let currentState = state;
    const dispatch = vi.fn((tr: Parameters<EditorState['update']>[0]) => {
        currentState = currentState.update(tr).state;
    });
    const view = {
        get state() {
            return currentState;
        },
        dispatch,
    } as unknown as EditorView;
    return {
        view,
        dispatch,
        getState: () => currentState,
    };
}

function createLinkedViews(state: EditorState): {
    sourceView: EditorView;
    targetView: EditorView;
    sourceDispatch: ReturnType<typeof vi.fn>;
    targetDispatch: ReturnType<typeof vi.fn>;
    getState: () => EditorState;
} {
    let currentState = state;
    const sourceDispatch = vi.fn((tr: Parameters<EditorState['update']>[0]) => {
        currentState = currentState.update(tr).state;
    });
    const targetDispatch = vi.fn((tr: Parameters<EditorState['update']>[0]) => {
        currentState = currentState.update(tr).state;
    });
    const sourceView = {
        get state() {
            return currentState;
        },
        dispatch: sourceDispatch,
    } as unknown as EditorView;
    const targetView = {
        get state() {
            return currentState;
        },
        dispatch: targetDispatch,
    } as unknown as EditorView;
    return {
        sourceView,
        targetView,
        sourceDispatch,
        targetDispatch,
        getState: () => currentState,
    };
}

function createTextMutationDeps(view: EditorView) {
    const lineParsing = createLineParsingContext(view.state.facet(EditorState.tabSize));
    return {
        parseLine: lineParsing.parseLine,
        listCtx: (doc: EditorState['doc'], lineNumber: number) =>
            getListContext(doc, lineNumber, lineParsing.parseLine),
        indentUnit: lineParsing.getIndentUnitWidth,
        insertText: (
            doc: EditorState['doc'],
            source: BlockInfo,
            targetLineNumber: number,
            sourceContent: string,
            listIntent?: ListDropTarget
        ) => buildInsertTextForDrop({
            lineParsing,
            doc,
            sourceBlock: source,
            targetLineNumber,
            sourceContent,
            listIntent,
        }),
    };
}

type TestMoveCommandParams = Omit<MoveCommandParams, 'command'> & {
    source: BlockSelection;
    target: DropTarget;
};

function createApplier(deps: MoveCommandApplierDeps): { applyMoveCommand(params: TestMoveCommandParams): void } {
    return {
        applyMoveCommand: ({ source, target, ...params }) => applyMoveCommand(deps, {
            ...params,
            command: createMoveCommand(source, target),
        }),
    };
}

describe('applyMoveCommand', () => {
    it('skips dispatch when container policy blocks the drop', () => {
        const state = EditorState.create({ doc: 'alpha\nbeta\ngamma' });
        const dispatch = vi.fn();
        const view = { state, dispatch } as unknown as EditorView;
        const applier = createApplier({
            view,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: false },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        applier.applyMoveCommand({
            source: selectionFromBlock(createBlockFromLine(state.doc, 1)),
            target: dropTarget(3),
        });

        expect(dispatch).not.toHaveBeenCalled();
    });

    it('dispatches insert+delete changes when drop is allowed', () => {
        const state = EditorState.create({ doc: 'alpha\nbeta\ngamma' });
        const dispatch = vi.fn();
        const view = { state, dispatch } as unknown as EditorView;
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);
        const applier = createApplier({
            view,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        applier.applyMoveCommand({
            source: selectionFromBlock(createBlockFromLine(state.doc, 1)),
            target: dropTarget(3),
        });

        expect(dispatch).toHaveBeenCalledTimes(2);
        expect(dispatch.mock.calls[0][0]).toMatchObject({
            selection: { anchor: 0 },
            scrollIntoView: false,
        });
        expect(dispatch.mock.calls[0][0].changes).toBeUndefined();
        const payload = dispatch.mock.calls[1][0];
        expect(Array.isArray(payload.changes)).toBe(true);
        expect(payload.changes).toHaveLength(2);
        setTimeoutSpy.mockRestore();
    });

    it('moves a single block across editor views', () => {
        const sourceInitialState = EditorState.create({ doc: 'alpha\nbeta\ngamma' });
        const targetInitialState = EditorState.create({ doc: 'one\ntwo' });
        const { view: sourceView, getState: getSourceState } = createMutableView(sourceInitialState);
        const { view: targetView, getState: getTargetState } = createMutableView(targetInitialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);
        const applier = createApplier({
            view: targetView,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        applier.applyMoveCommand({
            source: selectionFromBlock(createBlockFromLine(sourceInitialState.doc, 2)),
            target: dropTarget(2),
            sourceView,
        });

        expect(getTargetState().doc.toString()).toBe('one\nbeta\ntwo');
        expect(getSourceState().doc.toString()).toBe('alpha\ngamma');
        setTimeoutSpy.mockRestore();
    });

    it('restores list fold state at the shifted target line after a downward same-editor move', () => {
        const initialState = EditorState.create({ doc: '- alpha\n- beta\n- gamma' });
        const { view } = createMutableView(initialState);
        const blockFoldState = {
            capture: vi.fn(() => ({ collapsedRelativeLineOffsets: [0] })),
            restore: vi.fn(),
        };
        const applier = createApplier({
            view,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
            blockFoldState,
        });

        applier.applyMoveCommand({
            source: selectionFromBlock(createListBlock(initialState.doc, 1, 1)),
            target: dropTarget(3),
        });

        expect(blockFoldState.capture).toHaveBeenCalledTimes(1);
        expect(blockFoldState.restore).toHaveBeenCalledWith(
            view,
            2,
            { collapsedRelativeLineOffsets: [0] }
        );
    });

    it('preserves a folded target list when a lower folded list moves above it', () => {
        const initialState = EditorState.create({
            doc: '- upper\n  - upper child\n- lower\n  - lower child',
        });
        const { view, getState } = createMutableView(initialState);
        const upperFoldState = { collapsedRelativeLineOffsets: [0] };
        const lowerFoldState = { collapsedRelativeLineOffsets: [0] };
        const blockFoldState = {
            capture: vi.fn((_view: EditorView, block: BlockInfo) => (
                block.content.includes('lower') ? lowerFoldState
                    : block.content.includes('upper') ? upperFoldState
                        : null
            )),
            restore: vi.fn(),
        };
        const applier = createApplier({
            view,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
            blockFoldState,
        });

        applier.applyMoveCommand({
            source: selectionFromBlock(createListBlock(initialState.doc, 3, 4)),
            target: dropTarget(1),
        });

        expect(getState().doc.toString()).toBe('- lower\n  - lower child\n- upper\n  - upper child');
        expect(blockFoldState.restore).toHaveBeenNthCalledWith(1, view, 1, lowerFoldState);
        expect(blockFoldState.restore).toHaveBeenNthCalledWith(2, view, 3, upperFoldState);
    });

    it('preserves source and displaced target fold state across a blank insertion slot', () => {
        const initialState = EditorState.create({
            doc: '\n- upper\n  - upper child\n\n- lower\n  - lower child',
        });
        const { view, getState } = createMutableView(initialState);
        const upperFoldState = { collapsedRelativeLineOffsets: [0] };
        const lowerFoldState = { collapsedRelativeLineOffsets: [0] };
        const blockFoldState = {
            capture: vi.fn((_view: EditorView, block: BlockInfo) => (
                block.content.includes('lower') ? lowerFoldState
                    : block.content.includes('upper') ? upperFoldState
                        : null
            )),
            restore: vi.fn(),
        };
        const applier = createApplier({
            view,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
            blockFoldState,
        });

        applier.applyMoveCommand({
            source: selectionFromBlock(createListBlock(initialState.doc, 5, 6)),
            target: dropTarget(1),
        });

        expect(getState().doc.toString()).toBe('- lower\n  - lower child\n\n- upper\n  - upper child\n');
        expect(blockFoldState.restore).toHaveBeenNthCalledWith(1, view, 1, lowerFoldState);
        expect(blockFoldState.restore).toHaveBeenNthCalledWith(2, view, 4, upperFoldState);
    });

    it('restores heading fold state at the shifted target line after a downward same-editor move', () => {
        const initialState = EditorState.create({ doc: '# parent\nbody\n## child\nchild body\nafter\nlast' });
        const { view } = createMutableView(initialState);
        const blockFoldState = {
            capture: vi.fn(() => ({ collapsedRelativeLineOffsets: [0, 2] })),
            restore: vi.fn(),
        };
        const applier = createApplier({
            view,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
            blockFoldState,
        });

        applier.applyMoveCommand({
            source: selectionFromBlock(createHeadingBlock(initialState.doc, 1, 4)),
            target: dropTarget(6),
        });

        expect(blockFoldState.capture).toHaveBeenCalledTimes(1);
        expect(blockFoldState.restore).toHaveBeenCalledWith(
            view,
            2,
            { collapsedRelativeLineOffsets: [0, 2] }
        );
    });

    it('moves a composite source across editor views', () => {
        const sourceInitialState = EditorState.create({ doc: 'alpha\nbeta\ngamma\ndelta\nepsilon' });
        const targetInitialState = EditorState.create({ doc: 'one\ntwo' });
        const { view: sourceView, getState: getSourceState } = createMutableView(sourceInitialState);
        const { view: targetView, getState: getTargetState } = createMutableView(targetInitialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);
        const applier = createApplier({
            view: targetView,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        const line2 = sourceInitialState.doc.line(2);
        const line4 = sourceInitialState.doc.line(4);
        applier.applyMoveCommand({
            source: selectionFromBlock({
                type: BlockType.Paragraph,
                startLine: 1,
                endLine: 3,
                from: line2.from,
                to: line4.to,
                indentLevel: 0,
                content: 'beta\ndelta',
                }, [
                        { startLine: 1, endLine: 1 },
                        { startLine: 3, endLine: 3 },
                    ]),
            target: dropTarget(2),
            sourceView,
        });

        expect(getTargetState().doc.toString()).toBe('one\nbeta\ndelta\ntwo');
        expect(getSourceState().doc.toString()).toBe('alpha\ngamma\nepsilon');
        setTimeoutSpy.mockRestore();
    });

    it('moves contiguous composite selection as a single range in the same editor', () => {
        const initialState = EditorState.create({ doc: 'a\nb\nc\nd' });
        const { view, getState, dispatch } = createMutableView(initialState);
        const applier = createApplier({
            view,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        const line2 = initialState.doc.line(2);
        const line3 = initialState.doc.line(3);
        applier.applyMoveCommand({
            source: selectionFromBlock({
                type: BlockType.Paragraph,
                startLine: 1,
                endLine: 2,
                from: line2.from,
                to: line3.to,
                indentLevel: 0,
                content: 'b\nc',
                }, [
                        { startLine: 1, endLine: 1 },
                        { startLine: 2, endLine: 2 },
                    ]),
            target: dropTarget(1),
        });

        expect(dispatch).toHaveBeenCalledTimes(2);
        expect(dispatch.mock.calls[0][0].changes).toBeUndefined();
        expect(getState().doc.toString()).toBe('b\nc\na\nd');
    });

    it('applies list indent intent when moving a disjoint multi-selection as one group', () => {
        const initialState = EditorState.create({ doc: '- parent\ntail\n- a\nmid\n- b\nend' });
        const { view, getState } = createMutableView(initialState);
        const textMutation = createTextMutationDeps(view);
        const applier = createApplier({
            view,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            ...textMutation,
        });

        const line3 = initialState.doc.line(3);
        const line5 = initialState.doc.line(5);
        applier.applyMoveCommand({
            source: selectionFromBlock({
                type: BlockType.ListItem,
                startLine: 2,
                endLine: 4,
                from: line3.from,
                to: line5.to,
                indentLevel: 0,
                content: '- a\n- b',
                }, [
                        { startLine: 2, endLine: 2 },
                        { startLine: 4, endLine: 4 },
                    ]),
            target: dropTarget(2, { mode: 'child', contextLineNumber: 1, targetIndentWidth: 2 }),
        });

        expect(getState().doc.toString()).toBe('- parent\n  - a\n  - b\ntail\nmid\nend');
    });

    it('restores list fold state at the target line for cross-editor moves', () => {
        const sourceInitialState = EditorState.create({ doc: '- alpha\n- beta\n- gamma' });
        const targetInitialState = EditorState.create({ doc: 'one\ntwo' });
        const { view: sourceView } = createMutableView(sourceInitialState);
        const { view: targetView } = createMutableView(targetInitialState);
        const blockFoldState = {
            capture: vi.fn(() => ({ collapsedRelativeLineOffsets: [0] })),
            restore: vi.fn(),
        };
        const applier = createApplier({
            view: targetView,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
            blockFoldState,
        });

        applier.applyMoveCommand({
            source: selectionFromBlock(createListBlock(sourceInitialState.doc, 2, 2)),
            target: dropTarget(2),
            sourceView,
        });

        expect(blockFoldState.capture).toHaveBeenCalledTimes(1);
        expect(blockFoldState.restore).toHaveBeenCalledWith(
            targetView,
            2,
            { collapsedRelativeLineOffsets: [0] }
        );
    });

    it('uses a single-document transaction for same-file cross-window moves', () => {
        const initialState = EditorState.create({ doc: 'alpha\nbeta\ngamma' });
        const {
            sourceView,
            targetView,
            sourceDispatch,
            targetDispatch,
            getState,
        } = createLinkedViews(initialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
            () => 0 as unknown as ReturnType<typeof setTimeout>
        );
        const applier = createApplier({
            view: targetView,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        applier.applyMoveCommand({
            source: selectionFromBlock(createBlockFromLine(initialState.doc, 2)),
            target: dropTarget(1),
            sourceView,
            sourceDocumentRelation: 'same_document',
        });

        expect(getState().doc.toString()).toBe('beta\nalpha\ngamma');
        expect(targetDispatch).toHaveBeenCalledTimes(2);
        expect(targetDispatch.mock.calls[0][0].changes).toBeUndefined();
        expect(sourceDispatch).not.toHaveBeenCalled();
        setTimeoutSpy.mockRestore();
    });

    it('captures fold state from the source view for contiguous same-document multi-selection moves', () => {
        const initialState = EditorState.create({ doc: 'alpha\nbeta\ngamma\ndelta' });
        const {
            sourceView,
            targetView,
            sourceDispatch,
            targetDispatch,
            getState,
        } = createLinkedViews(initialState);
        const blockFoldState = {
            capture: vi.fn(() => ({ collapsedRelativeLineOffsets: [0] })),
            restore: vi.fn(),
        };
        const applier = createApplier({
            view: targetView,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
            blockFoldState,
        });

        const line2 = initialState.doc.line(2);
        const line3 = initialState.doc.line(3);
        applier.applyMoveCommand({
            source: selectionFromBlock({
                type: BlockType.Heading,
                startLine: 1,
                endLine: 2,
                from: line2.from,
                to: line3.to,
                indentLevel: 0,
                content: 'beta\ngamma',
                }, [
                        { startLine: 1, endLine: 1 },
                        { startLine: 2, endLine: 2 },
                    ]),
            target: dropTarget(1),
            sourceView,
            sourceDocumentRelation: 'same_document',
        });

        expect(getState().doc.toString()).toBe('beta\ngamma\nalpha\ndelta');
        expect(blockFoldState.capture).toHaveBeenCalledTimes(1);
        expect(blockFoldState.capture).toHaveBeenCalledWith(
            sourceView,
            expect.objectContaining({
                startLine: 1,
                endLine: 2,
            })
        );
        expect(blockFoldState.restore).toHaveBeenCalledWith(
            targetView,
            1,
            { collapsedRelativeLineOffsets: [0] }
        );
        expect(targetDispatch).toHaveBeenCalledTimes(2);
        expect(targetDispatch.mock.calls[0][0].changes).toBeUndefined();
        expect(sourceDispatch).not.toHaveBeenCalled();
    });

    it('prevents self-embedding indent when dropping list root at its own tail', () => {
        const state = EditorState.create({ doc: '- root\n  - child\nafter' });
        const dispatch = vi.fn();
        const view = { state, dispatch } as unknown as EditorView;
        const applier = createApplier({
            view,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        applier.applyMoveCommand({
            source: selectionFromBlock(createListBlock(state.doc, 1, 2)),
            target: dropTarget(3, { mode: 'child', contextLineNumber: 2, targetIndentWidth: 2 }),
        });

        expect(dispatch).not.toHaveBeenCalled();
    });

    it('moves composite multi-range source as ordered group', () => {
        const state = EditorState.create({ doc: 'a\nb\nc\nd\ne\nf' });
        const dispatch = vi.fn();
        const view = { state, dispatch } as unknown as EditorView;
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(() => 0 as unknown as ReturnType<typeof setTimeout>);
        const applier = createApplier({
            view,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        const line2 = state.doc.line(2);
        const line5 = state.doc.line(5);
        applier.applyMoveCommand({
            source: selectionFromBlock({
                type: BlockType.Paragraph,
                startLine: 1,
                endLine: 4,
                from: line2.from,
                to: line5.to,
                indentLevel: 0,
                content: 'b\ne',
                }, [
                        { startLine: 1, endLine: 1 },
                        { startLine: 4, endLine: 4 },
                    ]),
            target: dropTarget(1),
        });

        expect(dispatch).toHaveBeenCalledTimes(2);
        expect(dispatch.mock.calls[0][0].changes).toBeUndefined();
        const payload = dispatch.mock.calls[1][0];
        expect(Array.isArray(payload.changes)).toBe(true);
        expect(payload.changes).toHaveLength(3);
        const insertChange = payload.changes.find((change: { insert?: string }) => typeof change.insert === 'string' && change.insert.length > 0);
        expect(insertChange?.insert).toContain('b');
        expect(insertChange?.insert).toContain('e');
        setTimeoutSpy.mockRestore();
    });

    it('renumbers ordered lists after applying move changes', () => {
        const initial = EditorState.create({ doc: '1. one\n2. two\n3. three' });
        const { view, dispatch, getState } = createMutableView(initial);
        const applier = createApplier({
            view,
            ...createTextMutationDeps(view),
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
        });

        applier.applyMoveCommand({
            source: selectionFromBlock(createListBlock(initial.doc, 2, 2)),
            target: dropTarget(1),
        });

        expect(getState().doc.toString()).toBe('1. two\n2. one\n3. three');
        const moveDispatch = dispatch.mock.calls.find((call) => {
            const changes = call[0].changes;
            return Array.isArray(changes) && changes.some((change: { insert?: string }) => change.insert?.includes('2. two'));
        });
        expect(moveDispatch?.[0].changes).toHaveLength(2);
    });

    it('allows composite move into unselected gap between selected ranges', () => {
        const state = EditorState.create({ doc: 'a\nb\nc\nd\ne\nf' });
        const dispatch = vi.fn();
        const view = { state, dispatch } as unknown as EditorView;
        const applier = createApplier({
            view,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        const line2 = state.doc.line(2);
        const line5 = state.doc.line(5);
        applier.applyMoveCommand({
            source: selectionFromBlock({
                type: BlockType.Paragraph,
                startLine: 1,
                endLine: 4,
                from: line2.from,
                to: line5.to,
                indentLevel: 0,
                content: 'b\ne',
                }, [
                        { startLine: 1, endLine: 1 },
                        { startLine: 4, endLine: 4 },
                    ]),
            target: dropTarget(3),
        });

        expect(dispatch).toHaveBeenCalledTimes(2);
        expect(dispatch.mock.calls[0][0].changes).toBeUndefined();
    });

    it('moves block to end without merging with existing last line content', () => {
        const initialState = EditorState.create({ doc: 'alpha\nbeta\ngamma' });
        const { view, getState } = createMutableView(initialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
            () => 0 as unknown as ReturnType<typeof setTimeout>
        );
        const applier = createApplier({
            view,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        applier.applyMoveCommand({
            source: selectionFromBlock(createBlockFromLine(initialState.doc, 1)),
            target: dropTarget(initialState.doc.lines + 1),
        });

        expect(getState().doc.toString()).toBe('beta\ngamma\nalpha');
        setTimeoutSpy.mockRestore();
    });

    it('moves last line to another position without leaving an extra trailing blank line', () => {
        const initialState = EditorState.create({ doc: 'alpha\nbeta\ngamma' });
        const { view, getState } = createMutableView(initialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
            () => 0 as unknown as ReturnType<typeof setTimeout>
        );
        const applier = createApplier({
            view,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        applier.applyMoveCommand({
            source: selectionFromBlock(createBlockFromLine(initialState.doc, 3)),
            target: dropTarget(1),
        });

        expect(getState().doc.toString()).toBe('gamma\nalpha\nbeta');
        setTimeoutSpy.mockRestore();
    });

    it('moves last text line out of a terminal blank-line document while preserving terminal blank line', () => {
        const initialState = EditorState.create({ doc: 'alpha\nbeta\n' });
        const { view, getState } = createMutableView(initialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
            () => 0 as unknown as ReturnType<typeof setTimeout>
        );
        const applier = createApplier({
            view,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        applier.applyMoveCommand({
            source: selectionFromBlock(createBlockFromLine(initialState.doc, 2)),
            target: dropTarget(1),
        });

        expect(getState().doc.toString()).toBe('beta\nalpha\n');
        setTimeoutSpy.mockRestore();
    });

    it('moves last text line to the blank-tail insertion slot without dropping a line', () => {
        const initialState = EditorState.create({ doc: 'alpha\nbeta\n' });
        const { view, getState } = createMutableView(initialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
            () => 0 as unknown as ReturnType<typeof setTimeout>
        );
        const applier = createApplier({
            view,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        applier.applyMoveCommand({
            source: selectionFromBlock(createBlockFromLine(initialState.doc, 2)),
            target: dropTarget(initialState.doc.lines),
        });

        expect(getState().doc.toString()).toBe('alpha\nbeta\n');
        setTimeoutSpy.mockRestore();
    });

    it('moves a non-terminal source into penultimate line without removing trailing blank line', () => {
        const initialState = EditorState.create({ doc: 'alpha\nbeta\ngamma\n' });
        const { view, getState } = createMutableView(initialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
            () => 0 as unknown as ReturnType<typeof setTimeout>
        );
        const applier = createApplier({
            view,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        applier.applyMoveCommand({
            source: selectionFromBlock(createBlockFromLine(initialState.doc, 1)),
            target: dropTarget(initialState.doc.lines),
        });

        expect(getState().doc.toString()).toBe('beta\ngamma\nalpha\n');
        setTimeoutSpy.mockRestore();
    });

    it('moves last text line after terminal blank slot without dropping a line', () => {
        const initialState = EditorState.create({ doc: 'alpha\nbeta\n' });
        const { view, getState } = createMutableView(initialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
            () => 0 as unknown as ReturnType<typeof setTimeout>
        );
        const applier = createApplier({
            view,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        applier.applyMoveCommand({
            source: selectionFromBlock(createBlockFromLine(initialState.doc, 2)),
            target: dropTarget(initialState.doc.lines + 1),
        });

        expect(getState().doc.toString()).toBe('alpha\n\nbeta');
        setTimeoutSpy.mockRestore();
    });

    it('moves block into trailing empty last line while preserving terminal blank line', () => {
        const initialState = EditorState.create({ doc: 'alpha\nbeta\n' });
        const { view, getState } = createMutableView(initialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
            () => 0 as unknown as ReturnType<typeof setTimeout>
        );
        const applier = createApplier({
            view,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        applier.applyMoveCommand({
            source: selectionFromBlock(createBlockFromLine(initialState.doc, 1)),
            target: dropTarget(initialState.doc.lines),
        });

        expect(getState().doc.toString()).toBe('beta\nalpha\n');
        setTimeoutSpy.mockRestore();
    });

    it('keeps trailing empty line when targeting after the final blank line', () => {
        const initialState = EditorState.create({ doc: 'alpha\nbeta\n' });
        const { view, getState } = createMutableView(initialState);
        const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout').mockImplementation(
            () => 0 as unknown as ReturnType<typeof setTimeout>
        );
        const applier = createApplier({
            view,
            slotAt: () => ({
                slotContext: 'outside',
                decision: { allowDrop: true },
            }),
            parseLine: (line) => parseLineWithQuote(line, 4),
            listCtx: () => null,
            indentUnit: () => 2,
            insertText: (_doc, _sourceBlock, _targetLineNumber, sourceContent) => `${sourceContent}\n`,
        });

        applier.applyMoveCommand({
            source: selectionFromBlock(createBlockFromLine(initialState.doc, 1)),
            target: dropTarget(initialState.doc.lines + 1),
        });

        expect(getState().doc.toString()).toBe('beta\n\nalpha');
        setTimeoutSpy.mockRestore();
    });
});

