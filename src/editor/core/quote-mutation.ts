import { DocLike } from './protocol-types';

export function stripBlockquoteDepth(line: string, removeDepth: number): string {
    let remaining = line;
    let removed = 0;
    while (removed < removeDepth) {
        const match = remaining.match(/^(\s*> ?)/);
        if (!match) break;
        remaining = remaining.slice(match[0].length);
        removed += 1;
    }
    return remaining;
}

export function adjustBlockquoteDepth(
    sourceContent: string,
    targetDepth: number,
    getDepthFromLine: (line: string) => number,
    baseDepthOverride?: number
): string {
    const lines = sourceContent.split('\n');
    let baseDepth = 0;
    if (typeof baseDepthOverride === 'number') {
        baseDepth = baseDepthOverride;
    } else {
        for (const line of lines) {
            if (line.trim().length === 0) continue;
            baseDepth = getDepthFromLine(line);
            break;
        }
    }

    const delta = targetDepth - baseDepth;
    if (delta === 0) return sourceContent;

    return lines.map((line) => {
        if (line.trim().length === 0) {
            return delta > 0 ? `${'> '.repeat(delta)}${line}` : stripBlockquoteDepth(line, -delta);
        }
        if (delta > 0) {
            return `${'> '.repeat(delta)}${line}`;
        }
        return stripBlockquoteDepth(line, -delta);
    }).join('\n');
}

export function getBlockquoteDepthContext(
    doc: DocLike,
    lineNumber: number,
    getDepthFromLine: (line: string) => number
): number {
    if (doc.lines <= 0) return 0;
    const startLine = Math.min(Math.max(1, lineNumber), doc.lines);
    for (let i = startLine; i >= 1; i--) {
        const text = doc.line(i).text;
        if (text.trim().length === 0) return 0;
        const depth = getDepthFromLine(text);
        if (depth > 0) return depth;
        return 0;
    }
    return 0;
}

export function getContentQuoteDepth(sourceContent: string, getDepthFromLine: (line: string) => number): number {
    const lines = sourceContent.split('\n');
    for (const line of lines) {
        if (line.trim().length === 0) continue;
        return getDepthFromLine(line);
    }
    return 0;
}
