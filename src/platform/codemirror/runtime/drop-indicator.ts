import { EditorView } from '@codemirror/view';
import type { BlockSelection, DropTarget } from 'md-dragger/domain';
import { DROP_INDICATOR_CLASS, DROP_HIGHLIGHT_CLASS, HIDDEN_CLASS } from '../../../shared/dom-selectors';

export interface DropPreview {
    indicatorY: number;
    lineRect?: { left: number; width: number };
    highlightRect?: { top: number; left: number; width: number; height: number };
}

export type DropMark = {
    target: DropTarget;
    preview: DropPreview;
};

interface DropIndicatorManagerOptions {
    isDropHighlightEnabled?: () => boolean;
    onFrameMetrics?: (metrics: {
        evaluated: boolean;
        skipped: boolean;
        reused: boolean;
        durationMs: number;
    }) => void;
    recordPerfDuration?: (key: 'drop_indicator_resolve', durationMs: number) => void;
    onDropTargetEvaluated?: (info: {
        source: BlockSelection | null;
        pointerType: string | null;
        mark: DropMark | null;
    }) => void;
}

export class DropIndicatorManager {
    private static readonly instances = new Set<DropIndicatorManager>();
    private readonly indicatorEl: HTMLDivElement;
    private readonly highlightEl: HTMLDivElement;
    private pendingDragInfo: { mark: DropMark | null; selection: BlockSelection | null; pointerType: string | null } | null = null;
    private rafId: number | null = null;
    private lastMark: DropMark | null = null;

    constructor(
        private readonly view: EditorView,
        private readonly options?: DropIndicatorManagerOptions
    ) {
        DropIndicatorManager.instances.add(this);
        this.indicatorEl = activeDocument.createElement('div');
        this.indicatorEl.className = `${DROP_INDICATOR_CLASS} ${HIDDEN_CLASS}`;
        activeDocument.body.appendChild(this.indicatorEl);

        this.highlightEl = activeDocument.createElement('div');
        this.highlightEl.className = `${DROP_HIGHLIGHT_CLASS} ${HIDDEN_CLASS}`;
        activeDocument.body.appendChild(this.highlightEl);
    }

    scheduleRender(mark: DropMark | null, selection: BlockSelection | null, pointerType: string | null): void {
        this.pendingDragInfo = { mark, selection, pointerType };
        if (this.rafId !== null) return;
        this.rafId = window.requestAnimationFrame(() => {
            this.rafId = null;
            const pending = this.pendingDragInfo;
            if (!pending) return;
            this.renderValidation(pending);
        });
    }

    hide(): void {
        if (this.rafId !== null) {
            window.cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        this.pendingDragInfo = null;
        this.lastMark = null;
        this.indicatorEl.classList.add(HIDDEN_CLASS);
        this.highlightEl.classList.add(HIDDEN_CLASS);
    }

    destroy(): void {
        this.hide();
        this.indicatorEl.remove();
        this.highlightEl.remove();
        DropIndicatorManager.instances.delete(this);
    }

    private renderValidation(info: { mark: DropMark | null; selection: BlockSelection | null; pointerType: string | null }): void {
        const mark = info.mark;
        this.options?.onDropTargetEvaluated?.({
            source: info.selection,
            pointerType: info.pointerType,
            mark,
        });
        this.options?.onFrameMetrics?.({
            evaluated: true,
            skipped: false,
            reused: false,
            durationMs: 0,
        });
        this.lastMark = mark;
        if (!mark) {
            this.indicatorEl.classList.add(HIDDEN_CLASS);
            this.highlightEl.classList.add(HIDDEN_CLASS);
            return;
        }
        this.renderMark(mark);
    }

    private renderMark(mark: DropMark): void {
        this.hideOtherInstancesVisuals();
        const editorRect = this.view.dom.getBoundingClientRect();
        const indicatorY = mark.preview.indicatorY;
        const baseLeft = mark.preview.lineRect ? mark.preview.lineRect.left : editorRect.left + 35;
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const contentPaddingRight = parseFloat(getComputedStyle(this.view.contentDOM).paddingRight) || 0;
        const indentOffset = (mark.target.listIntent?.targetIndentWidth ?? 0)
            * (this.view.defaultCharacterWidth || 8);
        const indicatorLeft = baseLeft + indentOffset;
        const indicatorRight = contentRect.right - contentPaddingRight;
        const indicatorWidth = Math.max(8, indicatorRight - indicatorLeft);

        this.indicatorEl.classList.remove(HIDDEN_CLASS);
        this.indicatorEl.setCssStyles({
            top: `${indicatorY}px`,
            left: `${indicatorLeft}px`,
            width: `${indicatorWidth}px`,
        });

        if (mark.preview.highlightRect && this.options?.isDropHighlightEnabled?.() !== false) {
            this.highlightEl.classList.remove(HIDDEN_CLASS);
            this.highlightEl.setCssStyles({
                top: `${mark.preview.highlightRect.top}px`,
                left: `${mark.preview.highlightRect.left}px`,
                width: `${mark.preview.highlightRect.width}px`,
                height: `${mark.preview.highlightRect.height}px`,
            });
        } else {
            this.highlightEl.classList.add(HIDDEN_CLASS);
        }
    }

    private hideOtherInstancesVisuals(): void {
        for (const instance of DropIndicatorManager.instances) {
            if (instance === this) continue;
            instance.hide();
        }
    }
}
