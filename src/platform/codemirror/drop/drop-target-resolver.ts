import { EditorView } from '@codemirror/view';
import { BlockInfo, BlockType } from '../../../domain/block/block-types';
import type { DropTarget } from '../../../domain/command/drop-target';
import { validateInPlaceDrop } from '../../../domain/rules/drop-validation';
import { InsertionRuleRejectReason, InsertionSlotContext } from '../../../domain/rules/insertion-rules';
import { getLineMap, LineMap } from '../../../domain/markdown/line-map';
import { getCoordsAtPos } from '../selection/rect-calculator';
import { DocLike, ListContext, ParsedLine } from '../../../domain/markdown/document-types';
import { findEmbedElementAtPoint } from '../../dom/embed-probe';
import { resolveLineNumberAtCoords } from '../../dom/element-probe';
import { isPointInsideRenderedTableCell } from '../../dom/table-guard';
import { clampTargetLineNumber } from '../../../domain/markdown/line-target-number';
import { getRenderedMainLineNumberAtPoint } from '../../dom/line-hit';

import type { BlockSelection } from '../../../domain/selection/block-selection';
import { createListDropTargetResolver, type ListDropTargetResolver } from './list-drop-target-resolver';
import { getPreviousNonEmptyLineNumber } from '../../../domain/rules/container-policy';
import type { DragSelectionScope, DropRejectReason } from '../../../domain/decision/drop-decision';
import type { DropResolution, DropValidationResult } from './drop-validation';

type PerfDurationKey =
    | 'resolve_total'
    | 'vertical'
    | 'container'
    | 'list_target'
    | 'in_place'
    | 'geometry';

export interface DropTargetResolverDeps {
    tabSize: number;
    parseLineWithQuote: (line: string) => ParsedLine;
    getAdjustedTargetLocation: (
        lineNumber: number,
        options?: { clientY?: number }
    ) => { lineNumber: number; blockAdjusted: boolean };
    resolveDropRuleAtInsertion: (
        sourceBlock: BlockInfo,
        targetLineNumber: number,
        options: { lineMap?: LineMap; tabSize: number }
    ) => {
        slotContext: InsertionSlotContext;
        decision: { allowDrop: boolean; rejectReason?: InsertionRuleRejectReason | null };
    };
    getListContext: (doc: DocLike, lineNumber: number) => ListContext;
    getIndentUnitWidth: (sample: string) => number;
    getBlockInfoForEmbed: (embedEl: HTMLElement) => BlockInfo | null;
    getIndentUnitWidthForDoc: (doc: DocLike) => number;
    getLineRect: (lineNumber: number) => { left: number; width: number } | undefined;
    getInsertionAnchorY: (lineNumber: number) => number | null;
    getLineIndentPosByWidth: (lineNumber: number, targetIndentWidth: number) => number | null;
    getBlockRect: (
        startLineNumber: number,
        endLineNumber: number
    ) => { top: number; left: number; width: number; height: number } | undefined;
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

export class DropTargetResolver {
    private lastResolvedCache: {
        state: unknown;
        key: string;
        result: DropValidationResult;
    } | null = null;

    private readonly listDropTargetResolver: ListDropTargetResolver;

    constructor(
        private readonly view: EditorView,
        private readonly deps: DropTargetResolverDeps
    ) {
        this.listDropTargetResolver = createListDropTargetResolver(view, {
            tabSize: deps.tabSize,
            parseLineWithQuote: deps.parseLineWithQuote,
            getPreviousNonEmptyLineNumber,
            getIndentUnitWidthForDoc: deps.getIndentUnitWidthForDoc,
            getBlockRect: deps.getBlockRect,
            incrementPerfCounter: deps.incrementPerfCounter,
        });
    }

    resolveValidatedDropTarget(info: {
        clientX: number;
        clientY: number;
        selection?: BlockSelection | null;
        pointerType?: string | null;
        sourceScope?: DragSelectionScope;
    }): DropValidationResult {
        const startedAt = this.now();
        const selection = info.selection ?? null;
        const pointerType = info.pointerType ?? null;
        const sourceScope = info.sourceScope ?? 'same_editor';
        const cacheKey = this.buildResolveCacheKey(info.clientX, info.clientY, selection, pointerType, sourceScope);
        if (
            this.lastResolvedCache
            && this.lastResolvedCache.state === this.view.state
            && this.lastResolvedCache.key === cacheKey
        ) {
            this.deps.incrementPerfCounter?.('resolve_cache_hits', 1);
            const cached = this.lastResolvedCache.result;
            this.deps.recordPerfDuration?.('resolve_total', this.now() - startedAt);
            return cached;
        }
        this.deps.incrementPerfCounter?.('resolve_cache_misses', 1);

        const lineMap = getLineMap(this.view.state, { tabSize: this.deps.tabSize });

        const result = this.resolveValidatedDropTargetInternal({
            info,
            selection,
            sourceScope,
            lineMap,
        });
        this.lastResolvedCache = {
            state: this.view.state,
            key: cacheKey,
            result,
        };
        this.deps.recordPerfDuration?.('resolve_total', this.now() - startedAt);
        return result;
    }

    private resolveValidatedDropTargetInternal(params: {
        info: {
            clientX: number;
            clientY: number;
            selection?: BlockSelection | null;
            pointerType?: string | null;
            sourceScope?: DragSelectionScope;
        };
        selection: BlockSelection | null;
        sourceScope: DragSelectionScope;
        lineMap: ReturnType<typeof getLineMap>;
    }): DropValidationResult {
        const { info, selection, sourceScope, lineMap } = params;

        if (isPointInsideRenderedTableCell(this.view, info.clientX, info.clientY)) {
            return { allowed: false, reason: 'table_cell' } as const;
        }

        const embedEl = this.getEmbedElementAtPoint(info.clientX, info.clientY);
        if (embedEl) {
            const block = this.deps.getBlockInfoForEmbed(embedEl);
            if (block) {
                const rect = embedEl.getBoundingClientRect();
                const showAtBottom = info.clientY > rect.top + rect.height / 2;
                const lineNumber = clampTargetLineNumber(
                    this.view.state.doc.lines,
                    showAtBottom ? block.endLine + 2 : block.startLine + 1
                );
                const containerRule = this.resolveContainerRule(selection, lineNumber, lineMap);
                if (containerRule.rejectReason) {
                    return {
                        allowed: false,
                        reason: containerRule.rejectReason,
                    };
                }

                const inPlaceRejectReason = this.getInPlaceRejectReason({
                    selection,
                    sourceScope,
                    targetLineNumber: lineNumber,
                    slotContext: containerRule.slotContext,
                    lineMap,
                });
                if (inPlaceRejectReason) {
                    return {
                        allowed: false,
                        reason: inPlaceRejectReason,
                    };
                }

                const indicatorY = showAtBottom ? rect.bottom : rect.top;
                return this.buildAllowedResult({
                    target: {
                        targetLineNumber: lineNumber,
                        placement: 'before',
                    },
                    preview: {
                        indicatorY,
                        lineRect: { left: rect.left, width: rect.width },
                    },
                });
            }
        }

        const verticalStartedAt = this.now();
        const vertical = this.computeVerticalTarget(info, selection);
        this.deps.recordPerfDuration?.('vertical', this.now() - verticalStartedAt);
        if (!vertical) {
            return { allowed: false, reason: 'no_target' } as const;
        }

        const containerRule = this.resolveContainerRule(selection, vertical.targetLineNumber, lineMap);
        if (containerRule.rejectReason) {
            return {
                allowed: false,
                reason: containerRule.rejectReason,
            };
        }

        const listStartedAt = this.now();
        const listTarget = this.listDropTargetResolver.computeListTarget({
            targetLineNumber: vertical.targetLineNumber,
            lineNumber: vertical.line.number,
            forcedLineNumber: vertical.forcedLineNumber,
            childIntentOnLine: vertical.childIntentOnLine,
            selection,
            sourceScope,
            clientX: info.clientX,
            lineMap,
        });
        this.deps.recordPerfDuration?.('list_target', this.now() - listStartedAt);

        const inPlaceRejectReason = this.getInPlaceRejectReason({
            selection,
            sourceScope,
            targetLineNumber: vertical.targetLineNumber,
            slotContext: containerRule.slotContext,
            listIntent: listTarget.listIntent,
            lineMap,
        });
        if (inPlaceRejectReason) {
            return {
                allowed: false,
                reason: inPlaceRejectReason,
            };
        }

        const geometryStartedAt = this.now();
        const indicatorY = this.deps.getInsertionAnchorY(vertical.targetLineNumber);
        if (indicatorY === null) {
            this.deps.recordPerfDuration?.('geometry', this.now() - geometryStartedAt);
            return { allowed: false, reason: 'no_anchor' } as const;
        }

        const lineRectSourceLineNumber = listTarget.lineRectSourceLineNumber
            ?? vertical.lineRectSourceLineNumber;
        let lineRect = this.deps.getLineRect(lineRectSourceLineNumber);
        if (typeof listTarget.listIntent?.targetIndentWidth === 'number') {
            const indentPos = this.deps.getLineIndentPosByWidth(lineRectSourceLineNumber, listTarget.listIntent.targetIndentWidth);
            if (indentPos !== null) {
                const start = getCoordsAtPos(this.view, indentPos);
                const end = getCoordsAtPos(this.view, this.view.state.doc.line(lineRectSourceLineNumber).to);
                if (start && end) {
                    const left = start.left;
                    const width = Math.max(8, (end.right ?? end.left) - left);
                    lineRect = { left, width };
                }
            }
        }
        this.deps.recordPerfDuration?.('geometry', this.now() - geometryStartedAt);

        return this.buildAllowedResult({
            target: {
                targetLineNumber: vertical.targetLineNumber,
                placement: 'before',
                listIntent: listTarget.listIntent,
            },
            preview: {
                indicatorY,
                lineRect,
                highlightRect: listTarget.highlightRect,
            },
        });
    }

    private buildAllowedResult(resolution: DropResolution): DropValidationResult {
        return {
            allowed: true,
            resolution,
        };
    }

    private resolveContainerRule(
        selection: BlockSelection | null,
        targetLineNumber: number,
        lineMap: LineMap
    ): {
        slotContext: InsertionSlotContext | null;
        rejectReason: DropRejectReason | null;
    } {
        const containerStartedAt = this.now();
        const containerRule = selection
            ? this.deps.resolveDropRuleAtInsertion(selection.anchorBlock, targetLineNumber, {
                lineMap,
                tabSize: this.deps.tabSize,
            })
            : null;
        this.deps.recordPerfDuration?.('container', this.now() - containerStartedAt);
        if (!containerRule) {
            return { slotContext: null, rejectReason: null };
        }
        if (containerRule.decision.allowDrop) {
            return { slotContext: containerRule.slotContext, rejectReason: null };
        }
        return {
            slotContext: containerRule.slotContext,
            rejectReason: containerRule.decision.rejectReason ?? 'container_policy',
        };
    }

    private getInPlaceRejectReason(params: {
        selection: BlockSelection | null;
        sourceScope: DragSelectionScope;
        targetLineNumber: number;
        slotContext: InsertionSlotContext | null;
        lineMap: LineMap;
        listIntent?: DropTarget['listIntent'];
    }): DropRejectReason | null {
        const {
            selection,
            sourceScope,
            targetLineNumber,
            slotContext,
            lineMap,
            listIntent,
        } = params;

        if (!selection || sourceScope === 'cross_editor') return null;
        const inPlaceStartedAt = this.now();
        const inPlaceValidation = validateInPlaceDrop({
            doc: this.view.state.doc,
            source: selection,
            targetLineNumber,
            parseLineWithQuote: this.deps.parseLineWithQuote,
            getListContext: this.deps.getListContext,
            getIndentUnitWidth: this.deps.getIndentUnitWidth,
            slotContext: slotContext ?? undefined,
            listIntent,
            lineMap,
        });
        this.deps.recordPerfDuration?.('in_place', this.now() - inPlaceStartedAt);
        if (inPlaceValidation.inSelfRange && !inPlaceValidation.allowInPlaceIndentChange) {
            return inPlaceValidation.rejectReason ?? 'self_range_blocked';
        }
        if (!inPlaceValidation.inSelfRange && inPlaceValidation.rejectReason) {
            return inPlaceValidation.rejectReason;
        }
        return null;
    }

    private computeVerticalTarget(
        info: { clientX: number; clientY: number },
        selection: BlockSelection | null
    ): {
        line: { number: number; text: string; from: number; to: number };
        targetLineNumber: number;
        forcedLineNumber: number | null;
        childIntentOnLine: boolean;
        lineRectSourceLineNumber: number;
    } | null {
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        let lineNumber: number | null = getRenderedMainLineNumberAtPoint(this.view, info.clientX, info.clientY);
        if (lineNumber === null) {
            lineNumber = resolveLineNumberAtCoords(this.view, info.clientX, info.clientY, contentRect);
            if (lineNumber === null) return null;
        }

        const line = this.view.state.doc.line(lineNumber);
        const allowListChildIntent = !!selection && selection.anchorBlock.type === BlockType.ListItem;
        const lineBoundsForSnap = this.listDropTargetResolver.getListMarkerBounds(line.number);
        const lineParsedForSnap = this.deps.parseLineWithQuote(line.text);
        const childIntentOnLine = allowListChildIntent
            && !!lineBoundsForSnap
            && lineParsedForSnap.isListItem
            && info.clientX >= lineBoundsForSnap.contentStartX + 2;

        const adjustedTarget = this.deps.getAdjustedTargetLocation(line.number, {
            clientY: info.clientY,
        });
        let forcedLineNumber: number | null = adjustedTarget.blockAdjusted ? adjustedTarget.lineNumber : null;

        let showAtBottom = false;
        if (!forcedLineNumber) {
            const isBlankLine = line.text.trim().length === 0;
            if (isBlankLine) {
                const visualMidY = this.getVisualLineMidY(line.number, line.from);
                if (visualMidY !== null) {
                    forcedLineNumber = info.clientY > visualMidY
                        ? line.number + 1
                        : line.number;
                } else {
                    const lineStart = getCoordsAtPos(this.view, line.from);
                    const lineEnd = getCoordsAtPos(this.view, line.to);
                    if (lineStart && lineEnd) {
                        const midY = (lineStart.top + lineEnd.bottom) / 2;
                        forcedLineNumber = info.clientY > midY
                            ? line.number + 1
                            : line.number;
                    } else {
                        forcedLineNumber = line.number;
                    }
                }
            } else {
                showAtBottom = true;
                const visualMidY = this.getVisualLineMidY(line.number, line.from);
                if (visualMidY !== null) {
                    showAtBottom = info.clientY > visualMidY;
                } else {
                    const lineStart = getCoordsAtPos(this.view, line.from);
                    const lineEnd = getCoordsAtPos(this.view, line.to);
                    if (lineStart && lineEnd) {
                        const midY = (lineStart.top + lineEnd.bottom) / 2;
                        showAtBottom = info.clientY > midY;
                    }
                }
            }
        }

        let targetLineNumber = clampTargetLineNumber(
            this.view.state.doc.lines,
            forcedLineNumber ?? (showAtBottom ? line.number + 1 : line.number)
        );
        if (!forcedLineNumber && childIntentOnLine && !showAtBottom) {
            targetLineNumber = clampTargetLineNumber(this.view.state.doc.lines, line.number + 1);
        }

        return {
            line,
            targetLineNumber,
            forcedLineNumber,
            childIntentOnLine,
            lineRectSourceLineNumber: line.number,
        };
    }

    private getVisualLineMidY(lineNumber: number, lineFromPos: number): number | null {
        try {
            const block = this.view.lineBlockAt(lineFromPos);
            return this.view.documentTop + (block.top + block.bottom) / 2;
        } catch {
            return null;
        }
    }

    private getEmbedElementAtPoint(clientX: number, clientY: number): HTMLElement | null {
        return findEmbedElementAtPoint(this.view, clientX, clientY, {
            requireDirectWithinRoot: false,
            normalizeToEmbedRoot: true,
        });
    }

    private buildResolveCacheKey(
        clientX: number,
        clientY: number,
        selection: BlockSelection | null,
        pointerType: string | null,
        sourceScope: DragSelectionScope
    ): string {
        if (!selection) {
            return `${clientX}|${clientY}|none|${pointerType ?? ''}|${sourceScope}`;
        }
        const rangesKey = selection.ranges
            .map((range) => `${range.startLine}-${range.endLine}`)
            .join(',');
        return [
            clientX,
            clientY,
            pointerType ?? '',
            sourceScope,
            selection.anchorBlock.type,
            selection.anchorBlock.startLine,
            selection.anchorBlock.endLine,
            selection.anchorBlock.from,
            selection.anchorBlock.to,
            rangesKey,
        ].join('|');
    }

    private now(): number {
        if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
            return performance.now();
        }
        return Date.now();
    }
}



