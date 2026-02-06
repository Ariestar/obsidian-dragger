import { EditorState, Text } from '@codemirror/state';
import { BlockType, BlockInfo } from '../types';

/**
 * 检测指定行的块类型
 */
export function detectBlockType(lineText: string): BlockType {
    const trimmed = lineText.trimStart();

    // 标题
    if (/^#{1,6}\s/.test(trimmed)) {
        return BlockType.Heading;
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

    // 水平分隔线
    if (/^(---|\*\*\*|___)$/.test(trimmed)) {
        return BlockType.HorizontalRule;
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

function splitBlockquotePrefix(lineText: string): { prefix: string; rest: string; depth: number } {
    const match = lineText.match(/^(\s*> ?)+/);
    if (!match) return { prefix: '', rest: lineText, depth: 0 };
    const prefix = match[0];
    const depth = (prefix.match(/>/g) || []).length;
    return { prefix, rest: lineText.slice(prefix.length), depth };
}

function isCalloutHeader(rest: string): boolean {
    return rest.trimStart().startsWith('[!');
}

function isBlockquoteStartLine(doc: Text, lineNumber: number, depth: number): boolean {
    for (let i = lineNumber - 1; i >= 1; i--) {
        const text = doc.line(i).text;
        if (text.trim().length === 0) continue;
        const info = splitBlockquotePrefix(text);
        if (info.depth === 0) return true;
        return info.depth < depth;
    }
    return true;
}

function getBlockquoteContainerRange(doc: Text, lineNumber: number, depth: number): { startLine: number; endLine: number } {
    let endLine = lineNumber;
    for (let i = lineNumber + 1; i <= doc.lines; i++) {
        const nextText = doc.line(i).text;
        const info = splitBlockquotePrefix(nextText);
        if (info.depth === 0) break;
        if (info.depth < depth) break;
        endLine = i;
    }
    return { startLine: lineNumber, endLine };
}

function getListItemOwnRangeInBlockquote(doc: Text, lineNumber: number, tabSize: number, depth: number): { startLine: number; endLine: number } {
    const lineText = doc.line(lineNumber).text;
    const currentInfo = parseListMarker(splitBlockquotePrefix(lineText).rest, tabSize);
    const currentIndent = currentInfo.indentWidth;
    let endLine = lineNumber;
    let sawBlank = false;

    for (let i = lineNumber + 1; i <= doc.lines; i++) {
        const nextLine = doc.line(i);
        const nextInfoQuote = splitBlockquotePrefix(nextLine.text);
        if (nextInfoQuote.depth === 0 || nextInfoQuote.depth < depth) break;
        const nextText = nextInfoQuote.rest;

        if (nextText.trim().length === 0) {
            const lookahead = findNextNonEmptyLineInBlockquote(doc, i + 1, tabSize, depth);
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
        if (!sawBlank || nextIndent > currentIndent) {
            endLine = i;
            continue;
        }

        break;
    }

    return { startLine: lineNumber, endLine };
}

function getListItemSubtreeRangeInBlockquote(doc: Text, lineNumber: number, tabSize: number, depth: number): { startLine: number; endLine: number } {
    const lineText = doc.line(lineNumber).text;
    const currentInfo = parseListMarker(splitBlockquotePrefix(lineText).rest, tabSize);
    const currentIndent = currentInfo.indentWidth;
    let endLine = lineNumber;
    let sawBlank = false;

    for (let i = lineNumber + 1; i <= doc.lines; i++) {
        const nextLine = doc.line(i);
        const nextInfoQuote = splitBlockquotePrefix(nextLine.text);
        if (nextInfoQuote.depth === 0 || nextInfoQuote.depth < depth) break;
        const nextText = nextInfoQuote.rest;

        if (nextText.trim().length === 0) {
            const lookahead = findNextNonEmptyLineInBlockquote(doc, i + 1, tabSize, depth);
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
        const nextType = detectBlockType(nextText);
        if (nextType !== BlockType.Paragraph && !nextInfo.isListItem) {
            break;
        }
        if (nextInfo.isListItem || !sawBlank || nextIndent > currentIndent) {
            endLine = i;
            continue;
        }

        break;
    }

    return { startLine: lineNumber, endLine };
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
        if (!sawBlank || nextIndent > currentIndent) {
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
        const nextType = detectBlockType(nextText);
        if (nextType !== BlockType.Paragraph && !nextInfo.isListItem) {
            break;
        }
        if (nextInfo.isListItem || !sawBlank || nextIndent > currentIndent) {
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

function findNextNonEmptyLineInBlockquote(
    doc: Text,
    fromLine: number,
    tabSize: number,
    minDepth: number
): { isListItem: boolean; indentWidth: number } | null {
    for (let i = fromLine; i <= doc.lines; i++) {
        const text = doc.line(i).text;
        const info = splitBlockquotePrefix(text);
        if (info.depth === 0 || info.depth < minDepth) return null;
        if (info.rest.trim().length === 0) continue;
        const parsed = parseListMarker(info.rest, tabSize);
        return { isListItem: parsed.isListItem, indentWidth: parsed.indentWidth };
    }
    return null;
}

function isBlockquoteLine(lineText: string): boolean {
    return lineText.trimStart().startsWith('>');
}

function isTableLine(lineText: string): boolean {
    return lineText.trimStart().startsWith('|');
}

function isMathFenceLine(lineText: string): boolean {
    return lineText.trimStart().startsWith('$$');
}

function isCodeFenceLine(lineText: string): boolean {
    return lineText.trimStart().startsWith('```');
}

function getBlockquoteDepthFromLine(lineText: string): number {
    const match = lineText.match(/^(\s*> ?)+/);
    if (!match) return 0;
    return (match[0].match(/>/g) || []).length;
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

function getMathRangeFromStart(doc: Text, startLine: number): { startLine: number; endLine: number } | null {
    const startText = doc.line(startLine).text.trimStart();
    if (!startText.startsWith('$$')) return null;
    const rest = startText.slice(2);
    if (rest.includes('$$')) {
        return { startLine, endLine: startLine };
    }

    for (let i = startLine + 1; i <= doc.lines; i++) {
        const nextLine = doc.line(i);
        if (isMathFenceLine(nextLine.text)) {
            return { startLine, endLine: i };
        }
    }

    return null;
}

function getCodeBlockRangeFromStart(doc: Text, startLine: number): { startLine: number; endLine: number } | null {
    const startText = doc.line(startLine).text.trimStart();
    if (!startText.startsWith('```')) return null;

    for (let i = startLine + 1; i <= doc.lines; i++) {
        const nextLine = doc.line(i);
        if (isCodeFenceLine(nextLine.text)) {
            return { startLine, endLine: i };
        }
    }

    return { startLine, endLine: startLine };
}

function findMathBlockRange(doc: Text, lineNumber: number): { startLine: number; endLine: number } | null {
    for (let i = lineNumber; i >= 1; i--) {
        const line = doc.line(i);
        if (!isMathFenceLine(line.text)) continue;
        const range = getMathRangeFromStart(doc, i);
        if (!range) return null;
        if (lineNumber <= range.endLine) return range;
        return null;
    }

    return null;
}

function findCodeBlockRange(doc: Text, lineNumber: number): { startLine: number; endLine: number } | null {
    for (let i = lineNumber; i >= 1; i--) {
        const line = doc.line(i);
        if (!isCodeFenceLine(line.text)) continue;
        const range = getCodeBlockRangeFromStart(doc, i);
        if (!range) return null;
        if (lineNumber <= range.endLine) return range;
        return null;
    }

    return null;
}

/**
 * 检测块的完整范围（包括多行块如代码块）
 */
export function detectBlock(state: EditorState, lineNumber: number): BlockInfo | null {
    const doc = state.doc;
    const tabSize = state.facet(EditorState.tabSize) || 2;

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
        const range = getListItemSubtreeRange(doc, lineNumber, tabSize);
        endLine = range.endLine;
    }

    if (blockType === BlockType.Blockquote) {
        const quoteInfo = splitBlockquotePrefix(lineText);
        const restType = detectBlockType(quoteInfo.rest);
        const isHeader = isCalloutHeader(quoteInfo.rest) || isBlockquoteStartLine(doc, lineNumber, quoteInfo.depth);

        if (isHeader) {
            const range = getBlockquoteContainerRange(doc, lineNumber, quoteInfo.depth);
            startLine = range.startLine;
            endLine = range.endLine;
        } else if (restType === BlockType.ListItem) {
            const range = getListItemSubtreeRangeInBlockquote(doc, lineNumber, tabSize, quoteInfo.depth);
            startLine = range.startLine;
            endLine = range.endLine;
            blockType = BlockType.ListItem;
        } else {
            startLine = lineNumber;
            endLine = lineNumber;
            blockType = BlockType.Paragraph;
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

export function getListItemOwnRangeForHandle(state: EditorState, lineNumber: number): { startLine: number; endLine: number } | null {
    const doc = state.doc;
    if (lineNumber < 1 || lineNumber > doc.lines) return null;
    const lineText = doc.line(lineNumber).text;
    const blockType = detectBlockType(lineText);
    const tabSize = state.facet(EditorState.tabSize) || 2;
    if (blockType === BlockType.ListItem) {
        return getListItemOwnRange(doc, lineNumber, tabSize);
    }
    if (blockType !== BlockType.Blockquote) return null;

    const quoteInfo = splitBlockquotePrefix(lineText);
    if (quoteInfo.depth === 0) return null;
    const restType = detectBlockType(quoteInfo.rest);
    if (restType !== BlockType.ListItem) return null;
    return getListItemOwnRangeInBlockquote(doc, lineNumber, tabSize, quoteInfo.depth);
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
