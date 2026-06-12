import { EditorView } from '@codemirror/view';
import { EMBED_BLOCK_SELECTOR } from '../../../shared/dom-selectors';
import { safeCoordsAtPos, resolveLineNumberFromDomNodes } from '../../dom/element-probe';
import { findEmbedElementAtPoint } from '../../dom/embed-probe';

const MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX = 16;
const MOBILE_LINE_HIT_Y_TOLERANCE_PX = 8;
const MOBILE_EMBED_HIT_PADDING_PX = 6;
const MOBILE_RANGE_SELECT_SCROLL_CANCEL_THRESHOLD_PX = 14;

export class MobileInputHitTest {
    constructor(private readonly view: EditorView) {}

    isWithinContentTolerance(clientX: number): boolean {
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const left = contentRect.left - MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX;
        const right = contentRect.right + MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX;
        return clientX >= left && clientX <= right;
    }

    isWithinEditorTolerance(clientX: number): boolean {
        const editorRect = this.view.dom.getBoundingClientRect();
        const left = editorRect.left - MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX;
        const right = editorRect.right + MOBILE_DRAG_HOTZONE_EXTRA_LEFT_TOLERANCE_PX;
        return clientX >= left && clientX <= right;
    }

    isWithinMobileTextLineOrEmbedArea(target: HTMLElement | null, clientX: number, clientY: number): boolean {
        const embedEl = this.resolveEmbedElement(target, clientX, clientY);
        if (embedEl) {
            return this.isWithinEmbedDragArea(embedEl, clientX, clientY);
        }

        if (!target) return false;
        const lineEl = target.closest<HTMLElement>('.cm-line');
        if (lineEl && this.view.contentDOM.contains(lineEl)) {
            const lineNumber = this.resolveLineNumberFromTarget(target, lineEl);
            if (lineNumber !== null) {
                return this.isWithinLineDragArea(lineNumber, clientX, clientY);
            }
        }

        if (!this.view.contentDOM.contains(target)) return false;
        const targetLineNumber = this.resolveLineNumberFromTarget(target, null);
        if (targetLineNumber !== null) {
            return this.isWithinLineDragArea(targetLineNumber, clientX, clientY);
        }

        return false;
    }

    isMostlyVerticalScrollGesture(dx: number, dy: number): boolean {
        return Math.abs(dy) > MOBILE_RANGE_SELECT_SCROLL_CANCEL_THRESHOLD_PX
            && Math.abs(dy) > Math.abs(dx) * 1.4;
    }

    private resolveLineNumberFromTarget(target: HTMLElement, lineEl: HTMLElement | null): number | null {
        const probes: Node[] = [target];
        if (lineEl) probes.push(lineEl);
        if (target.firstChild) probes.push(target.firstChild);
        if (lineEl?.firstChild) probes.push(lineEl.firstChild);
        return resolveLineNumberFromDomNodes(this.view, probes);
    }

    private isWithinLineDragArea(lineNumber: number, clientX: number, clientY: number): boolean {
        if (!this.isWithinContentTolerance(clientX)) return false;
        const lineRect = this.resolveLineRect(lineNumber);
        if (!lineRect) return false;
        return clientY >= lineRect.top - MOBILE_LINE_HIT_Y_TOLERANCE_PX
            && clientY <= lineRect.bottom + MOBILE_LINE_HIT_Y_TOLERANCE_PX;
    }

    private isWithinEmbedDragArea(embedEl: HTMLElement, clientX: number, clientY: number): boolean {
        if (!this.isWithinEditorTolerance(clientX)) return false;
        const rect = embedEl.getBoundingClientRect();
        return clientX >= rect.left - MOBILE_EMBED_HIT_PADDING_PX
            && clientX <= rect.right + MOBILE_EMBED_HIT_PADDING_PX
            && clientY >= rect.top - MOBILE_EMBED_HIT_PADDING_PX
            && clientY <= rect.bottom + MOBILE_EMBED_HIT_PADDING_PX;
    }

    private resolveEmbedElement(target: HTMLElement | null, clientX: number, clientY: number): HTMLElement | null {
        if (target) {
            const fromTarget = target.closest<HTMLElement>(EMBED_BLOCK_SELECTOR);
            if (fromTarget && this.view.dom.contains(fromTarget)) {
                return fromTarget;
            }
        }

        return findEmbedElementAtPoint(this.view, clientX, clientY, {
            requireDirectWithinRoot: true,
            normalizeToEmbedRoot: false,
        });
    }

    private resolveLineRect(lineNumber: number): { top: number; bottom: number } | null {
        if (lineNumber < 1 || lineNumber > this.view.state.doc.lines) return null;
        const line = this.view.state.doc.line(lineNumber);
        const startCoords = safeCoordsAtPos(this.view, line.from, 1);
        const endCoords = safeCoordsAtPos(this.view, line.to, -1) ?? startCoords;
        if (!startCoords || !endCoords) return null;
        const top = Math.min(startCoords.top, endCoords.top);
        const bottom = Math.max(startCoords.bottom, endCoords.bottom);
        if (!Number.isFinite(top) || !Number.isFinite(bottom) || bottom <= top) return null;
        return { top, bottom };
    }
}
