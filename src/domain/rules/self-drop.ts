import { BlockType } from '../block/block-types';
import type { BlockSelection } from '../selection/block-selection';
import type { ListDropTarget } from '../command/drop-target';
import {
    InsertionRuleRejectReason,
    InsertionSlotContext,
    resolveInsertionRule,
} from './insertion-rules';
import { getLineMetaAt, LineMap } from '../markdown/line-map';
import { computeListIndentPlan } from '../mutation/list-mutation';
import { DocLike, ListContext, ParsedLine } from '../markdown/document-types';
import { normalizeCompositeRanges } from '../selection/selection-ranges';

export type SelfDropRejectReason =
    | 'self_range_blocked'
    | 'self_embedding'
    | 'container_policy'
    | InsertionRuleRejectReason;

export type SelfDropResult = {
    inSelfRange: boolean;
    allowInPlaceIndentChange: boolean;
    rejectReason?: SelfDropRejectReason;
    listContextLineNumber?: number;
    targetIndentWidth?: number;
};

function sourceRangesAreListStructured(params: {
    doc: DocLike;
    source: BlockSelection;
    parseLineWithQuote: (line: string) => ParsedLine;
    ranges: Array<{ startLine: number; endLine: number }>;
}): boolean {
    const { doc, source, parseLineWithQuote, ranges } = params;
    if (source.anchorBlock.type !== BlockType.ListItem) return false;

    for (const range of ranges) {
        let foundContent = false;
        for (let lineNumber = range.startLine + 1; lineNumber <= range.endLine + 1; lineNumber++) {
            const text = doc.line(lineNumber).text;
            if (text.trim().length === 0) continue;
            foundContent = true;
            if (!parseLineWithQuote(text).isListItem) return false;
        }
        if (!foundContent) return false;
    }

    return true;
}

export function selfDrop(params: {
    doc: DocLike;
    source: BlockSelection;
    targetLineNumber: number;
    parseLineWithQuote: (line: string) => ParsedLine;
    getListContext: (doc: DocLike, lineNumber: number) => ListContext;
    getIndentUnitWidth: (sample: string) => number;
    slotContext?: InsertionSlotContext;
    lineMap?: LineMap;
    listIntent?: ListDropTarget;
}): SelfDropResult {
    const {
        doc,
        source,
        targetLineNumber,
        parseLineWithQuote,
        getListContext,
        getIndentUnitWidth,
        slotContext,
        lineMap,
        listIntent,
    } = params;
    const sourceBlock = source.anchorBlock;

    if (typeof slotContext === 'string') {
        const containerRule = resolveInsertionRule({
            sourceType: sourceBlock.type,
            slotContext,
        });
        if (!containerRule.allowDrop) {
            return {
                inSelfRange: false,
                allowInPlaceIndentChange: false,
                rejectReason: containerRule.rejectReason ?? 'container_policy',
            };
        }
    }

    const targetLineIdx = targetLineNumber - 1;
    const sourceRanges = normalizeCompositeRanges(source.ranges, doc.lines);
    const effectiveSourceRange = {
        startLine: sourceRanges[0].startLine,
        endLine: sourceRanges[sourceRanges.length - 1].endLine,
    };

    const inSelectedRange = sourceRanges.some((range) => (
        targetLineIdx >= range.startLine && targetLineIdx <= range.endLine
    ));
    const inSelfRange = inSelectedRange || targetLineIdx === effectiveSourceRange.endLine + 1;
    if (!inSelfRange) {
        return { inSelfRange: false, allowInPlaceIndentChange: false };
    }

    const hasListIntent = listIntent?.targetIndentWidth !== undefined || listIntent?.mode !== undefined;
    if (!hasListIntent) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
        };
    }

    if (!sourceRangesAreListStructured({
        doc,
        source,
        parseLineWithQuote,
        ranges: sourceRanges,
    })) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
        };
    }

    const sourceLineNumber = effectiveSourceRange.startLine + 1;
    const sourceLineMeta = lineMap ? getLineMetaAt(lineMap, sourceLineNumber) : null;
    if (sourceLineMeta && !sourceLineMeta.isList) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
        };
    }
    const sourceLineText = doc.line(sourceLineNumber).text;
    const sourceParsed = parseLineWithQuote(sourceLineText);
    if (!sourceParsed.isListItem) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
        };
    }

    const indentPlan = computeListIndentPlan({
        doc,
        sourceBase: {
            indentWidth: sourceParsed.indentWidth,
            indentRaw: sourceParsed.indentRaw,
        },
        targetLineNumber,
        parseLineWithQuote,
        getIndentUnitWidth,
        getListContext,
        listIntent,
    });
    const targetIndentWidth = indentPlan.targetIndentWidth;
    const listContextLineNumber = indentPlan.listContextLineNumber;

    const isAfterSelf = targetLineIdx === effectiveSourceRange.endLine + 1;
    const isSameLine = targetLineIdx === effectiveSourceRange.startLine;
    const sourceEndLineNumber = effectiveSourceRange.endLine + 1;
    const isSelfContext = listContextLineNumber === sourceLineNumber;
    const isContextInsideSource = listContextLineNumber >= sourceLineNumber
        && listContextLineNumber <= sourceEndLineNumber;

    if (isAfterSelf && isContextInsideSource && targetIndentWidth > sourceParsed.indentWidth) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_embedding',
            listContextLineNumber,
            targetIndentWidth,
        };
    }

    const allowInPlaceIndentChange = (
        (isAfterSelf && targetIndentWidth !== sourceParsed.indentWidth)
        || (isSameLine && targetIndentWidth !== sourceParsed.indentWidth && !isSelfContext)
        || (!isAfterSelf && targetIndentWidth < sourceParsed.indentWidth)
    );

    if (!allowInPlaceIndentChange) {
        return {
            inSelfRange: true,
            allowInPlaceIndentChange: false,
            rejectReason: 'self_range_blocked',
            listContextLineNumber,
            targetIndentWidth,
        };
    }

    return {
        inSelfRange: true,
        allowInPlaceIndentChange: true,
        listContextLineNumber,
        targetIndentWidth,
    };
}
