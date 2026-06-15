import { EditorView } from '@codemirror/view';
import {
    CODEMIRROR_EDITOR_SELECTOR,
    HANDLE_GUTTER_CLASS,
} from '../../../shared/dom-selectors';

type HandleGutterSide = 'left' | 'right';

const HANDLE_GUTTER_PLACEMENT_BY_SIDE: Record<HandleGutterSide, {
    adjacentAnchor: 'nextSibling' | 'previousSibling';
    getReferenceNode: (anchor: HTMLElement) => ChildNode | null;
}> = {
    left: {
        adjacentAnchor: 'nextSibling',
        getReferenceNode: (anchor) => anchor,
    },
    right: {
        adjacentAnchor: 'previousSibling',
        getReferenceNode: (anchor) => anchor.nextSibling,
    },
};

function isVisible(el: HTMLElement): boolean {
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden';
}

export function getHandleGutter(view: EditorView): HTMLElement | null {
    const candidates = Array.from(view.dom.querySelectorAll<HTMLElement>(`.${HANDLE_GUTTER_CLASS}`));
    return candidates.find((candidate) => (
        candidate.closest(CODEMIRROR_EDITOR_SELECTOR) === view.dom
        && isVisible(candidate)
    )) ?? null;
}

export function placeHandleGutterForConfiguredSide(view: EditorView, side: HandleGutterSide): void {
    const gutter = getHandleGutter(view);
    if (!gutter) return;

    const parent = view.contentDOM.parentElement;
    if (!parent) return;

    const anchor = view.contentDOM;
    const placement = HANDLE_GUTTER_PLACEMENT_BY_SIDE[side];

    if (gutter.parentElement === parent && gutter[placement.adjacentAnchor] === anchor) return;
    parent.insertBefore(gutter, placement.getReferenceNode(anchor));
}
