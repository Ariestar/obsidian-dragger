import type { BlockInfo } from '../../../domain/block/block-types';
import {
    DRAG_SOURCE_LINE_CLASS,
    RANGE_SELECTED_HANDLE_CLASS,
} from '../../../shared/dom-selectors';
import {
    groupSelectedBlocksIntoSegments,
    type BlockSelectionSegment,
    type SelectedBlockRange,
} from '../../../domain/selection/block-ranges';
import { platform } from '../../../plugin/platform';

export const RANGE_SELECTION_GRIP_HIT_PADDING_PX = 20;
type AnchorSpan = {
    x: number;
    topY: number;
    bottomY: number;
};

type ResolveAnchorSpan = (segment: BlockSelectionSegment) => AnchorSpan | null;

export type RangeSelectionView = {
    blocks: SelectedBlockRange[];
    templateBlock: BlockInfo;
};

function getRangeSelectionDocLineCount(selection: RangeSelectionView): number {
    return Math.max(
        selection.templateBlock.endLine + 1,
        ...selection.blocks.map((block) => block.endLineNumber)
    );
}

type IsRangeSelectionGripHitOptions = {
    selection: RangeSelectionView | null;
    target: HTMLElement;
    clientX: number;
    clientY: number;
    pointerType: string | null;
    resolveAnchorSpan: ResolveAnchorSpan;
    isWithinMobileDragHotzoneBand: (clientX: number) => boolean;
};

export function isRangeSelectionGripHit(options: IsRangeSelectionGripHitOptions): boolean {
    const selection = options.selection;
    if (!selection) return false;

    const hitHandle = options.target.closest(`.${RANGE_SELECTED_HANDLE_CLASS}`);
    if (hitHandle) return true;

    if (platform.isMobile) {
        if (options.target.closest(`.${DRAG_SOURCE_LINE_CLASS}`)) return true;
        if (!options.isWithinMobileDragHotzoneBand(options.clientX)) {
            return false;
        }
    }

    const segments = groupSelectedBlocksIntoSegments(
        getRangeSelectionDocLineCount(selection),
        selection.blocks
    );
    for (const segment of segments) {
        const anchorSpan = options.resolveAnchorSpan(segment);
        if (!anchorSpan) continue;
        const top = anchorSpan.topY - RANGE_SELECTION_GRIP_HIT_PADDING_PX;
        const bottom = anchorSpan.bottomY + RANGE_SELECTION_GRIP_HIT_PADDING_PX;
        if (options.clientY >= top && options.clientY <= bottom) {
            return true;
        }
    }
    return false;
}
