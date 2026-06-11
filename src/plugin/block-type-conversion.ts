import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { planBlockTypeConversionChanges, type BlockTypeConversion } from '../domain/block/block-type-conversion';
import { detectBlock } from '../domain/block/block-detector';
import { BlockType, type BlockInfo } from '../domain/block/block-types';
import { createDeleteCommand } from '../domain/command/delete-command';
import { createBlockSelection } from '../domain/selection/block-selection';
import { planBlockCommandTransaction } from '../domain/transaction/block-command-transaction';
import { applyBlockTransaction } from '../platform/codemirror/transaction/transaction-applier';
import type { CommandReject } from '../domain/transaction/command-reject';

export type BlockTypeConversionOption = { target: BlockTypeConversion; label: string; icon: string };

export const PARAGRAPH_BLOCK_TYPE_OPTION: BlockTypeConversionOption = {
    target: { type: BlockType.Paragraph },
    label: 'Paragraph',
    icon: 'pilcrow',
};

export const HEADING_BLOCK_TYPE_OPTIONS: BlockTypeConversionOption[] = [
    { target: { type: BlockType.Heading, level: 1 }, label: 'Heading 1', icon: 'heading-1' },
    { target: { type: BlockType.Heading, level: 2 }, label: 'Heading 2', icon: 'heading-2' },
    { target: { type: BlockType.Heading, level: 3 }, label: 'Heading 3', icon: 'heading-3' },
    { target: { type: BlockType.Heading, level: 4 }, label: 'Heading 4', icon: 'heading-4' },
    { target: { type: BlockType.Heading, level: 5 }, label: 'Heading 5', icon: 'heading-5' },
    { target: { type: BlockType.Heading, level: 6 }, label: 'Heading 6', icon: 'heading-6' },
];

export const LIST_BLOCK_TYPE_OPTIONS: BlockTypeConversionOption[] = [
    { target: { type: BlockType.ListItem, markerType: 'unordered' }, label: 'Bullet list', icon: 'list' },
    { target: { type: BlockType.ListItem, markerType: 'ordered' }, label: 'Numbered list', icon: 'list-ordered' },
    { target: { type: BlockType.ListItem, markerType: 'task' }, label: 'Task list', icon: 'list-checks' },
];

export const SIMPLE_BLOCK_TYPE_OPTIONS: BlockTypeConversionOption[] = [
    { target: { type: BlockType.Blockquote }, label: 'Quote', icon: 'quote' },
    { target: { type: BlockType.CodeBlock }, label: 'Code block', icon: 'code' },
    { target: { type: BlockType.MathBlock }, label: 'Math block', icon: 'sigma' },
];

export function convertCurrentBlockType(view: EditorView, conversion: BlockTypeConversion, pos?: number): boolean {
    const block = getBlockAtPos(view, pos);
    if (!block) return false;

    const changes = planBlockTypeConversionChanges(view.state.doc, block.startLine + 1, block.endLine + 1, conversion);
    if (changes.length === 0) return false;

    view.dispatch({
        changes,
        scrollIntoView: false,
    });
    return true;
}

export function deleteCurrentBlock(view: EditorView): boolean {
    const block = getBlockAtPos(view);
    if (!block) return false;

    const transaction = planBlockCommandTransaction({
        doc: view.state.doc,
        command: createDeleteCommand(createBlockSelection(block, [{
            startLine: block.startLine,
            endLine: block.endLine,
        }])),
    });
    if (isCommandReject(transaction)) return false;
    applyBlockTransaction(view, transaction, { anchor: block.from });
    return true;
}

export async function copyCurrentBlock(view: EditorView): Promise<boolean> {
    const text = getBlockAtPosText(view);
    if (text === null) return false;
    return writeClipboardText(text);
}

export async function cutCurrentBlock(view: EditorView): Promise<boolean> {
    const copied = await copyCurrentBlock(view);
    if (!copied) return false;
    return deleteCurrentBlock(view);
}

function getBlockAtPosText(view: EditorView): string | null {
    const block = getBlockAtPos(view);
    if (!block) return null;
    return view.state.doc.sliceString(block.from, block.to);
}

async function writeClipboardText(text: string): Promise<boolean> {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

function getBlockAtPos(view: EditorView, pos?: number): BlockInfo | null {
    const head = pos ?? view.state.selection.main.head;
    const lineNumber = view.state.doc.lineAt(head).number;
    const block = detectBlock(view.state, lineNumber, { tabSize: view.state.facet(EditorState.tabSize) });
    if (block) return block;
    const line = view.state.doc.line(lineNumber);
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

function isCommandReject(value: unknown): value is CommandReject {
    return typeof value === 'object'
        && value !== null
        && 'type' in value
        && value.type === 'reject';
}
