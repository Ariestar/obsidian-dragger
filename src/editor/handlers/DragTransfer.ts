import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../types';
import { getLineNumberElementForLine } from '../core/handle-position';
import {
    clearAllActiveDragSourceBlocks,
    clearActiveDragSourceBlock,
    getActiveDragSourceBlock,
    hideDropVisuals,
    setActiveDragSourceBlock,
} from '../core/session';
import { isPosInsideRenderedTableCell } from '../core/table-guard';
import { DRAGGING_BODY_CLASS, DRAG_GHOST_CLASS, DRAG_SOURCE_LINE_NUMBER_CLASS } from '../core/selectors';

const sourceLineMarkerByView = new WeakMap<EditorView, HTMLElement>();
const draggingViews = new Set<EditorView>();

export function beginDragSession(blockInfo: BlockInfo, view: EditorView): void {
    updateSourceLineNumberMarker(blockInfo.startLine + 1, view);
    setActiveDragSourceBlock(view, blockInfo);
    draggingViews.add(view);
    if (draggingViews.size > 0) {
        document.body.classList.add(DRAGGING_BODY_CLASS);
    }
}

export function finishDragSession(view?: EditorView): void {
    if (view) {
        finishDragSessionForView(view);
    } else {
        for (const activeView of Array.from(draggingViews)) {
            finishDragSessionForView(activeView);
        }
        clearAllActiveDragSourceBlocks();
    }

    if (draggingViews.size === 0) {
        document.body.classList.remove(DRAGGING_BODY_CLASS);
    }
    hideDropVisuals();
}

export function startDragFromHandle(
    e: DragEvent,
    view: EditorView,
    resolveBlockInfo: () => BlockInfo | null,
    handle?: HTMLElement | null
): boolean {
    if (!e.dataTransfer) return false;
    const blockInfo = resolveBlockInfo();
    if (!blockInfo) {
        e.preventDefault();
        return false;
    }
    if (isPosInsideRenderedTableCell(view, blockInfo.from, { skipLayoutRead: true })) {
        e.preventDefault();
        return false;
    }
    return startDragWithBlockInfo(e, blockInfo, view, handle ?? null);
}

export function getDragSourceBlockFromEvent(e: DragEvent, view?: EditorView): BlockInfo | null {
    if (!e.dataTransfer) return getActiveDragSourceBlock(view);
    const data = e.dataTransfer.getData('application/dnd-block');
    if (!data) return getActiveDragSourceBlock(view);
    try {
        return JSON.parse(data) as BlockInfo;
    } catch {
        return getActiveDragSourceBlock(view);
    }
}

function startDragWithBlockInfo(
    e: DragEvent,
    blockInfo: BlockInfo,
    view: EditorView,
    handle?: HTMLElement | null
): boolean {
    if (!e.dataTransfer) return false;
    beginDragSession(blockInfo, view);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', blockInfo.content);
    e.dataTransfer.setData('application/dnd-block', JSON.stringify(blockInfo));

    if (handle) {
        handle.setAttribute('data-block-start', String(blockInfo.startLine));
        handle.setAttribute('data-block-end', String(blockInfo.endLine));
    }

    const ghost = document.createElement('div');
    ghost.className = DRAG_GHOST_CLASS;
    ghost.textContent = blockInfo.content.slice(0, 50) + (blockInfo.content.length > 50 ? '...' : '');
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, 0, 0);
    setTimeout(() => ghost.remove(), 0);
    return true;
}

function finishDragSessionForView(view: EditorView): void {
    clearSourceLineNumberMarker(view);
    clearActiveDragSourceBlock(view);
    draggingViews.delete(view);
}

function updateSourceLineNumberMarker(lineNumber: number, view: EditorView): void {
    clearSourceLineNumberMarker(view);
    const lineEl = getLineNumberElementForLine(view, lineNumber);
    if (!lineEl) return;

    sourceLineMarkerByView.set(view, lineEl);
    lineEl.classList.add(DRAG_SOURCE_LINE_NUMBER_CLASS);
}

function clearSourceLineNumberMarker(view: EditorView): void {
    const marker = sourceLineMarkerByView.get(view);
    if (!marker) return;
    marker.classList.remove(DRAG_SOURCE_LINE_NUMBER_CLASS);
    sourceLineMarkerByView.delete(view);
}
