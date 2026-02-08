import { EditorView } from '@codemirror/view';
import { BlockInfo, BlockType } from '../../types';
import { validateInPlaceDrop } from '../core/drop-validation';
import { RulePosition, RuleTargetContainerType } from '../core/insertion-rule-matrix';
import { DocLike, ListContext, ParsedLine } from '../core/protocol-types';
import { EMBED_BLOCK_SELECTOR } from '../core/selectors';
import { isPointInsideRenderedTableCell } from '../core/table-guard';
import { ListDropTargetCalculator } from './ListDropTargetCalculator';

type DropTargetInfo = {
    lineNumber: number;
    indicatorY: number;
    listContextLineNumber?: number;
    listIndentDelta?: number;
    listTargetIndentWidth?: number;
    lineRect?: { left: number; width: number };
    highlightRect?: { top: number; left: number; width: number; height: number };
};

export interface DropTargetCalculatorDeps {
    parseLineWithQuote: (line: string) => ParsedLine;
    getAdjustedTargetLocation: (lineNumber: number, options?: { clientY?: number }) => { lineNumber: number; blockAdjusted: boolean };
    clampTargetLineNumber: (totalLines: number, lineNumber: number) => number;
    getPreviousNonEmptyLineNumber: (doc: DocLike, lineNumber: number) => number | null;
    resolveDropRuleAtInsertion: (
        sourceBlock: BlockInfo,
        targetLineNumber: number
    ) => {
        targetContainerType: RuleTargetContainerType;
        position: RulePosition;
        decision: { allowDrop: boolean };
    };
    getListContext: (doc: DocLike, lineNumber: number) => ListContext;
    getIndentUnitWidth: (sample: string) => number;
    getBlockInfoForEmbed: (embedEl: HTMLElement) => BlockInfo | null;
    getIndentUnitWidthForDoc: (doc: DocLike) => number;
    getLineRect: (lineNumber: number) => { left: number; width: number } | undefined;
    getInsertionAnchorY: (lineNumber: number) => number | null;
    getLineIndentPosByWidth: (lineNumber: number, targetIndentWidth: number) => number | null;
    getBlockRect: (startLineNumber: number, endLineNumber: number) => { top: number; left: number; width: number; height: number } | undefined;
    clampNumber: (value: number, min: number, max: number) => number;
    onDragTargetEvaluated?: (info: {
        sourceBlock: BlockInfo | null;
        pointerType: string | null;
        validation: DropValidationResult;
    }) => void;
}

export type DropRejectReason =
    | 'table_cell'
    | 'no_target'
    | 'container_policy'
    | 'no_anchor'
    | 'self_range_blocked'
    | 'self_embedding';

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

    constructor(
        private readonly view: EditorView,
        private readonly deps: DropTargetCalculatorDeps
    ) {
        this.listDropTargetCalculator = new ListDropTargetCalculator(this.view, {
            parseLineWithQuote: this.deps.parseLineWithQuote,
            getPreviousNonEmptyLineNumber: this.deps.getPreviousNonEmptyLineNumber,
            getIndentUnitWidthForDoc: this.deps.getIndentUnitWidthForDoc,
            getBlockRect: this.deps.getBlockRect,
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
        if (isPointInsideRenderedTableCell(this.view, info.clientX, info.clientY)) {
            const result = { allowed: false, reason: 'table_cell' } as const;
            this.deps.onDragTargetEvaluated?.({
                sourceBlock: info.dragSource ?? null,
                pointerType: info.pointerType ?? null,
                validation: result,
            });
            return result;
        }
        const dragSource = info.dragSource ?? null;
        const embedEl = this.getEmbedElementAtPoint(info.clientX, info.clientY);
        if (embedEl) {
            const block = this.deps.getBlockInfoForEmbed(embedEl);
            if (block) {
                const rect = embedEl.getBoundingClientRect();
                const showAtBottom = info.clientY > rect.top + rect.height / 2;
                const lineNumber = this.deps.clampTargetLineNumber(this.view.state.doc.lines, showAtBottom ? block.endLine + 2 : block.startLine + 1);
                const containerRule = dragSource
                    ? this.deps.resolveDropRuleAtInsertion(dragSource, lineNumber)
                    : null;
                if (containerRule && !containerRule.decision.allowDrop) {
                    const result = { allowed: false, reason: 'container_policy' } as const;
                    this.deps.onDragTargetEvaluated?.({
                        sourceBlock: dragSource,
                        pointerType: info.pointerType ?? null,
                        validation: result,
                    });
                    return result;
                }
                if (dragSource) {
                    const inPlaceValidation = validateInPlaceDrop({
                        doc: this.view.state.doc,
                        sourceBlock: dragSource,
                        targetLineNumber: lineNumber,
                        parseLineWithQuote: this.deps.parseLineWithQuote,
                        getListContext: this.deps.getListContext,
                        getIndentUnitWidth: this.deps.getIndentUnitWidth,
                        targetContainerType: containerRule?.targetContainerType,
                        containerPosition: containerRule?.position,
                    });
                    if (inPlaceValidation.inSelfRange && !inPlaceValidation.allowInPlaceIndentChange) {
                        const result = {
                            allowed: false,
                            reason: inPlaceValidation.rejectReason ?? 'self_range_blocked',
                        };
                        this.deps.onDragTargetEvaluated?.({
                            sourceBlock: dragSource,
                            pointerType: info.pointerType ?? null,
                            validation: result,
                        });
                        return result;
                    }
                    if (inPlaceValidation.rejectReason === 'container_policy') {
                        const result = {
                            allowed: false,
                            reason: 'container_policy' as const,
                        };
                        this.deps.onDragTargetEvaluated?.({
                            sourceBlock: dragSource,
                            pointerType: info.pointerType ?? null,
                            validation: result,
                        });
                        return result;
                    }
                }
                const indicatorY = showAtBottom ? rect.bottom : rect.top;
                const result = {
                    allowed: true,
                    targetLineNumber: lineNumber,
                    indicatorY,
                    lineRect: { left: rect.left, width: rect.width },
                };
                this.deps.onDragTargetEvaluated?.({
                    sourceBlock: dragSource,
                    pointerType: info.pointerType ?? null,
                    validation: result,
                });
                return result;
            }
        }

        const vertical = this.computeVerticalTarget(info, dragSource);
        if (!vertical) {
            const result = { allowed: false, reason: 'no_target' } as const;
            this.deps.onDragTargetEvaluated?.({
                sourceBlock: dragSource,
                pointerType: info.pointerType ?? null,
                validation: result,
            });
            return result;
        }
        const containerRule = dragSource
            ? this.deps.resolveDropRuleAtInsertion(dragSource, vertical.targetLineNumber)
            : null;
        if (containerRule && !containerRule.decision.allowDrop) {
            const result = { allowed: false, reason: 'container_policy' } as const;
            this.deps.onDragTargetEvaluated?.({
                sourceBlock: dragSource,
                pointerType: info.pointerType ?? null,
                validation: result,
            });
            return result;
        }

        const listTarget = this.listDropTargetCalculator.computeListTarget({
            targetLineNumber: vertical.targetLineNumber,
            lineNumber: vertical.line.number,
            forcedLineNumber: vertical.forcedLineNumber,
            childIntentOnLine: vertical.childIntentOnLine,
            dragSource,
            clientX: info.clientX,
        });

        if (dragSource) {
            const inPlaceValidation = validateInPlaceDrop({
                doc: this.view.state.doc,
                sourceBlock: dragSource,
                targetLineNumber: vertical.targetLineNumber,
                parseLineWithQuote: this.deps.parseLineWithQuote,
                getListContext: this.deps.getListContext,
                getIndentUnitWidth: this.deps.getIndentUnitWidth,
                targetContainerType: containerRule?.targetContainerType,
                containerPosition: containerRule?.position,
                listContextLineNumberOverride: listTarget.listContextLineNumber,
                listIndentDeltaOverride: listTarget.listIndentDelta,
                listTargetIndentWidthOverride: listTarget.listTargetIndentWidth,
            });
            if (inPlaceValidation.inSelfRange && !inPlaceValidation.allowInPlaceIndentChange) {
                const result = {
                    allowed: false,
                    reason: inPlaceValidation.rejectReason ?? 'self_range_blocked',
                };
                this.deps.onDragTargetEvaluated?.({
                    sourceBlock: dragSource,
                    pointerType: info.pointerType ?? null,
                    validation: result,
                });
                return result;
            }
            if (inPlaceValidation.rejectReason === 'container_policy') {
                const result = {
                    allowed: false,
                    reason: 'container_policy' as const,
                };
                this.deps.onDragTargetEvaluated?.({
                    sourceBlock: dragSource,
                    pointerType: info.pointerType ?? null,
                    validation: result,
                });
                return result;
            }
        }

        const indicatorY = this.deps.getInsertionAnchorY(vertical.targetLineNumber);
        if (indicatorY === null) {
            const result = { allowed: false, reason: 'no_anchor' } as const;
            this.deps.onDragTargetEvaluated?.({
                sourceBlock: dragSource,
                pointerType: info.pointerType ?? null,
                validation: result,
            });
            return result;
        }

        const lineRectSourceLineNumber = listTarget.lineRectSourceLineNumber
            ?? vertical.lineRectSourceLineNumber;
        let lineRect = this.deps.getLineRect(lineRectSourceLineNumber);
        if (typeof listTarget.listTargetIndentWidth === 'number') {
            const indentPos = this.deps.getLineIndentPosByWidth(lineRectSourceLineNumber, listTarget.listTargetIndentWidth);
            if (indentPos !== null) {
                const start = this.view.coordsAtPos(indentPos);
                const end = this.view.coordsAtPos(this.view.state.doc.line(lineRectSourceLineNumber).to);
                if (start && end) {
                    const left = start.left;
                    const width = Math.max(8, (end.right ?? end.left) - left);
                    lineRect = { left, width };
                }
            }
        }
        const result = {
            allowed: true,
            targetLineNumber: vertical.targetLineNumber,
            indicatorY,
            listContextLineNumber: listTarget.listContextLineNumber,
            listIndentDelta: listTarget.listIndentDelta,
            listTargetIndentWidth: listTarget.listTargetIndentWidth,
            lineRect,
            highlightRect: listTarget.highlightRect,
        };
        this.deps.onDragTargetEvaluated?.({
            sourceBlock: dragSource,
            pointerType: info.pointerType ?? null,
            validation: result,
        });
        return result;
    }

    private computeVerticalTarget(
        info: { clientX: number; clientY: number },
        dragSource: BlockInfo | null
    ): {
        line: { number: number; text: string; from: number; to: number };
        targetLineNumber: number;
        forcedLineNumber: number | null;
        childIntentOnLine: boolean;
        lineRectSourceLineNumber: number;
    } | null {
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const x = this.deps.clampNumber(info.clientX, contentRect.left + 2, contentRect.right - 2);
        const pos = this.view.posAtCoords({ x, y: info.clientY });
        if (pos === null) return null;

        const line = this.view.state.doc.lineAt(pos);
        const allowListChildIntent = !!dragSource && dragSource.type === BlockType.ListItem;
        const lineBoundsForSnap = this.listDropTargetCalculator.getListMarkerBounds(line.number);
        const lineParsedForSnap = this.deps.parseLineWithQuote(line.text);
        const childIntentOnLine = allowListChildIntent
            && !!lineBoundsForSnap
            && lineParsedForSnap.isListItem
            && info.clientX >= lineBoundsForSnap.contentStartX + 2;

        const adjustedTarget = this.deps.getAdjustedTargetLocation(line.number, { clientY: info.clientY });
        let forcedLineNumber: number | null = adjustedTarget.blockAdjusted ? adjustedTarget.lineNumber : null;

        let showAtBottom = false;
        if (!forcedLineNumber) {
            const isBlankLine = line.text.trim().length === 0;
            showAtBottom = !isBlankLine;
            if (isBlankLine) {
                forcedLineNumber = line.number;
            } else {
                const lineStart = this.view.coordsAtPos(line.from);
                const lineEnd = this.view.coordsAtPos(line.to);
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
}
