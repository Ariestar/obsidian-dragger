import type { EditorView } from '@codemirror/view';
import type { RuntimeOptions } from 'md-dragger/runtime';

export function codeMirrorDocument(view: EditorView): RuntimeOptions['document'] {
    return {
        getDoc: () => view.state.doc,
    };
}
