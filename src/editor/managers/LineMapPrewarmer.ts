import { ViewUpdate } from '@codemirror/view';
import {
    getLineMap,
    primeLineMapFromTransition,
} from '../core/line-map';

interface PendingPrewarm {
    previousState: any;
    nextState: any;
    changes: any;
    docLines: number;
}

export class LineMapPrewarmer {
    private idleHandle: number | null = null;
    private timerHandle: number | null = null;
    private pending: PendingPrewarm | null = null;

    schedule(update: ViewUpdate): void {
        const nextState = update.state as any;
        const docLines = nextState?.doc?.lines ?? 0;
        if (docLines > 30_000) {
            // On very large docs, background prewarm can still cause visible typing hitches.
            // We warm line-map lazily at drag start instead.
            this.clear();
            return;
        }
        this.pending = {
            previousState: update.startState as any,
            nextState,
            changes: update.changes as any,
            docLines,
        };
        if (this.idleHandle !== null) {
            const cancelIdle = (window as any).cancelIdleCallback as
                | ((id: number) => void)
                | undefined;
            if (typeof cancelIdle === 'function') {
                cancelIdle(this.idleHandle);
            }
            this.idleHandle = null;
        }
        if (this.timerHandle !== null) {
            window.clearTimeout(this.timerHandle);
        }

        const isLargeDoc = docLines > 30_000;
        const debounceMs = isLargeDoc ? 1200 : 250;
        this.timerHandle = window.setTimeout(() => {
            this.timerHandle = null;
            this.enqueueIdleTask();
        }, debounceMs);
    }

    clear(): void {
        if (this.idleHandle !== null) {
            const cancelIdle = (window as any).cancelIdleCallback as
                | ((id: number) => void)
                | undefined;
            if (typeof cancelIdle === 'function') {
                cancelIdle(this.idleHandle);
            }
            this.idleHandle = null;
        }
        if (this.timerHandle !== null) {
            window.clearTimeout(this.timerHandle);
            this.timerHandle = null;
        }
        this.pending = null;
    }

    private enqueueIdleTask(): void {
        const pending = this.pending;
        if (!pending) return;
        const run = () => {
            this.idleHandle = null;
            const latest = this.pending;
            this.pending = null;
            if (!latest) return;
            try {
                primeLineMapFromTransition({
                    previousState: latest.previousState,
                    nextState: latest.nextState,
                    changes: latest.changes,
                });
            } catch {
                getLineMap(latest.nextState);
            }
        };
        const requestIdle = (window as any).requestIdleCallback as
            | ((cb: () => void, options?: { timeout?: number }) => number)
            | undefined;
        if (typeof requestIdle === 'function') {
            if (pending.docLines > 30_000) {
                this.idleHandle = requestIdle(run);
            } else {
                this.idleHandle = requestIdle(run, { timeout: 200 });
            }
            return;
        }
        this.timerHandle = window.setTimeout(() => {
            this.timerHandle = null;
            run();
        }, pending.docLines > 30_000 ? 250 : 16);
    }
}
