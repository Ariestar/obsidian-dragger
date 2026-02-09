import { nowMs } from '../utils/timing';

type DurationSampleKey =
    | 'resolve_total'
    | 'vertical'
    | 'container'
    | 'list_target'
    | 'in_place'
    | 'geometry'
    | 'line_map_get'
    | 'line_map_build'
    | 'detect_block_uncached'
    | 'drop_indicator_resolve';

type CounterKey =
    | 'drop_indicator_frames'
    | 'drop_indicator_skipped_frames'
    | 'drop_indicator_reused_frames'
    | 'resolve_cache_hits'
    | 'resolve_cache_misses'
    | 'list_ancestor_scan_steps'
    | 'list_parent_scan_steps'
    | 'highlight_scan_lines';

type DragPerfSessionInput = {
    docLines: number;
};

export interface DragPerfSession {
    id: string;
    docLines: number;
    startedAtMs: number;
    recordDuration: (key: DurationSampleKey, durationMs: number) => void;
    incrementCounter: (key: CounterKey, delta?: number) => void;
    snapshot: () => DragPerfSnapshot;
}

export interface DragPerfSnapshot {
    id: string;
    docLines: number;
    durationMs: number;
    durations: Record<DurationSampleKey, { count: number; p50: number; p95: number; max: number }>;
    counters: Record<CounterKey, number>;
    cacheHitRates: {
        resolveValidatedDropTarget: number;
    };
}

function createDurationStore(): Record<DurationSampleKey, number[]> {
    return {
        resolve_total: [],
        vertical: [],
        container: [],
        list_target: [],
        in_place: [],
        geometry: [],
        line_map_get: [],
        line_map_build: [],
        detect_block_uncached: [],
        drop_indicator_resolve: [],
    };
}

function createCounterStore(): Record<CounterKey, number> {
    return {
        drop_indicator_frames: 0,
        drop_indicator_skipped_frames: 0,
        drop_indicator_reused_frames: 0,
        resolve_cache_hits: 0,
        resolve_cache_misses: 0,
        list_ancestor_scan_steps: 0,
        list_parent_scan_steps: 0,
        highlight_scan_lines: 0,
    };
}

function percentile(values: number[], p: number): number {
    if (values.length === 0) return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = Math.max(0, Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1));
    return Number(sorted[index].toFixed(3));
}

function summarize(values: number[]): { count: number; p50: number; p95: number; max: number } {
    if (values.length === 0) {
        return { count: 0, p50: 0, p95: 0, max: 0 };
    }
    return {
        count: values.length,
        p50: percentile(values, 50),
        p95: percentile(values, 95),
        max: Number(Math.max(...values).toFixed(3)),
    };
}

function serializeSnapshot(snapshot: DragPerfSnapshot): string {
    return JSON.stringify(snapshot, null, 2);
}

export function createDragPerfSession(input: DragPerfSessionInput): DragPerfSession {
    const startedAtMs = nowMs();
    const durations = createDurationStore();
    const counters = createCounterStore();
    const id = `drag-${Math.random().toString(36).slice(2, 10)}`;

    return {
        id,
        docLines: input.docLines,
        startedAtMs,
        recordDuration(key, durationMs) {
            if (!isFinite(durationMs) || durationMs < 0) return;
            durations[key].push(durationMs);
        },
        incrementCounter(key, delta = 1) {
            counters[key] += delta;
        },
        snapshot() {
            const resolveHits = counters.resolve_cache_hits;
            const resolveMisses = counters.resolve_cache_misses;
            const resolveTotal = resolveHits + resolveMisses;
            return {
                id,
                docLines: input.docLines,
                durationMs: Number((nowMs() - startedAtMs).toFixed(3)),
                durations: {
                    resolve_total: summarize(durations.resolve_total),
                    vertical: summarize(durations.vertical),
                    container: summarize(durations.container),
                    list_target: summarize(durations.list_target),
                    in_place: summarize(durations.in_place),
                    geometry: summarize(durations.geometry),
                    line_map_get: summarize(durations.line_map_get),
                    line_map_build: summarize(durations.line_map_build),
                    detect_block_uncached: summarize(durations.detect_block_uncached),
                    drop_indicator_resolve: summarize(durations.drop_indicator_resolve),
                },
                counters: { ...counters },
                cacheHitRates: {
                    resolveValidatedDropTarget: resolveTotal > 0
                        ? Number((resolveHits / resolveTotal).toFixed(3))
                        : 0,
                },
            };
        },
    };
}

export function logDragPerfSession(session: DragPerfSession | null, reason: string): void {
    if (!session) return;
    const snapshot = session.snapshot();
    console.info('[Dragger][Perf]', reason, serializeSnapshot(snapshot));
}
