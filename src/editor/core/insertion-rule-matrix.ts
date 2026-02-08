import { BlockType } from '../../types';

export type RuleTargetContainerType =
    | BlockType.ListItem
    | BlockType.Blockquote
    | BlockType.Callout
    | null;

export type RulePosition = 'inside' | 'before' | 'after' | 'boundary' | 'outside';

type SourceFamily = 'list' | 'blockquote' | 'callout' | 'other';

export interface InsertionRuleInput {
    sourceType: BlockType;
    targetContainerType: RuleTargetContainerType;
    position: RulePosition;
}

export interface InsertionRuleDecision {
    allowDrop: boolean;
    leadingBlank: boolean;
    trailingBlank: boolean;
    resetQuoteDepth: boolean;
}

const SOURCE_FAMILY_BY_TYPE: Partial<Record<BlockType, SourceFamily>> = {
    [BlockType.ListItem]: 'list',
    [BlockType.Blockquote]: 'blockquote',
    [BlockType.Callout]: 'callout',
};

const INSIDE_ALLOW_MATRIX: Record<
Exclude<RuleTargetContainerType, null>,
Record<SourceFamily, boolean>
> = {
    [BlockType.ListItem]: {
        list: true,
        blockquote: false,
        callout: false,
        other: false,
    },
    [BlockType.Blockquote]: {
        list: false,
        blockquote: true,
        callout: false,
        other: false,
    },
    [BlockType.Callout]: {
        list: false,
        blockquote: false,
        callout: true,
        other: false,
    },
};

function resolveSourceFamily(sourceType: BlockType): SourceFamily {
    return SOURCE_FAMILY_BY_TYPE[sourceType] ?? 'other';
}

export function resolveInsertionRule(input: InsertionRuleInput): InsertionRuleDecision {
    const sourceFamily = resolveSourceFamily(input.sourceType);
    const targetType = input.targetContainerType;
    const position = input.position;
    const decision: InsertionRuleDecision = {
        allowDrop: true,
        leadingBlank: false,
        trailingBlank: false,
        resetQuoteDepth: false,
    };

    if (targetType && position === 'inside') {
        decision.allowDrop = INSIDE_ALLOW_MATRIX[targetType][sourceFamily];
    }

    const targetIsQuoteLike = targetType === BlockType.Blockquote || targetType === BlockType.Callout;
    const sourceIsQuoteLike = sourceFamily === 'blockquote' || sourceFamily === 'callout';
    if (targetIsQuoteLike && position === 'after' && !sourceIsQuoteLike) {
        decision.leadingBlank = true;
        decision.resetQuoteDepth = true;
    }

    return decision;
}
