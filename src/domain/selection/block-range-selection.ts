import type { DocLikeWithRange } from '../markdown/document-types';
import type { RangeSelectionOperation } from './block-selection';
import {
    isSelectedBlockCoveredByBlocks,
    mergeSelectedBlocks,
    subtractSelectedBlocks,
    type SelectedBlockRange,
} from './block-ranges';
import {
    collectSelectedBlocksBetween,
    type RangeSelectionBoundary,
    type RangeSelectionBoundaryResolver,
} from './range-selection';

export type BlockRangeSelectionState = {
    anchorStartLineNumber: number;
    anchorEndLineNumber: number;
    operation: RangeSelectionOperation;
    baseBlocks: SelectedBlockRange[];
    activeBlocks: SelectedBlockRange[];
    selectionBlocks: SelectedBlockRange[];
};

export function createBlockRangeSelectionState(options: {
    doc: DocLikeWithRange;
    anchorBoundary: RangeSelectionBoundary;
    initialBoundary?: RangeSelectionBoundary;
    selectedBlocks: SelectedBlockRange[];
    operation?: RangeSelectionOperation;
    resolveBoundary?: RangeSelectionBoundaryResolver;
}): BlockRangeSelectionState | null {
    const anchorStartLineNumber = options.anchorBoundary.startLineNumber;
    const anchorEndLineNumber = options.anchorBoundary.endLineNumber;
    if (
        anchorStartLineNumber < 1
        || anchorEndLineNumber > options.doc.lines
        || anchorStartLineNumber > anchorEndLineNumber
    ) {
        return null;
    }

    const initialBoundary = options.initialBoundary ?? options.anchorBoundary;
    const activeBlocks = options.resolveBoundary
        ? collectSelectedBlocksBetween(
            options.doc.lines,
            anchorStartLineNumber,
            anchorEndLineNumber,
            initialBoundary.startLineNumber,
            initialBoundary.endLineNumber,
            options.resolveBoundary
        )
        : [{
            startLineNumber: anchorStartLineNumber,
            endLineNumber: anchorEndLineNumber,
        }];
    const activeBlock = activeBlocks[0] ?? {
        startLineNumber: anchorStartLineNumber,
        endLineNumber: anchorEndLineNumber,
    };
    const operation = options.operation ?? (isSelectedBlockCoveredByBlocks(
        options.doc.lines,
        activeBlock,
        options.selectedBlocks
    ) ? 'remove' : 'add');
    const baseBlocks = operation === 'add'
        ? subtractSelectedBlocks(options.doc.lines, options.selectedBlocks, activeBlocks)
        : options.selectedBlocks;
    return applyBlockRangeSelection({
        docLines: options.doc.lines,
        operation,
        baseBlocks,
        activeBlocks,
    }, {
        anchorStartLineNumber,
        anchorEndLineNumber,
    });
}

export function updateBlockRangeSelectionState(
    state: Pick<BlockRangeSelectionState, 'anchorStartLineNumber' | 'anchorEndLineNumber' | 'operation' | 'baseBlocks'>,
    options: {
        docLines: number;
        target: RangeSelectionBoundary;
        resolveBoundary: RangeSelectionBoundaryResolver;
    }
): BlockRangeSelectionState {
    const activeBlocks = collectSelectedBlocksBetween(
        options.docLines,
        state.anchorStartLineNumber,
        state.anchorEndLineNumber,
        options.target.startLineNumber,
        options.target.endLineNumber,
        options.resolveBoundary
    );
    return applyBlockRangeSelection({
        docLines: options.docLines,
        operation: state.operation,
        baseBlocks: state.baseBlocks,
        activeBlocks,
    }, {
        anchorStartLineNumber: state.anchorStartLineNumber,
        anchorEndLineNumber: state.anchorEndLineNumber,
    });
}

function applyBlockRangeSelection(
    options: {
        docLines: number;
        operation: RangeSelectionOperation;
        baseBlocks: SelectedBlockRange[];
        activeBlocks: SelectedBlockRange[];
    },
    anchor: Pick<BlockRangeSelectionState, 'anchorStartLineNumber' | 'anchorEndLineNumber'>
): BlockRangeSelectionState {
    const selectionBlocks = options.operation === 'remove'
        ? subtractSelectedBlocks(options.docLines, options.baseBlocks, options.activeBlocks)
        : mergeSelectedBlocks(options.docLines, [
            ...options.baseBlocks,
            ...options.activeBlocks,
        ]);
    return {
        ...anchor,
        operation: options.operation,
        baseBlocks: mergeSelectedBlocks(options.docLines, options.baseBlocks),
        activeBlocks: mergeSelectedBlocks(options.docLines, options.activeBlocks),
        selectionBlocks,
    };
}
