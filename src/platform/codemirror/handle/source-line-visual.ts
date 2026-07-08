import {
    DRAG_SOURCE_LINE_CLASS,
    DRAG_SOURCE_LINE_FIRST_CLASS,
    DRAG_SOURCE_LINE_LAST_CLASS,
    DRAG_SOURCE_LINE_MIDDLE_CLASS,
    DRAG_SOURCE_LINE_SINGLE_CLASS,
} from '../../../shared/dom-selectors';

export function addSourceLineClasses(
    lineEl: HTMLElement,
    lineNumber: number,
    startLineNumber: number,
    endLineNumber: number
): void {
    removeSourceLineClasses(lineEl);
    lineEl.classList.add(
        DRAG_SOURCE_LINE_CLASS,
        getSourceLineVariantClass(lineNumber, startLineNumber, endLineNumber)
    );
}

export function removeSourceLineClasses(lineEl: HTMLElement): void {
    lineEl.classList.remove(
        DRAG_SOURCE_LINE_CLASS,
        DRAG_SOURCE_LINE_SINGLE_CLASS,
        DRAG_SOURCE_LINE_FIRST_CLASS,
        DRAG_SOURCE_LINE_MIDDLE_CLASS,
        DRAG_SOURCE_LINE_LAST_CLASS
    );
}

function getSourceLineVariantClass(lineNumber: number, startLineNumber: number, endLineNumber: number): string {
    if (startLineNumber === endLineNumber) return DRAG_SOURCE_LINE_SINGLE_CLASS;
    if (lineNumber === startLineNumber) return DRAG_SOURCE_LINE_FIRST_CLASS;
    if (lineNumber === endLineNumber) return DRAG_SOURCE_LINE_LAST_CLASS;
    return DRAG_SOURCE_LINE_MIDDLE_CLASS;
}
