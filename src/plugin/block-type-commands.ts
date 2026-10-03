import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { detectBlock, planConvert, planDelete, selectOne, type ConvertTo, type Block } from 'md-dragger/domain';

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
    if ('type' in result) return false;

    view.dispatch({
        changes: result.changes,
        scrollIntoView: false,
    });
    return true;
}

export async function copyCurrentBlock(view: EditorView, lineNumber?: number): Promise<boolean> {
    const block = getBlockAt(view, lineNumber);
    if (!block) return false;
    const from = view.state.doc.line(block.lines.startLine).from;
    const to = view.state.doc.line(block.lines.endLine).to;
    const text = view.state.doc.sliceString(from, to);
    if (typeof navigator === 'undefined' || !navigator.clipboard) return false;
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch {
        return false;
    }
}

export async function cutCurrentBlock(view: EditorView, lineNumber?: number): Promise<boolean> {
    const copied = await copyCurrentBlock(view, lineNumber);
    if (!copied) return false;
    return deleteCurrentBlock(view, lineNumber);
}

function getBlockAt(view: EditorView, lineNumber?: number): Block | null {
    const resolved = lineNumber ?? view.state.doc.lineAt(view.state.selection.main.head).number;
    return detectBlock(view.state.doc, resolved, {
        tabSize: view.state.facet(EditorState.tabSize),
    });
}
