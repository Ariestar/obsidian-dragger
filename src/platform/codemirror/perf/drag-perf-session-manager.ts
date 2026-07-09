import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { createDragPerfSession, DragPerfSession, logDragPerfSession } from './perf-session';
import { getLineMap } from 'md-dragger/domain';
import { setLineMapPerfRecorder, setDetectBlockPerfRecorder } from 'md-dragger/domain/perf';

export class DragPerfSessionManager {
    private session: DragPerfSession | null = null;

    constructor(private readonly view: EditorView) {}

    ensure(): void {
        if (this.session) return;
        this.session = createDragPerfSession({
            docLines: this.view.state.doc.lines,
        });
        setLineMapPerfRecorder((key, durationMs) => {
            this.session?.recordDuration(key, durationMs);
        });
        setDetectBlockPerfRecorder((key, durationMs) => {
            this.session?.recordDuration(key, durationMs);
        });
        // Warm line-map once per drag session to move cold build out of move-frame hot path.
        getLineMap(this.view.state.doc, { tabSize: this.view.state.facet(EditorState.tabSize) });
    }

    flush(reason: string): void {
        if (this.session) {
            logDragPerfSession(this.session, reason);
            this.session = null;
        }
        setLineMapPerfRecorder(null);
        setDetectBlockPerfRecorder(null);
    }

    recordDuration(key: Parameters<DragPerfSession['recordDuration']>[0], durationMs: number): void {
        this.session?.recordDuration(key, durationMs);
    }

    incrementCounter(key: Parameters<DragPerfSession['incrementCounter']>[0], delta: number = 1): void {
        this.session?.incrementCounter(key, delta);
    }
}
