import { BlockType } from '../../types';
import {
    isBlockquoteLine,
    isCalloutLine,
    isHorizontalRuleLine,
    isListItemLine,
    isTableLine,
} from './line-type-guards';

export type InsertionSlotContext =
    | 'inside_list'
    | 'inside_quote_run'
    | 'quote_before'
    | 'quote_after'
    | 'callout_after'
    | 'table_before'
    | 'hr_before'
    | 'outside';

export type InsertionRuleRejectReason =
    | 'inside_list'
    | 'inside_quote_run'
    | 'quote_boundary'
    | 'callout_after'
    | 'table_before'
    | 'hr_before';

export interface InsertionRuleInput {
    sourceType: BlockType;
    slotContext: InsertionSlotContext;
}

export interface InsertionRuleDecision {
    allowDrop: boolean;
    rejectReason: InsertionRuleRejectReason | null;
}

function isQuoteLikeType(type: BlockType): boolean {
    return type === BlockType.Blockquote || type === BlockType.Callout;
}


export function inferSlotContextFromAdjacentLines(input: {
    prevText: string | null;
    nextText: string | null;
}): InsertionSlotContext {
    const { prevText, nextText } = input;
    const prevIsQuoteLike = isBlockquoteLine(prevText);
    const nextIsQuoteLike = isBlockquoteLine(nextText);

    if (isCalloutLine(prevText) && !nextIsQuoteLike) {
        return 'callout_after';
    }

    const nextIsTable = isTableLine(nextText);
    const prevIsTable = isTableLine(prevText);
    if (nextIsTable && !prevIsTable) {
        return 'table_before';
    }

    if (isHorizontalRuleLine(nextText)) {
        return 'hr_before';
    }

    if (prevIsQuoteLike && nextIsQuoteLike) {
        return 'inside_quote_run';
    }
    if (!prevIsQuoteLike && nextIsQuoteLike) {
        return 'quote_before';
    }
    if (prevIsQuoteLike && !nextIsQuoteLike) {
        return 'quote_after';
    }

    if (isListItemLine(prevText) && isListItemLine(nextText)) {
        return 'inside_list';
    }

    return 'outside';
}

export function resolveInsertionRule(input: InsertionRuleInput): InsertionRuleDecision {
    const decision: InsertionRuleDecision = {
        allowDrop: true,
        rejectReason: null,
    };
    const sourceIsQuoteLike = isQuoteLikeType(input.sourceType);

    if (input.slotContext === 'inside_list' && input.sourceType !== BlockType.ListItem) {
        decision.allowDrop = false;
        decision.rejectReason = 'inside_list';
    }

    if (
        input.slotContext === 'inside_quote_run'
        && (!sourceIsQuoteLike || input.sourceType === BlockType.Callout)
    ) {
        decision.allowDrop = false;
        decision.rejectReason = 'inside_quote_run';
    }

    if (
        (input.slotContext === 'quote_before' || input.slotContext === 'quote_after')
        && input.sourceType === BlockType.Callout
    ) {
        decision.allowDrop = false;
        decision.rejectReason = 'quote_boundary';
    }

    if (input.slotContext === 'quote_after' && input.sourceType !== BlockType.Blockquote) {
        decision.allowDrop = false;
        decision.rejectReason = 'quote_boundary';
    }

    if (input.slotContext === 'callout_after') {
        decision.allowDrop = false;
        decision.rejectReason = 'callout_after';
    }

    if (input.slotContext === 'table_before') {
        decision.allowDrop = false;
        decision.rejectReason = 'table_before';
    }

    if (input.slotContext === 'hr_before') {
        decision.allowDrop = false;
        decision.rejectReason = 'hr_before';
    }

    return decision;
}
