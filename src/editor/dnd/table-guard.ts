import { EditorView } from '@codemirror/view';

export function isElementInsideRenderedTableCell(view: EditorView, el: HTMLElement | null): boolean {
    if (!el) return false;
    if (!view.dom.contains(el)) return false;

    const tableWidget = el.closest('.cm-table-widget');
    if (!tableWidget || !view.dom.contains(tableWidget)) return false;

    if (el.closest('td, th, .cm-table-cell, .table-cell-wrapper')) return true;
    if (el.closest('.cm-line')) return true;
    return true;
}

export function isPointInsideRenderedTableCell(view: EditorView, x: number, y: number): boolean {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return isElementInsideRenderedTableCell(view, el);
}

export function isPosInsideRenderedTableCell(
    view: EditorView,
    pos: number,
    options?: { skipLayoutRead?: boolean }
): boolean {
    const doc = view.state.doc;
    const safePos = Math.max(0, Math.min(pos, doc.length));

    try {
        const domAt = view.domAtPos(safePos);
        const node = domAt.node instanceof HTMLElement
            ? domAt.node
            : domAt.node.parentElement;
        if (isElementInsideRenderedTableCell(view, node)) return true;
    } catch {
        // ignore dom mapping failures
    }

    if (options?.skipLayoutRead) return false;

    let coords: ReturnType<EditorView['coordsAtPos']> | null = null;
    try {
        coords = view.coordsAtPos(safePos);
    } catch {
        return false;
    }
    if (!coords) return false;
    const editorRect = view.dom.getBoundingClientRect();
    const probeX = Math.min(Math.max(coords.left + 6, editorRect.left + 2), editorRect.right - 2);
    const probeY = Math.min(Math.max((coords.top + coords.bottom) / 2, editorRect.top + 2), editorRect.bottom - 2);
    return isPointInsideRenderedTableCell(view, probeX, probeY);
}
