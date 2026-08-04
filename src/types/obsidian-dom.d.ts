// Obsidian 1.13+ exposes createDiv/createSpan/createFragment on the runtime
// `window` object (activeWindow), but obsidian.d.ts only declares them on the
// global `Node` interface (createFragment only as a top-level function).
// Supplement the missing declarations so `activeWindow.createDiv()` type-checks.
declare global {
    interface Window {
        createDiv(o?: Record<string, unknown> | string, callback?: (el: HTMLDivElement) => void): HTMLDivElement;
        createSpan(o?: Record<string, unknown> | string, callback?: (el: HTMLSpanElement) => void): HTMLSpanElement;
        createFragment(callback?: (el: DocumentFragment) => void): DocumentFragment;
    }
}

export {};
