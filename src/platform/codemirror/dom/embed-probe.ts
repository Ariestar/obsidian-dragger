import { EditorView } from '@codemirror/view';
import { EMBED_BLOCK_SELECTOR, EMBED_ROOT_SELECTOR } from '../../../shared/dom-selectors';

export type FindEmbedElementAtPointOptions = {
    requireDirectWithinRoot?: boolean;
    normalizeToEmbedRoot?: boolean;
};

export function normalizeEmbedRoot(el: HTMLElement | null | undefined): HTMLElement | null {
    if (!el) return null;
    return el.closest<HTMLElement>(EMBED_ROOT_SELECTOR) ?? el;
}

export function collectEmbedRoots(
    view: EditorView,
    options?: { normalizeToEmbedRoot?: boolean }
): HTMLElement[] {
    const root = view.dom;
    if (!root?.instanceOf(HTMLElement)) return [];
    const normalizeToEmbedRoot = options?.normalizeToEmbedRoot !== false;
    const seen = new Set<HTMLElement>();
    const result: HTMLElement[] = [];
    const raws = Array.from(root.querySelectorAll<HTMLElement>(EMBED_BLOCK_SELECTOR));
    for (const raw of raws) {
        const candidate = normalizeToEmbedRoot ? (normalizeEmbedRoot(raw) ?? raw) : raw;
        if (!root.contains(candidate)) continue;
        if (seen.has(candidate)) continue;
        seen.add(candidate);
        result.push(candidate);
    }
    return result;
}

export function findEmbedElementAtPoint(
    view: EditorView,
    clientX: number,
    clientY: number,
    options?: FindEmbedElementAtPointOptions,
): HTMLElement | null {
    const root = view.dom;
    if (!root?.instanceOf(HTMLElement)) return null;

    const requireDirectWithinRoot = options?.requireDirectWithinRoot !== false;
    const normalizeToEmbedRoot = options?.normalizeToEmbedRoot !== false;

    if (typeof activeDocument.elementFromPoint === 'function') {
        const rawEl = activeDocument.elementFromPoint(clientX, clientY);
        const el = rawEl?.instanceOf(HTMLElement) ? rawEl : null;
        if (el) {
            const direct = el.closest<HTMLElement>(EMBED_BLOCK_SELECTOR);
            if (direct) {
                if (!requireDirectWithinRoot || root.contains(direct)) {
                    return normalizeToEmbedRoot ? (normalizeEmbedRoot(direct) ?? direct) : direct;
                }
            }
        }
    }
    return null;
}
