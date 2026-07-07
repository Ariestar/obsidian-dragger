import type { DocLikeWithRange } from '../markdown/document-types';
import type { DeleteBlockCommand } from '../command/delete-command';
import type { BlockCommand } from '../command/block-command';
import type { BlockTransaction } from './block-transaction';
import { rejectCommand, type CommandReject } from './command-reject';
import { planDeleteBlocksTransaction } from './delete-blocks';

export function planBlockCommandTransaction(params: {
    doc: DocLikeWithRange;
    command: BlockCommand;
}): BlockTransaction | CommandReject {
    const { doc, command } = params;
    if (command.type === 'delete') {
        return planDeleteCommandTransaction({ doc, command });
    }

    return rejectCommand('unsupported_command');
}

export function planDeleteCommandTransaction(params: {
    doc: DocLikeWithRange;
    command: DeleteBlockCommand;
}): BlockTransaction | CommandReject {
    const { doc, command } = params;
    return planDeleteBlocksTransaction({
        doc,
        selection: command.selection,
    });
}
