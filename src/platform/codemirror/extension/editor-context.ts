import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { BlockSelectionResolver } from '../selection/block-selection-resolver';
import {
    getInsertionAnchorY,
    getLineRect,
} from '../selection/geometry';

export function createEditorContext(view: EditorView) {
    const tabSize = view.state.facet(EditorState.tabSize);
    const selection = new BlockSelectionResolver(view);

    return {
        view,
        tabSize,
        selection,
        getLineRect: (lineNumber: number) => getLineRect(view, lineNumber),
        getInsertionAnchorY: (lineNumber: number) => getInsertionAnchorY(view, lineNumber),
    };
}

export type EditorContext = ReturnType<typeof createEditorContext>;
