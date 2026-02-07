import { EditorView } from '@codemirror/view';

const HANDLE_SIZE_PX = 16;
const GUTTER_FALLBACK_WIDTH_PX = 32;

function isUsableRect(rect: DOMRect | null | undefined): rect is DOMRect {
    if (!rect) return false;
    return rect.width > 0 && rect.height > 0;
}

function isLineNumberRowRect(rect: DOMRect | null | undefined): rect is DOMRect {
    if (!rect) return false;
    return rect.height > 0;
}

function isElementVisible(el: Element): boolean {
    if (!(el instanceof HTMLElement)) return false;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return true;
}

function getLineNumberGutterRect(view: EditorView): DOMRect | null {
    const lineNumberGutter = view.dom.querySelector('.cm-gutter.cm-lineNumbers, .cm-lineNumbers');
    if (!lineNumberGutter || !isElementVisible(lineNumberGutter)) return null;
    const rect = lineNumberGutter.getBoundingClientRect();
    return isUsableRect(rect) ? rect : null;
}

function getAnyGutterRect(view: EditorView): DOMRect | null {
    const gutters = view.dom.querySelector('.cm-gutters');
    if (!gutters || !isElementVisible(gutters)) return null;
    const rect = gutters.getBoundingClientRect();
    return isUsableRect(rect) ? rect : null;
}

function getLineNumberGutter(view: EditorView): HTMLElement | null {
    const gutter = view.dom.querySelector('.cm-gutter.cm-lineNumbers, .cm-lineNumbers');
    if (!(gutter instanceof HTMLElement)) return null;
    if (!isElementVisible(gutter)) return null;
    return gutter;
}

function getClosestLineNumberElementByY(view: EditorView, lineNumber: number): HTMLElement | null {
    if (lineNumber < 1 || lineNumber > view.state.doc.lines) return null;
    const gutter = getLineNumberGutter(view);
    if (!gutter) return null;

    const line = view.state.doc.line(lineNumber);
    const lineCoords = view.coordsAtPos(line.from);
    if (!lineCoords) return null;
    const y = (lineCoords.top + lineCoords.bottom) / 2;

    const candidates = Array.from(gutter.querySelectorAll('.cm-gutterElement')) as HTMLElement[];
    let bestEl: HTMLElement | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const candidate of candidates) {
        const rect = candidate.getBoundingClientRect();
        if (!isLineNumberRowRect(rect)) continue;
        if (y >= rect.top && y <= rect.bottom) return candidate;
        const centerY = (rect.top + rect.bottom) / 2;
        const distance = Math.abs(centerY - y);
        if (distance < bestDistance) {
            bestDistance = distance;
            bestEl = candidate;
        }
    }
    return bestEl;
}

function getLineNumberElementByText(view: EditorView, lineNumber: number): HTMLElement | null {
    const gutter = getLineNumberGutter(view);
    if (!gutter) return null;
    const target = String(lineNumber);
    const candidates = Array.from(gutter.querySelectorAll('.cm-gutterElement')) as HTMLElement[];
    return candidates.find((el) => el.textContent?.trim() === target) ?? null;
}

export function getLineNumberElementForLine(view: EditorView, lineNumber: number): HTMLElement | null {
    return getClosestLineNumberElementByY(view, lineNumber) ?? getLineNumberElementByText(view, lineNumber);
}

function getLineNumberTextRect(lineNumberEl: HTMLElement): DOMRect | null {
    if (!lineNumberEl.textContent?.trim()) return null;
    try {
        const range = document.createRange();
        range.selectNodeContents(lineNumberEl);
        const rect = range.getBoundingClientRect();
        if (isUsableRect(rect)) return rect;
    } catch {
        // ignore range measurement failures
    }
    return null;
}

function getHandleCenterForLine(view: EditorView, lineNumber: number): { x: number; y: number } | null {
    const lineNumberEl = getLineNumberElementForLine(view, lineNumber);
    if (lineNumberEl) {
        const textRect = getLineNumberTextRect(lineNumberEl);
        if (textRect) {
            return {
                x: textRect.left + textRect.width / 2,
                y: textRect.top + textRect.height / 2,
            };
        }

        const rect = lineNumberEl.getBoundingClientRect();
        if (isLineNumberRowRect(rect)) {
            return {
                x: getHandleColumnCenterX(view),
                y: rect.top + rect.height / 2,
            };
        }
    }

    if (lineNumber >= 1 && lineNumber <= view.state.doc.lines) {
        const line = view.state.doc.line(lineNumber);
        const lineCoords = view.coordsAtPos(line.from);
        if (lineCoords) {
            return {
                x: getHandleColumnCenterX(view),
                y: lineCoords.top + Math.max(0, (lineCoords.bottom - lineCoords.top) / 2),
            };
        }
    }

    return null;
}

export function getHandleColumnCenterX(view: EditorView): number {
    const lineNumberRect = getLineNumberGutterRect(view);
    if (lineNumberRect) return lineNumberRect.left + lineNumberRect.width / 2;

    const gutterRect = getAnyGutterRect(view);
    if (gutterRect) return gutterRect.left + gutterRect.width / 2;

    const contentRect = view.contentDOM.getBoundingClientRect();
    return contentRect.left - GUTTER_FALLBACK_WIDTH_PX / 2;
}

export function getHandleColumnLeftPx(view: EditorView): number {
    return Math.round(getHandleColumnCenterX(view) - HANDLE_SIZE_PX / 2);
}

export function getHandleLeftPxForLine(view: EditorView, lineNumber: number): number | null {
    const center = getHandleCenterForLine(view, lineNumber);
    if (!center) return null;
    return Math.round(center.x - HANDLE_SIZE_PX / 2);
}

export function getInlineHandleLeftPx(view: EditorView, lineLeftPx: number, lineNumber?: number): number {
    const lineSpecificLeft = typeof lineNumber === 'number'
        ? getHandleLeftPxForLine(view, lineNumber)
        : null;
    const viewportLeft = lineSpecificLeft ?? getHandleColumnLeftPx(view);
    return Math.round(viewportLeft - lineLeftPx);
}

export function alignInlineHandleToHandleColumn(view: EditorView, handle: HTMLElement, lineNumber?: number): void {
    const lineEl = handle.closest('.cm-line') as HTMLElement | null;
    if (lineEl) {
        const lineRect = lineEl.getBoundingClientRect();
        handle.style.left = `${getInlineHandleLeftPx(view, lineRect.left, lineNumber)}px`;
        const topPx = typeof lineNumber === 'number' ? getHandleTopPxForLine(view, lineNumber) : null;
        if (topPx !== null) {
            handle.style.top = `${Math.round(topPx - lineRect.top)}px`;
        }
        return;
    }

    const contentRect = view.contentDOM.getBoundingClientRect();
    const contentPaddingLeft = parseFloat(getComputedStyle(view.contentDOM).paddingLeft) || 0;
    const fallbackLineLeft = contentRect.left + contentPaddingLeft;
    handle.style.left = `${getInlineHandleLeftPx(view, fallbackLineLeft, lineNumber)}px`;
}

export function getHandleTopPxForLine(view: EditorView, lineNumber: number): number | null {
    const center = getHandleCenterForLine(view, lineNumber);
    if (!center) return null;
    return Math.round(center.y - HANDLE_SIZE_PX / 2);
}
