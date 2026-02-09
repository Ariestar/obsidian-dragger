import { EditorView } from '@codemirror/view';
import { HANDLE_SIZE_PX } from './constants';

const GUTTER_FALLBACK_WIDTH_PX = 32;
let handleHorizontalOffsetPx = 0;

function safeCoordsAtPos(view: EditorView, pos: number): ReturnType<EditorView['coordsAtPos']> | null {
    try {
        return view.coordsAtPos(pos);
    } catch {
        return null;
    }
}

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

function getOwnLineNumberGutters(view: EditorView): HTMLElement[] {
    const all = Array.from(view.dom.querySelectorAll('.cm-gutter.cm-lineNumbers, .cm-lineNumbers')) as HTMLElement[];
    return all.filter((gutter) => (
        isElementVisible(gutter)
        && gutter.closest('.cm-editor') === view.dom
    ));
}

function getGutterElementInnerCenterX(gutterElement: HTMLElement): number | null {
    const rect = gutterElement.getBoundingClientRect();
    if (!isLineNumberRowRect(rect)) return null;

    const style = getComputedStyle(gutterElement);
    const borderLeft = Number.parseFloat(style.borderLeftWidth || '0') || 0;
    const borderRight = Number.parseFloat(style.borderRightWidth || '0') || 0;
    const paddingLeft = Number.parseFloat(style.paddingLeft || '0') || 0;
    const paddingRight = Number.parseFloat(style.paddingRight || '0') || 0;
    const innerLeft = rect.left + borderLeft + paddingLeft;
    const innerRight = rect.right - borderRight - paddingRight;
    if (innerRight <= innerLeft) {
        return rect.left + rect.width / 2;
    }
    return (innerLeft + innerRight) / 2;
}

function getLineNumberGutterRect(view: EditorView): DOMRect | null {
    const lineNumberGutter = getLineNumberGutter(view);
    if (!lineNumberGutter) return null;
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
    const candidates = getOwnLineNumberGutters(view);
    if (candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];

    const editorRect = view.dom.getBoundingClientRect();
    let bestGutter: HTMLElement | null = null;
    let bestOverlapArea = -1;
    for (const gutter of candidates) {
        const rect = gutter.getBoundingClientRect();
        if (!isUsableRect(rect)) continue;
        const overlapWidth = Math.max(0, Math.min(rect.right, editorRect.right) - Math.max(rect.left, editorRect.left));
        const overlapHeight = Math.max(0, Math.min(rect.bottom, editorRect.bottom) - Math.max(rect.top, editorRect.top));
        const overlapArea = overlapWidth * overlapHeight;
        if (overlapArea > bestOverlapArea) {
            bestOverlapArea = overlapArea;
            bestGutter = gutter;
        }
    }
    return bestGutter ?? candidates[0];
}

function getLineNumberElementCenterX(view: EditorView): number | null {
    const gutter = getLineNumberGutter(view);
    if (!gutter) return null;
    const candidates = Array.from(gutter.querySelectorAll('.cm-gutterElement')) as HTMLElement[];
    for (const candidate of candidates) {
        const centerX = getGutterElementInnerCenterX(candidate);
        if (centerX === null) continue;
        return centerX;
    }
    return null;
}

function getClosestLineNumberElementByY(view: EditorView, lineNumber: number): HTMLElement | null {
    if (lineNumber < 1 || lineNumber > view.state.doc.lines) return null;
    const gutter = getLineNumberGutter(view);
    if (!gutter) return null;

    const line = view.state.doc.line(lineNumber);
    const lineCoords = safeCoordsAtPos(view, line.from);
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

export function hasVisibleLineNumberGutter(view: EditorView): boolean {
    return getLineNumberGutterRect(view) !== null;
}

function getHandleCenterForLine(view: EditorView, lineNumber: number): { x: number; y: number } | null {
    const horizontalOffset = handleHorizontalOffsetPx;
    const lineNumberEl = getLineNumberElementForLine(view, lineNumber);
    if (lineNumberEl) {
        const rect = lineNumberEl.getBoundingClientRect();
        if (isLineNumberRowRect(rect)) {
            const textRect = getLineNumberTextRect(lineNumberEl);
            const centerY = textRect
                ? (textRect.top + textRect.height / 2)
                : (rect.top + rect.height / 2);
            const centerX = (getGutterElementInnerCenterX(lineNumberEl) ?? (rect.left + rect.width / 2)) + horizontalOffset;
            return {
                x: centerX,
                y: centerY,
            };
        }
    }

    if (lineNumber >= 1 && lineNumber <= view.state.doc.lines) {
        const line = view.state.doc.line(lineNumber);
        const lineCoords = safeCoordsAtPos(view, line.from);
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
    const horizontalOffset = handleHorizontalOffsetPx;
    const lineNumberElementCenterX = getLineNumberElementCenterX(view);
    if (lineNumberElementCenterX !== null) return lineNumberElementCenterX + horizontalOffset;

    const lineNumberRect = getLineNumberGutterRect(view);
    if (lineNumberRect) return lineNumberRect.left + lineNumberRect.width / 2 + horizontalOffset;

    const gutterRect = getAnyGutterRect(view);
    if (gutterRect) return gutterRect.left + gutterRect.width / 2 + horizontalOffset;

    const contentRect = view.contentDOM.getBoundingClientRect();
    return contentRect.left - GUTTER_FALLBACK_WIDTH_PX / 2 + horizontalOffset;
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

    const offsetParentEl = (handle.offsetParent instanceof HTMLElement ? handle.offsetParent : view.dom);
    const parentRect = offsetParentEl.getBoundingClientRect();
    handle.style.left = `${getInlineHandleLeftPx(view, parentRect.left, lineNumber)}px`;
    const topPx = typeof lineNumber === 'number' ? getHandleTopPxForLine(view, lineNumber) : null;
    if (topPx !== null) {
        handle.style.top = `${Math.round(topPx - parentRect.top)}px`;
    }
}

export function getHandleTopPxForLine(view: EditorView, lineNumber: number): number | null {
    const center = getHandleCenterForLine(view, lineNumber);
    if (!center) return null;
    return Math.round(center.y - HANDLE_SIZE_PX / 2);
}

function getEditorAxisScale(rectSize: number, offsetSize: number): number {
    if (rectSize <= 0 || offsetSize <= 0) return 1;
    return rectSize / offsetSize;
}

export function viewportXToEditorLocalX(view: EditorView, viewportX: number): number {
    const rect = view.dom.getBoundingClientRect();
    const scaleX = getEditorAxisScale(rect.width, view.dom.offsetWidth);
    return (viewportX - rect.left) / scaleX - view.dom.clientLeft;
}

export function viewportYToEditorLocalY(view: EditorView, viewportY: number): number {
    const rect = view.dom.getBoundingClientRect();
    const scaleY = getEditorAxisScale(rect.height, view.dom.offsetHeight);
    return (viewportY - rect.top) / scaleY - view.dom.clientTop;
}

export function setHandleHorizontalOffsetPx(offsetPx: number): void {
    if (!Number.isFinite(offsetPx)) {
        handleHorizontalOffsetPx = 0;
        return;
    }
    handleHorizontalOffsetPx = offsetPx;
}
