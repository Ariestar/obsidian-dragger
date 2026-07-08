/**
 * High-resolution timestamp helper.
 * Shared across perf-session, line-map, and block-detector.
 */
export function nowMs(): number {
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}
