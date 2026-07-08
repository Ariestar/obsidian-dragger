import { Extension } from '@codemirror/state';
import {
    BlockInfo,
    EditorView,
    gutter,
} from '@codemirror/view';
import {
    HANDLE_GUTTER_CLASS,
} from '../../../shared/dom-selectors';
import { HandleGutterLineMarker, resolveHandleBlockAtLine } from './handle-renderer';

function resolveLineNumber(view: EditorView, line: BlockInfo): number {
    return view.state.doc.lineAt(line.from).number;
}

export function createHandleGutterExtension(): Extension {
    return gutter({
        class: HANDLE_GUTTER_CLASS,
        side: 'before',
        renderEmptyElements: false,
        lineMarker: (view, line) => {
            const block = resolveHandleBlockAtLine(view.state, resolveLineNumber(view, line));
            return block ? new HandleGutterLineMarker(block) : null;
        },
        lineMarkerChange: (update) => update.docChanged || update.viewportChanged || update.geometryChanged,
    });
}
