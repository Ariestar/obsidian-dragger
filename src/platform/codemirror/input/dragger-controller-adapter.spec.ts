// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { DraggerControllerAdapter } from './dragger-controller-adapter';
import {
    appendHandleForBlockStart,
    createBlock,
    createViewStub,
    dispatchPointer,
    registerMouseHandlerTestHooks,
    resolveBlockSelectionFromTestBlocks,
} from './dragger-controller-adapter.test-helpers';
import { RANGE_SELECTED_HANDLE_CLASS } from '../../../shared/dom-selectors';
import { platform } from '../../../plugin/platform';

registerMouseHandlerTestHooks();

describe('DraggerControllerAdapter', () => {
    it('connects ordinary CodeMirror handle drag through DraggerController facts and effects', () => {
        const view = createViewStub(6);
        const handle = appendHandleForBlockStart(view, 0);
        const sourceBlock = createBlock('- item', 0, 0);
        const beginPointerDragSession = vi.fn();
        const finishDragSession = vi.fn();
        const showDropPreview = vi.fn();
        const applyCommand = vi.fn();

        const adapter = new DraggerControllerAdapter(view, {
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({
                handle: () => sourceBlock,
                point: () => sourceBlock,
            }),
            isBlockInsideRenderedTableCell: () => false,
            resolveDropSnapshotAtPoint: (_clientX, _clientY) => ({
                target: { targetLineNumber: 2, placement: 'before' },
                rejectReason: null,
            }),
            buildBlockCommandAtPoint: (source, _clientX, _clientY) => ({
                type: 'command',
                command: {
                    type: 'move',
                    selection: source,
                    target: { targetLineNumber: 2, placement: 'before' },
                },
                drop: {
                    target: { targetLineNumber: 2, placement: 'before' },
                    rejectReason: null,
                },
            }),
            output: {
                showDropPreview,
                hideDropPreview: vi.fn(),
                applyCommand,
                emitLifecycle: vi.fn(),
                beginDragSession: beginPointerDragSession,
                finishDragSession,
            },
        });

        adapter.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 1,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 10,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 1,
            pointerType: 'mouse',
            clientX: 32,
            clientY: 10,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 1,
            pointerType: 'mouse',
            clientX: 32,
            clientY: 10,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(showDropPreview).toHaveBeenCalledWith(expect.objectContaining({
            ranges: [{ startLine: 0, endLine: 0 }],
        }), expect.objectContaining({
            target: { targetLineNumber: 2, placement: 'before' },
        }), 'mouse');
        expect(applyCommand).toHaveBeenCalledWith({
            type: 'move',
            selection: expect.objectContaining({
                ranges: [{ startLine: 0, endLine: 0 }],
            }),
            target: { targetLineNumber: 2, placement: 'before' },
        });
        expect(finishDragSession).toHaveBeenCalled();
        adapter.destroy();
    });

    it('reads gesture config dynamically from platform settings', () => {
        const view = createViewStub(6);
        const handle = appendHandleForBlockStart(view, 0);
        const sourceBlock = createBlock('- item', 0, 0);
        let mobileInput = false;
        const showDropPreview = vi.fn();
        const adapter = new DraggerControllerAdapter(view, {
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({
                handle: () => sourceBlock,
                point: () => sourceBlock,
            }),
            isBlockInsideRenderedTableCell: () => false,
            isMobileInput: () => mobileInput,
            isMobileDragModeEnabled: () => true,
            getMobileDragLongPressMs: () => 0,
            getMouseRangeSelectLongPressMs: () => 0,
            resolveDropSnapshotAtPoint: () => ({
                target: { targetLineNumber: 2, placement: 'before' },
                rejectReason: null,
            }),
            buildBlockCommandAtPoint: () => ({
                type: 'cancel',
                drop: { target: null, rejectReason: 'no_target' },
                reason: 'no_target',
            }),
            output: {
                showDropPreview,
                hideDropPreview: vi.fn(),
                applyCommand: vi.fn(),
                emitLifecycle: vi.fn(),
                beginDragSession: vi.fn(),
                finishDragSession: vi.fn(),
            },
        });

        adapter.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 11,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 10,
        });
        mobileInput = true;
        dispatchPointer(window, 'pointermove', {
            pointerId: 11,
            pointerType: 'mouse',
            clientX: 17,
            clientY: 10,
        });
        expect(showDropPreview).not.toHaveBeenCalled();

        dispatchPointer(window, 'pointermove', {
            pointerId: 11,
            pointerType: 'mouse',
            clientX: 21,
            clientY: 10,
        });

        expect(showDropPreview).toHaveBeenCalledWith(expect.objectContaining({
            ranges: [{ startLine: 0, endLine: 0 }],
        }), expect.objectContaining({
            target: { targetLineNumber: 2, placement: 'before' },
        }), 'mouse');
        adapter.destroy();
    });

    it('drives shift-handle range selection through DraggerController', () => {
        const view = createViewStub(6);
        const handle0 = appendHandleForBlockStart(view, 0);
        const handle1 = appendHandleForBlockStart(view, 1);
        const handle2 = appendHandleForBlockStart(view, 2);
        const handles = [handle0, handle1, handle2];
        const adapter = new DraggerControllerAdapter(view, {
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({
                handle: (handle) => {
                    const start = Number(handle.getAttribute('data-block-start'));
                    return createBlock(`line ${start + 1}`, start, start);
                },
                point: () => createBlock('- item', 0, 0),
            }),
            getVisibleHandleForBlockStart: (blockStart) => handles[blockStart] ?? null,
            isBlockInsideRenderedTableCell: () => false,
            isMultiLineSelectionEnabled: () => true,
            resolveDropSnapshotAtPoint: () => ({ target: null, rejectReason: 'no_target' }),
            buildBlockCommandAtPoint: () => ({ type: 'cancel', drop: { target: null, rejectReason: 'no_target' }, reason: 'no_target' }),
            output: {
                showDropPreview: vi.fn(),
                hideDropPreview: vi.fn(),
                applyCommand: vi.fn(),
                emitLifecycle: vi.fn(),
                beginDragSession: vi.fn(),
                finishDragSession: vi.fn(),
            },
        });

        adapter.attach();
        dispatchPointer(handle0, 'pointerdown', {
            pointerId: 2,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 10,
            shiftKey: true,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 2,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 50,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 2,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 50,
        });

        expect(handle0.classList.contains(RANGE_SELECTED_HANDLE_CLASS)).toBe(true);
        expect(handle1.classList.contains(RANGE_SELECTED_HANDLE_CLASS)).toBe(true);
        expect(handle2.classList.contains(RANGE_SELECTED_HANDLE_CLASS)).toBe(true);
        expect(adapter.pipelineState.type).toBe('selecting');
        adapter.destroy();
    });

    it('starts drag from a passive selected handle without platform phase logic', () => {
        const view = createViewStub(6);
        const handle0 = appendHandleForBlockStart(view, 0);
        const handle1 = appendHandleForBlockStart(view, 1);
        const handle2 = appendHandleForBlockStart(view, 2);
        const handles = [handle0, handle1, handle2];
        const beginPointerDragSession = vi.fn();
        const applyCommand = vi.fn();
        const adapter = new DraggerControllerAdapter(view, {
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({
                handle: (handle) => {
                    const start = Number(handle.getAttribute('data-block-start'));
                    return createBlock(`line ${start + 1}`, start, start);
                },
                point: () => createBlock('- item', 0, 0),
            }),
            getVisibleHandleForBlockStart: (blockStart) => handles[blockStart] ?? null,
            isBlockInsideRenderedTableCell: () => false,
            isMultiLineSelectionEnabled: () => true,
            resolveDropSnapshotAtPoint: () => ({
                target: { targetLineNumber: 5, placement: 'before' },
                rejectReason: null,
            }),
            buildBlockCommandAtPoint: (selection) => ({
                type: 'command',
                command: {
                    type: 'move',
                    selection,
                    target: { targetLineNumber: 5, placement: 'before' },
                },
                drop: {
                    target: { targetLineNumber: 5, placement: 'before' },
                    rejectReason: null,
                },
            }),
            output: {
                showDropPreview: vi.fn(),
                hideDropPreview: vi.fn(),
                applyCommand,
                emitLifecycle: vi.fn(),
                beginDragSession: beginPointerDragSession,
                finishDragSession: vi.fn(),
            },
        });

        adapter.attach();
        dispatchPointer(handle0, 'pointerdown', {
            pointerId: 3,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 10,
            shiftKey: true,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 3,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 50,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 3,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 50,
        });

        dispatchPointer(handle1, 'pointerdown', {
            pointerId: 4,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 4,
            pointerType: 'mouse',
            clientX: 36,
            clientY: 30,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 4,
            pointerType: 'mouse',
            clientX: 36,
            clientY: 30,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(applyCommand).toHaveBeenCalledWith(expect.objectContaining({
            type: 'move',
            selection: expect.objectContaining({
                ranges: [
                    { startLine: 0, endLine: 0 },
                    { startLine: 1, endLine: 1 },
                    { startLine: 2, endLine: 2 },
                ],
            }),
        }));
        adapter.destroy();
    });

    it('enters passive selection from the mobile toolbar through controller range facts', () => {
        platform.isMobile = true;
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 0);
        const sourceBlock = createBlock('line 1', 0, 0);
        const adapter = new DraggerControllerAdapter(view, {
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({
                handle: () => sourceBlock,
                point: () => sourceBlock,
            }),
            getVisibleHandleForBlockStart: () => handle,
            isBlockInsideRenderedTableCell: () => false,
            isMultiLineSelectionEnabled: () => true,
            isMobileInput: () => true,
            isMobileDragModeEnabled: () => true,
            resolveDropSnapshotAtPoint: () => ({ target: null, rejectReason: 'no_target' }),
            buildBlockCommandAtPoint: () => ({ type: 'cancel', drop: { target: null, rejectReason: 'no_target' }, reason: 'no_target' }),
            output: {
                showDropPreview: vi.fn(),
                hideDropPreview: vi.fn(),
                applyCommand: vi.fn(),
                emitLifecycle: vi.fn(),
                beginDragSession: vi.fn(),
                finishDragSession: vi.fn(),
            },
        });

        adapter.attach();
        const event = new CustomEvent('dnd:enter-mobile-selection-mode', {
            bubbles: true,
            detail: { handled: false },
        });
        view.dom.dispatchEvent(event);

        expect(event.detail.handled).toBe(true);
        expect(adapter.pipelineState.type).toBe('selecting');
        expect(handle.classList.contains(RANGE_SELECTED_HANDLE_CLASS)).toBe(true);
        expect(view.dom.querySelector('.dnd-mobile-selection-resize-handle-top')).not.toBeNull();
        expect(view.dom.querySelector('.dnd-mobile-selection-resize-handle-bottom')).not.toBeNull();
        platform.isMobile = false;
        adapter.destroy();
    });

    it('resizes passive selection from mobile resize handles without platform controller state', () => {
        platform.isMobile = true;
        const view = createViewStub(8);
        const handles = Array.from({ length: 6 }, (_, index) => appendHandleForBlockStart(view, index));
        const adapter = new DraggerControllerAdapter(view, {
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({
                handle: () => null,
                point: (_x, y) => {
                    const lineIndex = Math.max(0, Math.min(7, Math.floor(y / 20)));
                    return createBlock(`line ${lineIndex + 1}`, lineIndex, lineIndex);
                },
            }),
            getVisibleHandleForBlockStart: (blockStart) => handles[blockStart] ?? null,
            isBlockInsideRenderedTableCell: () => false,
            isMultiLineSelectionEnabled: () => true,
            isMobileInput: () => true,
            isMobileDragModeEnabled: () => true,
            resolveDropSnapshotAtPoint: () => ({ target: null, rejectReason: 'no_target' }),
            buildBlockCommandAtPoint: () => ({ type: 'cancel', drop: { target: null, rejectReason: 'no_target' }, reason: 'no_target' }),
            output: {
                showDropPreview: vi.fn(),
                hideDropPreview: vi.fn(),
                applyCommand: vi.fn(),
                emitLifecycle: vi.fn(),
                beginDragSession: vi.fn(),
                finishDragSession: vi.fn(),
            },
        });

        adapter.attach();
        view.dom.dispatchEvent(new CustomEvent('dnd:enter-mobile-selection-mode', {
            bubbles: true,
            detail: { handled: false },
        }));

        const bottomResizeHandle = view.dom.querySelector<HTMLElement>('.dnd-mobile-selection-resize-handle-bottom');
        expect(bottomResizeHandle).not.toBeNull();
        dispatchPointer(bottomResizeHandle!, 'pointerdown', {
            pointerId: 5,
            pointerType: 'touch',
            clientX: 12,
            clientY: 10,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 5,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 5,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });

        const selectedHandles = Array.from(view.dom.querySelectorAll<HTMLElement>('.dnd-range-selected-handle'));
        expect(selectedHandles).toHaveLength(6);
        for (const handle of handles) {
            expect(selectedHandles).toContain(handle);
        }
        expect(adapter.pipelineState.type).toBe('selecting');
        platform.isMobile = false;
        adapter.destroy();
    });
});
