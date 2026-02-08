import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../types';

type DropTargetInfo = {
    lineNumber: number;
    indicatorY: number;
    lineRect?: { left: number; width: number };
    highlightRect?: { top: number; left: number; width: number; height: number };
};

type DropTargetResolver = (info: {
    clientX: number;
    clientY: number;
    dragSource: BlockInfo | null;
    pointerType: string | null;
}) => DropTargetInfo | null;

export class DropIndicatorManager {
    private readonly indicatorEl: HTMLDivElement;
    private readonly highlightEl: HTMLDivElement;
    private pendingDragInfo: { x: number; y: number; dragSource: BlockInfo | null; pointerType: string | null } | null = null;
    private rafId: number | null = null;

    constructor(
        private readonly view: EditorView,
        private readonly resolveDropTarget: DropTargetResolver
    ) {
        this.indicatorEl = document.createElement('div');
        this.indicatorEl.className = 'dnd-drop-indicator';
        this.indicatorEl.style.position = 'fixed';
        this.indicatorEl.style.display = 'none';
        document.body.appendChild(this.indicatorEl);

        this.highlightEl = document.createElement('div');
        this.highlightEl.className = 'dnd-drop-highlight';
        this.highlightEl.style.position = 'fixed';
        this.highlightEl.style.display = 'none';
        document.body.appendChild(this.highlightEl);
    }

    scheduleFromPoint(clientX: number, clientY: number, dragSource: BlockInfo | null, pointerType: string | null): void {
        this.pendingDragInfo = { x: clientX, y: clientY, dragSource, pointerType };
        if (this.rafId !== null) return;
        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            const pending = this.pendingDragInfo;
            if (!pending) return;
            this.updateFromPoint(pending);
        });
    }

    hide(): void {
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.pendingDragInfo = null;
        this.indicatorEl.style.display = 'none';
        this.highlightEl.style.display = 'none';
    }

    destroy(): void {
        this.hide();
        this.indicatorEl.remove();
        this.highlightEl.remove();
    }

    private updateFromPoint(info: { x: number; y: number; dragSource: BlockInfo | null; pointerType: string | null }): void {
        const targetInfo = this.resolveDropTarget({
            clientX: info.x,
            clientY: info.y,
            dragSource: info.dragSource,
            pointerType: info.pointerType,
        });
        if (!targetInfo) {
            this.hide();
            return;
        }

        const editorRect = this.view.dom.getBoundingClientRect();
        const indicatorY = targetInfo.indicatorY;
        const indicatorLeft = targetInfo.lineRect ? targetInfo.lineRect.left : editorRect.left + 35;
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const contentPaddingRight = parseFloat(getComputedStyle(this.view.contentDOM).paddingRight) || 0;
        const indicatorRight = contentRect.right - contentPaddingRight;
        const indicatorWidth = Math.max(8, indicatorRight - indicatorLeft);

        this.indicatorEl.style.top = `${indicatorY}px`;
        this.indicatorEl.style.left = `${indicatorLeft}px`;
        this.indicatorEl.style.width = `${indicatorWidth}px`;
        this.indicatorEl.style.display = '';

        if (targetInfo.highlightRect) {
            this.highlightEl.style.top = `${targetInfo.highlightRect.top}px`;
            this.highlightEl.style.left = `${targetInfo.highlightRect.left}px`;
            this.highlightEl.style.width = `${targetInfo.highlightRect.width}px`;
            this.highlightEl.style.height = `${targetInfo.highlightRect.height}px`;
            this.highlightEl.style.display = '';
        } else {
            this.highlightEl.style.display = 'none';
        }
    }
}
