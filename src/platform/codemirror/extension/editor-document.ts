import type { EditorView } from '@codemirror/view';
import type { DraggerRuntimeOptions } from '../../../drag/runtime';

export function codeMirrorDocument(view: EditorView): DraggerRuntimeOptions['document'] {
    return {
        getDoc: () => view.state.doc,
        applyChanges: (changes) => view.dispatch({ changes }),
    };
}
