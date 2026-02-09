/**
 * Timing constants for semantic refresh delays based on document size
 */
export const DOC_SEMANTIC_IDLE_SMALL_MS = 500;
export const DOC_SEMANTIC_IDLE_MEDIUM_MS = 900;
export const DOC_SEMANTIC_IDLE_LARGE_MS = 1400;

/**
 * Debounce delays for embed handle scanning based on document size
 */
export const EMBED_SCAN_DEBOUNCE_SMALL_MS = 120;
export const EMBED_SCAN_DEBOUNCE_MEDIUM_MS = 300;
export const EMBED_SCAN_DEBOUNCE_LARGE_MS = 700;

/**
 * Document size thresholds (line count)
 */
export const DOC_SIZE_MEDIUM_THRESHOLD = 30_000;
export const DOC_SIZE_LARGE_THRESHOLD = 120_000;

/**
 * Interaction zone width for handle hover detection
 */
export const HANDLE_INTERACTION_ZONE_PX = 64;

/**
 * Handle visual constants
 */
let handleSizePx = 16;

export function getHandleSizePx(): number {
    return handleSizePx;
}

export function setHandleSizePx(size: number): void {
    handleSizePx = Math.max(12, Math.min(28, size));
}

/**
 * CSS class names
 */
export const HOVER_HIDDEN_LINE_NUMBER_CLASS = 'dnd-line-number-hover-hidden';
export const GRAB_HIDDEN_LINE_NUMBER_CLASS = 'dnd-line-number-grab-hidden';
