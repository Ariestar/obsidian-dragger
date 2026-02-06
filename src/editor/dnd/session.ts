import { BlockInfo } from '../../types';
import { DROP_HIGHLIGHT_SELECTOR, DROP_INDICATOR_SELECTOR } from './selectors';

let activeDragSourceBlock: BlockInfo | null = null;

export function setActiveDragSourceBlock(block: BlockInfo | null): void {
    activeDragSourceBlock = block;
}

export function getActiveDragSourceBlock(): BlockInfo | null {
    return activeDragSourceBlock;
}

export function clearActiveDragSourceBlock(): void {
    activeDragSourceBlock = null;
}

export function hideDropVisuals(scope: ParentNode = document): void {
    scope.querySelectorAll<HTMLElement>(DROP_INDICATOR_SELECTOR).forEach((el) => {
        el.style.display = 'none';
    });
    scope.querySelectorAll<HTMLElement>(DROP_HIGHLIGHT_SELECTOR).forEach((el) => {
        el.style.display = 'none';
    });
}
