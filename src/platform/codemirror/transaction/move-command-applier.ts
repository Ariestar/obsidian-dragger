import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { detectBlock } from '../../../domain/block/block-detector';
import type { BlockInfo } from '../../../domain/block/block-types';
import { getLineMap } from '../../../domain/markdown/line-map';
import { getNextNonEmptyLineNumber } from '../../../domain/rules/container-policy';
import type { DocLikeWithRange } from '../../../domain/markdown/document-types';
import {
    type MoveBlockCommand,
} from '../../../domain/command/move-command';
import {
    captureMoveSource,
    type CapturedMoveSource,
    type MoveBlocksPlannerDeps,
} from '../../../domain/transaction/move-blocks';
import {
    planBlockCommandTransaction,
    planCapturedMoveCommandTransaction,
} from '../../../domain/transaction/block-command-transaction';
import { planOrderedListRenumberChanges } from '../../../domain/transaction/list-renumber';
import type { BlockEffect } from '../../../domain/transaction/block-transaction';
import type { DragDocumentRelation } from '../../../domain/decision/drop-decision';
import { applyBlockTransaction } from './transaction-applier';
import type { CapturedBlockFoldState, BlockFoldStateManager } from '../../obsidian/block-fold-state';

export interface MoveCommandApplierDeps extends MoveBlocksPlannerDeps {
    view: EditorView;
    blockFoldState?: BlockFoldStateManager;
}

export type MoveCommandParams = {
    command: MoveBlockCommand;
    sourceView?: EditorView;
    sourceDocumentRelation?: DragDocumentRelation;
    capturedBlockFoldStateOverride?: CapturedBlockFoldState | null;
};

function isReject(value: unknown): value is { type: 'reject' } {
    return !!value && typeof value === 'object' && 'type' in value && (value as { type?: unknown }).type === 'reject';
}

export function applyMoveCommand(deps: MoveCommandApplierDeps, params: MoveCommandParams): void {
    const {
        command,
        sourceView,
        sourceDocumentRelation,
        capturedBlockFoldStateOverride,
    } = params;
    const selection = command.selection;
    const sourceEditorView = sourceView ?? deps.view;
    const sourceDoc = sourceEditorView.state.doc as unknown as DocLikeWithRange;
    const capturedSource = captureMoveSource(sourceDoc, selection);
    if (!capturedSource) return;

    if (sourceView && sourceView !== deps.view && sourceDocumentRelation !== 'same_document') {
        const capturedBlockFoldState = capturedBlockFoldStateOverride
            ?? captureBlockFoldState(deps, sourceView, capturedSource.block);
        applyMoveCommandAcrossEditors({
            sourceView,
            targetView: deps.view,
            sourceBlock: capturedSource.block,
            moveSourcePayload: capturedSource.payload,
            command,
            capturedBlockFoldState,
            deps,
        });
        return;
    }

    const capturedBlockFoldState = capturedBlockFoldStateOverride
        ?? captureBlockFoldState(deps, sourceEditorView, capturedSource.block);
    const doc = deps.view.state.doc as unknown as DocLikeWithRange;
    const displacedTargetFoldState = selection.ranges.length <= 1
        ? captureDisplacedTargetFoldState(deps, {
            sourceBlock: capturedSource.block,
            targetLineNumber: command.target.targetLineNumber,
            insertedLineCount: capturedSource.payload.content.split('\n').length,
        })
        : null;
    const planned = planBlockCommandTransaction({ doc, command, deps });
    if (isReject(planned)) return;
    applyBlockTransaction(deps.view, planned, { anchor: capturedSource.block.from });
    applyMovePostEffects(deps, planned.effects);
    const restoreLine = planned.effects?.find((effect) => effect.type === 'restore-fold-state')?.lineNumber
        ?? command.target.targetLineNumber;
    deps.blockFoldState?.restore(deps.view, restoreLine, capturedBlockFoldState ?? null);
    if (displacedTargetFoldState) {
        deps.blockFoldState?.restore(
            deps.view,
            displacedTargetFoldState.targetStartLineNumber,
            displacedTargetFoldState.foldState
        );
    }
}

export interface CrossEditorMoveCommandParams {
    sourceView: EditorView;
    targetView: EditorView;
    sourceBlock: BlockInfo;
    moveSourcePayload: CapturedMoveSource['payload'];
    command: MoveBlockCommand;
    capturedBlockFoldState?: CapturedBlockFoldState | null;
    deps: MoveCommandApplierDeps;
}

export function applyMoveCommandAcrossEditors(params: CrossEditorMoveCommandParams): void {
    const { sourceView, targetView, sourceBlock, moveSourcePayload, command, capturedBlockFoldState, deps } = params;
    if (sourceView === targetView) return;

    const targetDoc = targetView.state.doc as unknown as DocLikeWithRange;
    const planned = planCapturedMoveCommandTransaction({
        doc: targetDoc,
        capturedSource: { block: sourceBlock, payload: moveSourcePayload },
        command,
        deps,
        mode: 'insert-only',
    });
    if (isReject(planned)) return;

    applyBlockTransaction(targetView, { ...planned, changes: planned.changes.filter((change) => change.insert.length > 0) }, {
        anchor: sourceBlock.from,
    });
    applyMovePostEffects({ ...deps, view: targetView }, planned.effects);
    applyBlockTransaction(sourceView, {
        changes: moveSourcePayload.segments
            .map((segment) => ({ from: segment.deleteFrom, to: segment.deleteTo, insert: '' }))
            .sort((a, b) => b.from - a.from),
    }, { anchor: sourceBlock.from });
    deps.blockFoldState?.restore(targetView, command.target.targetLineNumber, capturedBlockFoldState ?? null);
}

function applyMovePostEffects(deps: MoveCommandApplierDeps, effects: BlockEffect[] | undefined): void {
    if (!effects) return;
    const renumberLineNumbers = Array.from(new Set(
        effects
            .filter((effect) => effect.type === 'renumber-ordered-list')
            .map((effect) => effect.lineNumber)
    ));
    for (const lineNumber of renumberLineNumbers) {
        const changes = planOrderedListRenumberChanges(
            deps.view.state.doc,
            deps.parseLineWithQuote,
            lineNumber
        );
        if (changes.length > 0) {
            applyBlockTransaction(deps.view, { changes });
        }
    }
}

function captureBlockFoldState(
    deps: MoveCommandApplierDeps,
    sourceView: EditorView,
    sourceBlock: BlockInfo
): CapturedBlockFoldState | null {
    return deps.blockFoldState?.capture(sourceView, sourceBlock) ?? null;
}

function captureDisplacedTargetFoldState(deps: MoveCommandApplierDeps, params: {
    sourceBlock: BlockInfo;
    targetLineNumber: number;
    insertedLineCount: number;
}): { targetStartLineNumber: number; foldState: CapturedBlockFoldState } | null {
    if (!deps.blockFoldState) return null;
    const { sourceBlock, targetLineNumber, insertedLineCount } = params;
    const targetBlock = resolveDisplacedTargetBlock(deps.view, targetLineNumber);
    if (!targetBlock) return null;
    if (sourceBlock.startLine <= targetBlock.startLine) return null;

    const foldState = deps.blockFoldState.capture(deps.view, targetBlock);
    if (!foldState) return null;
    return {
        targetStartLineNumber: targetBlock.startLine + 1 + insertedLineCount,
        foldState,
    };
}

function resolveDisplacedTargetBlock(view: EditorView, targetLineNumber: number): BlockInfo | null {
    const state = view.state;
    const doc = state.doc;
    if (targetLineNumber < 1 || targetLineNumber > doc.lines) return null;

    const targetBlock = detectBlock(state, targetLineNumber, { tabSize: view.state.facet(EditorState.tabSize) });
    if (targetBlock) {
        return targetLineNumber === targetBlock.startLine + 1
            ? targetBlock
            : null;
    }

    const lineMap = getLineMap(state, { tabSize: view.state.facet(EditorState.tabSize) });
    const nextNonEmptyLineNumber = getNextNonEmptyLineNumber(doc, targetLineNumber, lineMap);
    if (nextNonEmptyLineNumber === null) return null;
    const nextBlock = detectBlock(state, nextNonEmptyLineNumber, { tabSize: view.state.facet(EditorState.tabSize) });
    if (!nextBlock || nextNonEmptyLineNumber !== nextBlock.startLine + 1) return null;
    return nextBlock;
}

export type { MoveBlocksPlannerDeps };
