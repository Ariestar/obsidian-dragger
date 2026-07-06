import { describe, expect, it } from 'vitest';
import { BlockType } from '../block/block-types';
import { createSingleBlockSelection } from '../selection/block-selection';
import { buildMoveCommandDecision } from './move-decision';
import type { DropDecision } from './drop-decision';

function createSelection() {
    return createSingleBlockSelection({
        type: BlockType.Paragraph,
        startLine: 0,
        endLine: 0,
        from: 0,
        to: 5,
        indentLevel: 0,
        content: 'alpha',
    });
}

const allowedDecision: DropDecision = {
    allowed: true,
    target: {
        targetLineNumber: 3,
        placement: 'before',
        listIntent: {
            mode: 'child',
            contextLineNumber: 2,
            targetIndentWidth: 4,
        },
    },
};

describe('buildMoveCommandDecision', () => {
    it('cancels cross-document drops when the setting is disabled', () => {
        const decision = buildMoveCommandDecision({
            selection: createSelection(),
            decision: allowedDecision,
            sourceScope: 'cross_editor',
            sourceDocumentRelation: 'different_document',
            crossFileDragEnabled: false,
        });

        expect(decision).toEqual({ type: 'cancel', rejectReason: 'cross_document_disabled' });
    });

    it('converts an allowed drop into a move command', () => {
        const selection = createSelection();
        const decision = buildMoveCommandDecision({
            selection,
            decision: allowedDecision,
            sourceScope: 'same_editor',
            sourceDocumentRelation: 'same_document',
            crossFileDragEnabled: false,
        });

        expect(decision.type).toBe('commit');
        if (decision.type !== 'commit') return;
        expect(decision.targetLine).toBe(3);
        expect(decision.command).toEqual({
            type: 'move',
            selection,
            target: allowedDecision.target,
        });
    });

    it('cancels a rejected drop without creating a command', () => {
        const decision = buildMoveCommandDecision({
            selection: createSelection(),
            decision: { allowed: false, reason: 'no_target' },
            sourceScope: 'same_editor',
            sourceDocumentRelation: 'same_document',
            crossFileDragEnabled: false,
        });

        expect(decision).toEqual({ type: 'cancel', rejectReason: 'no_target' });
    });
});
