import { EditorView } from '@codemirror/view';

export function clampNumber(value: number, min: number, max: number): number {
    if (value < min) return min;
    if (value > max) return max;
    return value;
}

export function getLineRect(view: EditorView, lineNumber: number): { left: number; width: number } | undefined {
    const doc = view.state.doc;
    if (lineNumber < 1 || lineNumber > doc.lines) return undefined;
    const line = doc.line(lineNumber);
    const start = view.coordsAtPos(line.from);
    const end = view.coordsAtPos(line.to);
    if (!start || !end) return undefined;
    const left = Math.min(start.left, end.left);
    const right = Math.max(start.left, end.left);
    return { left, width: Math.max(8, right - left) };
}

export function getInsertionAnchorY(view: EditorView, lineNumber: number): number | null {
    const doc = view.state.doc;
    if (lineNumber <= 1) {
        const first = doc.line(1);
        const coords = view.coordsAtPos(first.from);
        return coords ? coords.top : null;
    }
    const anchorLineNumber = Math.min(lineNumber - 1, doc.lines);
    const anchorLine = doc.line(anchorLineNumber);
    const coords = view.coordsAtPos(anchorLine.to);
    return coords ? coords.bottom : null;
}

export function getLineIndentPosByWidth(
    view: EditorView,
    lineNumber: number,
    targetIndentWidth: number,
    tabSize: number
): number | null {
    const doc = view.state.doc;
    if (lineNumber < 1 || lineNumber > doc.lines) return null;
    const line = doc.line(lineNumber);
    const text = line.text;
    let width = 0;
    let idx = 0;
    while (idx < text.length && width < targetIndentWidth) {
        const ch = text[idx];
        if (ch === '\t') {
            width += tabSize;
        } else if (ch === ' ') {
            width += 1;
        } else {
            break;
        }
        idx += 1;
    }
    return line.from + idx;
}

export function getBlockRect(
    view: EditorView,
    startLineNumber: number,
    endLineNumber: number
): { top: number; left: number; width: number; height: number } | undefined {
    const doc = view.state.doc;
    if (startLineNumber < 1 || endLineNumber > doc.lines) return undefined;
    let minLeft = Number.POSITIVE_INFINITY;
    let maxRight = 0;
    let top = 0;
    let bottom = 0;

    for (let i = startLineNumber; i <= endLineNumber; i++) {
        const line = doc.line(i);
        const start = view.coordsAtPos(line.from);
        const end = view.coordsAtPos(line.to);
        if (!start || !end) continue;
        if (i === startLineNumber) top = start.top;
        if (i === endLineNumber) bottom = end.bottom;
        const left = Math.min(start.left, end.left);
        const right = Math.max(start.left, end.left);
        minLeft = Math.min(minLeft, left);
        maxRight = Math.max(maxRight, right);
    }

    if (!isFinite(minLeft) || maxRight === 0 || bottom <= top) return undefined;
    return { top, left: minLeft, width: Math.max(8, maxRight - minLeft), height: bottom - top };
}
