import { EditorView } from '@codemirror/view';
import {
    DOC_SEMANTIC_IDLE_SMALL_MS,
    DOC_SEMANTIC_IDLE_MEDIUM_MS,
    DOC_SEMANTIC_IDLE_LARGE_MS,
} from '../../../shared/constants';
import { DRAGGING_BODY_CLASS } from '../../../shared/dom-selectors';

export interface SemanticRefreshDeps {
    performRefresh: () => void;
}

export class SemanticRefreshScheduler {
    private semanticRefreshTimerHandle: number | null = null;
    private pendingSemanticRefresh = false;

    constructor(
        private readonly view: EditorView,
        private readonly deps: SemanticRefreshDeps
    ) {}

    get isPending(): boolean {
        return this.pendingSemanticRefresh;
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
            if (activeDocument.body.classList.contains(DRAGGING_BODY_CLASS)) {
                this.markSemanticRefreshPending();
                return;
            }
            if (!this.pendingSemanticRefresh) return;
            this.deps.performRefresh();
        }, delayMs);
    }

    ensureSemanticReadyForInteraction(): void {
        if (!this.pendingSemanticRefresh) return;
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
    }

    private getSemanticRefreshDelayMs(docLines: number): number {
        if (docLines > 120_000) return DOC_SEMANTIC_IDLE_LARGE_MS;
        if (docLines > 30_000) return DOC_SEMANTIC_IDLE_MEDIUM_MS;
        return DOC_SEMANTIC_IDLE_SMALL_MS;
    }
}
