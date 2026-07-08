import { EditorView } from '@codemirror/view';

function getRenderedMainLineElementAtPoint(
    view: EditorView,
    clientX: number,
    clientY: number
): HTMLElement | null {
    if (typeof activeDocument.elementFromPoint !== 'function') return null;
    const rawEl = activeDocument.elementFromPoint(clientX, clientY);
    const el = rawEl?.instanceOf(HTMLElement) ? rawEl : null;
    if (!el) return null;
    const lineEl = el.closest<HTMLElement>('.cm-line');
    if (!lineEl) return null;
    if (!view.contentDOM.contains(lineEl)) return null;
    return lineEl;
}

export function getRenderedMainLineNumberAtPoint(
    view: EditorView,
    clientX: number,
    clientY: number
): number | null {
    const lineEl = getRenderedMainLineElementAtPoint(view, clientX, clientY);
    if (!lineEl) return null;
    try {
        const pos = view.posAtDOM(lineEl, 0);
        const lineNumber = view.state.doc.lineAt(pos).number;
        if (lineNumber < 1 || lineNumber > view.state.doc.lines) return null;
        return lineNumber;
    } catch {
        return null;
    }
}
