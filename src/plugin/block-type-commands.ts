import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
    detectBlock,
    planConvert,
    planDelete,
    selectOne,
    isReject,
    type ConvertTo,
    type Block,
    BlockType,
} from 'md-dragger/domain';

export type BlockTypeConversionOption = { target: ConvertTo; label: string; icon: string };

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

export function convertCurrentBlockType(view: EditorView, conversion: ConvertTo, lineNumber?: number): boolean {
    const block = getBlockAt(view, lineNumber);
    if (!block) return false;

    const changes = planConvert({
        doc: view.state.doc,
        block,
        to: conversion,
    });
    if (changes.length === 0) return false;

    view.dispatch({
        changes,
        scrollIntoView: false,
    });
    return true;
}

export function deleteCurrentBlock(view: EditorView, lineNumber?: number): boolean {
    const block = getBlockAt(view, lineNumber);
    if (!block) return false;

    const result = planDelete({
        doc: view.state.doc,
        selection: selectOne(block),
    });
    if (isReject(result)) return false;

    view.dispatch({
        changes: result.changes,
        scrollIntoView: false,
    });
    return true;
}

export async function copyCurrentBlock(view: EditorView, lineNumber?: number): Promise<boolean> {
    const text = getBlockAtText(view, lineNumber);
    if (text === null) return false;
    return writeClipboardText(text);
}

export async function cutCurrentBlock(view: EditorView, lineNumber?: number): Promise<boolean> {
    const copied = await copyCurrentBlock(view, lineNumber);
    if (!copied) return false;
    return deleteCurrentBlock(view, lineNumber);
}

function getBlockAtText(view: EditorView, lineNumber?: number): string | null {
    const block = getBlockAt(view, lineNumber);
    if (!block) return null;
    const from = view.state.doc.line(block.lines.startLine).from;
    const to = view.state.doc.line(block.lines.endLine).to;
    return view.state.doc.sliceString(from, to);
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

function getBlockAt(view: EditorView, lineNumber?: number): Block | null {
    const resolved = lineNumber ?? view.state.doc.lineAt(view.state.selection.main.head).number;
    return detectBlock(view.state.doc, resolved, {
        tabSize: view.state.facet(EditorState.tabSize),
    });
}
