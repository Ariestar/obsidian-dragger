import { EditorView } from '@codemirror/view';
import { BlockInfo, BlockType } from '../../types';
import { validateInPlaceDrop } from '../core/drop-validation';
import { InsertionRuleRejectReason, InsertionSlotContext } from '../core/insertion-rule-matrix';
import { getLineMap, LineMap } from '../core/line-map';
import {
    createGeometryFrameCache,
    GeometryFrameCache,
    getCoordsAtPos,
} from '../core/drop-target';
import { DocLike, DropTargetInfo, ListContext, ParsedLine } from '../core/protocol-types';
import { EMBED_BLOCK_SELECTOR } from '../core/selectors';
import { isPointInsideRenderedTableCell } from '../core/table-guard';
import { ListDropTargetCalculator } from './ListDropTargetCalculator';

type PerfDurationKey =
    | 'resolve_total'
    | 'vertical'
    | 'container'
    | 'list_target'
    | 'in_place'
    | 'geometry';

export interface DropTargetCalculatorDeps {
    parseLineWithQuote: (line: string) => ParsedLine;
    getAdjustedTargetLocation: (
        lineNumber: number,
        options?: { clientY?: number; frameCache?: GeometryFrameCache }
    ) => { lineNumber: number; blockAdjusted: boolean };
    clampTargetLineNumber: (totalLines: number, lineNumber: number) => number;
    getPreviousNonEmptyLineNumber: (doc: DocLike, lineNumber: number) => number | null;
    resolveDropRuleAtInsertion: (
        sourceBlock: BlockInfo,
        targetLineNumber: number,
        options?: { lineMap?: LineMap }
    ) => {
        slotContext: InsertionSlotContext;
        decision: { allowDrop: boolean; rejectReason?: string | null };
    };
    getListContext: (doc: DocLike, lineNumber: number) => ListContext;
    getIndentUnitWidth: (sample: string) => number;
    getBlockInfoForEmbed: (embedEl: HTMLElement) => BlockInfo | null;
    getIndentUnitWidthForDoc: (doc: DocLike) => number;
    getLineRect: (lineNumber: number, frameCache?: GeometryFrameCache) => { left: number; width: number } | undefined;
    getInsertionAnchorY: (lineNumber: number, frameCache?: GeometryFrameCache) => number | null;
    getLineIndentPosByWidth: (lineNumber: number, targetIndentWidth: number) => number | null;
    getBlockRect: (
        startLineNumber: number,
        endLineNumber: number,
        frameCache?: GeometryFrameCache
    ) => { top: number; left: number; width: number; height: number } | undefined;
    clampNumber: (value: number, min: number, max: number) => number;
    onDragTargetEvaluated?: (info: {
        sourceBlock: BlockInfo | null;
        pointerType: string | null;
        validation: DropValidationResult;
    }) => void;
    recordPerfDuration?: (key: PerfDurationKey, durationMs: number) => void;
    incrementPerfCounter?: (
        key:
            | 'resolve_cache_hits'
            | 'resolve_cache_misses'
            | 'list_ancestor_scan_steps'
            | 'list_parent_scan_steps'
            | 'highlight_scan_lines',
        delta?: number
    ) => void;
}

export type DropRejectReason =
    | 'table_cell'
    | 'no_target'
    | 'no_anchor'
    | 'self_range_blocked'
    | 'self_embedding'
    | InsertionRuleRejectReason
    | 'container_policy';

export type DropValidationResult = {
    allowed: boolean;
    reason?: DropRejectReason;
    targetLineNumber?: number;
    listContextLineNumber?: number;
    listIndentDelta?: number;
    listTargetIndentWidth?: number;
    indicatorY?: number;
    lineRect?: { left: number; width: number };
    highlightRect?: { top: number; left: number; width: number; height: number };
};

export class DropTargetCalculator {
    private readonly listDropTargetCalculator: ListDropTargetCalculator;
    private lastResolvedCache: {
        state: unknown;
        key: string;
        result: DropValidationResult;
    } | null = null;

    constructor(
        private readonly view: EditorView,
        private readonly deps: DropTargetCalculatorDeps
    ) {
        this.listDropTargetCalculator = new ListDropTargetCalculator(this.view, {
            parseLineWithQuote: this.deps.parseLineWithQuote,
            getPreviousNonEmptyLineNumber: this.deps.getPreviousNonEmptyLineNumber,
            getIndentUnitWidthForDoc: this.deps.getIndentUnitWidthForDoc,
            getBlockRect: this.deps.getBlockRect,
            incrementPerfCounter: this.deps.incrementPerfCounter,
        });
    }

    getDropTargetInfo(info: { clientX: number; clientY: number; dragSource?: BlockInfo | null; pointerType?: string | null }): DropTargetInfo | null {
        const validated = this.resolveValidatedDropTarget(info);
        if (!validated.allowed || typeof validated.targetLineNumber !== 'number' || typeof validated.indicatorY !== 'number') {
            return null;
        }
        return {
            lineNumber: validated.targetLineNumber,
            indicatorY: validated.indicatorY,
            listContextLineNumber: validated.listContextLineNumber,
            listIndentDelta: validated.listIndentDelta,
            listTargetIndentWidth: validated.listTargetIndentWidth,
            lineRect: validated.lineRect,
            highlightRect: validated.highlightRect,
        };
    }

    resolveValidatedDropTarget(info: { clientX: number; clientY: number; dragSource?: BlockInfo | null; pointerType?: string | null }): DropValidationResult {
        const startedAt = this.now();
        const dragSource = info.dragSource ?? null;
        const pointerType = info.pointerType ?? null;
        const cacheKey = this.buildResolveCacheKey(info.clientX, info.clientY, dragSource, pointerType);
        if (
            this.lastResolvedCache
            && this.lastResolvedCache.state === this.view.state
            && this.lastResolvedCache.key === cacheKey
        ) {
            this.deps.incrementPerfCounter?.('resolve_cache_hits', 1);
            const cached = this.lastResolvedCache.result;
            this.deps.onDragTargetEvaluated?.({
                sourceBlock: dragSource,
                pointerType,
                validation: cached,
            });
            this.deps.recordPerfDuration?.('resolve_total', this.now() - startedAt);
            return cached;
        }
        this.deps.incrementPerfCounter?.('resolve_cache_misses', 1);

        const frameCache = createGeometryFrameCache();
        const lineMap = getLineMap(this.view.state);

        const result = this.resolveValidatedDropTargetInternal({
            info,
            dragSource,
            pointerType,
            frameCache,
            lineMap,
        });
        this.lastResolvedCache = {
            state: this.view.state,
            key: cacheKey,
            result,
        };
        this.deps.recordPerfDuration?.('resolve_total', this.now() - startedAt);
        this.deps.onDragTargetEvaluated?.({
            sourceBlock: dragSource,
            pointerType,
            validation: result,
        });
        return result;
    }

    private resolveValidatedDropTargetInternal(params: {
        info: { clientX: number; clientY: number; dragSource?: BlockInfo | null; pointerType?: string | null };
        dragSource: BlockInfo | null;
        pointerType: string | null;
        frameCache: GeometryFrameCache;
        lineMap: ReturnType<typeof getLineMap>;
    }): DropValidationResult {
        const { info, dragSource, frameCache, lineMap } = params;

        if (isPointInsideRenderedTableCell(this.view, info.clientX, info.clientY)) {
            return { allowed: false, reason: 'table_cell' } as const;
        }

        const embedEl = this.getEmbedElementAtPoint(info.clientX, info.clientY);
        if (embedEl) {
            const block = this.deps.getBlockInfoForEmbed(embedEl);
            if (block) {
                const rect = embedEl.getBoundingClientRect();
                const showAtBottom = info.clientY > rect.top + rect.height / 2;
                const lineNumber = this.deps.clampTargetLineNumber(
                    this.view.state.doc.lines,
                    showAtBottom ? block.endLine + 2 : block.startLine + 1
                );
                const containerStartedAt = this.now();
                const containerRule = dragSource
                    ? this.deps.resolveDropRuleAtInsertion(dragSource, lineNumber, { lineMap })
                    : null;
                this.deps.recordPerfDuration?.('container', this.now() - containerStartedAt);
                if (containerRule && !containerRule.decision.allowDrop) {
                    return {
                        allowed: false,
                        reason: (containerRule.decision.rejectReason ?? 'container_policy') as DropRejectReason,
                    };
                }

                if (dragSource) {
                    const inPlaceStartedAt = this.now();
                    const inPlaceValidation = validateInPlaceDrop({
                        doc: this.view.state.doc,
                        sourceBlock: dragSource,
                        targetLineNumber: lineNumber,
                        parseLineWithQuote: this.deps.parseLineWithQuote,
                        getListContext: this.deps.getListContext,
                        getIndentUnitWidth: this.deps.getIndentUnitWidth,
                        slotContext: containerRule?.slotContext,
                        lineMap,
                    });
                    this.deps.recordPerfDuration?.('in_place', this.now() - inPlaceStartedAt);
                    if (inPlaceValidation.inSelfRange && !inPlaceValidation.allowInPlaceIndentChange) {
                        return {
                            allowed: false,
                            reason: inPlaceValidation.rejectReason ?? 'self_range_blocked',
                        };
                    }
                    if (!inPlaceValidation.inSelfRange && inPlaceValidation.rejectReason) {
                        return {
                            allowed: false,
                            reason: inPlaceValidation.rejectReason as DropRejectReason,
                        };
                    }
                }

                const indicatorY = showAtBottom ? rect.bottom : rect.top;
                return {
                    allowed: true,
                    targetLineNumber: lineNumber,
                    indicatorY,
                    lineRect: { left: rect.left, width: rect.width },
                };
            }
        }

        const verticalStartedAt = this.now();
        const vertical = this.computeVerticalTarget(info, dragSource, frameCache);
        this.deps.recordPerfDuration?.('vertical', this.now() - verticalStartedAt);
        if (!vertical) {
            return { allowed: false, reason: 'no_target' } as const;
        }

        const containerStartedAt = this.now();
        const containerRule = dragSource
            ? this.deps.resolveDropRuleAtInsertion(dragSource, vertical.targetLineNumber, { lineMap })
            : null;
        this.deps.recordPerfDuration?.('container', this.now() - containerStartedAt);
        if (containerRule && !containerRule.decision.allowDrop) {
            return {
                allowed: false,
                reason: (containerRule.decision.rejectReason ?? 'container_policy') as DropRejectReason,
            };
        }

        const listStartedAt = this.now();
        const listTarget = this.listDropTargetCalculator.computeListTarget({
            targetLineNumber: vertical.targetLineNumber,
            lineNumber: vertical.line.number,
            forcedLineNumber: vertical.forcedLineNumber,
            childIntentOnLine: vertical.childIntentOnLine,
            dragSource,
            clientX: info.clientX,
            frameCache,
            lineMap,
        });
        this.deps.recordPerfDuration?.('list_target', this.now() - listStartedAt);

        if (dragSource) {
            const inPlaceStartedAt = this.now();
            const inPlaceValidation = validateInPlaceDrop({
                doc: this.view.state.doc,
                sourceBlock: dragSource,
                targetLineNumber: vertical.targetLineNumber,
                parseLineWithQuote: this.deps.parseLineWithQuote,
                getListContext: this.deps.getListContext,
                getIndentUnitWidth: this.deps.getIndentUnitWidth,
                slotContext: containerRule?.slotContext,
                listContextLineNumberOverride: listTarget.listContextLineNumber,
                listIndentDeltaOverride: listTarget.listIndentDelta,
                listTargetIndentWidthOverride: listTarget.listTargetIndentWidth,
                lineMap,
            });
            this.deps.recordPerfDuration?.('in_place', this.now() - inPlaceStartedAt);
            if (inPlaceValidation.inSelfRange && !inPlaceValidation.allowInPlaceIndentChange) {
                return {
                    allowed: false,
                    reason: inPlaceValidation.rejectReason ?? 'self_range_blocked',
                };
            }
            if (!inPlaceValidation.inSelfRange && inPlaceValidation.rejectReason) {
                return {
                    allowed: false,
                    reason: inPlaceValidation.rejectReason as DropRejectReason,
                };
            }
        }

        const geometryStartedAt = this.now();
        const indicatorY = this.deps.getInsertionAnchorY(vertical.targetLineNumber, frameCache);
        if (indicatorY === null) {
            this.deps.recordPerfDuration?.('geometry', this.now() - geometryStartedAt);
            return { allowed: false, reason: 'no_anchor' } as const;
        }

        const lineRectSourceLineNumber = listTarget.lineRectSourceLineNumber
            ?? vertical.lineRectSourceLineNumber;
        let lineRect = this.deps.getLineRect(lineRectSourceLineNumber, frameCache);
        if (typeof listTarget.listTargetIndentWidth === 'number') {
            const indentPos = this.deps.getLineIndentPosByWidth(lineRectSourceLineNumber, listTarget.listTargetIndentWidth);
            if (indentPos !== null) {
                const start = getCoordsAtPos(this.view, indentPos, frameCache);
                const end = getCoordsAtPos(this.view, this.view.state.doc.line(lineRectSourceLineNumber).to, frameCache);
                if (start && end) {
                    const left = start.left;
                    const width = Math.max(8, (end.right ?? end.left) - left);
                    lineRect = { left, width };
                }
            }
        }
        this.deps.recordPerfDuration?.('geometry', this.now() - geometryStartedAt);

        return {
            allowed: true,
            targetLineNumber: vertical.targetLineNumber,
            indicatorY,
            listContextLineNumber: listTarget.listContextLineNumber,
            listIndentDelta: listTarget.listIndentDelta,
            listTargetIndentWidth: listTarget.listTargetIndentWidth,
            lineRect,
            highlightRect: listTarget.highlightRect,
        };
    }

    private computeVerticalTarget(
        info: { clientX: number; clientY: number },
        dragSource: BlockInfo | null,
        frameCache: GeometryFrameCache
    ): {
        line: { number: number; text: string; from: number; to: number };
        targetLineNumber: number;
        forcedLineNumber: number | null;
        childIntentOnLine: boolean;
        lineRectSourceLineNumber: number;
    } | null {
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const x = this.deps.clampNumber(info.clientX, contentRect.left + 2, contentRect.right - 2);
        let pos: number | null = null;
        try {
            pos = this.view.posAtCoords({ x, y: info.clientY });
        } catch {
            return null;
        }
        if (pos === null) return null;

        const line = this.view.state.doc.lineAt(pos);
        const allowListChildIntent = !!dragSource && dragSource.type === BlockType.ListItem;
        const lineBoundsForSnap = this.listDropTargetCalculator.getListMarkerBounds(line.number, { frameCache });
        const lineParsedForSnap = this.deps.parseLineWithQuote(line.text);
        const childIntentOnLine = allowListChildIntent
            && !!lineBoundsForSnap
            && lineParsedForSnap.isListItem
            && info.clientX >= lineBoundsForSnap.contentStartX + 2;

        const adjustedTarget = this.deps.getAdjustedTargetLocation(line.number, {
            clientY: info.clientY,
            frameCache,
        });
        let forcedLineNumber: number | null = adjustedTarget.blockAdjusted ? adjustedTarget.lineNumber : null;

        let showAtBottom = false;
        if (!forcedLineNumber) {
            const isBlankLine = line.text.trim().length === 0;
            showAtBottom = !isBlankLine;
            if (isBlankLine) {
                forcedLineNumber = line.number;
            } else {
                const lineStart = getCoordsAtPos(this.view, line.from, frameCache);
                const lineEnd = getCoordsAtPos(this.view, line.to, frameCache);
                if (lineStart && lineEnd) {
                    const midY = (lineStart.top + lineEnd.bottom) / 2;
                    showAtBottom = info.clientY > midY;
                }
            }
        }

        let targetLineNumber = this.deps.clampTargetLineNumber(
            this.view.state.doc.lines,
            forcedLineNumber ?? (showAtBottom ? line.number + 1 : line.number)
        );
        if (!forcedLineNumber && childIntentOnLine && !showAtBottom) {
            targetLineNumber = this.deps.clampTargetLineNumber(this.view.state.doc.lines, line.number + 1);
        }

        return {
            line,
            targetLineNumber,
            forcedLineNumber,
            childIntentOnLine,
            lineRectSourceLineNumber: line.number,
        };
    }

    private getEmbedElementAtPoint(clientX: number, clientY: number): HTMLElement | null {
        const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
        if (el) {
            const direct = el.closest(EMBED_BLOCK_SELECTOR) as HTMLElement | null;
            if (direct) {
                return (direct.closest('.cm-embed-block') as HTMLElement | null) ?? direct;
            }
        }

        const editorRect = this.view.dom.getBoundingClientRect();
        if (clientY < editorRect.top || clientY > editorRect.bottom) return null;
        if (clientX < editorRect.left || clientX > editorRect.right) return null;

        const embeds = Array.from(
            this.view.dom.querySelectorAll(EMBED_BLOCK_SELECTOR)
        ) as HTMLElement[];

        let best: HTMLElement | null = null;
        let bestDist = Number.POSITIVE_INFINITY;
        for (const raw of embeds) {
            const embed = (raw.closest('.cm-embed-block') as HTMLElement | null) ?? raw;
            const rect = embed.getBoundingClientRect();
            if (clientY >= rect.top && clientY <= rect.bottom) {
                const centerY = (rect.top + rect.bottom) / 2;
                const dist = Math.abs(centerY - clientY);
                if (dist < bestDist) {
                    bestDist = dist;
                    best = embed;
                }
            }
        }

        return best;
    }

    private buildResolveCacheKey(
        clientX: number,
        clientY: number,
        dragSource: BlockInfo | null,
        pointerType: string | null
    ): string {
        if (!dragSource) {
            return `${clientX}|${clientY}|none|${pointerType ?? ''}`;
        }
        const compositeKey = (dragSource.compositeSelection?.ranges ?? [])
            .map((range) => `${range.startLine}-${range.endLine}`)
            .join(',');
        return [
            clientX,
            clientY,
            pointerType ?? '',
            dragSource.type,
            dragSource.startLine,
            dragSource.endLine,
            dragSource.from,
            dragSource.to,
            compositeKey,
        ].join('|');
    }

    private now(): number {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }
}
