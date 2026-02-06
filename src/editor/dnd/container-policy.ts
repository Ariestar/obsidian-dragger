import { BlockInfo, BlockType } from '../../types';
import { detectBlock } from '../block-detector';
import { getBlockquoteDepthFromLine } from './line-parser';
import { DocLike, StateWithDoc } from './types';

type ContainerType = BlockType.ListItem | BlockType.Blockquote | BlockType.Callout;
export type DetectBlockFn = (state: StateWithDoc, lineNumber: number) => BlockInfo | null;

function isCalloutLine(text: string): boolean {
    return /^(\s*> ?)+\s*\[!/.test(text.trimStart());
}

export function getPreviousNonEmptyLineNumber(doc: DocLike, lineNumber: number): number | null {
    for (let i = lineNumber; i >= 1; i--) {
        const text = doc.line(i).text;
        if (text.trim().length === 0) continue;
        return i;
    }
    return null;
}

export function getNextNonEmptyLineNumber(doc: DocLike, lineNumber: number): number | null {
    for (let i = lineNumber; i <= doc.lines; i++) {
        const text = doc.line(i).text;
        if (text.trim().length === 0) continue;
        return i;
    }
    return null;
}

export function getContainerTypeForBlock(doc: DocLike, block: BlockInfo): ContainerType | null {
    if (block.type === BlockType.ListItem) return BlockType.ListItem;
    if (block.type === BlockType.Callout) return BlockType.Callout;
    if (block.type !== BlockType.Blockquote) return null;

    const startLineText = doc.line(block.startLine + 1).text.trimStart();
    if (isCalloutLine(startLineText)) return BlockType.Callout;
    return BlockType.Blockquote;
}

export function getSourceContainerType(sourceBlock: BlockInfo): ContainerType | null {
    if (sourceBlock.type === BlockType.ListItem) return BlockType.ListItem;
    if (sourceBlock.type === BlockType.Callout) return BlockType.Callout;
    if (sourceBlock.type !== BlockType.Blockquote) return null;

    const firstLine = sourceBlock.content.split('\n', 1)[0]?.trimStart() ?? '';
    if (isCalloutLine(firstLine)) return BlockType.Callout;
    return BlockType.Blockquote;
}

export function buildSyntheticLineBlock(doc: DocLike, lineNumber: number, type: BlockType): BlockInfo {
    const lineObj = doc.line(lineNumber);
    return {
        type,
        startLine: lineNumber - 1,
        endLine: lineNumber - 1,
        from: lineObj.from ?? 0,
        to: lineObj.to ?? 0,
        indentLevel: 0,
        content: lineObj.text,
    };
}

export function findEnclosingListBlock(
    state: StateWithDoc,
    lineNumber: number,
    detectBlockFn: DetectBlockFn = detectBlock as unknown as DetectBlockFn
): BlockInfo | null {
    const doc = state.doc;
    if (lineNumber < 1 || lineNumber > doc.lines) return null;

    const radius = 8;
    const minLine = Math.max(1, lineNumber - radius);
    const maxLine = Math.min(doc.lines, lineNumber + radius);
    let best: BlockInfo | null = null;

    for (let ln = minLine; ln <= maxLine; ln++) {
        const block = detectBlockFn(state, ln);
        if (!block || block.type !== BlockType.ListItem) continue;
        const blockStart = block.startLine + 1;
        const blockEnd = block.endLine + 1;
        if (lineNumber < blockStart || lineNumber > blockEnd) continue;

        if (!best || (block.endLine - block.startLine) > (best.endLine - best.startLine)) {
            best = block;
        }
    }

    return best;
}

export function getContainerInfoAtLine(
    state: StateWithDoc,
    lineNumber: number,
    detectBlockFn: DetectBlockFn = detectBlock as unknown as DetectBlockFn
): { type: ContainerType; block: BlockInfo } | null {
    const doc = state.doc;
    if (lineNumber < 1 || lineNumber > doc.lines) return null;

    const directBlock = detectBlockFn(state, lineNumber);
    if (directBlock) {
        const directType = getContainerTypeForBlock(doc, directBlock);
        if (directType) {
            return { type: directType, block: directBlock };
        }
    }

    const enclosingListBlock = findEnclosingListBlock(state, lineNumber, detectBlockFn);
    if (enclosingListBlock) {
        return { type: BlockType.ListItem, block: enclosingListBlock };
    }

    const lineText = doc.line(lineNumber).text;
    const quoteDepth = getBlockquoteDepthFromLine(lineText);
    if (quoteDepth > 0) {
        let isCallout = false;
        for (let i = lineNumber; i >= 1; i--) {
            const text = doc.line(i).text;
            if (getBlockquoteDepthFromLine(text) === 0) break;
            if (isCalloutLine(text)) {
                isCallout = true;
                break;
            }
        }
        const type = isCallout ? BlockType.Callout : BlockType.Blockquote;
        return { type, block: buildSyntheticLineBlock(doc, lineNumber, type) };
    }

    return null;
}

export function getContainerContextAtInsertion(
    state: StateWithDoc,
    targetLineNumber: number,
    detectBlockFn: DetectBlockFn = detectBlock as unknown as DetectBlockFn
): { type: ContainerType; block: BlockInfo } | null {
    const doc = state.doc;
    const prevLineNumber = getPreviousNonEmptyLineNumber(doc, targetLineNumber - 1);
    const nextLineNumber = getNextNonEmptyLineNumber(doc, targetLineNumber);
    const strictCandidates = [
        targetLineNumber - 1,
        targetLineNumber,
        targetLineNumber + 1,
        prevLineNumber,
        nextLineNumber,
    ].filter((v): v is number => typeof v === 'number' && v >= 1 && v <= doc.lines);
    const seen = new Set<number>();

    for (const lineNumber of strictCandidates) {
        if (seen.has(lineNumber)) continue;
        seen.add(lineNumber);

        const infoAtLine = getContainerInfoAtLine(state, lineNumber, detectBlockFn);
        if (!infoAtLine) continue;

        const blockTopBoundary = infoAtLine.block.startLine + 1;
        const blockBottomBoundary = infoAtLine.block.endLine + 2;
        const isInsideContainer = targetLineNumber > blockTopBoundary
            && targetLineNumber < blockBottomBoundary;
        if (!isInsideContainer) continue;

        return infoAtLine;
    }

    const prevInfo = typeof prevLineNumber === 'number'
        ? getContainerInfoAtLine(state, prevLineNumber, detectBlockFn)
        : null;
    const nextInfo = typeof nextLineNumber === 'number'
        ? getContainerInfoAtLine(state, nextLineNumber, detectBlockFn)
        : null;
    const targetLineText = targetLineNumber <= doc.lines ? doc.line(targetLineNumber).text : '';
    const targetLineIsBlank = targetLineText.trim().length === 0;
    if (!targetLineIsBlank && prevInfo && nextInfo && prevInfo.type === nextInfo.type) {
        return prevInfo;
    }

    return null;
}

export function shouldPreventDropIntoDifferentContainer(
    state: StateWithDoc,
    sourceBlock: BlockInfo,
    targetLineNumber: number,
    detectBlockFn: DetectBlockFn = detectBlock as unknown as DetectBlockFn
): boolean {
    const targetContainer = getContainerContextAtInsertion(state, targetLineNumber, detectBlockFn);
    if (!targetContainer) return false;

    const sourceContainerType = getSourceContainerType(sourceBlock);
    if (sourceContainerType === targetContainer.type) return false;

    return true;
}
