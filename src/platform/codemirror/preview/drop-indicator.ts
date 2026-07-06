import { EditorView } from '@codemirror/view';
import type { BlockSelection } from '../../../domain/selection/block-selection';
import type { DropResolution, DropValidationResult } from '../drop/drop-validation';
import { DROP_INDICATOR_CLASS, DROP_HIGHLIGHT_CLASS, HIDDEN_CLASS } from '../../../shared/dom-selectors';

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
        validation: DropValidationResult;
    }) => void;
}

export class DropIndicatorManager {
    private static readonly instances = new Set<DropIndicatorManager>();
    private readonly indicatorEl: HTMLDivElement;
    private readonly highlightEl: HTMLDivElement;
    private pendingDragInfo: { validation: DropValidationResult; selection: BlockSelection | null; pointerType: string | null } | null = null;
    private rafId: number | null = null;
    private lastResolution: DropResolution | null = null;

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

    scheduleRender(validation: DropValidationResult, selection: BlockSelection | null, pointerType: string | null): void {
        this.pendingDragInfo = { validation, selection, pointerType };
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
        this.lastResolution = null;
        this.indicatorEl.classList.add(HIDDEN_CLASS);
        this.highlightEl.classList.add(HIDDEN_CLASS);
    }

    destroy(): void {
        this.hide();
        this.indicatorEl.remove();
        this.highlightEl.remove();
        DropIndicatorManager.instances.delete(this);
    }

    private renderValidation(info: { validation: DropValidationResult; selection: BlockSelection | null; pointerType: string | null }): void {
        const validation = info.validation;
        const resolution = validation.allowed ? validation.resolution ?? null : null;
        this.options?.onDropTargetEvaluated?.({
            source: info.selection,
            pointerType: info.pointerType,
            validation,
        });
        this.options?.onFrameMetrics?.({
            evaluated: true,
            skipped: false,
            reused: false,
            durationMs: 0,
        });
        this.lastResolution = resolution;
        if (!resolution) {
            this.indicatorEl.classList.add(HIDDEN_CLASS);
            this.highlightEl.classList.add(HIDDEN_CLASS);
            return;
        }
        this.renderResolution(resolution);
    }

    private renderResolution(resolution: DropResolution): void {
        this.hideOtherInstancesVisuals();
        const editorRect = this.view.dom.getBoundingClientRect();
        const indicatorY = resolution.preview.indicatorY;
        const indicatorLeft = resolution.preview.lineRect ? resolution.preview.lineRect.left : editorRect.left + 35;
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const contentPaddingRight = parseFloat(getComputedStyle(this.view.contentDOM).paddingRight) || 0;
        const indicatorRight = contentRect.right - contentPaddingRight;
        const indicatorWidth = Math.max(8, indicatorRight - indicatorLeft);

        this.indicatorEl.classList.remove(HIDDEN_CLASS);
        this.indicatorEl.setCssStyles({
            top: `${indicatorY}px`,
            left: `${indicatorLeft}px`,
            width: `${indicatorWidth}px`,
        });

        if (resolution.preview.highlightRect && this.options?.isDropHighlightEnabled?.() !== false) {
            this.highlightEl.classList.remove(HIDDEN_CLASS);
            this.highlightEl.setCssStyles({
                top: `${resolution.preview.highlightRect.top}px`,
                left: `${resolution.preview.highlightRect.left}px`,
                width: `${resolution.preview.highlightRect.width}px`,
                height: `${resolution.preview.highlightRect.height}px`,
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
