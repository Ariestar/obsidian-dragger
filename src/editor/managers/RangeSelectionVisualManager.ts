import { EditorView } from '@codemirror/view';
import {
    getHandleColumnCenterX,
    getLineNumberElementForLine,
    viewportXToEditorLocalX,
    viewportYToEditorLocalY,
} from '../core/handle-position';
import {
    DRAG_HANDLE_CLASS,
    RANGE_SELECTED_LINE_CLASS,
    RANGE_SELECTED_HANDLE_CLASS,
    RANGE_SELECTION_LINK_CLASS,
    EMBED_HANDLE_CLASS,
} from '../core/selectors';
import { GRAB_HIDDEN_LINE_NUMBER_CLASS } from '../core/constants';

const RANGE_SELECTED_LINE_NUMBER_HIDDEN_CLASS = GRAB_HIDDEN_LINE_NUMBER_CLASS;

export type LineRange = {
    startLineNumber: number;
    endLineNumber: number;
};

export class RangeSelectionVisualManager {
    private readonly lineElements = new Set<HTMLElement>();
    private readonly lineNumberElements = new Set<HTMLElement>();
    private readonly handleElements = new Set<HTMLElement>();
    private readonly linkEls: HTMLElement[] = [];
    private refreshRafHandle: number | null = null;
    private scrollContainer: HTMLElement | null = null;
    private readonly onScroll: () => void;

    constructor(
        private readonly view: EditorView,
        private readonly onRefreshRequested: () => void
    ) {
        this.onScroll = () => this.scheduleRefresh();
        this.bindScrollListener();
    }

    render(ranges: LineRange[]): void {
        const normalizedRanges = this.mergeLineRanges(ranges);
        const nextLineElements = new Set<HTMLElement>();
        const nextLineNumberElements = new Set<HTMLElement>();
        const nextHandleElements = new Set<HTMLElement>();
        const doc = this.view.state.doc;
        const visibleRanges = this.view.visibleRanges ?? [{ from: 0, to: doc.length }];
        for (const range of visibleRanges) {
            let pos = range.from;
            while (pos <= range.to) {
                const line = doc.lineAt(pos);
                const lineNumber = line.number;
                if (this.isLineNumberInRanges(lineNumber, normalizedRanges)) {
                    const lineEl = this.getLineElementForLine(lineNumber);
                    if (lineEl) {
                        nextLineElements.add(lineEl);
                    }
                    const lineNumberEl = getLineNumberElementForLine(this.view, lineNumber);
                    if (lineNumberEl) {
                        nextLineNumberElements.add(lineNumberEl);
                    }
                    const handleEl = this.getInlineHandleForLine(lineNumber);
                    if (handleEl) {
                        nextHandleElements.add(handleEl);
                    }
                }
                pos = line.to + 1;
            }
        }
        this.syncSelectionElements(
            this.lineElements,
            nextLineElements,
            RANGE_SELECTED_LINE_CLASS
        );
        this.syncSelectionElements(
            this.lineNumberElements,
            nextLineNumberElements,
            RANGE_SELECTED_LINE_NUMBER_HIDDEN_CLASS
        );
        this.syncSelectionElements(
            this.handleElements,
            nextHandleElements,
            RANGE_SELECTED_HANDLE_CLASS
        );
        this.updateLinks(normalizedRanges);
    }

    clear(): void {
        for (const lineEl of this.lineElements) {
            lineEl.classList.remove(RANGE_SELECTED_LINE_CLASS);
        }
        this.lineElements.clear();

        for (const lineNumberEl of this.lineNumberElements) {
            lineNumberEl.classList.remove(RANGE_SELECTED_LINE_NUMBER_HIDDEN_CLASS);
        }
        this.lineNumberElements.clear();

        for (const handleEl of this.handleElements) {
            handleEl.classList.remove(RANGE_SELECTED_HANDLE_CLASS);
        }
        this.handleElements.clear();

        for (const link of this.linkEls) {
            link.style.opacity = '0';
            link.style.pointerEvents = 'none';
        }
    }

    scheduleRefresh(): void {
        if (this.refreshRafHandle !== null) return;
        this.refreshRafHandle = window.requestAnimationFrame(() => {
            this.refreshRafHandle = null;
            this.onRefreshRequested();
        });
    }

    cancelScheduledRefresh(): void {
        if (this.refreshRafHandle === null) return;
        window.cancelAnimationFrame(this.refreshRafHandle);
        this.refreshRafHandle = null;
    }

    getAnchorY(lineNumber: number): number | null {
        const handle = this.getInlineHandleForLine(lineNumber);
        if (handle) {
            const rect = handle.getBoundingClientRect();
            if (rect.height > 0) {
                return rect.top + rect.height / 2;
            }
        }

        const lineNumberEl = getLineNumberElementForLine(this.view, lineNumber);
        if (lineNumberEl) {
            const rect = lineNumberEl.getBoundingClientRect();
            if (rect.height > 0) {
                return rect.top + rect.height / 2;
            }
        }

        const lineEl = this.getLineElementForLine(lineNumber);
        if (lineEl) {
            const rect = lineEl.getBoundingClientRect();
            if (rect.height > 0) {
                return rect.top + rect.height / 2;
            }
        }

        try {
            const line = this.view.state.doc.line(lineNumber);
            const coords = this.view.coordsAtPos(line.from);
            if (coords) {
                return (coords.top + coords.bottom) / 2;
            }
        } catch {
            // ignore anchor fallback errors
        }
        return null;
    }

    getInlineHandleForLine(lineNumber: number): HTMLElement | null {
        const blockStart = lineNumber - 1;
        if (blockStart < 0) return null;
        const selector = `.${DRAG_HANDLE_CLASS}[data-block-start="${blockStart}"]`;
        const handles = Array.from(this.view.dom.querySelectorAll(selector)) as HTMLElement[];
        if (handles.length === 0) return null;
        return handles.find((handle) => !handle.classList.contains(EMBED_HANDLE_CLASS)) ?? handles[0] ?? null;
    }

    getLineElementForLine(lineNumber: number): HTMLElement | null {
        if (lineNumber < 1 || lineNumber > this.view.state.doc.lines) return null;
        if (typeof this.view.domAtPos !== 'function') return null;
        try {
            const line = this.view.state.doc.line(lineNumber);
            const domAtPos = this.view.domAtPos(line.from);
            const base = domAtPos.node.nodeType === Node.TEXT_NODE
                ? domAtPos.node.parentElement
                : domAtPos.node;
            if (!(base instanceof Element)) return null;
            return (base.closest('.cm-line') as HTMLElement | null) ?? null;
        } catch {
            return null;
        }
    }

    destroy(): void {
        this.clear();
        for (const link of this.linkEls) {
            link.remove();
        }
        this.linkEls.length = 0;
        this.cancelScheduledRefresh();
        this.unbindScrollListener();
    }

    private bindScrollListener(): void {
        this.unbindScrollListener();
        const scroller = ((this.view as any).scrollDOM as HTMLElement | undefined)
            ?? (this.view.dom.querySelector('.cm-scroller') as HTMLElement | null)
            ?? null;
        if (!scroller) return;
        scroller.addEventListener('scroll', this.onScroll, { passive: true });
        this.scrollContainer = scroller;
    }

    private unbindScrollListener(): void {
        if (!this.scrollContainer) return;
        this.scrollContainer.removeEventListener('scroll', this.onScroll);
        this.scrollContainer = null;
    }

    private syncSelectionElements(
        current: Set<HTMLElement>,
        next: Set<HTMLElement>,
        className: string
    ): void {
        for (const el of current) {
            if (next.has(el)) continue;
            el.classList.remove(className);
        }
        for (const el of next) {
            if (current.has(el)) continue;
            el.classList.add(className);
        }
        current.clear();
        for (const el of next) {
            current.add(el);
        }
    }

    private isLineNumberInRanges(lineNumber: number, ranges: LineRange[]): boolean {
        for (const range of ranges) {
            if (lineNumber >= range.startLineNumber && lineNumber <= range.endLineNumber) {
                return true;
            }
        }
        return false;
    }

    private mergeLineRanges(ranges: LineRange[]): LineRange[] {
        if (ranges.length <= 1) return ranges;
        const sorted = [...ranges].sort((a, b) => a.startLineNumber - b.startLineNumber);
        const merged: LineRange[] = [sorted[0]];
        for (let i = 1; i < sorted.length; i++) {
            const last = merged[merged.length - 1];
            const current = sorted[i];
            if (current.startLineNumber <= last.endLineNumber + 1) {
                last.endLineNumber = Math.max(last.endLineNumber, current.endLineNumber);
            } else {
                merged.push({ ...current });
            }
        }
        return merged;
    }

    private updateLinks(ranges: LineRange[]): void {
        const editorRect = this.view.dom.getBoundingClientRect();
        const centerX = getHandleColumnCenterX(this.view);
        const left = viewportXToEditorLocalX(this.view, centerX);
        const localViewportHeight = Math.max(0, this.view.dom.clientHeight || editorRect.height);

        for (let i = 0; i < ranges.length; i++) {
            const range = ranges[i];
            const startAnchorY = this.getAnchorY(range.startLineNumber);
            const endAnchorY = this.getAnchorY(range.endLineNumber);
            const link = this.ensureLinkEl(i);
            if (startAnchorY === null || endAnchorY === null) {
                link.style.opacity = '0';
                link.style.pointerEvents = 'none';
                continue;
            }
            const topY = Math.min(startAnchorY, endAnchorY);
            const bottomY = Math.max(startAnchorY, endAnchorY);
            const top = viewportYToEditorLocalY(this.view, topY);
            const bottom = viewportYToEditorLocalY(this.view, bottomY);
            const clampedTop = Math.max(0, Math.min(localViewportHeight, top));
            const clampedBottom = Math.max(clampedTop + 2, Math.min(localViewportHeight, bottom));
            link.style.opacity = '1';
            link.style.pointerEvents = 'auto';
            link.style.left = `${left.toFixed(2)}px`;
            link.style.top = `${clampedTop.toFixed(2)}px`;
            link.style.height = `${Math.max(2, clampedBottom - clampedTop).toFixed(2)}px`;
        }
        for (let i = ranges.length; i < this.linkEls.length; i++) {
            this.linkEls[i].style.opacity = '0';
            this.linkEls[i].style.pointerEvents = 'none';
        }
    }

    private ensureLinkEl(index: number): HTMLElement {
        const existing = this.linkEls[index];
        if (existing && existing.isConnected) {
            return existing;
        }
        const link = document.createElement('div');
        link.className = RANGE_SELECTION_LINK_CLASS;
        link.style.opacity = '0';
        this.view.dom.appendChild(link);
        this.linkEls[index] = link;
        return link;
    }
}
