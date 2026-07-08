import { EditorView } from '@codemirror/view';
import { clampLineNumber } from 'md-dragger/domain';
import { getCoordsAtPos } from '../selection/rect-calculator';

type ContentRect = Pick<DOMRect | DOMRectReadOnly, 'left' | 'right' | 'top' | 'bottom'>;

function clamp(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

export function safeCoordsAtPos(
    view: EditorView,
    pos: number,
    side?: -1 | 1
): ReturnType<EditorView['coordsAtPos']> | null {
    return getCoordsAtPos(view, pos, side);
}

export function safePosAtCoords(
    view: EditorView,
    coords: { x: number; y: number }
): number | null {
    try {
        return view.posAtCoords(coords);
    } catch {
        return null;
    }
}

export function resolveLineNumberFromPos(view: EditorView, pos: number): number | null {
    try {
        return clampLineNumber(view.state.doc.lines, view.state.doc.lineAt(pos).number);
    } catch {
        return null;
    }
}

export function resolveLineNumberFromDomNodes(
    view: EditorView,
    probes: Array<Node | null | undefined>,
): number | null {
    const seen = new Set<Node>();
    for (const probe of probes) {
        if (!probe) continue;
        if (seen.has(probe)) continue;
        seen.add(probe);
        try {
            const pos = view.posAtDOM(probe, 0);
            const lineNumber = resolveLineNumberFromPos(view, pos);
            if (lineNumber !== null) return lineNumber;
        } catch {
            // Try next probe node.
        }
    }
    return null;
}

export function resolveLineNumberFromBlockStartAttribute(
    view: EditorView,
    handle: HTMLElement
): number | null {
    const startAttr = handle.getAttribute('data-block-start');
    if (startAttr === null) return null;
    const lineNumber = Number(startAttr) + 1;
    if (!Number.isInteger(lineNumber)) return null;
    if (lineNumber < 1 || lineNumber > view.state.doc.lines) return null;
    return lineNumber;
}

export function resolveLineNumberAtCoords(
    view: EditorView,
    clientX: number,
    clientY: number,
    contentRect: ContentRect,
): number | null {
    const clampedX = clamp(clientX, contentRect.left + 2, contentRect.right - 2);
    const pos = safePosAtCoords(view, { x: clampedX, y: clientY });
    if (pos === null) return null;
    return resolveLineNumberFromPos(view, pos);
}

