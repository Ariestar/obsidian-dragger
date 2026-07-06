import { describe, expect, it } from 'vitest';
import { BlockType, type BlockInfo } from '../../domain/block/block-types';
import { createSingleBlockSelection } from '../../domain/selection/block-selection';
import type { DragRuleContext } from './dragger-controller-types';
import { defaultMarkdownDragRules } from './default-markdown-drag-rules';

const paragraph: BlockInfo = {
    type: BlockType.Paragraph,
    startLine: 0,
    endLine: 0,
    from: 0,
    to: 5,
    indentLevel: 0,
    content: 'alpha',
};

const listItem: BlockInfo = {
    ...paragraph,
    type: BlockType.ListItem,
    content: '- alpha',
};

function context(
    block: BlockInfo,
    markdown: DragRuleContext['drop']['markdown']
): DragRuleContext {
    return {
        selection: createSingleBlockSelection(block),
        source: 'handle',
        document: { lineCount: 4 },
        drop: {
            target: { targetLineNumber: 2, placement: 'before' },
            rejectReason: null,
            markdown,
        },
    };
}

function evaluate(
    ruleContext: DragRuleContext,
    options?: Parameters<typeof defaultMarkdownDragRules>[0]
) {
    const [rule] = defaultMarkdownDragRules(options);
    return rule(ruleContext);
}

describe('defaultMarkdownDragRules', () => {
    it('uses the markdown insertion matrix when markdown facts are provided', () => {
        expect(evaluate(context(paragraph, { slotContext: 'inside_list' }))).toEqual({
            allowed: false,
            reason: 'inside_list',
        });
        expect(evaluate(context(listItem, { slotContext: 'inside_list' }))).toEqual({
            allowed: true,
        });
    });

    it('allows plain drops when no markdown facts are provided', () => {
        expect(evaluate(context(paragraph, null))).toEqual({ allowed: true });
        expect(evaluate(context(paragraph, { slotContext: 'outside' }))).toEqual({ allowed: true });
    });

    it('can disable nested list, quote, callout, and cross-document drops', () => {
        expect(evaluate(context(listItem, { slotContext: 'inside_list' }), {
            allowNestedListDrop: false,
        })).toEqual({
            allowed: false,
            reason: 'inside_list',
        });
        expect(evaluate(context(paragraph, { slotContext: 'quote_before' }), {
            allowQuoteDrop: false,
        })).toEqual({
            allowed: false,
            reason: 'quote_boundary',
        });
        expect(evaluate(context(paragraph, { slotContext: 'callout_after' }), {
            allowCalloutDrop: false,
        })).toEqual({
            allowed: false,
            reason: 'callout_after',
        });
        expect(evaluate(context(paragraph, { documentRelation: 'different_document' }), {
            allowCrossDocumentDrop: false,
        })).toEqual({
            allowed: false,
            reason: 'cross_document_disabled',
        });
    });
});
