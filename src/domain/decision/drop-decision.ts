import type { DropTarget } from '../command/drop-target';
import type { InsertionRuleRejectReason } from '../rules/insertion-rules';

/**
 * Why a drop was rejected. Mixes markdown rule reasons with geometry-derived
 * reasons (table cell, no anchor). All are literal facts the platform reports;
 * domain only enumerates them, it never computes them.
 */
export type DropRejectReason =
    | 'table_cell'
    | 'no_target'
    | 'no_anchor'
    | 'self_range_blocked'
    | 'self_embedding'
    | InsertionRuleRejectReason
    | 'container_policy';

/**
 * Platform-neutral drop decision: the answer to "may this block drop here?",
 * stripped of preview geometry. The platform owns the geometry-bundled
 * validation result; this is the slice the drag runtime actually decides on.
 */
export type DropDecision =
    | { allowed: true; target: DropTarget }
    | { allowed: false; reason: DropRejectReason };

export type DragSelectionScope = 'same_editor' | 'cross_editor';

export type DragDocumentRelation = 'same_document' | 'different_document';
