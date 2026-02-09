import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../types';
import { detectBlock } from '../core/block-detector';
import { EMBED_BLOCK_SELECTOR } from '../core/selectors';

export type LineRange = {
    startLineNumber: number;
    endLineNumber: number;
};

export type RangeSelectionBoundary = {
    startLineNumber: number;
    endLineNumber: number;
    representativeLineNumber: number;
};

export type RangeSelectConfig = {
    longPressMs: number;
};

export type CommittedRangeSelection = {
    selectedBlock: BlockInfo;
    ranges: LineRange[];
};

export type MouseRangeSelectState = {
    sourceBlock: BlockInfo;
    dragSourceBlock: BlockInfo;
    selectedBlock: BlockInfo;
    pointerId: number;
    startX: number;
    startY: number;
    latestX: number;
    latestY: number;
    pointerType: string | null;
    dragReady: boolean;
    longPressReady: boolean;
    isIntercepting: boolean;
    timeoutId: number | null;
    dragTimeoutId: number | null;
    sourceHandle: HTMLElement | null;
    sourceHandleDraggableAttr: string | null;
    anchorStartLineNumber: number;
    anchorEndLineNumber: number;
    currentLineNumber: number;
    committedRangesSnapshot: LineRange[];
    selectionRanges: LineRange[];
};

export function normalizeLineRange(docLines: number, startLineNumber: number, endLineNumber: number): LineRange {
    const safeStart = Math.max(1, Math.min(docLines, Math.min(startLineNumber, endLineNumber)));
    const safeEnd = Math.max(1, Math.min(docLines, Math.max(startLineNumber, endLineNumber)));
    return {
        startLineNumber: safeStart,
        endLineNumber: safeEnd,
    };
}

export function mergeLineRanges(docLines: number, ranges: LineRange[]): LineRange[] {
    const normalized = ranges
        .map((range) => normalizeLineRange(docLines, range.startLineNumber, range.endLineNumber))
        .sort((a, b) => a.startLineNumber - b.startLineNumber);
    const merged: LineRange[] = [];
    for (const range of normalized) {
        const last = merged[merged.length - 1];
        if (!last || range.startLineNumber > last.endLineNumber + 1) {
            merged.push({ ...range });
            continue;
        }
        if (range.endLineNumber > last.endLineNumber) {
            last.endLineNumber = range.endLineNumber;
        }
    }
    return merged;
}

export function cloneLineRanges(ranges: LineRange[]): LineRange[] {
    return ranges.map((range) => ({ ...range }));
}

export function cloneBlockInfo(block: BlockInfo): BlockInfo {
    return {
        ...block,
        compositeSelection: block.compositeSelection
            ? {
                ranges: block.compositeSelection.ranges.map((range) => ({ ...range })),
            }
            : undefined,
    };
}

export function buildBlockInfoFromLineRange(
    doc: { line: (n: number) => { from: number; to: number }; lines: number; sliceString: (from: number, to: number) => string },
    startLineNumber: number,
    endLineNumber: number,
    template: BlockInfo
): BlockInfo {
    const safeStart = Math.max(1, Math.min(doc.lines, startLineNumber));
    const safeEnd = Math.max(safeStart, Math.min(doc.lines, endLineNumber));
    const startLine = doc.line(safeStart);
    const endLine = doc.line(safeEnd);
    return {
        type: template.type,
        startLine: safeStart - 1,
        endLine: safeEnd - 1,
        from: startLine.from,
        to: endLine.to,
        indentLevel: template.indentLevel,
        content: doc.sliceString(startLine.from, endLine.to),
    };
}

export function buildDragSourceFromLineRanges(
    doc: { line: (n: number) => { from: number; to: number; number: number }; lines: number; length: number; sliceString: (from: number, to: number) => string },
    ranges: LineRange[],
    template: BlockInfo
): BlockInfo {
    const normalizedRanges = mergeLineRanges(doc.lines, ranges);
    if (normalizedRanges.length === 0) {
        return buildBlockInfoFromLineRange(doc, template.startLine + 1, template.endLine + 1, template);
    }
    if (normalizedRanges.length === 1) {
        const range = normalizedRanges[0];
        return buildBlockInfoFromLineRange(doc, range.startLineNumber, range.endLineNumber, template);
    }

    const firstRange = normalizedRanges[0];
    const lastRange = normalizedRanges[normalizedRanges.length - 1];
    const firstLine = doc.line(firstRange.startLineNumber);
    const lastLine = doc.line(lastRange.endLineNumber);
    const content = normalizedRanges.map((range) => {
        const startLine = doc.line(range.startLineNumber);
        const endLine = doc.line(range.endLineNumber);
        const from = startLine.from;
        const to = Math.min(endLine.to + 1, doc.length);
        return doc.sliceString(from, to);
    }).join('');

    return {
        type: template.type,
        startLine: firstRange.startLineNumber - 1,
        endLine: lastRange.endLineNumber - 1,
        from: firstLine.from,
        to: lastLine.to,
        indentLevel: template.indentLevel,
        content,
        compositeSelection: {
            ranges: normalizedRanges.map((range) => ({
                startLine: range.startLineNumber - 1,
                endLine: range.endLineNumber - 1,
            })),
        },
    };
}

export function resolveBlockBoundaryAtLine(
    state: { doc: { lines: number; lineAt: (pos: number) => { number: number } } },
    lineNumber: number
): { startLineNumber: number; endLineNumber: number } {
    const doc = state.doc;
    const clampedLine = Math.max(1, Math.min(doc.lines, lineNumber));
    const block = detectBlock(state as any, clampedLine);
    if (!block) {
        return {
            startLineNumber: clampedLine,
            endLineNumber: clampedLine,
        };
    }
    return {
        startLineNumber: Math.max(1, block.startLine + 1),
        endLineNumber: Math.min(doc.lines, block.endLine + 1),
    };
}

export function resolveBlockAlignedLineRange(
    state: { doc: { lines: number; lineAt: (pos: number) => { number: number } } },
    anchorStartLineNumber: number,
    anchorEndLineNumber: number,
    targetBlockStartLineNumber: number,
    targetBlockEndLineNumber: number
): { startLineNumber: number; endLineNumber: number } {
    const docLines = state.doc.lines;
    let startLineNumber = Math.max(1, Math.min(docLines, Math.min(anchorStartLineNumber, targetBlockStartLineNumber)));
    let endLineNumber = Math.max(1, Math.min(docLines, Math.max(anchorEndLineNumber, targetBlockEndLineNumber)));

    let changed = true;
    while (changed) {
        changed = false;
        let cursor = startLineNumber;
        while (cursor <= endLineNumber) {
            const boundary = resolveBlockBoundaryAtLine(state, cursor);
            if (boundary.startLineNumber < startLineNumber) {
                startLineNumber = boundary.startLineNumber;
                changed = true;
            }
            if (boundary.endLineNumber > endLineNumber) {
                endLineNumber = boundary.endLineNumber;
                changed = true;
            }
            cursor = Math.max(cursor + 1, boundary.endLineNumber + 1);
        }
    }

    return { startLineNumber, endLineNumber };
}

export function resolveLineNumberForRangeSelection(
    view: EditorView,
    clientY: number
): number | null {
    const doc = view.state.doc;
    if (doc.lines <= 0) return null;
    const contentRect = view.contentDOM.getBoundingClientRect();
    if (clientY <= contentRect.top) return 1;
    if (clientY >= contentRect.bottom) return doc.lines;

    const probeXs = [
        contentRect.left + 40,
        contentRect.left + 96,
        contentRect.left + Math.max(12, Math.min(160, contentRect.width / 2)),
    ].map((x) => Math.max(contentRect.left + 2, Math.min(contentRect.right - 2, x)));
    for (const x of probeXs) {
        let pos: number | null = null;
        try {
            pos = view.posAtCoords({ x, y: clientY });
        } catch {
            pos = null;
        }
        if (pos !== null) {
            const lineNumber = doc.lineAt(pos).number;
            return Math.max(1, Math.min(doc.lines, lineNumber));
        }
    }

    const lineEl = getLineElementAtY(view, clientY);
    if (lineEl && typeof view.posAtDOM === 'function') {
        try {
            const pos = view.posAtDOM(lineEl, 0);
            const lineNumber = doc.lineAt(pos).number;
            return Math.max(1, Math.min(doc.lines, lineNumber));
        } catch {
            // ignore DOM-pos mapping failures and fall through
        }
    }
    return null;
}

export function getLineElementAtY(view: EditorView, clientY: number): HTMLElement | null {
    const lines = Array.from(view.contentDOM.querySelectorAll('.cm-line')) as HTMLElement[];
    if (lines.length === 0) return null;
    let best: HTMLElement | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const lineEl of lines) {
        const rect = lineEl.getBoundingClientRect();
        if (clientY >= rect.top && clientY <= rect.bottom) return lineEl;
        const center = (rect.top + rect.bottom) / 2;
        const distance = Math.abs(center - clientY);
        if (distance < bestDistance) {
            bestDistance = distance;
            best = lineEl;
        }
    }
    return best;
}

export function resolveLineNumberFromDomNode(view: EditorView, node: Node): number | null {
    if (typeof view.posAtDOM !== 'function') return null;
    const doc = view.state.doc;
    const probes: Node[] = [node];
    if (node instanceof Element && node.firstChild) {
        probes.push(node.firstChild);
    }

    for (const probe of probes) {
        try {
            const pos = view.posAtDOM(probe, 0);
            const lineNumber = doc.lineAt(pos).number;
            return Math.max(1, Math.min(doc.lines, lineNumber));
        } catch {
            // ignore DOM-pos mapping failures and try next probe
        }
    }

    return null;
}

export function resolveTargetBoundaryForRangeSelection(
    view: EditorView,
    clientX: number,
    clientY: number,
    getBlockInfoAtPoint: (clientX: number, clientY: number) => BlockInfo | null
): RangeSelectionBoundary | null {
    const doc = view.state.doc;
    if (doc.lines <= 0) return null;
    const contentRect = view.contentDOM.getBoundingClientRect();
    const lineHeight = Math.max(12, Number((view as any).defaultLineHeight ?? 20));

    const probeXs = [
        clientX,
        contentRect.left + 6,
        contentRect.left + 40,
        contentRect.left + Math.max(18, Math.min(180, contentRect.width * 0.4)),
    ].map((x) => Math.max(contentRect.left + 2, Math.min(contentRect.right - 2, x)));
    const probeYs = [
        clientY,
        clientY - lineHeight * 0.6,
        clientY + lineHeight * 0.6,
        clientY - lineHeight * 1.2,
        clientY + lineHeight * 1.2,
    ].map((y) => Math.max(contentRect.top + 1, Math.min(contentRect.bottom - 1, y)));

    for (const y of probeYs) {
        const domBoundary = resolveDomHitBoundaryForRangeSelection(view, probeXs, y);
        if (domBoundary) {
            return domBoundary;
        }
        for (const x of probeXs) {
            let block: BlockInfo | null = null;
            try {
                block = getBlockInfoAtPoint(x, y);
            } catch {
                block = null;
            }
            if (!block) continue;
            const startLineNumber = Math.max(1, Math.min(doc.lines, block.startLine + 1));
            const endLineNumber = Math.max(1, Math.min(doc.lines, block.endLine + 1));
            const representativeLineNumber = Math.max(
                startLineNumber,
                Math.min(endLineNumber, doc.lineAt(block.from).number)
            );
            return {
                startLineNumber,
                endLineNumber,
                representativeLineNumber,
            };
        }
    }

    const fallbackLineNumber = resolveLineNumberForRangeSelection(view, clientY);
    if (fallbackLineNumber === null) return null;
    const fallbackBoundary = resolveBlockBoundaryAtLine(view.state, fallbackLineNumber);
    return {
        ...fallbackBoundary,
        representativeLineNumber: fallbackLineNumber,
    };
}

function resolveDomHitBoundaryForRangeSelection(
    view: EditorView,
    probeXs: number[],
    clientY: number
): RangeSelectionBoundary | null {
    if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
        return null;
    }

    for (const x of probeXs) {
        const hit = document.elementFromPoint(x, clientY) as HTMLElement | null;
        if (!hit || !view.dom.contains(hit)) continue;

        const candidates: Node[] = [];
        const pushCandidate = (candidate: Element | null): void => {
            if (!candidate) return;
            if (!candidates.includes(candidate)) {
                candidates.push(candidate);
            }
        };

        pushCandidate(hit.closest('.cm-line'));
        pushCandidate(hit.closest('.cm-embed-block'));
        pushCandidate(hit.closest(EMBED_BLOCK_SELECTOR));

        for (const candidate of candidates) {
            const lineNumber = resolveLineNumberFromDomNode(view, candidate);
            if (lineNumber === null) continue;
            const boundary = resolveBlockBoundaryAtLine(view.state, lineNumber);
            return {
                ...boundary,
                representativeLineNumber: lineNumber,
            };
        }
    }

    return null;
}
