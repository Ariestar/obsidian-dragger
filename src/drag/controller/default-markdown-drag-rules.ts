import { resolveInsertionRule, type InsertionSlotContext } from '../../domain/rules/insertion-rules';
import type { DragCancelReason } from '../pipeline/pipeline-event';
import type {
    DragRule,
    DragRuleContext,
    DragRuleResult,
} from './dragger-controller-types';

export type DefaultMarkdownDragRuleOptions = {
    allowNestedListDrop?: boolean;
    allowQuoteDrop?: boolean;
    allowCalloutDrop?: boolean;
    allowCrossDocumentDrop?: boolean;
};

const DEFAULT_MARKDOWN_RULE_OPTIONS: Required<DefaultMarkdownDragRuleOptions> = {
    allowNestedListDrop: true,
    allowQuoteDrop: true,
    allowCalloutDrop: true,
    allowCrossDocumentDrop: true,
};

export function defaultMarkdownDragRules<TPreview = unknown>(
    options: DefaultMarkdownDragRuleOptions = {}
): DragRule<TPreview>[] {
    const config = {
        ...DEFAULT_MARKDOWN_RULE_OPTIONS,
        ...options,
    };
    return [
        (context) => evaluateDefaultMarkdownRule(context, config),
    ];
}

function evaluateDefaultMarkdownRule<TPreview>(
    context: DragRuleContext<TPreview>,
    options: Required<DefaultMarkdownDragRuleOptions>
): DragRuleResult {
    if (
        options.allowCrossDocumentDrop === false
        && context.drop.markdown?.documentRelation === 'different_document'
    ) {
        return reject('cross_document_disabled');
    }

    const slotContext = context.drop.markdown?.slotContext ?? null;
    if (!slotContext || slotContext === 'outside') return allow();

    const optionRejection = rejectByDisabledOption(slotContext, options);
    if (optionRejection) return optionRejection;

    const insertionRule = resolveInsertionRule({
        sourceType: context.selection.anchorBlock.type,
        slotContext,
    });
    if (!insertionRule.allowDrop) {
        return reject(insertionRule.rejectReason ?? 'container_policy');
    }

    return allow();
}

function rejectByDisabledOption(
    slotContext: InsertionSlotContext,
    options: Required<DefaultMarkdownDragRuleOptions>
): DragRuleResult | null {
    if (options.allowNestedListDrop === false && slotContext === 'inside_list') {
        return reject('inside_list');
    }
    if (
        options.allowQuoteDrop === false
        && (
            slotContext === 'inside_quote_run'
            || slotContext === 'quote_before'
            || slotContext === 'quote_after'
        )
    ) {
        return reject(slotContext === 'inside_quote_run' ? 'inside_quote_run' : 'quote_boundary');
    }
    if (options.allowCalloutDrop === false && slotContext === 'callout_after') {
        return reject('callout_after');
    }
    return null;
}

function allow(): DragRuleResult {
    return { allowed: true };
}

function reject(reason: DragCancelReason): DragRuleResult {
    return {
        allowed: false,
        reason,
    };
}
