import { ParsedLine, ParsedListLine } from './types';

export function getIndentWidthFromIndentRaw(indentRaw: string, tabSize: number): number {
    const safeTabSize = tabSize > 0 ? tabSize : 4;
    let width = 0;
    for (const ch of indentRaw) {
        width += ch === '\t' ? safeTabSize : 1;
    }
    return width;
}

export function splitBlockquotePrefix(line: string): { prefix: string; rest: string } {
    const match = line.match(/^(\s*> ?)+/);
    if (!match) return { prefix: '', rest: line };
    return { prefix: match[0], rest: line.slice(match[0].length) };
}

export function getBlockquoteDepthFromLine(line: string): number {
    const match = line.match(/^(\s*> ?)+/);
    if (!match) return 0;
    const prefix = match[0];
    return (prefix.match(/>/g) || []).length;
}

export function parseListLine(line: string, tabSize: number): ParsedListLine {
    const indentMatch = line.match(/^(\s*)/);
    const indentRaw = indentMatch ? indentMatch[1] : '';
    const indentWidth = getIndentWidthFromIndentRaw(indentRaw, tabSize);
    const rest = line.slice(indentRaw.length);

    const taskMatch = rest.match(/^([-*+])\s\[[ xX]\]\s+/);
    if (taskMatch) {
        const marker = taskMatch[0];
        return { isListItem: true, indentRaw, indentWidth, marker, markerType: 'task', content: rest.slice(marker.length) };
    }

    const unorderedMatch = rest.match(/^([-*+])\s+/);
    if (unorderedMatch) {
        const marker = unorderedMatch[0];
        return { isListItem: true, indentRaw, indentWidth, marker, markerType: 'unordered', content: rest.slice(marker.length) };
    }

    const orderedMatch = rest.match(/^(\d+)[.)]\s+/);
    if (orderedMatch) {
        const marker = orderedMatch[0];
        return { isListItem: true, indentRaw, indentWidth, marker, markerType: 'ordered', content: rest.slice(marker.length) };
    }

    return { isListItem: false, indentRaw, indentWidth, marker: '', markerType: 'unordered', content: rest };
}

export function parseLineWithQuote(line: string, tabSize: number): ParsedLine {
    const quoteInfo = splitBlockquotePrefix(line);
    const parsed = parseListLine(quoteInfo.rest, tabSize);
    return {
        text: line,
        quotePrefix: quoteInfo.prefix,
        quoteDepth: getBlockquoteDepthFromLine(line),
        rest: quoteInfo.rest,
        isListItem: parsed.isListItem,
        indentRaw: parsed.indentRaw,
        indentWidth: parsed.indentWidth,
        marker: parsed.marker,
        markerType: parsed.markerType,
        content: parsed.content,
    };
}
