import { EditorView } from '@codemirror/view';
import {
    DOC_SEMANTIC_IDLE_SMALL_MS,
    DOC_SEMANTIC_IDLE_MEDIUM_MS,
    DOC_SEMANTIC_IDLE_LARGE_MS,
} from '../core/constants';
import { DRAGGING_BODY_CLASS } from '../core/selectors';

export interface SemanticRefreshDeps {
    performRefresh: () => void;
    isGestureActive: () => boolean;
    refreshSelectionVisual: () => void;
}

export class SemanticRefreshScheduler {
    private semanticRefreshTimerHandle: number | null = null;
    private pendingSemanticRefresh = false;
    private viewportScrollContainer: HTMLElement | null = null;
    private viewportScrollRefreshTimerHandle: number | null = null;
    private viewportScrollRefreshRafHandle: number | null = null;
    private readonly onViewportScroll = () => this.scheduleViewportRefreshFromScroll();

    constructor(
        private readonly view: EditorView,
        private readonly deps: SemanticRefreshDeps
    ) {}

    get isPending(): boolean {
        return this.pendingSemanticRefresh;
    }

    bindViewportScrollFallback(): void {
        this.unbindViewportScrollFallback();
        const scroller = ((this.view as any).scrollDOM as HTMLElement | undefined)
            ?? (this.view.dom.querySelector('.cm-scroller') as HTMLElement | null)
            ?? null;
        if (!scroller) return;
        scroller.addEventListener('scroll', this.onViewportScroll, { passive: true });
        this.viewportScrollContainer = scroller;
    }

    unbindViewportScrollFallback(): void {
        if (this.viewportScrollContainer) {
            this.viewportScrollContainer.removeEventListener('scroll', this.onViewportScroll);
            this.viewportScrollContainer = null;
        }
        this.clearScheduledViewportRefreshFromScroll();
    }

    markSemanticRefreshPending(): void {
        this.pendingSemanticRefresh = true;
        if (this.semanticRefreshTimerHandle !== null) {
            window.clearTimeout(this.semanticRefreshTimerHandle);
            this.semanticRefreshTimerHandle = null;
        }
        const delayMs = this.getSemanticRefreshDelayMs(this.view.state.doc.lines);
        this.semanticRefreshTimerHandle = window.setTimeout(() => {
            this.semanticRefreshTimerHandle = null;
            if (document.body.classList.contains(DRAGGING_BODY_CLASS)) {
                this.markSemanticRefreshPending();
                return;
            }
            if (!this.pendingSemanticRefresh) return;
            this.deps.performRefresh();
        }, delayMs);
    }

    ensureSemanticReadyForInteraction(): void {
        const hasPendingViewportRefresh = this.viewportScrollRefreshTimerHandle !== null
            || this.viewportScrollRefreshRafHandle !== null;
        if (!this.pendingSemanticRefresh && !hasPendingViewportRefresh) return;
        this.clearScheduledViewportRefreshFromScroll();
        this.deps.performRefresh();
    }

    clearPendingSemanticRefresh(): void {
        this.pendingSemanticRefresh = false;
        if (this.semanticRefreshTimerHandle !== null) {
            window.clearTimeout(this.semanticRefreshTimerHandle);
            this.semanticRefreshTimerHandle = null;
        }
    }

    destroy(): void {
        this.clearPendingSemanticRefresh();
        this.unbindViewportScrollFallback();
    }

    private scheduleViewportRefreshFromScroll(): void {
        if (document.body.classList.contains(DRAGGING_BODY_CLASS)) return;
        if (this.deps.isGestureActive()) return;
        // Skip if already scheduled - avoid redundant RAF calls during fast scrolling
        if (this.viewportScrollRefreshRafHandle !== null) return;

        this.viewportScrollRefreshRafHandle = window.requestAnimationFrame(() => {
            this.viewportScrollRefreshRafHandle = null;
            if (document.body.classList.contains(DRAGGING_BODY_CLASS)) return;
            if (this.deps.isGestureActive()) return;
            this.deps.performRefresh();
            this.deps.refreshSelectionVisual();
        });
    }

    private clearScheduledViewportRefreshFromScroll(): void {
        if (this.viewportScrollRefreshTimerHandle !== null) {
            window.clearTimeout(this.viewportScrollRefreshTimerHandle);
            this.viewportScrollRefreshTimerHandle = null;
        }
        if (this.viewportScrollRefreshRafHandle !== null) {
            window.cancelAnimationFrame(this.viewportScrollRefreshRafHandle);
            this.viewportScrollRefreshRafHandle = null;
        }
    }

    private getSemanticRefreshDelayMs(docLines: number): number {
        if (docLines > 120_000) return DOC_SEMANTIC_IDLE_LARGE_MS;
        if (docLines > 30_000) return DOC_SEMANTIC_IDLE_MEDIUM_MS;
        return DOC_SEMANTIC_IDLE_SMALL_MS;
    }
}
