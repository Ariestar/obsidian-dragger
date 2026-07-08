import { EditorView } from '@codemirror/view';



function getMainContentLineElementByDomAtPos(view: EditorView, lineNumber: number): HTMLElement | null {
    if (typeof view.domAtPos !== 'function') return null;
    try {
        const line = view.state.doc.line(lineNumber);
        const domAtPos = view.domAtPos(line.from);
        const base = domAtPos.node.nodeType === Node.TEXT_NODE
            ? domAtPos.node.parentElement
            : domAtPos.node;
        if (!(base instanceof Element)) return null;
        const lineEl = base.closest<HTMLElement>('.cm-line');
        if (!lineEl) return null;
        if (!view.contentDOM.contains(lineEl)) return null;
        return lineEl;
    } catch {
        return null;
    }
}

export function getMainContentLineElementForLine(view: EditorView, lineNumber: number): HTMLElement | null {
    if (lineNumber < 1 || lineNumber > view.state.doc.lines) return null;
    return getMainContentLineElementByDomAtPos(view, lineNumber);
}


