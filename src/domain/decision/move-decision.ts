import type { BlockSelection } from '../selection/block-selection';
import { createMoveCommand, type MoveBlockCommand } from '../command/move-command';
import type {
    DragDocumentRelation,
    DragSelectionScope,
    DropDecision,
    DropRejectReason,
} from './drop-decision';

export type MoveCommandDecision =
    | { type: 'cancel'; rejectReason: DropRejectReason | 'cross_document_disabled' }
    | { type: 'commit'; command: MoveBlockCommand; targetLine: number };

/**
 * Turns a drop decision into either a move command or a cancel. Pure: no
 * preview, no validation struct, no editor types.
 */
export function buildMoveCommandDecision(params: {
    selection: BlockSelection;
    decision: DropDecision;
    sourceScope: DragSelectionScope;
    sourceDocumentRelation: DragDocumentRelation;
    crossFileDragEnabled: boolean;
}): MoveCommandDecision {
    const { selection, decision, sourceScope, sourceDocumentRelation, crossFileDragEnabled } = params;

    if (
        sourceScope === 'cross_editor'
        && sourceDocumentRelation === 'different_document'
        && !crossFileDragEnabled
    ) {
        return { type: 'cancel', rejectReason: 'cross_document_disabled' };
    }

    if (!decision.allowed) {
        return { type: 'cancel', rejectReason: decision.reason };
    }

    return {
        type: 'commit',
        command: createMoveCommand(selection, decision.target),
        targetLine: decision.target.targetLineNumber,
    };
}
