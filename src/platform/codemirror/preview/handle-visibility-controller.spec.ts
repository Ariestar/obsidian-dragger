// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { describe, expect, it, vi } from 'vitest';
import { BlockInfo, BlockType } from 'md-dragger/domain';
import { createHoverPointerSnapshot } from '../extension/hover-pointer-snapshot';
import {
    CODEMIRROR_GUTTER_ELEMENT_CLASS,
    CODEMIRROR_GUTTERS_BEFORE_CLASS,
    DRAG_SOURCE_LINE_CLASS,
    DRAG_SOURCE_LINE_SINGLE_CLASS,
    DRAG_SOURCE_LINE_FIRST_CLASS,
    DRAG_SOURCE_LINE_MIDDLE_CLASS,
    DRAG_SOURCE_LINE_LAST_CLASS,
    DRAG_SOURCE_EMBED_CLASS,
    HANDLE_GUTTER_CLASS,
} from '../../../shared/dom-selectors';
import { HandleVisibilityController } from './handle-visibility-controller';

function createBlock(startLine: number, endLine: number): BlockInfo {
    return {
        type: BlockType.Paragraph,
        startLine,
        endLine,
        from: 0,
        to: 0,
        indentLevel: 0,
        content: '',
    };
}

function createViewStub(lineCount = 8): { view: EditorView; lines: HTMLElement[] } {
    const root = document.createElement('div');
    root.className = 'cm-editor';
    const content = document.createElement('div');
    root.appendChild(content);
    document.body.appendChild(root);

    const texts = Array.from({ length: lineCount }, (_, i) => `line ${i + 1}`);
    const state = EditorState.create({ doc: texts.join('\n') });
    const lineEls: HTMLElement[] = [];
    for (const text of texts) {
        const lineEl = document.createElement('div');
        lineEl.className = 'cm-line';
        lineEl.textContent = text;
        content.appendChild(lineEl);
        lineEls.push(lineEl);
    }

    const posToLineIndex = new Map<number, number>();
    for (let i = 1; i <= state.doc.lines; i++) {
        posToLineIndex.set(state.doc.line(i).from, i - 1);
    }

    Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
            left: 0,
            top: 0,
            right: 400,
            bottom: 200,
            width: 400,
            height: 200,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        }),
    });
    Object.defineProperty(content, 'getBoundingClientRect', {
        configurable: true,
        value: () => ({
            left: 0,
            top: 0,
            right: 360,
            bottom: 200,
            width: 360,
            height: 200,
            x: 0,
            y: 0,
            toJSON: () => ({}),
        }),
    });

    const view = {
        dom: root,
        contentDOM: content,
        state,
        domAtPos: (pos: number) => {
            const lineIndex = posToLineIndex.get(pos) ?? 0;
            const node = lineEls[Math.max(0, Math.min(lineEls.length - 1, lineIndex))] ?? content;
            return { node, offset: 0 };
        },
        posAtDOM: (node: Node) => {
            const lineIndex = lineEls.findIndex((lineEl) => lineEl === node || lineEl.contains(node));
            if (lineIndex >= 0) {
                return state.doc.line(lineIndex + 1).from;
            }
            throw new Error('unknown node');
        },
    } as unknown as EditorView;

    return { view, lines: lineEls };
}

function appendHandleGutter(view: EditorView, side: 'left' | 'right' = 'left'): HTMLElement {
    const gutter = document.createElement('div');
    gutter.className = `cm-gutter ${HANDLE_GUTTER_CLASS}`;
    if (side === 'right') {
        view.contentDOM.parentElement?.appendChild(gutter);
        return gutter;
    }

    const gutters = document.createElement('div');
    gutters.className = `cm-gutters ${CODEMIRROR_GUTTERS_BEFORE_CLASS}`;
    gutters.appendChild(gutter);
    view.dom.appendChild(gutters);
    return gutter;
}

function appendHandleForLine(view: EditorView, lineNumber: number): HTMLElement {
    const gutter = appendHandleGutter(view);
    const marker = document.createElement('div');
    marker.className = `${CODEMIRROR_GUTTER_ELEMENT_CLASS} dnd-handle-gutter-marker`;
    marker.setAttribute('data-line-number', String(lineNumber));
    const handle = document.createElement('div');
    handle.className = 'dnd-drag-handle';
    handle.setAttribute('data-block-start', String(lineNumber - 1));
    marker.appendChild(handle);
    gutter.appendChild(marker);
    return handle;
}

function appendLineNumberForLine(view: EditorView, lineNumber: number): HTMLElement {
    const gutters = document.createElement('div');
    gutters.className = `cm-gutters ${CODEMIRROR_GUTTERS_BEFORE_CLASS}`;
    const gutter = document.createElement('div');
    gutter.className = 'cm-gutter cm-lineNumbers';
    const row = document.createElement('div');
    row.className = CODEMIRROR_GUTTER_ELEMENT_CLASS;
    row.setAttribute('data-line-number', String(lineNumber));
    row.setAttribute('aria-label', String(lineNumber));
    gutter.appendChild(row);
    gutters.appendChild(gutter);
    view.dom.appendChild(gutters);
    return row;
}

describe('HandleVisibilityController', () => {
    it('applies contiguous drag-source variant classes for a block range', () => {
        const { view, lines } = createViewStub(6);
        const controller = new HandleVisibilityController(view, {
            getBlockInfoForHandle: () => null,
            getLineNumberAtVerticalPosition: () => null,
            getDraggableBlockAtVerticalPosition: () => null,
            getVisibleHandleForBlockStart: () => null,
        });

        controller.enterGrabVisualStateForBlock(createBlock(1, 3), null);

        expect(lines[1].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(true);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(true);
        expect(lines[3].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(true);
        expect(lines[1].classList.contains(DRAG_SOURCE_LINE_FIRST_CLASS)).toBe(true);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_MIDDLE_CLASS)).toBe(true);
        expect(lines[3].classList.contains(DRAG_SOURCE_LINE_LAST_CLASS)).toBe(true);
        expect(lines[0].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);
        expect(lines[4].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);

        controller.clearGrabbedLineNumbers();

        expect(lines[1].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);
        expect(lines[3].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);
        expect(lines[1].classList.contains(DRAG_SOURCE_LINE_FIRST_CLASS)).toBe(false);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_MIDDLE_CLASS)).toBe(false);
        expect(lines[3].classList.contains(DRAG_SOURCE_LINE_LAST_CLASS)).toBe(false);
    });

    it('highlights disjoint block selection ranges without filling the gap', () => {
        const { view, lines } = createViewStub(7);
        const controller = new HandleVisibilityController(view, {
            getBlockInfoForHandle: () => null,
            getLineNumberAtVerticalPosition: () => null,
            getDraggableBlockAtVerticalPosition: () => null,
            getVisibleHandleForBlockStart: () => null,
        });

        controller.enterGrabVisualState([
            { startLineNumber: 1, endLineNumber: 1 },
            { startLineNumber: 4, endLineNumber: 5 },
        ], null);

        expect(lines[0].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(true);
        expect(lines[3].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(true);
        expect(lines[4].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(true);
        expect(lines[0].classList.contains(DRAG_SOURCE_LINE_SINGLE_CLASS)).toBe(true);
        expect(lines[3].classList.contains(DRAG_SOURCE_LINE_FIRST_CLASS)).toBe(true);
        expect(lines[4].classList.contains(DRAG_SOURCE_LINE_LAST_CLASS)).toBe(true);
        expect(lines[1].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);
        expect(lines[5].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);
    });

    it('re-applies drag-source class on refresh when grab state is active', () => {
        const { view, lines } = createViewStub(5);
        const controller = new HandleVisibilityController(view, {
            getBlockInfoForHandle: () => null,
            getLineNumberAtVerticalPosition: () => null,
            getDraggableBlockAtVerticalPosition: () => null,
            getVisibleHandleForBlockStart: () => null,
        });

        controller.enterGrabVisualStateForBlock(createBlock(2, 2), null);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(true);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_SINGLE_CLASS)).toBe(true);

        lines[2].classList.remove(DRAG_SOURCE_LINE_CLASS, DRAG_SOURCE_LINE_SINGLE_CLASS);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(false);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_SINGLE_CLASS)).toBe(false);

        controller.refreshGrabVisualState();
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_CLASS)).toBe(true);
        expect(lines[2].classList.contains(DRAG_SOURCE_LINE_SINGLE_CLASS)).toBe(true);
    });

    it('applies and clears drag-source class on rendered embed block for selected range', () => {
        const { view } = createViewStub(6);
        const embed = document.createElement('div');
        embed.className = 'cm-callout';
        view.dom.appendChild(embed);

        const originalPosAtDOM = view.posAtDOM.bind(view);
        (view as unknown as { posAtDOM: (node: Node, offset?: number) => number }).posAtDOM = (node: Node, offset?: number) => {
            if (node === embed || embed.contains(node)) {
                return view.state.doc.line(3).from;
            }
            return originalPosAtDOM(node, offset);
        };

        const controller = new HandleVisibilityController(view, {
            getBlockInfoForHandle: () => null,
            getLineNumberAtVerticalPosition: () => null,
            getDraggableBlockAtVerticalPosition: () => null,
            getVisibleHandleForBlockStart: () => null,
        });

        controller.enterGrabVisualStateForBlock(createBlock(2, 2), null);
        expect(embed.classList.contains(DRAG_SOURCE_EMBED_CLASS)).toBe(true);

        controller.clearGrabbedLineNumbers();
        expect(embed.classList.contains(DRAG_SOURCE_EMBED_CLASS)).toBe(false);
    });

    it('uses the configured handle gutter side for the hover interaction zone', () => {
        const { view } = createViewStub(4);
        appendHandleGutter(view, 'right');
        const controller = new HandleVisibilityController(view, {
            getBlockInfoForHandle: () => null,
            getLineNumberAtVerticalPosition: () => null,
            getDraggableBlockAtVerticalPosition: () => null,
            getVisibleHandleForBlockStart: () => null,
        });

        expect(controller.isPointerInHandleInteractionZone(createHoverPointerSnapshot(view, 16, 10, 'right'))).toBe(false);
        expect(controller.isPointerInHandleInteractionZone(createHoverPointerSnapshot(view, 344, 10, 'right'))).toBe(true);
    });

    it('reveals a hovered handle across the content row without hiding visible line numbers', () => {
        const { view } = createViewStub(4);
        const lineNumberEl = appendLineNumberForLine(view, 1);
        const handle = appendHandleForLine(view, 1);
        const controller = new HandleVisibilityController(view, {
            getBlockInfoForHandle: () => createBlock(0, 0),
            getLineNumberAtVerticalPosition: () => 1,
            getDraggableBlockAtVerticalPosition: () => createBlock(0, 0),
            getVisibleHandleForBlockStart: () => handle,
        });

        expect(view.dom.querySelector('.dnd-drag-handle[data-block-start="0"]')).toBe(handle);
        const resolved = controller.resolveVisibleHandleFromPointer(createHoverPointerSnapshot(view, 240, 10, 'left'));
        expect(resolved).toBe(handle);

        controller.setActiveVisibleHandle(handle);
        expect(lineNumberEl.className).toBe(CODEMIRROR_GUTTER_ELEMENT_CLASS);
    });

    it('keeps visible line numbers untouched while applying drag-source highlight', () => {
        const { view } = createViewStub(4);
        const lineNumberEl = appendLineNumberForLine(view, 2);
        const controller = new HandleVisibilityController(view, {
            getBlockInfoForHandle: () => null,
            getLineNumberAtVerticalPosition: () => null,
            getDraggableBlockAtVerticalPosition: () => null,
            getVisibleHandleForBlockStart: () => null,
        });

        controller.enterGrabVisualStateForBlock(createBlock(1, 1), null);
        expect(lineNumberEl.className).toBe(CODEMIRROR_GUTTER_ELEMENT_CLASS);

        controller.clearGrabbedLineNumbers();
        expect(lineNumberEl.className).toBe(CODEMIRROR_GUTTER_ELEMENT_CLASS);
    });

    it('reuses the active hovered block while pointer stays inside the same block', () => {
        const { view } = createViewStub(6);
        const handle = appendHandleForLine(view, 2);
        const getLineNumberAtVerticalPosition = vi.fn(() => 3);
        const getDraggableBlockAtVerticalPosition = vi.fn(() => createBlock(1, 3));
        const controller = new HandleVisibilityController(view, {
            getBlockInfoForHandle: () => createBlock(1, 3),
            getLineNumberAtVerticalPosition,
            getDraggableBlockAtVerticalPosition,
            getVisibleHandleForBlockStart: () => handle,
        });

        const firstSnapshot = createHoverPointerSnapshot(view, 240, 12, 'left');
        expect(controller.resolveVisibleHandleFromPointer(firstSnapshot)).toBe(handle);
        controller.setActiveVisibleHandle(handle);

        const secondSnapshot = createHoverPointerSnapshot(view, 240, 42, 'left');
        expect(controller.resolveVisibleHandleFromPointer(secondSnapshot)).toBe(handle);
        expect(getDraggableBlockAtVerticalPosition).toHaveBeenCalledTimes(1);
        expect(getLineNumberAtVerticalPosition).toHaveBeenCalledTimes(1);
    });

    it('switches from parent list handle to child list handle when moving downward into the child row', () => {
        const { view } = createViewStub(6);
        const parentHandle = appendHandleForLine(view, 1);
        const childHandle = appendHandleForLine(view, 2);
        const getLineNumberAtVerticalPosition = vi.fn((clientY: number) => clientY < 30 ? 1 : 2);
        const getDraggableBlockAtVerticalPosition = vi.fn((clientY: number) => clientY < 30
            ? createBlock(0, 2)
            : createBlock(1, 1));
        const controller = new HandleVisibilityController(view, {
            getBlockInfoForHandle: () => createBlock(0, 2),
            getLineNumberAtVerticalPosition,
            getDraggableBlockAtVerticalPosition,
            getVisibleHandleForBlockStart: (blockStart) => blockStart === 0 ? parentHandle : childHandle,
        });

        const parentSnapshot = createHoverPointerSnapshot(view, 240, 10, 'left');
        expect(controller.resolveVisibleHandleFromPointer(parentSnapshot)).toBe(parentHandle);
        controller.setActiveVisibleHandle(parentHandle);

        const childSnapshot = createHoverPointerSnapshot(view, 240, 42, 'left');
        expect(controller.resolveVisibleHandleFromPointer(childSnapshot)).toBe(childHandle);
        expect(getDraggableBlockAtVerticalPosition).toHaveBeenCalledTimes(2);
    });
});
