import type { BlockInfo } from '../block/block-types';
import type { DocLikeWithRange } from '../markdown/document-types';
import type { ListDropTarget } from '../command/drop-target';
import { resolveDeleteRange, resolveInsertionChange } from '../mutation/document-change';
import { normalizeCompositeRanges, type CompositeLineRange } from '../selection/selection-ranges';
import type { BlockSelection } from '../selection/block-selection';
import type { MoveDeps, MovePlan } from '../move/move-plan';
import type { BlockTransaction } from './block-transaction';
import { rejectCommand, type CommandReject } from './command-reject';

export type MoveSourceSegment = {
    startLineNumber: number;
    endLineNumber: number;
    from: number;
    to: number;
    deleteFrom: number;
    deleteTo: number;
};

export type MoveSourcePayload = {
    content: string;
    ranges: CompositeLineRange[];
    segments: MoveSourceSegment[];
};

export type CapturedMoveSource = {
    block: BlockInfo;
    payload: MoveSourcePayload;
};

export function captureMoveSource(doc: DocLikeWithRange, selection: BlockSelection): CapturedMoveSource | null {
    const payload = captureMoveSourcePayload(doc, selection);
    if (!payload) return null;

    const firstRange = payload.ranges[0];
    const lastRange = payload.ranges[payload.ranges.length - 1];
    const firstLine = doc.line(firstRange.startLine + 1);
    const lastLine = doc.line(lastRange.endLine + 1);

    return {
        block: {
            ...selection.anchorBlock,
            startLine: firstRange.startLine,
            endLine: lastRange.endLine,
            from: firstLine.from,
            to: lastLine.to,
            content: payload.content,
        },
        payload,
    };
}

export function captureMoveSourcePayload(doc: DocLikeWithRange, selection: BlockSelection): MoveSourcePayload | null {
    const ranges = normalizeCompositeRanges(selection.ranges, doc.lines);
    if (ranges.length === 0) return null;

    const segments = ranges.map((range) => {
        const startLineNumber = range.startLine + 1;
        const endLineNumber = range.endLine + 1;
        const startLine = doc.line(startLineNumber);
        const endLine = doc.line(endLineNumber);
        const deleteRange = resolveDeleteRange(doc, startLine.from, endLine.to);
        return {
            startLineNumber,
            endLineNumber,
            from: startLine.from,
            to: endLine.to,
            deleteFrom: deleteRange.from,
            deleteTo: deleteRange.to,
        };
    });
    const content = segments
        .map((segment) => doc.sliceString(segment.from, segment.to))
        .join('\n');

    return { content, ranges, segments };
}

export function moveTx(doc: DocLikeWithRange, plan: MovePlan): BlockTransaction | CommandReject {
    if (plan.mode === 'insert-only') {
        return planInsertOnlyTransaction({
            doc,
            sourceBlock: plan.captured.block,
            payload: plan.captured.payload,
            targetLineNumber: plan.targetLineNumber,
            listIntent: plan.target.listIntent,
            deps: plan.deps,
        });
    }

    return planInsertionAndDeletionTransaction({
        doc,
        sourceBlock: plan.captured.block,
        payload: plan.captured.payload,
        targetLineNumber: plan.targetLineNumber,
        listIntent: plan.target.listIntent,
        deps: plan.deps,
        allowInPlaceIndentChange: plan.allowIndent,
    });
}

function planInsertionAndDeletionTransaction(params: {
    doc: DocLikeWithRange;
    sourceBlock: BlockInfo;
    payload: MoveSourcePayload;
    targetLineNumber: number;
    listIntent?: ListDropTarget;
    deps: MoveDeps;
    allowInPlaceIndentChange: boolean;
}): BlockTransaction | CommandReject {
    const { doc, sourceBlock, payload, targetLineNumber, listIntent, deps, allowInPlaceIndentChange } = params;

    const insertText = deps.insertText(
        doc,
        sourceBlock,
        targetLineNumber,
        payload.content,
        listIntent
    );
    if (!insertText.length) return rejectCommand('no_insert_text');

    const totalDeletedLength = payload.segments.reduce(
        (sum, segment) => sum + (segment.deleteTo - segment.deleteFrom),
        0
    );
    const insertion = resolveInsertionChange(doc, targetLineNumber, insertText, {
        remainingLengthAfterDelete: doc.length - totalDeletedLength,
    });
    if (payload.segments.some((segment) => insertion.pos > segment.deleteFrom && insertion.pos < segment.deleteTo)) {
        return rejectCommand('insertion_inside_deleted_range');
    }

    const firstSegment = payload.segments[0];
    const changes = allowInPlaceIndentChange && insertion.pos === firstSegment.deleteFrom
        ? [{ from: firstSegment.deleteFrom, to: firstSegment.deleteTo, insert: insertion.text }]
        : [
            { from: insertion.pos, to: insertion.pos, insert: insertion.text },
            ...payload.segments.map((segment) => ({ from: segment.deleteFrom, to: segment.deleteTo, insert: '' })),
        ].sort((a, b) => b.from - a.from);

    const finalInsertedStartLineNumber = resolveFinalInsertedStartLineNumber(targetLineNumber, payload);
    const renumberTargets = new Set<number>([targetLineNumber, finalInsertedStartLineNumber]);
    for (const segment of payload.segments) {
        renumberTargets.add(segment.startLineNumber);
    }

    return {
        changes,
        effects: [
            { type: 'restore-fold-state', lineNumber: finalInsertedStartLineNumber },
            ...Array.from(renumberTargets).map((lineNumber) => ({ type: 'renumber-ordered-list' as const, lineNumber })),
        ],
    };
}

function planInsertOnlyTransaction(params: {
    doc: DocLikeWithRange;
    sourceBlock: BlockInfo;
    payload: MoveSourcePayload;
    targetLineNumber: number;
    listIntent?: ListDropTarget;
    deps: MoveDeps;
}): BlockTransaction | CommandReject {
    const { doc, sourceBlock, payload, targetLineNumber, listIntent, deps } = params;
    const insertText = deps.insertText(
        doc,
        sourceBlock,
        targetLineNumber,
        payload.content,
        listIntent
    );
    if (!insertText.length) return rejectCommand('no_insert_text');

    const insertion = resolveInsertionChange(doc, targetLineNumber, insertText, {
        remainingLengthAfterDelete: doc.length,
    });
    const changes = [{ from: insertion.pos, to: insertion.pos, insert: insertion.text }];
    return {
        changes,
        effects: [
            { type: 'restore-fold-state', lineNumber: targetLineNumber },
            { type: 'renumber-ordered-list', lineNumber: targetLineNumber },
        ],
    };
}

export function resolveFinalInsertedStartLineNumber(targetLineNumber: number, payload: MoveSourcePayload): number {
    let removedLineCountBeforeTarget = 0;
    for (const segment of payload.segments) {
        if (segment.endLineNumber < targetLineNumber) {
            removedLineCountBeforeTarget += segment.endLineNumber - segment.startLineNumber + 1;
        }
    }
    return Math.max(1, targetLineNumber - removedLineCountBeforeTarget);
}
