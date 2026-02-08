import { describe, expect, it } from 'vitest';
import { BlockType } from '../../types';
import { resolveInsertionRule } from './insertion-rule-matrix';

describe('insertion-rule-matrix', () => {
    it('blocks non-list blocks inside list containers', () => {
        const rule = resolveInsertionRule({
            sourceType: BlockType.Paragraph,
            targetContainerType: BlockType.ListItem,
            position: 'inside',
        });

        expect(rule.allowDrop).toBe(false);
    });

    it('allows list blocks inside list containers', () => {
        const rule = resolveInsertionRule({
            sourceType: BlockType.ListItem,
            targetContainerType: BlockType.ListItem,
            position: 'inside',
        });

        expect(rule.allowDrop).toBe(true);
    });

    it('resets quote depth when plain content is inserted after callout flow', () => {
        const rule = resolveInsertionRule({
            sourceType: BlockType.Paragraph,
            targetContainerType: BlockType.Callout,
            position: 'after',
        });

        expect(rule.leadingBlank).toBe(true);
        expect(rule.resetQuoteDepth).toBe(true);
    });

    it('keeps quote depth when blockquote content follows quote container', () => {
        const rule = resolveInsertionRule({
            sourceType: BlockType.Blockquote,
            targetContainerType: BlockType.Blockquote,
            position: 'after',
        });

        expect(rule.leadingBlank).toBe(false);
        expect(rule.resetQuoteDepth).toBe(false);
    });
});
