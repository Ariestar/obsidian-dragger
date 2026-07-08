import { EditorView } from '@codemirror/view';
import {
    MAIN_EDITOR_CONTENT_CLASS,
    ROOT_EDITOR_CLASS,
} from '../../../shared/dom-selectors';
import { DND_DRAG_SOURCE_HIGHLIGHT_ATTR, DND_DRAG_SOURCE_STYLE_ATTR } from '../../../shared/dom-attrs';

export function ensureEditorRootClasses(view: EditorView): void {
    view.dom.classList.add(ROOT_EDITOR_CLASS);
    view.contentDOM.classList.add(MAIN_EDITOR_CONTENT_CLASS);
}

export function clearEditorRootClasses(view: EditorView): void {
    view.dom.classList.remove(ROOT_EDITOR_CLASS);
    view.contentDOM.classList.remove(MAIN_EDITOR_CONTENT_CLASS);
}

export function syncBlockSelectionStyleAttr(view: EditorView, style: string): void {
    view.dom.setAttribute(DND_DRAG_SOURCE_STYLE_ATTR, style);
}

export function syncBlockSelectionHighlightAttr(view: EditorView, enabled: boolean): void {
    view.dom.setAttribute(DND_DRAG_SOURCE_HIGHLIGHT_ATTR, enabled ? 'on' : 'off');
}
