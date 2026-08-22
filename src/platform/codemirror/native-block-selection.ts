import type { EditorState } from '@codemirror/state';
import { type Block, type BlockSelection, hasBlock, selectBlocksInLineRanges } from 'md-dragger/domain';

/** Translate non-empty native editor ranges to semantic drag blocks. */
export function nativeBlockSelection(state: EditorState, anchorBlock: Block, tabSize: number): BlockSelection | null {
    const ranges = state.selection.ranges
        .filter((range) => !range.empty)
        .map((range) => ({
            startLine: state.doc.lineAt(range.from).number,
            endLine: state.doc.lineAt(Math.max(range.from, range.to - 1)).number,
        }));
    if (ranges.length === 0) return null;

    const selection = selectBlocksInLineRanges(state.doc, ranges, { tabSize });
    if (selection.blocks.length < 2 || !hasBlock(selection, anchorBlock)) return null;
    return selection;
}
