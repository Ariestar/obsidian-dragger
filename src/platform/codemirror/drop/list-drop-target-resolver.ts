import { EditorView } from '@codemirror/view';
import { BlockType } from '../../../domain/block/block-types';
import {
    getLineMap,
    getLineMetaAt,
    getNearestListLineAtOrBefore,
    LineMap,
} from '../../../domain/markdown/line-map';
import { getCoordsAtPos } from '../selection/rect-calculator';
import { DocLike, ParsedLine } from '../../../domain/markdown/document-types';
import type { ListDropTarget } from '../../../domain/command/drop-target';
import type { BlockSelection } from '../../../domain/selection/block-selection';
import type { DragSelectionScope } from '../../../domain/decision/drop-decision';

export type ListDropTargetContribution = {
    listIntent?: ListDropTarget;
    highlightRect?: { top: number; left: number; width: number; height: number };
    lineRectSourceLineNumber?: number;
};

export interface ListDropTargetResolverPort {
    getListMarkerBounds(
        lineNumber: number,
        options?: { memo?: unknown; lineMap?: LineMap }
    ): { markerStartX: number; contentStartX: number } | null;
    computeListTarget(params: {
        targetLineNumber: number;
        lineNumber: number;
        forcedLineNumber: number | null;
        childIntentOnLine: boolean;
        selection: BlockSelection | null;
        sourceScope?: 'same_editor' | 'cross_editor';
        clientX: number;
        lineMap?: LineMap;
    }): ListDropTargetContribution;
}

export interface ListDropTargetResolverDeps {
    tabSize: number;
    parseLineWithQuote: (line: string) => ParsedLine;
    getPreviousNonEmptyLineNumber: (doc: DocLike, lineNumber: number) => number | null;
    getIndentUnitWidthForDoc: (doc: DocLike) => number;
    getBlockRect: (
        startLineNumber: number,
        endLineNumber: number
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
    indentUnit: number;
};

export type ListDropTargetResolver = ListDropTargetResolverPort;

export function createListDropTargetResolver(view: EditorView, deps: ListDropTargetResolverDeps): ListDropTargetResolver {
    function getListMarkerBounds(
        lineNumber: number,
        options?: { memo?: ListCalcMemo; lineMap?: LineMap }
    ): { markerStartX: number; contentStartX: number } | null {
        const doc = view.state.doc;
        if (lineNumber < 1 || lineNumber > doc.lines) return null;
        const memo = options?.memo;
        if (memo && memo.markerBoundsByLine.has(lineNumber)) {
            return memo.markerBoundsByLine.get(lineNumber) ?? null;
        }

        const parsed = getParsedLineAtLineNumber(
            doc,
            lineNumber,
            memo,
            options?.lineMap
        );
        if (!parsed || !parsed.isListItem) {
            if (memo) memo.markerBoundsByLine.set(lineNumber, null);
            return null;
        }

        const line = doc.line(lineNumber);
        const markerStartPos = line.from + parsed.quotePrefix.length + parsed.indentRaw.length;
        const contentStartPos = markerStartPos + parsed.marker.length;
        const markerStart = getCoordsAtPos(view, markerStartPos);
        const contentStart = getCoordsAtPos(view, contentStartPos);
        if (!markerStart || !contentStart) {
            if (memo) memo.markerBoundsByLine.set(lineNumber, null);
            return null;
        }

        const bounds = {
            markerStartX: markerStart.left,
            contentStartX: contentStart.left,
        };
        if (memo) memo.markerBoundsByLine.set(lineNumber, bounds);
        return bounds;
    }

    function computeListTarget(params: {
        targetLineNumber: number;
        lineNumber: number;
        forcedLineNumber: number | null;
        childIntentOnLine: boolean;
        selection: BlockSelection | null;
        sourceScope?: DragSelectionScope;
        clientX: number;
        lineMap?: LineMap;
    }): ListDropTargetContribution {
        const {
            targetLineNumber,
            lineNumber,
            forcedLineNumber,
            childIntentOnLine,
            selection,
            sourceScope = 'same_editor',
            clientX,
            lineMap: providedLineMap,
        } = params;
        if (!selection || selection.anchorBlock.type !== BlockType.ListItem) return {};

        const doc = view.state.doc;
        const lineMap = providedLineMap ?? getLineMap(view.state, { tabSize: deps.tabSize });
        const memo: ListCalcMemo = {
            parsedLineByLine: new Map<number, ParsedLine>(),
            markerBoundsByLine: new Map<number, { markerStartX: number; contentStartX: number } | null>(),
            listIndentByLine: new Map<number, number | undefined>(),
        };
        const indentUnit = deps.getIndentUnitWidthForDoc(doc);
        const context: ListCalcContext = {
            doc,
            lineMap,
            memo,
            indentUnit,
        };

        const prevNonEmptyLineNumber = deps.getPreviousNonEmptyLineNumber(doc, targetLineNumber - 1);
        let referenceLineNumber = prevNonEmptyLineNumber ?? 0;
        if (!forcedLineNumber && childIntentOnLine) {
            referenceLineNumber = lineNumber;
        }
        if (referenceLineNumber < 1) return {};

        const baseLineNumber = resolveReferenceListLineNumber(referenceLineNumber, lineMap);
        if (baseLineNumber === null) return {};
        const isSelfTarget = sourceScope !== 'cross_editor'
            && selection.anchorBlock.type === BlockType.ListItem
            && baseLineNumber === selection.anchorBlock.startLine + 1;
        const allowChild = !isSelfTarget;
        const dropTarget = getListDropTarget(baseLineNumber, clientX, allowChild, context);
        if (!dropTarget) return {};

        const listIntent = {
            mode: dropTarget.mode === 'child' ? 'child' : 'sibling',
            contextLineNumber: dropTarget.lineNumber,
            targetIndentWidth: dropTarget.indentWidth,
        } satisfies ListDropTarget;
        let cappedIndentWidth = listIntent.targetIndentWidth;

        const prevIndent = getListIndentWidthAtLine(doc, baseLineNumber, lineMap, memo);
        if (typeof prevIndent === 'number') {
            const maxAllowedIndent = prevIndent + indentUnit;
            if (cappedIndentWidth > maxAllowedIndent) {
                cappedIndentWidth = maxAllowedIndent;
            }
        }

        const nextLineNumber = targetLineNumber <= doc.lines ? targetLineNumber : null;
        if (nextLineNumber !== null) {
            const nextIndent = getListIndentWidthAtLine(doc, nextLineNumber, lineMap, memo);
            if (typeof nextIndent === 'number') {
                const minAllowedIndent = Math.max(0, nextIndent - indentUnit);
                if (cappedIndentWidth < minAllowedIndent) {
                    cappedIndentWidth = minAllowedIndent;
                }
            }
        }

        listIntent.targetIndentWidth = cappedIndentWidth;
        const highlightInfo = computeHighlightRectForList({
            targetLineNumber,
            listTargetIndentWidth: listIntent.targetIndentWidth,
            context,
        });

        return {
            listIntent,
            highlightRect: highlightInfo.highlightRect,
            lineRectSourceLineNumber: highlightInfo.lineRectSourceLineNumber,
        };
    }

    function computeHighlightRectForList(params: {
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
        const parentLineNumber = findParentLineNumberByIndent(
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
        const bounds = getListMarkerBounds(blockStartLineNumber, {
            memo: context.memo,
            lineMap: context.lineMap,
        });

        const startLineObj = context.doc.line(blockStartLineNumber);
        const endLineObj = context.doc.line(blockEndLineNumber);
        const startCoords = getCoordsAtPos(view, startLineObj.from);
        const endCoords = getCoordsAtPos(view, endLineObj.to);

        if (bounds && startCoords && endCoords) {
            const lineCount = blockEndLineNumber - blockStartLineNumber + 1;
            deps.incrementPerfCounter?.('highlight_scan_lines', lineCount);
            const left = bounds.markerStartX;
            let maxRight = left;
            for (let i = blockStartLineNumber; i <= blockEndLineNumber; i++) {
                const lineObj = context.doc.line(i);
                const lineEndCoords = getCoordsAtPos(view, lineObj.to);
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
        return { lineRectSourceLineNumber };
    }

    function getListDropTarget(
        lineNumber: number,
        clientX: number,
        allowChild: boolean,
        context: ListCalcContext
    ): { lineNumber: number; indentWidth: number; mode: 'child' | 'same' } | null {
        const { doc, lineMap, memo, indentUnit } = context;
        if (lineNumber < 1 || lineNumber > doc.lines) return null;
        const bounds = getListMarkerBounds(lineNumber, { memo, lineMap });
        if (!bounds) return null;

        const slots: Array<{ x: number; lineNumber: number; indentWidth: number; mode: 'child' | 'same' }> = [];

        const baseIndent = getListIndentWidthAtLine(doc, lineNumber, lineMap, memo);
        const maxIndent = typeof baseIndent === 'number' ? baseIndent + indentUnit : undefined;
        const columnPixelWidth = view.defaultCharacterWidth || 7;
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

        const ancestors = getListAncestorLineNumbers(doc, lineNumber, lineMap);
        for (const ancestorLine of ancestors) {
            if (ancestorLine === lineNumber) continue;
            const indentWidth = getListIndentWidthAtLine(doc, ancestorLine, lineMap, memo);
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

    function resolveReferenceListLineNumber(lineNumber: number, lineMap: LineMap): number | null {
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

    function getParsedLineAtLineNumber(
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
        const parsed = deps.parseLineWithQuote(doc.line(lineNumber).text);
        if (memo) memo.parsedLineByLine.set(lineNumber, parsed);
        return parsed;
    }

    function getListIndentWidthAtLine(
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
            const parsed = deps.parseLineWithQuote(doc.line(lineNumber).text);
            indent = parsed.isListItem ? parsed.indentWidth : undefined;
        }
        if (memo) memo.listIndentByLine.set(lineNumber, indent);
        return indent;
    }

    function getListAncestorLineNumbers(
        doc: { line: (n: number) => { text: string }; lines: number },
        lineNumber: number,
        lineMap?: LineMap
    ): number[] {
        const result: number[] = [];

        if (lineMap) {
            let steps = 0;
            let cursor = resolveReferenceListLineNumber(
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
                deps.incrementPerfCounter?.('list_ancestor_scan_steps', steps);
            }
            return result;
        }

        let currentIndent: number | null = null;
        for (let i = lineNumber; i >= 1; i--) {
            const text = doc.line(i).text;
            if (text.trim().length === 0) continue;
            const parsed = deps.parseLineWithQuote(text);
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

    function findParentLineNumberByIndent(
        doc: { line: (n: number) => { text: string }; lines: number },
        startLineNumber: number,
        targetIndent: number,
        lineMap?: LineMap,
        memo?: ListCalcMemo
    ): number | null {
        if (lineMap) {
            let steps = 0;
            let cursor = resolveReferenceListLineNumber(
                Math.max(1, Math.min(startLineNumber, doc.lines)),
                lineMap
            );
            while (cursor !== null && cursor > 0) {
                steps += 1;
                const indent = getListIndentWidthAtLine(doc, cursor, lineMap, memo);
                if (typeof indent === 'number' && indent === targetIndent) {
                    deps.incrementPerfCounter?.('list_parent_scan_steps', steps);
                    return cursor;
                }
                if (typeof indent === 'number' && indent < targetIndent) {
                    break;
                }
                const parent = lineMap.listParentLine[cursor];
                cursor = parent > 0 ? parent : null;
            }
            if (steps > 0) {
                deps.incrementPerfCounter?.('list_parent_scan_steps', steps);
            }
            return null;
        }

        for (let i = startLineNumber; i >= 1; i--) {
            const text = doc.line(i).text;
            if (text.trim().length === 0) continue;
            const parsed = deps.parseLineWithQuote(text);
            if (!parsed.isListItem) continue;
            if (parsed.indentWidth === targetIndent) return i;
        }
        return null;
    }

    return {
        getListMarkerBounds,
        computeListTarget,
    };
}
