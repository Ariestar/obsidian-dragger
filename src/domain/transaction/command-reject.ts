import type { InsertionRuleRejectReason } from '../rules/insertion-rules';

export type CommandRejectReason =
    | 'empty_selection'
    | 'container_policy'
    | 'self_range_blocked'
    | 'self_embedding'
    | 'no_insert_text'
    | 'insertion_inside_deleted_range'
    | 'unsupported_command'
    | InsertionRuleRejectReason;

export type CommandReject = {
    type: 'reject';
    reason: CommandRejectReason;
};

export function rejectCommand(reason: CommandRejectReason): CommandReject {
    return { type: 'reject', reason };
}
