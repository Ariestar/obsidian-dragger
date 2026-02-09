import { EditorState, Text } from '@codemirror/state';
import { BlockType, BlockInfo } from '../../types';
import { getLineMap, getLineMetaAt, peekCachedLineMap } from './line-map';
import {
    isHorizontalRuleLine,
    isBlockquoteLine,
    isTableLine,
} from './line-type-guards';
import { nowMs } from '../utils/timing';
import { splitBlockquotePrefix, getBlockquoteDepthFromLine } from './line-parsing';
import { findCodeBlockRange, findMathBlockRange, FenceRange } from './fence-scanner';
export { prewarmFenceScan } from './fence-scanner';

export function getHeadingLevel(lineText: string): number | null {
    const trimmed = lineText.trimStart();
    const match = trimmed.match(/^(#{1,6})\s+/);
    if (!match) return null;
    return match[1].length;
}


export function getHeadingSectionRange(doc: Text, lineNumber: number): { startLine: number; endLine: number } | null {
    if (lineNumber < 1 || lineNumber > doc.lines) return null;
    const currentHeadingLevel = getHeadingLevel(doc.line(lineNumber).text);
    if (!currentHeadingLevel) return null;

    let endLine = lineNumber;
    for (let i = lineNumber + 1; i <= doc.lines; i++) {
        const nextHeadingLevel = getHeadingLevel(doc.line(i).text);
        if (nextHeadingLevel !== null && nextHeadingLevel <= currentHeadingLevel) {
            break;
        }
        endLine = i;
    }

    return { startLine: lineNumber, endLine };
}

/**
 * 检测指定行的块类型
 */
export function detectBlockType(lineText: string): BlockType {
    const trimmed = lineText.trimStart();

    // 标题
    if (getHeadingLevel(lineText) !== null) {
        return BlockType.Heading;
    }

    // 水平分隔线（支持 ---、***、___ 以及 - - - 等空格变体）
    if (isHorizontalRuleLine(trimmed)) {
        return BlockType.HorizontalRule;
    }

    // 列表项（无序列表、有序列表、任务列表）
    if (/^[-*+]\s/.test(trimmed) || /^\d+\.\s/.test(trimmed) || /^[-*+]\s\[[ x]\]/.test(trimmed)) {
        return BlockType.ListItem;
    }

    // 代码块开始
    if (/^```/.test(trimmed)) {
        return BlockType.CodeBlock;
    }

    // 数学块（$$）
    if (/^\$\$/.test(trimmed)) {
        return BlockType.MathBlock;
    }

    // 引用块
    if (/^>/.test(trimmed)) {
        return BlockType.Blockquote;
    }

    // 表格（以|开头）
    if (/^\|/.test(trimmed)) {
        return BlockType.Table;
    }

    // 空行或普通段落
    if (trimmed.length === 0) {
        return BlockType.Unknown;
    }

    return BlockType.Paragraph;
}

/**
 * 获取行的缩进级别
 */
export function getIndentLevel(lineText: string, tabSize = 2): number {
    const match = lineText.match(/^(\s*)/);
    if (!match) return 0;

    const spaces = match[1];
    const width = getIndentWidthWithTabSize(spaces, tabSize);
    const unit = tabSize > 0 ? tabSize : 2;
    return Math.floor(width / unit);
}

function getIndentWidthWithTabSize(indentRaw: string, tabSize: number): number {
    const unit = tabSize > 0 ? tabSize : 2;
    let width = 0;
    for (const ch of indentRaw) {
        width += ch === '\t' ? unit : 1;
    }
    return width;
}

function getIndentWidth(lineText: string, tabSize: number): number {
    const match = lineText.match(/^(\s*)/);
    if (!match) return 0;
    return getIndentWidthWithTabSize(match[1], tabSize);
}

function parseListMarker(lineText: string, tabSize: number): { isListItem: boolean; indentWidth: number } {
    const match = lineText.match(/^(\s*)([-*+])\s\[[ xX]\]\s+/);
    if (match) {
        return { isListItem: true, indentWidth: getIndentWidthWithTabSize(match[1], tabSize) };
    }

    const unorderedMatch = lineText.match(/^(\s*)([-*+])\s+/);
    if (unorderedMatch) {
        return { isListItem: true, indentWidth: getIndentWidthWithTabSize(unorderedMatch[1], tabSize) };
    }

    const orderedMatch = lineText.match(/^(\s*)(\d+)[.)]\s+/);
    if (orderedMatch) {
        return { isListItem: true, indentWidth: getIndentWidthWithTabSize(orderedMatch[1], tabSize) };
    }

    return { isListItem: false, indentWidth: getIndentWidth(lineText, tabSize) };
}


function isCalloutHeader(restText: string): boolean {
    return restText.trimStart().startsWith('[!');
}

function isInsideCalloutContainer(doc: Text, lineNumber: number, depth: number): boolean {
    for (let i = lineNumber; i >= 1; i--) {
        const text = doc.line(i).text;
        const lineDepth = getBlockquoteDepthFromLine(text);
        if (lineDepth === 0 || lineDepth < depth) break;
        const info = splitBlockquotePrefix(text);
        if (isCalloutHeader(info.rest)) return true;
    }
    return false;
}

function getBlockquoteContainerRange(doc: Text, lineNumber: number, depth: number): { startLine: number; endLine: number } {
    let startLine = lineNumber;
    for (let i = lineNumber - 1; i >= 1; i--) {
        const d = getBlockquoteDepthFromLine(doc.line(i).text);
        if (d === 0 || d < depth) break;
        startLine = i;
    }

    let endLine = lineNumber;
    for (let i = lineNumber + 1; i <= doc.lines; i++) {
        const d = getBlockquoteDepthFromLine(doc.line(i).text);
        if (d === 0 || d < depth) break;
        endLine = i;
    }
    return { startLine, endLine };
}

function getListItemOwnRange(doc: Text, lineNumber: number, tabSize: number): { startLine: number; endLine: number } {
    const lineText = doc.line(lineNumber).text;
    const currentInfo = parseListMarker(lineText, tabSize);
    const currentIndent = currentInfo.indentWidth;
    let endLine = lineNumber;
    let sawBlank = false;

    for (let i = lineNumber + 1; i <= doc.lines; i++) {
        const nextLine = doc.line(i);
        const nextText = nextLine.text;

        if (nextText.trim().length === 0) {
            // 空行仅在后续有缩进续行时归属当前项
            const lookahead = findNextNonEmptyLine(doc, i + 1, tabSize);
            if (!lookahead || lookahead.indentWidth <= currentIndent || lookahead.isListItem) {
                break;
            }
            endLine = i;
            sawBlank = true;
            continue;
        }

        const nextInfo = parseListMarker(nextText, tabSize);
        if (nextInfo.isListItem) {
            break;
        }

        const nextIndent = getIndentWidth(nextText, tabSize);
        const nextType = detectBlockType(nextText);
        if (nextType !== BlockType.Paragraph) {
            break;
        }
        if (nextIndent > currentIndent) {
            endLine = i;
            continue;
        }

        break;
    }

    return { startLine: lineNumber, endLine };
}

function getListItemSubtreeRange(doc: Text, lineNumber: number, tabSize: number): { startLine: number; endLine: number } {
    const lineText = doc.line(lineNumber).text;
    const currentInfo = parseListMarker(lineText, tabSize);
    const currentIndent = currentInfo.indentWidth;
    let endLine = lineNumber;
    let sawBlank = false;

    for (let i = lineNumber + 1; i <= doc.lines; i++) {
        const nextLine = doc.line(i);
        const nextText = nextLine.text;

        if (nextText.trim().length === 0) {
            const lookahead = findNextNonEmptyLine(doc, i + 1, tabSize);
            if (!lookahead || (lookahead.isListItem && lookahead.indentWidth <= currentIndent) || lookahead.indentWidth <= currentIndent) {
                break;
            }
            endLine = i;
            sawBlank = true;
            continue;
        }

        const nextInfo = parseListMarker(nextText, tabSize);
        if (nextInfo.isListItem && nextInfo.indentWidth <= currentIndent) {
            break;
        }

        const nextIndent = getIndentWidth(nextText, tabSize);
        if (nextInfo.isListItem || nextIndent > currentIndent) {
            endLine = i;
            continue;
        }

        break;
    }

    return { startLine: lineNumber, endLine };
}

function findNextNonEmptyLine(doc: Text, fromLine: number, tabSize: number): { isListItem: boolean; indentWidth: number } | null {
    for (let i = fromLine; i <= doc.lines; i++) {
        const text = doc.line(i).text;
        if (text.trim().length === 0) continue;
        const info = parseListMarker(text, tabSize);
        return { isListItem: info.isListItem, indentWidth: info.indentWidth };
    }
    return null;
}



function getBlockquoteSubtreeRange(doc: Text, lineNumber: number): { startLine: number; endLine: number } {
    const lineText = doc.line(lineNumber).text;
    const currentDepth = getBlockquoteDepthFromLine(lineText);
    let endLine = lineNumber;

    for (let i = lineNumber + 1; i <= doc.lines; i++) {
        const nextText = doc.line(i).text;
        if (!isBlockquoteLine(nextText)) break;
        const nextDepth = getBlockquoteDepthFromLine(nextText);
        if (nextDepth < currentDepth) break;
        endLine = i;
    }

    return { startLine: lineNumber, endLine };
}

const blockDetectionCache = new WeakMap<Text, Map<number, Map<number, BlockInfo | null>>>();
const LIST_LINE_MAP_COLD_BUILD_MAX_LINES = 30_000;

type DetectBlockPerfDurationKey = 'detect_block_uncached';

let detectBlockPerfRecorder: ((key: DetectBlockPerfDurationKey, durationMs: number) => void) | null = null;

function recordDetectBlockPerf(key: DetectBlockPerfDurationKey, durationMs: number): void {
    if (!detectBlockPerfRecorder) return;
    if (!isFinite(durationMs) || durationMs < 0) return;
    detectBlockPerfRecorder(key, durationMs);
}

export function setDetectBlockPerfRecorder(
    recorder: ((key: DetectBlockPerfDurationKey, durationMs: number) => void) | null
): void {
    detectBlockPerfRecorder = recorder;
}

/**
 * 检测块的完整范围（包括多行块如代码块）
 */
function detectBlockUncached(state: EditorState, lineNumber: number, tabSize: number): BlockInfo | null {
    const doc = state.doc;

    if (lineNumber < 1 || lineNumber > doc.lines) {
        return null;
    }

    const line = doc.line(lineNumber);
    const lineText = line.text;
    let blockType = detectBlockType(lineText);

    const codeRange = findCodeBlockRange(doc, lineNumber);
    const mathRange = findMathBlockRange(doc, lineNumber);
    if (codeRange) {
        blockType = BlockType.CodeBlock;
    }
    if (mathRange) {
        blockType = BlockType.MathBlock;
    }

    if (blockType === BlockType.Unknown) {
        return null;
    }

    let startLine = lineNumber;
    let endLine = lineNumber;

    if (blockType === BlockType.CodeBlock && codeRange) {
        startLine = codeRange.startLine;
        endLine = codeRange.endLine;
    }

    if (blockType === BlockType.MathBlock && mathRange) {
        startLine = mathRange.startLine;
        endLine = mathRange.endLine;
    }

    // 代码块：找到结束的```
    // （已由 codeRange 统一处理）

    // 列表项：包含其子项
    if (blockType === BlockType.ListItem) {
        let lineMap = peekCachedLineMap(state, { tabSize });
        if (!lineMap && doc.lines <= LIST_LINE_MAP_COLD_BUILD_MAX_LINES) {
            lineMap = getLineMap(state, { tabSize });
        }

        const lineMeta = lineMap ? getLineMetaAt(lineMap, lineNumber) : null;
        const subtreeEndLine = lineMeta?.isList && lineMap
            ? lineMap.listSubtreeEndLine[lineNumber]
            : 0;

        if (subtreeEndLine >= lineNumber) {
            endLine = subtreeEndLine;
        } else {
            const range = getListItemSubtreeRange(doc, lineNumber, tabSize);
            endLine = range.endLine;
        }
    }

    if (blockType === BlockType.Blockquote) {
        const quoteDepth = getBlockquoteDepthFromLine(lineText);
        const inCallout = isInsideCalloutContainer(doc, lineNumber, quoteDepth);
        if (inCallout) {
            const range = getBlockquoteContainerRange(doc, lineNumber, quoteDepth);
            startLine = range.startLine;
            endLine = range.endLine;
            blockType = BlockType.Callout;
        } else {
            // Regular blockquotes are line-level blocks so sibling lines can be reordered.
            startLine = lineNumber;
            endLine = lineNumber;
            blockType = BlockType.Blockquote;
        }
    }

    // 表格：向上合并连续的|行
    if (blockType === BlockType.Table) {
        for (let i = lineNumber - 1; i >= 1; i--) {
            const prevLine = doc.line(i);
            if (isTableLine(prevLine.text)) {
                startLine = i;
            } else {
                break;
            }
        }
    }

    // 表格：连续的|行
    if (blockType === BlockType.Table) {
        for (let i = lineNumber + 1; i <= doc.lines; i++) {
            const nextLine = doc.line(i);
            if (isTableLine(nextLine.text)) {
                endLine = i;
            } else {
                break;
            }
        }
    }

    const startLineObj = doc.line(startLine);
    const endLineObj = doc.line(endLine);
    const startLineText = startLineObj.text;

    // 收集块内容
    let content = '';
    for (let i = startLine; i <= endLine; i++) {
        content += doc.line(i).text;
        if (i < endLine) content += '\n';
    }

    return {
        type: blockType,
        startLine: startLine - 1, // 转为0-indexed
        endLine: endLine - 1,
        from: startLineObj.from,
        to: endLineObj.to,
        indentLevel: getIndentLevel(startLineText, tabSize),
        content,
    };
}

/**
 * hot path cache: drag move 每帧会重复查询同一行块信息
 */
export function detectBlock(state: EditorState, lineNumber: number): BlockInfo | null {
    const doc = state.doc;
    const tabSize = state.facet(EditorState.tabSize) || 2;

    let cacheByTabSize = blockDetectionCache.get(doc);
    if (!cacheByTabSize) {
        cacheByTabSize = new Map<number, Map<number, BlockInfo | null>>();
        blockDetectionCache.set(doc, cacheByTabSize);
    }
    let perDocCache = cacheByTabSize.get(tabSize);
    if (!perDocCache) {
        perDocCache = new Map<number, BlockInfo | null>();
        cacheByTabSize.set(tabSize, perDocCache);
    }

    if (perDocCache.has(lineNumber)) {
        return perDocCache.get(lineNumber) ?? null;
    }

    const startedAt = nowMs();
    const detected = detectBlockUncached(state, lineNumber, tabSize);
    recordDetectBlockPerf('detect_block_uncached', nowMs() - startedAt);
    perDocCache.set(lineNumber, detected);
    return detected;
}

export function getListItemOwnRangeForHandle(state: EditorState, lineNumber: number): { startLine: number; endLine: number } | null {
    const doc = state.doc;
    if (lineNumber < 1 || lineNumber > doc.lines) return null;
    const lineText = doc.line(lineNumber).text;
    const blockType = detectBlockType(lineText);
    const tabSize = state.facet(EditorState.tabSize) || 2;
    if (blockType === BlockType.ListItem) {
        return getListItemOwnRange(doc, lineNumber, tabSize);
    }
    return null;
}

/**
 * 获取文档中所有块的信息
 */
export function getAllBlocks(state: EditorState): BlockInfo[] {
    const blocks: BlockInfo[] = [];
    const doc = state.doc;
    let currentLine = 1;

    while (currentLine <= doc.lines) {
        const block = detectBlock(state, currentLine);
        if (block) {
            blocks.push(block);
            currentLine = block.endLine + 2; // 跳过已处理的行（转回1-indexed）
        } else {
            currentLine++;
        }
    }

    return blocks;
}
