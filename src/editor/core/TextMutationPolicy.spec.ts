import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { BlockInfo, BlockType } from '../../types';
import { LineParsingService } from './LineParsingService';
import { TextMutationPolicy } from './TextMutationPolicy';

function createPolicy(docText: string): { policy: TextMutationPolicy; doc: EditorState['doc'] } {
    const state = EditorState.create({ doc: docText });
    const view = { state } as unknown as EditorView;
    const lineParsingService = new LineParsingService(view);
    return {
        policy: new TextMutationPolicy(lineParsingService),
        doc: state.doc,
    };
}

function createBlock(type: BlockType, content: string): BlockInfo {
    return {
        type,
        startLine: 0,
        endLine: Math.max(0, content.split('\n').length - 1),
        from: 0,
        to: content.length,
        indentLevel: 0,
        content,
    };
}

describe('TextMutationPolicy', () => {
    it('keeps callout quote markers when building insert text', () => {
        const { policy, doc } = createPolicy('paragraph');
        const sourceBlock = createBlock(BlockType.Callout, '> [!TIP]\n> keep marker');

        const insertText = policy.buildInsertText(doc as any, sourceBlock, 2, sourceBlock.content);

        expect(insertText).toBe('> [!TIP]\n> keep marker\n');
    });

    it('adapts list marker to task context', () => {
        const { policy, doc } = createPolicy('- [ ] existing task');
        const sourceBlock = createBlock(BlockType.ListItem, '- moved item');

        const insertText = policy.buildInsertText(doc as any, sourceBlock, 2, sourceBlock.content);

        expect(insertText).toBe('- [ ] moved item\n');
    });
});
