import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { detectBlock } from '../../../domain/block/block-detector';
import type {
    RangeSelectionBoundary,
    RangeSelectionBoundaryResolver,
} from '../../../domain/selection/range-selection';

export function createRangeSelectionBoundaryResolver(state: EditorState): RangeSelectionBoundaryResolver {
    const doc = state.doc;
    const tabSize = state.facet(EditorState.tabSize);
    return (lineNumber) => {
        const clampedLine = Math.max(1, Math.min(doc.lines, lineNumber));
        const block = detectBlock(state, clampedLine, { tabSize });
        if (!block) {
            return {
                startLineNumber: clampedLine,
                endLineNumber: clampedLine,
            };
        }
        return {
            startLineNumber: Math.max(1, block.startLine + 1),
            endLineNumber: Math.min(doc.lines, block.endLine + 1),
        };
    };
}

export function resolveRangeSelectionBoundaryAtVerticalPosition(
    view: EditorView,
    clientY: number
): RangeSelectionBoundary | null {
    const contentRect = view.contentDOM.getBoundingClientRect();
    if (clientY < contentRect.top || clientY > contentRect.bottom) return null;

    try {
        const lineBlock = view.lineBlockAtHeight(clientY - view.documentTop);
        const lineNumber = view.state.doc.lineAt(lineBlock.from).number;
        const boundary = createRangeSelectionBoundaryResolver(view.state)(lineNumber);
        return {
            ...boundary,
            representativeLineNumber: lineNumber,
        };
    } catch {
        return null;
    }
}
