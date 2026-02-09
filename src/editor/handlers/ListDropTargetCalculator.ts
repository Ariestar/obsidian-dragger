import { EditorView } from '@codemirror/view';
import { BlockInfo, BlockType } from '../../types';
import {
    getLineMap,
    getLineMetaAt,
    getNearestListLineAtOrBefore,
    LineMap,
} from '../core/line-map';
import { GeometryFrameCache, getCoordsAtPos } from '../core/drop-target';
import { DocLike, ParsedLine } from '../core/protocol-types';
import { ListTargetSessionCache } from './ListTargetSessionCache';

export type ListDropTargetInfo = {
    listContextLineNumber?: number;
    listIndentDelta?: number;
    listTargetIndentWidth?: number;
    highlightRect?: { top: number; left: number; width: number; height: number };
    lineRectSourceLineNumber?: number;
};

export interface ListDropTargetCalculatorDeps {
    parseLineWithQuote: (line: string) => ParsedLine;
    getPreviousNonEmptyLineNumber: (doc: DocLike, lineNumber: number) => number | null;
    getIndentUnitWidthForDoc: (doc: DocLike) => number;
    getBlockRect: (
        startLineNumber: number,
        endLineNumber: number,
        frameCache?: GeometryFrameCache
    ) => { top: number; left: number; width: number; height: number } | undefined;
    incrementPerfCounter?: (
        key: 'list_ancestor_scan_steps' | 'list_parent_scan_steps' | 'highlight_scan_lines',
        delta?: number
    ) => void;
}

type ListCalcMemo = {
    parsedLineByLine: Map<number, ParsedLine>;
    markerBoundsByLine: Map<number, { markerStartX: number; contentStartX: number } | null>;
    listIndentByLine: Map<number, number | undefined>;
};

type ListCalcContext = {
    doc: { line: (n: number) => { text: string; from: number; to: number }; lines: number };
    lineMap: LineMap;
    memo: ListCalcMemo;
    frameCache?: GeometryFrameCache;
    indentUnit: number;
};

const LARGE_DOC_HIGHLIGHT_THRESHOLD = 30_000;
const MAX_PRECISE_HIGHLIGHT_SCAN_LINES = 200;
export class ListDropTargetCalculator {
    private readonly cache: ListTargetSessionCache;

    constructor(
        private readonly view: EditorView,
        private readonly deps: ListDropTargetCalculatorDeps
    ) {
        this.cache = new ListTargetSessionCache(view);
    }

    getListMarkerBounds(
        lineNumber: number,
        options?: { frameCache?: GeometryFrameCache; memo?: ListCalcMemo; lineMap?: LineMap }
    ): { markerStartX: number; contentStartX: number } | null {
        const doc = this.view.state.doc;
        if (lineNumber < 1 || lineNumber > doc.lines) return null;
        const memo = options?.memo;
        if (memo && memo.markerBoundsByLine.has(lineNumber)) {
            return memo.markerBoundsByLine.get(lineNumber) ?? null;
        }
        const sessionCached = this.cache.getCachedMarkerBounds(lineNumber);
        if (sessionCached !== undefined) {
            if (memo) memo.markerBoundsByLine.set(lineNumber, sessionCached);
            return sessionCached;
        }

        const parsed = this.getParsedLineAtLineNumber(
            doc,
            lineNumber,
            memo,
            options?.lineMap
        );
        if (!parsed || !parsed.isListItem) {
            if (memo) memo.markerBoundsByLine.set(lineNumber, null);
            this.cache.setCachedMarkerBounds(lineNumber, null);
            return null;
        }

        const line = doc.line(lineNumber);
        const markerStartPos = line.from + parsed.quotePrefix.length + parsed.indentRaw.length;
        const contentStartPos = markerStartPos + parsed.marker.length;
        const markerStart = getCoordsAtPos(this.view, markerStartPos, options?.frameCache);
        const contentStart = getCoordsAtPos(this.view, contentStartPos, options?.frameCache);
        if (!markerStart || !contentStart) {
            if (memo) memo.markerBoundsByLine.set(lineNumber, null);
            this.cache.setCachedMarkerBounds(lineNumber, null);
            return null;
        }

        const bounds = {
            markerStartX: markerStart.left,
            contentStartX: contentStart.left,
        };
        if (memo) memo.markerBoundsByLine.set(lineNumber, bounds);
        this.cache.setCachedMarkerBounds(lineNumber, bounds);
        return bounds;
    }

    computeListTarget(params: {
        targetLineNumber: number;
        lineNumber: number;
        forcedLineNumber: number | null;
        childIntentOnLine: boolean;
        dragSource: BlockInfo | null;
        clientX: number;
        frameCache?: GeometryFrameCache;
        lineMap?: LineMap;
    }): ListDropTargetInfo {
        const {
            targetLineNumber,
            lineNumber,
            forcedLineNumber,
            childIntentOnLine,
            dragSource,
            clientX,
            frameCache,
            lineMap: providedLineMap,
        } = params;
        if (!dragSource || dragSource.type !== BlockType.ListItem) return {};

        const cacheKey = this.cache.buildListTargetCacheKey({
            targetLineNumber,
            lineNumber,
            forcedLineNumber,
            childIntentOnLine,
            dragSource,
            clientX,
        });
        const cached = this.cache.getCachedListTarget(cacheKey);
        if (cached) return cached;

        const finalize = (result: ListDropTargetInfo): ListDropTargetInfo => {
            this.cache.setCachedListTarget(cacheKey, result);
            return result;
        };

        const doc = this.view.state.doc;
        const lineMap = providedLineMap ?? getLineMap(this.view.state);
        const memo: ListCalcMemo = {
            parsedLineByLine: new Map<number, ParsedLine>(),
            markerBoundsByLine: new Map<number, { markerStartX: number; contentStartX: number } | null>(),
            listIndentByLine: new Map<number, number | undefined>(),
        };
        const indentUnit = this.deps.getIndentUnitWidthForDoc(doc);
        const context: ListCalcContext = {
            doc,
            lineMap,
            memo,
            frameCache,
            indentUnit,
        };

        const prevNonEmptyLineNumber = this.deps.getPreviousNonEmptyLineNumber(doc, targetLineNumber - 1);
        let referenceLineNumber = prevNonEmptyLineNumber ?? 0;
        if (!forcedLineNumber && childIntentOnLine) {
            referenceLineNumber = lineNumber;
        }
        if (referenceLineNumber < 1) return finalize({});

        const baseLineNumber = this.resolveReferenceListLineNumber(referenceLineNumber, lineMap);
        if (baseLineNumber === null) return finalize({});
        const isSelfTarget = !!dragSource
            && dragSource.type === BlockType.ListItem
            && baseLineNumber === dragSource.startLine + 1;
        const allowChild = !isSelfTarget;
        const dropTarget = this.getListDropTarget(baseLineNumber, clientX, allowChild, context);
        if (!dropTarget) return finalize({});

        const listContextLineNumber = dropTarget.lineNumber;
        const listIndentDelta = dropTarget.mode === 'child' ? 1 : 0;
        let cappedIndentWidth = dropTarget.indentWidth;

        const prevIndent = this.getListIndentWidthAtLine(doc, baseLineNumber, lineMap, memo);
        if (typeof prevIndent === 'number') {
            const maxAllowedIndent = prevIndent + indentUnit;
            if (cappedIndentWidth > maxAllowedIndent) {
                cappedIndentWidth = maxAllowedIndent;
            }
        }

        const nextLineNumber = targetLineNumber <= doc.lines ? targetLineNumber : null;
        if (nextLineNumber !== null) {
            const nextIndent = this.getListIndentWidthAtLine(doc, nextLineNumber, lineMap, memo);
            if (typeof nextIndent === 'number') {
                const minAllowedIndent = Math.max(0, nextIndent - indentUnit);
                if (cappedIndentWidth < minAllowedIndent) {
                    cappedIndentWidth = minAllowedIndent;
                }
            }
        }

        const listTargetIndentWidth = cappedIndentWidth;
        const highlightInfo = this.computeHighlightRectForList({
            targetLineNumber,
            listTargetIndentWidth,
            context,
        });

        return finalize({
            listContextLineNumber,
            listIndentDelta,
            listTargetIndentWidth,
            highlightRect: highlightInfo.highlightRect,
            lineRectSourceLineNumber: highlightInfo.lineRectSourceLineNumber,
        });
    }

    private computeHighlightRectForList(params: {
        targetLineNumber: number;
        listTargetIndentWidth: number;
        context: ListCalcContext;
    }): {
        highlightRect?: { top: number; left: number; width: number; height: number };
        lineRectSourceLineNumber?: number;
    } {
        const { targetLineNumber, listTargetIndentWidth, context } = params;
        if (listTargetIndentWidth <= 0) return {};

        const targetParentIndent = listTargetIndentWidth - context.indentUnit;
        const parentLineNumber = this.findParentLineNumberByIndent(
            context.doc,
            targetLineNumber - 1,
            targetParentIndent,
            context.lineMap,
            context.memo
        );
        if (parentLineNumber === null) return {};

        const parentMeta = getLineMetaAt(context.lineMap, parentLineNumber);
        if (!parentMeta?.isList) return {};

        const lineRectSourceLineNumber = parentLineNumber;
        const blockStartLineNumber = parentLineNumber;
        const mappedSubtreeEnd = context.lineMap.listSubtreeEndLine[parentLineNumber];
        const blockEndLineNumber = Math.max(
            blockStartLineNumber,
            mappedSubtreeEnd >= blockStartLineNumber ? mappedSubtreeEnd : blockStartLineNumber
        );
        const bounds = this.getListMarkerBounds(blockStartLineNumber, {
            frameCache: context.frameCache,
            memo: context.memo,
            lineMap: context.lineMap,
        });

        const lineCount = blockEndLineNumber - blockStartLineNumber + 1;
        const shouldUseFallbackRect = context.doc.lines > LARGE_DOC_HIGHLIGHT_THRESHOLD
            || lineCount > MAX_PRECISE_HIGHLIGHT_SCAN_LINES;
        if (shouldUseFallbackRect) {
            const startLineObj = context.doc.line(blockStartLineNumber);
            const startCoords = getCoordsAtPos(this.view, startLineObj.from, context.frameCache);
            const endCoords = getCoordsAtPos(this.view, startLineObj.to, context.frameCache);
            if (bounds && startCoords && endCoords) {
                const right = endCoords.right ?? endCoords.left;
                return {
                    lineRectSourceLineNumber,
                    highlightRect: {
                        top: startCoords.top,
                        left: bounds.markerStartX,
                        width: Math.max(8, right - bounds.markerStartX),
                        height: Math.max(4, endCoords.bottom - startCoords.top),
                    },
                };
            }
            return { lineRectSourceLineNumber };
        }

        if (!shouldUseFallbackRect) {
            const startLineObj = context.doc.line(blockStartLineNumber);
            const endLineObj = context.doc.line(blockEndLineNumber);
            const startCoords = getCoordsAtPos(this.view, startLineObj.from, context.frameCache);
            const endCoords = getCoordsAtPos(this.view, endLineObj.to, context.frameCache);
            if (bounds && startCoords && endCoords) {
                this.deps.incrementPerfCounter?.('highlight_scan_lines', lineCount);
                const left = bounds.markerStartX;
                let maxRight = left;
                for (let i = blockStartLineNumber; i <= blockEndLineNumber; i++) {
                    const lineObj = context.doc.line(i);
                    const lineEndCoords = getCoordsAtPos(this.view, lineObj.to, context.frameCache);
                    if (!lineEndCoords) continue;
                    const right = lineEndCoords.right ?? lineEndCoords.left;
                    if (right > maxRight) {
                        maxRight = right;
                    }
                }
                const width = Math.max(8, maxRight - left);
                return {
                    lineRectSourceLineNumber,
                    highlightRect: {
                        top: startCoords.top,
                        left,
                        width,
                        height: Math.max(4, endCoords.bottom - startCoords.top),
                    },
                };
            }
        }
        return { lineRectSourceLineNumber };

    }

    private getListDropTarget(
        lineNumber: number,
        clientX: number,
        allowChild: boolean,
        context: ListCalcContext
    ): { lineNumber: number; indentWidth: number; mode: 'child' | 'same' } | null {
        const { doc, lineMap, memo, frameCache, indentUnit } = context;
        if (lineNumber < 1 || lineNumber > doc.lines) return null;
        const bounds = this.getListMarkerBounds(lineNumber, { frameCache, memo, lineMap });
        if (!bounds) return null;

        const slots: Array<{ x: number; lineNumber: number; indentWidth: number; mode: 'child' | 'same' }> = [];

        const baseIndent = this.getListIndentWidthAtLine(doc, lineNumber, lineMap, memo);
        const maxIndent = typeof baseIndent === 'number' ? baseIndent + indentUnit : undefined;
        const columnPixelWidth = this.view.defaultCharacterWidth || 7;
        if (typeof baseIndent === 'number') {
            slots.push({ x: bounds.markerStartX, lineNumber, indentWidth: baseIndent, mode: 'same' });
        }

        if (allowChild && typeof baseIndent === 'number') {
            const childIndent = baseIndent + indentUnit;
            if (maxIndent === undefined || childIndent <= maxIndent) {
                const indentPixels = indentUnit * columnPixelWidth;
                const childSlotX = bounds.markerStartX + indentPixels;
                slots.push({ x: childSlotX, lineNumber, indentWidth: childIndent, mode: 'child' });
            }
        }

        const ancestors = this.getListAncestorLineNumbers(doc, lineNumber, lineMap, memo);
        for (const ancestorLine of ancestors) {
            if (ancestorLine === lineNumber) continue;
            const indentWidth = this.getListIndentWidthAtLine(doc, ancestorLine, lineMap, memo);
            if (typeof indentWidth !== 'number' || typeof baseIndent !== 'number') continue;
            const indentDeltaColumns = Math.max(0, baseIndent - indentWidth);
            const projectedX = bounds.markerStartX - indentDeltaColumns * columnPixelWidth;
            slots.push({
                x: projectedX,
                lineNumber: ancestorLine,
                indentWidth,
                mode: 'same',
            });
        }

        if (slots.length === 0) return null;

        let best = slots[0];
        let bestDist = Math.abs(clientX - best.x);
        for (let i = 1; i < slots.length; i++) {
            const dist = Math.abs(clientX - slots[i].x);
            if (dist < bestDist) {
                best = slots[i];
                bestDist = dist;
            }
        }

        return { lineNumber: best.lineNumber, indentWidth: best.indentWidth, mode: best.mode };
    }

    private resolveReferenceListLineNumber(
        lineNumber: number,
        lineMap: LineMap
    ): number | null {
        const nearestListLine = getNearestListLineAtOrBefore(lineMap, lineNumber);
        if (nearestListLine === null) return null;
        let cursor = nearestListLine;
        while (cursor > 0) {
            const subtreeEnd = lineMap.listSubtreeEndLine[cursor];
            if (subtreeEnd >= lineNumber) {
                return cursor;
            }
            cursor = lineMap.listParentLine[cursor];
        }
        return null;
    }

    private getParsedLineAtLineNumber(
        doc: { line: (n: number) => { text: string }; lines: number },
        lineNumber: number,
        memo?: ListCalcMemo,
        lineMap?: LineMap
    ): ParsedLine | null {
        if (lineNumber < 1 || lineNumber > doc.lines) return null;
        if (memo?.parsedLineByLine.has(lineNumber)) {
            return memo.parsedLineByLine.get(lineNumber) ?? null;
        }
        const lineMeta = lineMap ? getLineMetaAt(lineMap, lineNumber) : null;
        if (lineMeta && !lineMeta.isList) {
            return null;
        }
        const parsed = this.deps.parseLineWithQuote(doc.line(lineNumber).text);
        if (memo) memo.parsedLineByLine.set(lineNumber, parsed);
        return parsed;
    }

    private getListIndentWidthAtLine(
        doc: { line: (n: number) => { text: string }; lines: number },
        lineNumber: number,
        lineMap?: LineMap,
        memo?: ListCalcMemo
    ): number | undefined {
        if (lineNumber < 1 || lineNumber > doc.lines) return undefined;
        if (memo?.listIndentByLine.has(lineNumber)) {
            return memo.listIndentByLine.get(lineNumber);
        }

        let indent: number | undefined;
        const lineMeta = lineMap ? getLineMetaAt(lineMap, lineNumber) : null;
        if (lineMeta) {
            indent = lineMeta.isList ? lineMeta.indentWidth : undefined;
        } else {
            const parsed = this.deps.parseLineWithQuote(doc.line(lineNumber).text);
            indent = parsed.isListItem ? parsed.indentWidth : undefined;
        }
        if (memo) memo.listIndentByLine.set(lineNumber, indent);
        return indent;
    }

    private getListAncestorLineNumbers(
        doc: { line: (n: number) => { text: string }; lines: number },
        lineNumber: number,
        lineMap?: LineMap,
        memo?: ListCalcMemo
    ): number[] {
        const result: number[] = [];

        if (lineMap) {
            let steps = 0;
            let cursor = this.resolveReferenceListLineNumber(
                Math.max(1, Math.min(lineNumber, doc.lines)),
                lineMap
            );
            while (cursor !== null && cursor > 0) {
                result.push(cursor);
                steps += 1;
                const parent = lineMap.listParentLine[cursor];
                cursor = parent > 0 ? parent : null;
            }
            if (steps > 0) {
                this.deps.incrementPerfCounter?.('list_ancestor_scan_steps', steps);
            }
            return result;
        }

        let currentIndent: number | null = null;
        for (let i = lineNumber; i >= 1; i--) {
            const text = doc.line(i).text;
            if (text.trim().length === 0) continue;
            const parsed = this.deps.parseLineWithQuote(text);
            if (!parsed.isListItem) {
                if (currentIndent !== null) break;
                continue;
            }
            if (currentIndent === null) {
                currentIndent = parsed.indentWidth;
                result.push(i);
                continue;
            }
            if (parsed.indentWidth < currentIndent) {
                currentIndent = parsed.indentWidth;
                result.push(i);
            }
        }

        return result;
    }

    private findParentLineNumberByIndent(
        doc: { line: (n: number) => { text: string }; lines: number },
        startLineNumber: number,
        targetIndent: number,
        lineMap?: LineMap,
        memo?: ListCalcMemo
    ): number | null {
        if (lineMap) {
            let steps = 0;
            let cursor = this.resolveReferenceListLineNumber(
                Math.max(1, Math.min(startLineNumber, doc.lines)),
                lineMap
            );
            while (cursor !== null && cursor > 0) {
                steps += 1;
                const indent = this.getListIndentWidthAtLine(doc, cursor, lineMap, memo);
                if (typeof indent === 'number' && indent === targetIndent) {
                    this.deps.incrementPerfCounter?.('list_parent_scan_steps', steps);
                    return cursor;
                }
                if (typeof indent === 'number' && indent < targetIndent) {
                    break;
                }
                const parent = lineMap.listParentLine[cursor];
                cursor = parent > 0 ? parent : null;
            }
            if (steps > 0) {
                this.deps.incrementPerfCounter?.('list_parent_scan_steps', steps);
            }
            return null;
        }

        for (let i = startLineNumber; i >= 1; i--) {
            const text = doc.line(i).text;
            if (text.trim().length === 0) continue;
            const parsed = this.deps.parseLineWithQuote(text);
            if (!parsed.isListItem) continue;
            if (parsed.indentWidth === targetIndent) return i;
        }
        return null;
    }

}
