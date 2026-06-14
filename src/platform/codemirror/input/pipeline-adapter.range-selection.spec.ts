// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import { BlockInfo, BlockType } from '../../../domain/block/block-types';
import { type BlockSelection } from '../../../domain/selection/block-selection';
import { PipelineAdapter } from './pipeline-adapter';
import { platform } from '../../../plugin/platform';
import {
    registerMouseHandlerTestHooks,
    createBlock,
    createPipelineAdapterDeps,
    createViewStub,
    appendHandleForBlockStart,
    appendHandleGutterMarker,
    dispatchPointer,
    dispatchTouchMove,
    createRect,
    resolveBlockSelectionFromTestBlocks,
} from './pipeline-adapter.test-helpers';

registerMouseHandlerTestHooks();

describe('PipelineAdapter Range Selection', () => {
    it('supports mouse handle range selection and selected-handle removal', () => {
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 1);

        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const finishDragSession = vi.fn();
        const onDropPreview = vi.fn();
        const onHideDropPreview = vi.fn();
        const onPlatformCommit = vi.fn();
        const endBlock = createBlock('line 6', 5, 5);

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: (_x, y) => (y >= 100 ? endBlock : sourceBlock) }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession,
            onDropPreview,
            onHideDropPreview,
            onPlatformCommit,
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 7,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);

        dispatchPointer(window, 'pointermove', {
            pointerId: 7,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 7,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 7,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });
        expect(beginPointerDragSession).not.toHaveBeenCalled();

        const selectedHandle = view.dom.querySelector<HTMLElement>('.dnd-range-selected-handle');
        expect(selectedHandle).not.toBeNull();
        expect(selectedHandle?.querySelector<HTMLInputElement>(':scope > .dnd-selection-checkbox')?.checked).toBe(true);
        expect(view.dom.querySelector('.dnd-selection-floating-grip')).toBeNull();
        expect(handler.pipelineState.type).toBe('selecting');
        if (handler.pipelineState.type !== 'selecting') throw new Error('expected range selection');
        expect(handler.pipelineState.selection.selection.ranges[0].startLine).toBe(1);
        expect(handler.pipelineState.selection.selection.ranges.at(-1)?.endLine).toBe(5);

        dispatchPointer(selectedHandle!, 'pointerdown', {
            pointerId: 8,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 80,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 8,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 80,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        expect(onDropPreview).not.toHaveBeenCalled();
        expect(onPlatformCommit).not.toHaveBeenCalled();
        expect(finishDragSession).not.toHaveBeenCalled();
        expect(selectedHandle.classList.contains('dnd-range-selected-handle')).toBe(false);
        handler.destroy();
    });

    it('keeps content text unhighlighted after committing multi-block selection', () => {
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 1);
        appendHandleForBlockStart(view, 5);

        const sourceBlock = createBlock('- item', 1, 1);
        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => null }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 72,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 72,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 72,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });

        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).not.toHaveLength(0);
        expect(view.dom.querySelector('.dnd-range-selected-line')).toBeNull();
        handler.destroy();
    });

    it('marks selected handles for multi-line end blocks', () => {
        const view = createViewStub([
            'line 1',
            'anchor',
            'line 3',
            'line 4',
            '```ts',
            'const value = 1',
            '```',
            'tail',
        ]);
        const anchorHandle = appendHandleForBlockStart(view, 1, () => 22, 1);
        const codeBlockHandle = appendHandleForBlockStart(view, 4, () => 82, 6);

        const sourceBlock = createBlock('anchor', 1, 1);
        const codeBlock = createBlock('```ts', 4, 6);
        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({
                handle: (handle) => {
                    if (handle === anchorHandle) return sourceBlock;
                    if (handle === codeBlockHandle) return codeBlock;
                    return null;
                },
                point: (_x, y) => (y >= 110 ? codeBlock : sourceBlock),
            }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(anchorHandle, 'pointerdown', {
            pointerId: 73,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 73,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 125,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 73,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 125,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 73,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 125,
        });

        expect(anchorHandle.classList.contains('dnd-range-selected-handle')).toBe(true);
        expect(codeBlockHandle.classList.contains('dnd-range-selected-handle')).toBe(true);
        handler.destroy();
    });

    it('keeps committed range overlay active as a single endpoint when end handle is missing', () => {
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 1, () => 22);

        const sourceBlock = createBlock('- item', 1, 1);
        const endBlock = createBlock('- end', 5, 5);
        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: (_x, y) => (y >= 160 ? endBlock : sourceBlock) }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 74,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 74,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 182,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 74,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 182,
        });

        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).not.toHaveLength(0);
        handler.destroy();
    });

    it('does not use gutter marker as anchor when endpoint handle is unavailable', () => {
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 1, () => 22);
        appendHandleGutterMarker(view, 6, () => 100);

        const sourceBlock = createBlock('- item', 1, 1);
        const endBlock = createBlock('- end', 5, 5);
        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: (_x, y) => (y >= 100 ? endBlock : sourceBlock) }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 76,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 76,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 112,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 76,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 112,
        });

        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).not.toHaveLength(0);
        handler.destroy();
    });

    it('drags committed selection from a selected desktop handle after long-press', () => {
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 1);
        appendHandleForBlockStart(view, 5);

        const sourceBlock = createBlock('- item', 1, 1);
        const endBlock = createBlock('line 6', 5, 5);
        const beginPointerDragSession = vi.fn();
        const onDropPreview = vi.fn();
        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: (_x, y) => (y >= 100 ? endBlock : sourceBlock) }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview,
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 70,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 70,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 70,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });

        const selectedHandle = view.dom.querySelector<HTMLElement>('.dnd-range-selected-handle');
        expect(selectedHandle).not.toBeNull();
        expect(view.dom.querySelector('.dnd-selection-floating-grip')).toBeNull();

        dispatchPointer(selectedHandle!, 'pointerdown', {
            pointerId: 71,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 80,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 71,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 13,
            clientY: 80,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(0);
        expect(onDropPreview).not.toHaveBeenCalled();

        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 71,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 90,
            clientY: 80,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(onDropPreview).toHaveBeenCalledWith(90, 80, expect.objectContaining({
            ranges: [expect.objectContaining({
                startLine: 1,
                endLine: 5,
            })],
        }), 'mouse');
        handler.destroy();
    });

    it('supports immediate handle retargeting in committed desktop multi-select mode', () => {
        const view = createViewStub(8);
        const startHandle = appendHandleForBlockStart(view, 1);
        const endHandle = appendHandleForBlockStart(view, 5);

        const sourceBlock = createBlock('- item', 1, 1);
        const endBlock = createBlock('line 6', 5, 5);
        const beginPointerDragSession = vi.fn();

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: (handle) => (handle === endHandle ? endBlock : sourceBlock), point: (_x, y) => (y >= 100 ? endBlock : sourceBlock) }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(startHandle, 'pointerdown', {
            pointerId: 171,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 171,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 171,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });

        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).not.toHaveLength(0);

        dispatchPointer(endHandle, 'pointerdown', {
            pointerId: 172,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 172,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 172,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        expect(view.dom.querySelector('.dnd-selection-rail')).toBeNull();
        handler.destroy();
    });

    it('does not start drag from a selected desktop handle before long-press', () => {
        const view = createViewStub(8);
        const startHandle = appendHandleForBlockStart(view, 1);
        const endHandle = appendHandleForBlockStart(view, 5);

        const sourceBlock = createBlock('- item', 1, 1);
        const endBlock = createBlock('line 6', 5, 5);
        const beginPointerDragSession = vi.fn();
        const onDropPreview = vi.fn();

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: (handle) => (handle === endHandle ? endBlock : sourceBlock), point: (_x, y) => (y >= 100 ? endBlock : sourceBlock) }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview,
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(startHandle, 'pointerdown', {
            pointerId: 181,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 181,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 181,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });

        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).not.toHaveLength(0);

        dispatchPointer(endHandle, 'pointerdown', {
            pointerId: 182,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 182,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 182,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        expect(onDropPreview).not.toHaveBeenCalled();
        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).toHaveLength(0);
        handler.destroy();
    });

    it('drags committed desktop selection from a selected handle after long-press', () => {
        const view = createViewStub(8);
        const startHandle = appendHandleForBlockStart(view, 1);
        const endHandle = appendHandleForBlockStart(view, 5);

        const sourceBlock = createBlock('- item', 1, 1);
        const endBlock = createBlock('line 6', 5, 5);
        const beginPointerDragSession = vi.fn();
        const onPlatformCommit = vi.fn();

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: (handle) => (handle === endHandle ? endBlock : sourceBlock), point: (_x, y) => (y >= 100 ? endBlock : sourceBlock) }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit,
        }));

        handler.attach();
        dispatchPointer(startHandle, 'pointerdown', {
            pointerId: 281,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 281,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 281,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });

        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).not.toHaveLength(0);

        dispatchPointer(endHandle, 'pointerdown', {
            pointerId: 282,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 282,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 90,
            clientY: 105,
        });

        dispatchPointer(window, 'pointerup', {
            pointerId: 282,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 90,
            clientY: 105,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(beginPointerDragSession).toHaveBeenCalledWith(expect.objectContaining({
            ranges: [expect.objectContaining({
                startLine: 1,
                endLine: 5,
            })],
        }));
        expect(onPlatformCommit).toHaveBeenCalledTimes(1);
        expect(view.dom.querySelector('.dnd-selection-rail')).toBeNull();
        handler.destroy();
    });

    it('does not start drag from a selected desktop handle after small pointer jitter', () => {
        const view = createViewStub(8);
        const startHandle = appendHandleForBlockStart(view, 1);
        const endHandle = appendHandleForBlockStart(view, 5);

        const sourceBlock = createBlock('- item', 1, 1);
        const endBlock = createBlock('line 6', 5, 5);
        const beginPointerDragSession = vi.fn();
        const onDropPreview = vi.fn();

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: (handle) => (handle === endHandle ? endBlock : sourceBlock), point: (_x, y) => (y >= 100 ? endBlock : sourceBlock) }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview,
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(startHandle, 'pointerdown', {
            pointerId: 281,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 281,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 281,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });

        dispatchPointer(endHandle, 'pointerdown', {
            pointerId: 282,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 282,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 14,
            clientY: 106,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 282,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 90,
            clientY: 105,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(onDropPreview).toHaveBeenCalledWith(90, 105, expect.objectContaining({
            ranges: [expect.objectContaining({
                startLine: 1,
                endLine: 5,
            })],
        }), 'mouse');
        handler.destroy();
    });

    it('removes a selected desktop handle without starting drag', () => {
        const view = createViewStub(8);
        const startHandle = appendHandleForBlockStart(view, 1);
        const endHandle = appendHandleForBlockStart(view, 5);

        const sourceBlock = createBlock('- item', 1, 1);
        const endBlock = createBlock('line 6', 5, 5);
        const beginPointerDragSession = vi.fn();

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: (handle) => (handle === endHandle ? endBlock : sourceBlock), point: (_x, y) => (y >= 100 ? endBlock : sourceBlock) }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(startHandle, 'pointerdown', {
            pointerId: 191,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(120);
        dispatchPointer(window, 'pointermove', {
            pointerId: 191,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 191,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });

        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).not.toHaveLength(0);

        dispatchPointer(endHandle, 'pointerdown', {
            pointerId: 192,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });
        vi.advanceTimersByTime(120);
        dispatchPointer(window, 'pointerup', {
            pointerId: 192,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        expect(endHandle.classList.contains('dnd-range-selected-handle')).toBe(false);
        expect(startHandle.classList.contains('dnd-range-selected-handle')).toBe(true);
        handler.destroy();
    });

    it('does not downgrade stale handle mapping to point-based source resolution', () => {
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 1);
        appendHandleForBlockStart(view, 4);

        const sourceBlock = createBlock('- item', 1, 1);
        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => null, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 75,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 75,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 90,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 75,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 90,
        });

        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).toHaveLength(0);
        handler.destroy();
    });

    it('uses unified touch long-press drag flow for handle interactions', () => {
        platform.isMobile = true;
        const view = createViewStub(8);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        view.dom.appendChild(handle);

        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const finishDragSession = vi.fn();
        const onDropPreview = vi.fn();
        const onHideDropPreview = vi.fn();
        const onPlatformCommit = vi.fn();

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => null }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession,
            onDropPreview,
            onHideDropPreview,
            onPlatformCommit,
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 17,
            pointerType: 'touch',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(260);

        dispatchPointer(window, 'pointermove', {
            pointerId: 17,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 17,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });
        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(onPlatformCommit).toHaveBeenCalledTimes(1);
        expect(view.dom.querySelector('.dnd-selection-rail')).toBeNull();
        platform.isMobile = false;
        handler.destroy();
    });

    it('enters mobile selection from real handle long-press when text long-press selection is disabled', () => {
        platform.isMobile = true;
        const view = createViewStub(6);
        const handle = appendHandleForBlockStart(view, 1);
        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => null }),
            isBlockInsideRenderedTableCell: () => false,
            isMobileTextLongPressDragEnabled: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 181,
            pointerType: 'touch',
            clientX: 12,
            clientY: 30,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 181,
            pointerType: 'touch',
            clientX: 12,
            clientY: 30,
        });
        expect(handle.classList.contains('dnd-range-selected-handle')).toBe(false);

        dispatchPointer(handle, 'pointerdown', {
            pointerId: 182,
            pointerType: 'touch',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(920);
        dispatchPointer(window, 'pointerup', {
            pointerId: 182,
            pointerType: 'touch',
            clientX: 12,
            clientY: 30,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        expect(handle.classList.contains('dnd-range-selected-handle')).toBe(true);
        expect(view.dom.querySelector('.dnd-mobile-selection-resize-handle-top')).not.toBeNull();
        expect(view.dom.querySelector('.dnd-mobile-selection-resize-handle-bottom')).not.toBeNull();

        platform.isMobile = false;
        handler.destroy();
    });

    it('enters mobile selection from real handle long-press when text long-press selection is enabled', () => {
        platform.isMobile = true;
        const view = createViewStub(6);
        const handle = appendHandleForBlockStart(view, 1);
        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => null }),
            isBlockInsideRenderedTableCell: () => false,
            isMobileTextLongPressDragEnabled: () => true,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 183,
            pointerType: 'touch',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(920);
        dispatchPointer(window, 'pointerup', {
            pointerId: 183,
            pointerType: 'touch',
            clientX: 12,
            clientY: 30,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        expect(handle.classList.contains('dnd-range-selected-handle')).toBe(true);
        expect(view.dom.querySelector('.dnd-mobile-selection-resize-handle-top')).not.toBeNull();
        expect(view.dom.querySelector('.dnd-mobile-selection-resize-handle-bottom')).not.toBeNull();

        platform.isMobile = false;
        handler.destroy();
    });

    it('keeps mobile handle long-press duration aligned with drag flow', () => {
        platform.isMobile = true;
        const view = createViewStub(8);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        view.dom.appendChild(handle);

        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const onPlatformCommit = vi.fn();
        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => null }),
            isBlockInsideRenderedTableCell: () => false,
            getMultiLineSelectionLongPressMs: () => 1200,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit,
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 170,
            pointerType: 'touch',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(260);

        dispatchPointer(window, 'pointermove', {
            pointerId: 170,
            pointerType: 'touch',
            clientX: 90,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 170,
            pointerType: 'touch',
            clientX: 90,
            clientY: 105,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(onPlatformCommit).toHaveBeenCalledTimes(1);
        expect(view.dom.querySelector('.dnd-selection-rail')).toBeNull();
        platform.isMobile = false;
        handler.destroy();
    });

    it('keeps committed selection when pointerdown is not a selection command', () => {
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 1);
        appendHandleForBlockStart(view, 5);

        const sourceBlock = createBlock('- item', 1, 1);
        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => null }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 41,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 41,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 41,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });

        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).not.toHaveLength(0);

        dispatchPointer(view.contentDOM, 'pointerdown', {
            pointerId: 42,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 220,
            clientY: 40,
        });

        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).not.toHaveLength(0);
        expect(view.dom.querySelector('.dnd-range-selected-line')).toBeNull();
        handler.destroy();
    });

    it('shows mobile resize handles for mobile selection mode', () => {
        platform.isMobile = true;
        const view = createViewStub(8);
        appendHandleForBlockStart(view, 0);
        appendHandleForBlockStart(view, 1);

        const sourceBlock = createBlock('- item', 1, 1);
        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        const event = new CustomEvent('dnd:enter-mobile-selection-mode', {
            bubbles: true,
            detail: { handled: false },
        });
        view.dom.dispatchEvent(event);

        expect(event.detail.handled).toBe(true);
        expect(document.body.classList.contains('dnd-mobile-gesture-lock')).toBe(false);
        expect(view.dom.querySelector('.dnd-mobile-selection-bar')).toBeNull();
        expect(view.dom.querySelector('.dnd-range-selected-line')).toBeNull();
        expect(view.dom.querySelector('.dnd-drag-source-line')).not.toBeNull();
        expect(view.dom.querySelector('.dnd-mobile-selection-resize-handle-top')).not.toBeNull();
        expect(view.dom.querySelector('.dnd-mobile-selection-resize-handle-bottom')).not.toBeNull();
        platform.isMobile = false;
        handler.destroy();
    });

    it('suppresses editor input without locking scroll in passive mobile selection mode', () => {
        platform.isMobile = true;
        const view = createViewStub(8);
        view.contentDOM.setAttribute('contenteditable', 'true');
        appendHandleForBlockStart(view, 1);

        const sourceBlock = createBlock('- item', 1, 1);
        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => null }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        view.dom.dispatchEvent(new CustomEvent('dnd:enter-mobile-selection-mode', {
            bubbles: true,
            detail: { handled: false },
        }));

        expect(view.contentDOM.getAttribute('contenteditable')).toBe('false');
        expect(document.body.classList.contains('dnd-mobile-gesture-lock')).toBe(false);
        expect(dispatchTouchMove(window).defaultPrevented).toBe(false);

        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));

        expect(view.contentDOM.getAttribute('contenteditable')).toBe('true');
        platform.isMobile = false;
        handler.destroy();
    });

    it('keeps mobile resize handles hidden outside mobile', () => {
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 1);

        const sourceBlock = createBlock('- item', 1, 1);
        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => null }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 53,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 53,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 53,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });

        expect(view.dom.querySelector('.dnd-mobile-selection-bar')).toBeNull();
        expect(view.dom.querySelector('.dnd-mobile-selection-resize-handle-top')).toBeNull();
        expect(view.dom.querySelector('.dnd-mobile-selection-resize-handle-bottom')).toBeNull();
        handler.destroy();
    });

    it('keeps committed selection on touch content tap and editor input focus', () => {
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 1);
        appendHandleForBlockStart(view, 5);

        const sourceBlock = createBlock('- item', 1, 1);
        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => null }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 61,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 61,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 61,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });

        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).not.toHaveLength(0);

        dispatchPointer(view.contentDOM, 'pointerdown', {
            pointerId: 62,
            pointerType: 'touch',
            clientX: 220,
            clientY: 40,
        });

        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).not.toHaveLength(0);

        const input = document.createElement('textarea');
        view.dom.appendChild(input);
        input.dispatchEvent(new FocusEvent('focusin', { bubbles: true, cancelable: true }));

        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).not.toHaveLength(0);
        handler.destroy();
    });

    it('repositions committed selection overlay after scroll', () => {
        const view = createViewStub(8);
        (view as unknown as { scrollDOM?: HTMLElement }).scrollDOM = view.dom;
        let scrollOffset = 0;
        (view as unknown as { coordsAtPos: (pos: number) => { left: number; right: number; top: number; bottom: number } | null }).coordsAtPos = (pos: number) => {
            const line = view.state.doc.lineAt(pos);
            const top = (line.number - 1) * 20 - scrollOffset;
            return { left: 40, right: 120, top, bottom: top + 20 };
        };

        const handle = appendHandleForBlockStart(view, 1, () => 22 - scrollOffset);
        appendHandleForBlockStart(view, 5, () => 102 - scrollOffset);

        const sourceBlock = createBlock('- item', 1, 1);
        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => null }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 43,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 43,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 43,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });

        const selectedHandle = view.dom.querySelector<HTMLElement>('.dnd-range-selected-handle');
        expect(selectedHandle).not.toBeNull();
        const topBefore = selectedHandle!.getBoundingClientRect().top;

        scrollOffset = 40;
        view.dom.dispatchEvent(new Event('scroll'));
        vi.advanceTimersByTime(20);

        const topAfter = selectedHandle!.getBoundingClientRect().top;
        expect(topAfter).toBeLessThan(topBefore);
        handler.destroy();
    });

    it('keeps selection active when boundary handles are missing but middle selected handle is visible', () => {
        const view = createViewStub(12);
        (view as unknown as { scrollDOM?: HTMLElement }).scrollDOM = view.dom;
        const topHandle = appendHandleForBlockStart(view, 1, () => 22);
        const middleHandle = appendHandleForBlockStart(view, 4, () => 82);
        const bottomHandle = appendHandleForBlockStart(view, 7, () => 142);

        const sourceBlock = createBlock('line 2', 1, 1);
        const middleBlock = createBlock('line 5', 4, 4);
        const endBlock = createBlock('line 8', 7, 7);
        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({
                handle: (handle) => {
                    if (handle === topHandle) return sourceBlock;
                    if (handle === middleHandle) return middleBlock;
                    if (handle === bottomHandle) return endBlock;
                    return null;
                },
                point: (_x, y) => (y >= 140 ? endBlock : sourceBlock),
            }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(topHandle, 'pointerdown', {
            pointerId: 440,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 440,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 150,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 440,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 150,
        });

        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).not.toHaveLength(0);

        topHandle.remove();
        bottomHandle.remove();
        view.dom.dispatchEvent(new Event('scroll'));
        vi.advanceTimersByTime(20);

        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).not.toHaveLength(0);
        handler.destroy();
    });

    it('expands selection to whole list block when range touches any list line', () => {
        const view = createViewStub([
            'intro',
            '- parent',
            '  - child',
            'after',
            'tail',
        ]);
        const handle = appendHandleForBlockStart(view, 0);

        const sourceBlock: BlockInfo = {
            type: BlockType.Paragraph,
            startLine: 0,
            endLine: 0,
            from: 0,
            to: 5,
            indentLevel: 0,
            content: 'intro',
        };
        const listParentBlock: BlockInfo = {
            type: BlockType.ListItem,
            startLine: 1,
            endLine: 2,
            from: view.state.doc.line(2).from,
            to: view.state.doc.line(3).to,
            indentLevel: 0,
            content: '- parent\n  - child',
        };
        const beginPointerDragSession = vi.fn();
        const onDropPreview = vi.fn();

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: (_x, y) => (y >= 20 ? listParentBlock : sourceBlock) }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview,
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 9,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 10,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 9,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 25, // line 2: list parent
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 9,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 25,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 9,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 25,
        });
        expect(beginPointerDragSession).not.toHaveBeenCalled();

        const selectedHandle = view.dom.querySelector<HTMLElement>('.dnd-range-selected-handle');
        expect(selectedHandle).not.toBeNull();
        expect(handler.pipelineState.type).toBe('selecting');
        if (handler.pipelineState.type !== 'selecting') throw new Error('expected range selection');
        expect(handler.pipelineState.selection.selection.ranges[0].startLine).toBe(0);
        expect(handler.pipelineState.selection.selection.ranges.at(-1)?.endLine).toBe(2); // list child line must be included
        expect(onDropPreview).not.toHaveBeenCalled();
        handler.destroy();
    });

    it('captures rendered embed block during downward range selection without requiring blank line hit', () => {
        const view = createViewStub([
            'intro',
            'anchor',
            'before',
            'around',
            '> [!note] title',
            '> body',
            'tail',
        ]);
        const handle = appendHandleForBlockStart(view, 1, () => 22);
        appendHandleForBlockStart(view, 4, () => 82);

        const sourceBlock = createBlock('anchor', 1, 1);
        const calloutBlock = createBlock('> [!note] title\n> body', 4, 5);
        const beginPointerDragSession = vi.fn();
        const onDropPreview = vi.fn();

        const embed = document.createElement('div');
        embed.className = 'cm-callout';
        view.dom.appendChild(embed);
        Object.defineProperty(embed, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(120, 82, 220, 56),
        });

        Object.defineProperty(document, 'elementFromPoint', {
            configurable: true,
            writable: true,
            value: vi.fn((clientX: number, clientY: number) => {
                if (clientY >= 82 && clientY <= 138 && clientX >= 6 && clientX <= 240) {
                    return embed;
                }
                return null;
            }),
        });

        const originalPosAtCoords = view.posAtCoords.bind(view);
        (view as unknown as { posAtCoords: (coords: { x: number; y: number }) => number | null }).posAtCoords = (coords) => {
            if (coords.y >= 82 && coords.y <= 138) {
                // Simulate rendered block hit mismatch: point looks inside callout but resolves to previous line.
                return view.state.doc.line(4).from;
            }
            return originalPosAtCoords(coords);
        };

        const originalPosAtDOM = view.posAtDOM.bind(view);
        (view as unknown as { posAtDOM: (node: Node, offset?: number) => number }).posAtDOM = (node: Node, offset?: number) => {
            if (node === embed || embed.contains(node)) {
                return view.state.doc.line(5).from;
            }
            return originalPosAtDOM(node, offset);
        };

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: (_x, y) => (y >= 82 && y <= 138 ? calloutBlock : null) }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview,
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 11,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 11,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 92,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 11,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 92,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 11,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 92,
        });
        expect(beginPointerDragSession).not.toHaveBeenCalled();

        const selectedHandle = view.dom.querySelector<HTMLElement>('.dnd-range-selected-handle');
        expect(selectedHandle).not.toBeNull();
        expect(handler.pipelineState.type).toBe('selecting');
        if (handler.pipelineState.type !== 'selecting') throw new Error('expected range selection');
        expect(handler.pipelineState.selection.selection.ranges[0].startLine).toBe(1);
        expect(handler.pipelineState.selection.selection.ranges.at(-1)?.endLine).toBe(5);
        expect(onDropPreview).not.toHaveBeenCalled();
        handler.destroy();
    });

    it('keeps disjoint committed ranges as one ordered composite selection', () => {
        const view = createViewStub(12);
        const handleA = appendHandleForBlockStart(view, 1);
        const handleB = appendHandleForBlockStart(view, 7);

        const blockA = createBlock('line 2', 1, 1);
        const blockB = createBlock('line 8', 7, 7);
        const beginPointerDragSession = vi.fn();
        const onPlatformCommit = vi.fn();

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({
                handle: (handle) => {
                    if (handle === handleA) return blockA;
                    if (handle === handleB) return blockB;
                    return null;
                },
                point: () => null,
            }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit,
        }));

        handler.attach();

        dispatchPointer(handleA, 'pointerdown', {
            pointerId: 30,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 30,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 30,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });

        dispatchPointer(handleB, 'pointerdown', {
            pointerId: 31,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 150,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 31,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 150,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 31,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 150,
        });

        const selectedHandle = view.dom.querySelector<HTMLElement>('.dnd-range-selected-handle');
        expect(selectedHandle).not.toBeNull();

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        expect(handler.pipelineState.type).toBe('selecting');
        if (handler.pipelineState.type !== 'selecting') throw new Error('expected range selection');
        const composite = handler.pipelineState.selection.selection;
        expect(composite.ranges).toEqual([
            { startLine: 1, endLine: 1 },
            { startLine: 7, endLine: 7 },
        ]);
        expect(onPlatformCommit).not.toHaveBeenCalled();
        handler.destroy();
    });

    it('starts pointer drag from zero-delay mouse handle hold before long-press selection activates', () => {
        const view = createViewStub(6);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        view.dom.appendChild(handle);
        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const onDropPreview = vi.fn();
        const onPlatformCommit = vi.fn();

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => null }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview,
            onHideDropPreview: vi.fn(),
            onPlatformCommit,
        }));

        handler.attach();
        const downEvent = dispatchPointer(handle, 'pointerdown', {
            pointerId: 8,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        expect(downEvent.defaultPrevented).toBe(true);

        dispatchPointer(window, 'pointermove', {
            pointerId: 8,
            pointerType: 'mouse',
            clientX: 120,
            clientY: 30,
        });
        vi.advanceTimersByTime(400);
        dispatchPointer(window, 'pointerup', {
            pointerId: 8,
            pointerType: 'mouse',
            clientX: 120,
            clientY: 30,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(onDropPreview).toHaveBeenCalledTimes(1);
        expect(onDropPreview).toHaveBeenCalledWith(120, 30, expect.objectContaining({
            ranges: [expect.objectContaining({
                startLine: 1,
                endLine: 1,
            })],
            }), 'mouse');
        expect(onPlatformCommit).toHaveBeenCalledTimes(1);
        expect(view.dom.querySelector('.dnd-range-selected-handle')).toBeNull();
        expect(view.dom.querySelector('.dnd-selection-rail')).toBeNull();
        handler.destroy();
    });

    it('waits for mouse handle long-press before entering range selection', () => {
        const view = createViewStub(6);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        view.dom.appendChild(handle);
        const sourceBlock = createBlock('- item', 1, 1);

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 88,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });

        expect(handler.pipelineState.type).toBe('idle');
        expect(view.dom.querySelector('.dnd-range-selected-handle')).toBeNull();

        vi.advanceTimersByTime(259);
        expect(handler.pipelineState.type).toBe('idle');

        vi.advanceTimersByTime(1);
        expect(handler.pipelineState.type).toBe('selecting');

        dispatchPointer(window, 'pointerup', {
            pointerId: 88,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        handler.destroy();
    });

    it('triggers vibration when mobile long-press drag starts', () => {
        const view = createViewStub();
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        view.dom.appendChild(handle);

        const sourceBlock = createBlock();
        const beginPointerDragSession = vi.fn();
        const onDropPreview = vi.fn();
        const vibrate = vi.fn();
        Object.defineProperty(window.navigator, 'vibrate', {
            configurable: true,
            writable: true,
            value: vibrate,
        });

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => null }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview,
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        platform.isMobile = true;
        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 2,
            pointerType: 'touch',
            clientX: 32,
            clientY: 12,
        });
        vi.advanceTimersByTime(220);
        dispatchPointer(window, 'pointermove', {
            pointerId: 2,
            pointerType: 'touch',
            clientX: 45,
            clientY: 12,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 2,
            pointerType: 'touch',
            clientX: 45,
            clientY: 12,
        });
        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(onDropPreview).toHaveBeenCalledWith(45, 12, expect.objectContaining({
            ranges: [expect.objectContaining({
                startLine: 0,
                endLine: 0,
            })],
            }), 'touch');
        expect(vibrate).toHaveBeenCalledTimes(1);
        platform.isMobile = false;
        handler.destroy();
    });

    it('allows touch drag from text area long-press with a single selection stage', () => {
        const view = createViewStub(8);
        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const onDropPreview = vi.fn();
        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview,
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        const line = view.contentDOM.querySelector<HTMLElement>('.cm-line') ?? view.contentDOM;
        platform.isMobile = true;
        handler.attach();
        dispatchPointer(line, 'pointerdown', {
            pointerId: 52,
            pointerType: 'touch',
            clientX: 80,
            clientY: 8,
        });
        vi.advanceTimersByTime(220);
        dispatchPointer(window, 'pointermove', {
            pointerId: 52,
            pointerType: 'touch',
            clientX: 80,
            clientY: 60,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(onDropPreview).toHaveBeenCalledWith(80, 60, expect.any(Object), 'touch');
        handler.destroy();
    });

    it('uses pointer drag on mouse when multi-line selection is disabled', () => {
        const view = createViewStub(6);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        view.dom.appendChild(handle);

        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const onDropPreview = vi.fn();
        const onPlatformCommit = vi.fn();
        const finishDragSession = vi.fn();
        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => null }),
            isBlockInsideRenderedTableCell: () => false,
            isMultiLineSelectionEnabled: () => false,
            beginPointerDragSession,
            finishDragSession,
            onDropPreview,
            onHideDropPreview: vi.fn(),
            onPlatformCommit,
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 81,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(600);
        expect(beginPointerDragSession).not.toHaveBeenCalled();
        dispatchPointer(window, 'pointermove', {
            pointerId: 81,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 90,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 81,
            pointerType: 'mouse',
            clientX: 12,
            clientY: 90,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(onDropPreview).toHaveBeenCalledTimes(1);
        expect(onDropPreview).toHaveBeenCalledWith(12, 90, expect.objectContaining({
            ranges: [expect.objectContaining({
                startLine: 1,
                endLine: 1,
            })],
            }), 'mouse');
        expect(onPlatformCommit).toHaveBeenCalledTimes(1);
        expect(finishDragSession).toHaveBeenCalledTimes(1);
        expect(view.dom.querySelector('.dnd-selection-rail')).toBeNull();
        handler.destroy();
    });

    it('falls back to single-block touch drag when multi-line selection is disabled', () => {
        const view = createViewStub(8);
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        view.dom.appendChild(handle);

        const sourceBlock = createBlock('- item', 1, 1);
        const beginPointerDragSession = vi.fn();
        const onDropPreview = vi.fn();
        const onPlatformCommit = vi.fn();
        const finishDragSession = vi.fn();

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => null }),
            isBlockInsideRenderedTableCell: () => false,
            isMultiLineSelectionEnabled: () => false,
            beginPointerDragSession,
            finishDragSession,
            onDropPreview,
            onHideDropPreview: vi.fn(),
            onPlatformCommit,
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 82,
            pointerType: 'touch',
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(260);
        dispatchPointer(window, 'pointermove', {
            pointerId: 82,
            pointerType: 'touch',
            clientX: 90,
            clientY: 80,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 82,
            pointerType: 'touch',
            clientX: 90,
            clientY: 80,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(onDropPreview).toHaveBeenCalledWith(90, 80, expect.objectContaining({
            ranges: [expect.objectContaining({
                startLine: 1,
                endLine: 1,
            })],
            }), 'touch');
        expect(view.dom.querySelector('.dnd-selection-rail')).toBeNull();
        expect(onPlatformCommit).toHaveBeenCalledTimes(1);
        expect(finishDragSession).toHaveBeenCalledTimes(1);
        handler.destroy();
    });

    it('keeps mobile selection mode open and supports resize handles to extend selection', () => {
        platform.isMobile = true;
        const view = createViewStub(8);
        const startHandle = appendHandleForBlockStart(view, 0);
        const endHandle = appendHandleForBlockStart(view, 5);
        const sourceBlock = createBlock('- item', 0, 0);
        const endBlock = createBlock('line 6', 5, 5);
        const beginPointerDragSession = vi.fn();

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: (handle) => (handle === endHandle ? endBlock : sourceBlock), point: (_x, y) => (y >= 100 ? endBlock : sourceBlock) }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        const event = new CustomEvent('dnd:enter-mobile-selection-mode', {
            bubbles: true,
            detail: { handled: false },
        });
        view.dom.dispatchEvent(event);
        vi.runOnlyPendingTimers();

        expect(event.detail.handled).toBe(true);
        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).not.toHaveLength(0);
        expect(view.dom.querySelector('.dnd-mobile-selection-bar')).toBeNull();
        const bottomResizeHandle = view.dom.querySelector<HTMLElement>('.dnd-mobile-selection-resize-handle-bottom');
        expect(bottomResizeHandle).not.toBeNull();

        dispatchPointer(bottomResizeHandle!, 'pointerdown', {
            pointerId: 205,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });
        expect(document.body.classList.contains('dnd-mobile-gesture-lock')).toBe(true);
        dispatchPointer(window, 'pointermove', {
            pointerId: 205,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 205,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        const selectedHandles = Array.from(view.dom.querySelectorAll<HTMLElement>('.dnd-range-selected-handle'));
        expect(selectedHandles).toHaveLength(2);
        expect(selectedHandles).toContain(startHandle);
        expect(selectedHandles).toContain(endHandle);
        expect(view.dom.querySelector('.dnd-mobile-selection-bar')).toBeNull();
        platform.isMobile = false;
        handler.destroy();
    });

    it('drags highlighted mobile selection handles only after a second long-press', () => {
        platform.isMobile = true;
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 0);
        const sourceBlock = createBlock('- item', 0, 0);
        const beginPointerDragSession = vi.fn();
        const finishDragSession = vi.fn();
        const onDropPreview = vi.fn();
        const onPlatformCommit = vi.fn();

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            isMobileDragModeEnabled: () => true,
            beginPointerDragSession,
            finishDragSession,
            onDropPreview,
            onHideDropPreview: vi.fn(),
            onPlatformCommit,
        }));

        handler.attach();
        view.dom.dispatchEvent(new CustomEvent('dnd:enter-mobile-selection-mode', {
            bubbles: true,
            detail: { handled: false },
        }));

        expect(handle.classList.contains('dnd-range-selected-handle')).toBe(true);
        expect(view.dom.querySelector('.dnd-range-selected-line')).toBeNull();
        expect(view.dom.querySelector('.dnd-drag-source-line')).not.toBeNull();

        dispatchPointer(handle, 'pointerdown', {
            pointerId: 401,
            pointerType: 'touch',
            clientX: 12,
            clientY: 10,
        });
        expect(document.body.classList.contains('dnd-mobile-gesture-lock')).toBe(true);
        dispatchPointer(window, 'pointermove', {
            pointerId: 401,
            pointerType: 'touch',
            clientX: 12,
            clientY: 15,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        expect(onDropPreview).not.toHaveBeenCalled();

        vi.advanceTimersByTime(130);
        dispatchPointer(window, 'pointermove', {
            pointerId: 401,
            pointerType: 'touch',
            clientX: 12,
            clientY: 30,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(onDropPreview).toHaveBeenCalledWith(12, 30, expect.objectContaining({
            ranges: [expect.objectContaining({
                startLine: 0,
                endLine: 0,
            })],
            }), 'touch');

        dispatchPointer(window, 'pointerup', {
            pointerId: 401,
            pointerType: 'touch',
            clientX: 12,
            clientY: 30,
        });

        expect(onPlatformCommit).toHaveBeenCalledTimes(1);
        expect(finishDragSession).toHaveBeenCalledTimes(1);
        expect(document.body.classList.contains('dnd-mobile-gesture-lock')).toBe(false);
        platform.isMobile = false;
        handler.destroy();
    });

    it('does not drag selected mobile handles after mobile drag mode becomes disabled', () => {
        platform.isMobile = true;
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 0);
        const sourceBlock = createBlock('- item', 0, 0);
        const beginPointerDragSession = vi.fn();
        let mobileDragModeEnabled = true;

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            isMobileDragModeEnabled: () => mobileDragModeEnabled,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        view.dom.dispatchEvent(new CustomEvent('dnd:enter-mobile-selection-mode', {
            bubbles: true,
            detail: { handled: false },
        }));
        mobileDragModeEnabled = false;

        dispatchPointer(handle, 'pointerdown', {
            pointerId: 405,
            pointerType: 'touch',
            clientX: 12,
            clientY: 10,
        });
        vi.advanceTimersByTime(130);
        dispatchPointer(window, 'pointermove', {
            pointerId: 405,
            pointerType: 'touch',
            clientX: 12,
            clientY: 30,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        platform.isMobile = false;
        handler.destroy();
    });

    it('keeps mobile selection highlight visible while dragging from selected handles', () => {
        platform.isMobile = true;
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 0);
        const sourceBlock = createBlock('- item', 0, 0);
        const beginPointerDragSession = vi.fn();
        const onDropPreview = vi.fn();

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview,
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        view.dom.dispatchEvent(new CustomEvent('dnd:enter-mobile-selection-mode', {
            bubbles: true,
            detail: { handled: false },
        }));

        expect(handle.classList.contains('dnd-range-selected-handle')).toBe(true);
        expect(view.dom.querySelector('.dnd-range-selected-line')).toBeNull();
        expect(view.dom.querySelector('.dnd-drag-source-line')).not.toBeNull();
        expect(view.dom.querySelector('.dnd-mobile-selection-resize-handle-top')).not.toBeNull();
        expect(view.dom.querySelector('.dnd-mobile-selection-resize-handle-bottom')).not.toBeNull();

        dispatchPointer(handle, 'pointerdown', {
            pointerId: 402,
            pointerType: 'touch',
            clientX: 12,
            clientY: 10,
        });
        vi.advanceTimersByTime(5000);
        expect(handle.classList.contains('dnd-range-selected-handle')).toBe(true);
        expect(view.dom.querySelector('.dnd-range-selected-line')).toBeNull();
        expect(view.dom.querySelector('.dnd-drag-source-line')).not.toBeNull();

        dispatchPointer(window, 'pointermove', {
            pointerId: 402,
            pointerType: 'touch',
            clientX: 12,
            clientY: 30,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        expect(onDropPreview).toHaveBeenCalledWith(12, 30, expect.objectContaining({
            ranges: [expect.objectContaining({
                startLine: 0,
                endLine: 0,
            })],
            }), 'touch');
        expect(handle.classList.contains('dnd-range-selected-handle')).toBe(true);
        expect(view.dom.querySelector('.dnd-range-selected-line')).toBeNull();
        expect(view.dom.querySelector('.dnd-drag-source-line')).not.toBeNull();

        platform.isMobile = false;
        handler.destroy();
    });

    it('keeps mobile committed selection visuals during committed selection refresh', () => {
        platform.isMobile = true;
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 0);
        const sourceBlock = createBlock('- item', 0, 0);

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        view.dom.dispatchEvent(new CustomEvent('dnd:enter-mobile-selection-mode', {
            bubbles: true,
            detail: { handled: false },
        }));

        expect(view.dom.querySelector('.dnd-drag-source-line')).not.toBeNull();
        expect(view.dom.querySelector('.dnd-mobile-selection-resize-handle-top')).not.toBeNull();
        expect(view.dom.querySelector('.dnd-mobile-selection-resize-handle-bottom')).not.toBeNull();

        dispatchPointer(handle, 'pointerdown', {
            pointerId: 409,
            pointerType: 'touch',
            clientX: 12,
            clientY: 10,
        });
        expect(handler.pipelineState.type).toBe('holding');

        handler.refreshSelectionVisual();
        vi.runOnlyPendingTimers();

        expect(view.dom.querySelector('.dnd-drag-source-line')).not.toBeNull();
        expect(view.dom.querySelector('.dnd-mobile-selection-resize-handle-top')).not.toBeNull();
        expect(view.dom.querySelector('.dnd-mobile-selection-resize-handle-bottom')).not.toBeNull();

        platform.isMobile = false;
        handler.destroy();
    });

    it('drags the whole mobile selection from selected text long-press', () => {
        platform.isMobile = true;
        const view = createViewStub(8);
        const firstLine = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')[0];
        expect(firstLine).not.toBeNull();
        const firstHandle = appendHandleForBlockStart(view, 0);
        const farHandle = appendHandleForBlockStart(view, 5);
        const firstBlock = createBlock('line 1', 0, 0);
        const farBlock = createBlock('line 6', 5, 5);
        const beginPointerDragSession = vi.fn();
        const onDropPreview = vi.fn();

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({
                handle: (handle) => (handle === farHandle ? farBlock : firstBlock),
                point: (_x, y) => (y >= 100 ? farBlock : firstBlock),
            }),
            isBlockInsideRenderedTableCell: () => false,
            isMobileDragModeEnabled: () => true,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview,
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        view.dom.dispatchEvent(new CustomEvent('dnd:enter-mobile-selection-mode', {
            bubbles: true,
            detail: { handled: false },
        }));
        vi.runOnlyPendingTimers();

        dispatchPointer(farHandle, 'pointerdown', {
            pointerId: 501,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 501,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });

        expect(firstHandle.classList.contains('dnd-range-selected-handle')).toBe(true);
        expect(farHandle.classList.contains('dnd-range-selected-handle')).toBe(true);
        expect(firstLine.classList.contains('dnd-drag-source-line')).toBe(true);

        dispatchPointer(firstLine, 'pointerdown', {
            pointerId: 502,
            pointerType: 'touch',
            clientX: 120,
            clientY: 10,
        });
        vi.advanceTimersByTime(130);
        dispatchPointer(window, 'pointermove', {
            pointerId: 502,
            pointerType: 'touch',
            clientX: 120,
            clientY: 36,
        });

        expect(beginPointerDragSession).toHaveBeenCalledTimes(1);
        const selectedBlock = beginPointerDragSession.mock.calls[0][0] as BlockSelection;
        expect(selectedBlock.ranges).toEqual([
            { startLine: 0, endLine: 0 },
            { startLine: 5, endLine: 5 },
        ]);
        expect(onDropPreview).toHaveBeenCalledWith(120, 36, expect.objectContaining({
            ranges: [
                expect.objectContaining({ startLine: 0, endLine: 0 }),
                expect.objectContaining({ startLine: 5, endLine: 5 }),
            ],
        }), 'touch');

        platform.isMobile = false;
        handler.destroy();
    });

    it('extends and shrinks mobile selection from segment top and bottom handles', () => {
        platform.isMobile = true;
        const view = createViewStub(8);
        const lineHandles = [
            appendHandleForBlockStart(view, 0),
            appendHandleForBlockStart(view, 1),
            appendHandleForBlockStart(view, 2),
            appendHandleForBlockStart(view, 3),
            appendHandleForBlockStart(view, 4),
            appendHandleForBlockStart(view, 5),
        ];
        const beginPointerDragSession = vi.fn();

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({
                handle: () => null,
                point: (_x, y) => {
                    const lineIndex = Math.max(0, Math.min(7, Math.floor(y / 20)));
                    return createBlock(`line ${lineIndex + 1}`, lineIndex, lineIndex);
                },
            }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession,
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        view.dom.dispatchEvent(new CustomEvent('dnd:enter-mobile-selection-mode', {
            bubbles: true,
            detail: { handled: false },
        }));
        vi.runOnlyPendingTimers();

        const bottomResizeHandle = view.dom.querySelector<HTMLElement>('.dnd-mobile-selection-resize-handle-bottom');
        expect(bottomResizeHandle).not.toBeNull();
        dispatchPointer(bottomResizeHandle!, 'pointerdown', {
            pointerId: 207,
            pointerType: 'touch',
            clientX: 12,
            clientY: 10,
        });
        expect(document.body.classList.contains('dnd-mobile-gesture-lock')).toBe(true);
        dispatchPointer(window, 'pointermove', {
            pointerId: 207,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 207,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });
        expect(document.body.classList.contains('dnd-mobile-gesture-lock')).toBe(false);
        dispatchPointer(view.dom, 'lostpointercapture', {
            pointerId: 207,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });

        expect(beginPointerDragSession).not.toHaveBeenCalled();
        let selectedHandles = Array.from(view.dom.querySelectorAll<HTMLElement>('.dnd-range-selected-handle'));
        expect(selectedHandles).toHaveLength(6);
        for (const handle of lineHandles) {
            expect(selectedHandles).toContain(handle);
        }
        expect(view.dom.querySelectorAll('.dnd-mobile-selection-resize-handle-top.is-active')).toHaveLength(1);
        expect(view.dom.querySelectorAll('.dnd-mobile-selection-resize-handle-bottom.is-active')).toHaveLength(1);

        const topResizeHandle = view.dom.querySelector<HTMLElement>('.dnd-mobile-selection-resize-handle-top');
        expect(topResizeHandle).not.toBeNull();
        dispatchPointer(topResizeHandle!, 'pointerdown', {
            pointerId: 208,
            pointerType: 'touch',
            clientX: 12,
            clientY: 10,
        });
        expect(document.body.classList.contains('dnd-mobile-gesture-lock')).toBe(true);
        dispatchPointer(window, 'pointermove', {
            pointerId: 208,
            pointerType: 'touch',
            clientX: 12,
            clientY: 50,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 208,
            pointerType: 'touch',
            clientX: 12,
            clientY: 50,
        });
        expect(document.body.classList.contains('dnd-mobile-gesture-lock')).toBe(false);
        dispatchPointer(view.dom, 'lostpointercapture', {
            pointerId: 208,
            pointerType: 'touch',
            clientX: 12,
            clientY: 50,
        });

        selectedHandles = Array.from(view.dom.querySelectorAll<HTMLElement>('.dnd-range-selected-handle'));
        expect(selectedHandles).toHaveLength(4);
        for (const handle of lineHandles.slice(2, 6)) {
            expect(selectedHandles).toContain(handle);
        }
        expect(selectedHandles).not.toContain(lineHandles[0]);
        expect(selectedHandles).not.toContain(lineHandles[1]);
        expect(view.dom.querySelectorAll('.dnd-mobile-selection-resize-handle-top.is-active')).toHaveLength(1);
        expect(view.dom.querySelectorAll('.dnd-mobile-selection-resize-handle-bottom.is-active')).toHaveLength(1);
        expect(view.dom.querySelector<HTMLElement>('.dnd-mobile-selection-resize-handle-top')?.getAttribute('data-dnd-mobile-selection-start-line')).toBe('3');
        expect(view.dom.querySelector<HTMLElement>('.dnd-mobile-selection-resize-handle-bottom')?.getAttribute('data-dnd-mobile-selection-end-line')).toBe('6');

        const shrinkBottomHandle = view.dom.querySelector<HTMLElement>('.dnd-mobile-selection-resize-handle-bottom');
        expect(shrinkBottomHandle).not.toBeNull();
        dispatchPointer(shrinkBottomHandle!, 'pointerdown', {
            pointerId: 209,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointermove', {
            pointerId: 209,
            pointerType: 'touch',
            clientX: 12,
            clientY: 70,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 209,
            pointerType: 'touch',
            clientX: 12,
            clientY: 70,
        });

        selectedHandles = Array.from(view.dom.querySelectorAll<HTMLElement>('.dnd-range-selected-handle'));
        expect(selectedHandles).toHaveLength(2);
        expect(selectedHandles).toContain(lineHandles[2]);
        expect(selectedHandles).toContain(lineHandles[3]);
        expect(view.dom.querySelector<HTMLElement>('.dnd-mobile-selection-resize-handle-top')?.getAttribute('data-dnd-mobile-selection-start-line')).toBe('3');
        expect(view.dom.querySelector<HTMLElement>('.dnd-mobile-selection-resize-handle-bottom')?.getAttribute('data-dnd-mobile-selection-end-line')).toBe('4');
        platform.isMobile = false;
        handler.destroy();
    });

    it('adds disjoint mobile selection ranges from unselected handles', () => {
        platform.isMobile = true;
        const view = createViewStub(8);
        const firstHandle = appendHandleForBlockStart(view, 0);
        const middleHandle = appendHandleForBlockStart(view, 1);
        const farHandle = appendHandleForBlockStart(view, 5);
        const firstBlock = createBlock('line 1', 0, 0);
        const middleBlock = createBlock('line 2', 1, 1);
        const farBlock = createBlock('line 6', 5, 5);

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({
                handle: (handle) => {
                    if (handle === firstHandle) return firstBlock;
                    if (handle === middleHandle) return middleBlock;
                    if (handle === farHandle) return farBlock;
                    return null;
                },
                point: () => firstBlock,
            }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        view.dom.dispatchEvent(new CustomEvent('dnd:enter-mobile-selection-mode', {
            bubbles: true,
            detail: { handled: false },
        }));
        vi.runOnlyPendingTimers();

        dispatchPointer(farHandle, 'pointerdown', {
            pointerId: 209,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });
        expect(document.body.classList.contains('dnd-mobile-gesture-lock')).toBe(true);
        dispatchPointer(window, 'pointerup', {
            pointerId: 209,
            pointerType: 'touch',
            clientX: 12,
            clientY: 105,
        });

        const selectedHandles = Array.from(view.dom.querySelectorAll<HTMLElement>('.dnd-range-selected-handle'));
        expect(selectedHandles).toContain(firstHandle);
        expect(selectedHandles).toContain(farHandle);
        expect(selectedHandles).not.toContain(middleHandle);
        expect(selectedHandles).toHaveLength(2);
        expect(view.dom.querySelectorAll('.dnd-drag-source-line')).toHaveLength(2);
        const topResizeHandles = Array.from(view.dom.querySelectorAll<HTMLElement>('.dnd-mobile-selection-resize-handle-top.is-active'));
        const bottomResizeHandles = Array.from(view.dom.querySelectorAll<HTMLElement>('.dnd-mobile-selection-resize-handle-bottom.is-active'));
        expect(topResizeHandles.map((handle) => handle.getAttribute('data-dnd-mobile-selection-start-line'))).toEqual(['1', '6']);
        expect(bottomResizeHandles.map((handle) => handle.getAttribute('data-dnd-mobile-selection-start-line'))).toEqual(['1', '6']);
        expect(topResizeHandles.map((handle) => handle.parentElement?.classList.contains('dnd-handle-gutter-marker'))).toEqual([true, true]);
        expect(bottomResizeHandles.map((handle) => handle.parentElement?.classList.contains('dnd-handle-gutter-marker'))).toEqual([true, true]);
        expect(topResizeHandles.some((handle) => view.contentDOM.contains(handle))).toBe(false);
        expect(bottomResizeHandles.some((handle) => view.contentDOM.contains(handle))).toBe(false);
        expect(topResizeHandles.every((handle) => handle.style.getPropertyValue('--dnd-selection-resize-handle-left') !== '')).toBe(true);
        expect(bottomResizeHandles.every((handle) => handle.style.getPropertyValue('--dnd-selection-resize-handle-left') !== '')).toBe(true);
        expect(document.body.classList.contains('dnd-mobile-gesture-lock')).toBe(false);
        expect(dispatchTouchMove(window).defaultPrevented).toBe(false);

        platform.isMobile = false;
        handler.destroy();
    });

    it('exits mobile selection when parent mobile drag mode becomes unavailable', () => {
        platform.isMobile = true;
        const view = createViewStub(8);
        view.contentDOM.setAttribute('contenteditable', 'true');
        const handle = appendHandleForBlockStart(view, 0);
        const sourceBlock = createBlock('line 1', 0, 0);

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({
                handle: () => sourceBlock,
                point: () => sourceBlock,
            }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        view.dom.dispatchEvent(new CustomEvent('dnd:enter-mobile-selection-mode', {
            bubbles: true,
            detail: { handled: false },
        }));

        expect(handle.classList.contains('dnd-range-selected-handle')).toBe(true);
        expect(view.dom.querySelector('.dnd-drag-source-line')).not.toBeNull();
        expect(view.contentDOM.getAttribute('contenteditable')).toBe('false');
        expect(handler.pipelineState.type).toBe('selecting');
        if (handler.pipelineState.type === 'selecting') {
            expect(handler.pipelineState.selection.phase).toBe('passive');
        }

        handler.handleMobileDragAvailabilityChanged(false);

        expect(handle.classList.contains('dnd-range-selected-handle')).toBe(false);
        expect(view.dom.querySelector('.dnd-drag-source-line')).toBeNull();
        expect(view.dom.querySelector('.dnd-mobile-selection-resize-handle-top.is-active')).toBeNull();
        expect(view.dom.querySelector('.dnd-mobile-selection-resize-handle-bottom.is-active')).toBeNull();
        expect(view.contentDOM.getAttribute('contenteditable')).toBe('true');

        platform.isMobile = false;
        handler.destroy();
    });

    it('adds disjoint mobile selection ranges from unselected text long-long-press without clearing short taps', () => {
        platform.isMobile = true;
        const view = createViewStub(8);
        const farLine = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')[5];
        expect(farLine).not.toBeNull();
        const firstHandle = appendHandleForBlockStart(view, 0);
        const secondHandle = appendHandleForBlockStart(view, 1);
        const farHandle = appendHandleForBlockStart(view, 5);
        const firstBlock = createBlock('line 1', 0, 0);
        const secondBlock = createBlock('line 2', 1, 1);
        const farBlock = createBlock('line 6', 5, 5);

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({
                handle: () => null,
                point: (_x, y) => {
                    if (!Number.isFinite(y)) return null;
                    if (y >= 100) return farBlock;
                    if (y >= 20) return secondBlock;
                    return firstBlock;
                },
            }),
            isBlockInsideRenderedTableCell: () => false,
            isMobileDragModeEnabled: () => true,
            isMobileTextLongPressDragEnabled: () => true,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        view.dom.dispatchEvent(new CustomEvent('dnd:enter-mobile-selection-mode', {
            bubbles: true,
            detail: { handled: false },
        }));
        vi.runOnlyPendingTimers();

        const shortTapDown = dispatchPointer(farLine, 'pointerdown', {
            pointerId: 301,
            pointerType: 'touch',
            clientX: 340,
            clientY: 105,
        });
        expect(shortTapDown.defaultPrevented).toBe(true);
        dispatchPointer(window, 'pointerup', {
            pointerId: 301,
            pointerType: 'touch',
            clientX: 340,
            clientY: 105,
        });

        let selectedHandles = Array.from(view.dom.querySelectorAll<HTMLElement>('.dnd-range-selected-handle'));
        expect(selectedHandles).toContain(firstHandle);
        expect(selectedHandles).not.toContain(secondHandle);
        expect(selectedHandles).toHaveLength(1);
        expect(view.dom.querySelector('.dnd-range-selected-line')).toBeNull();
        expect(view.dom.querySelectorAll('.dnd-drag-source-line')).toHaveLength(1);

        const contentTouchMove = dispatchTouchMove(window);
        expect(contentTouchMove.defaultPrevented).toBe(false);

        const longPressDown = dispatchPointer(farLine, 'pointerdown', {
            pointerId: 302,
            pointerType: 'touch',
            clientX: 340,
            clientY: 105,
        });
        expect(longPressDown.defaultPrevented).toBe(true);
        vi.advanceTimersByTime(920);
        dispatchPointer(window, 'pointerup', {
            pointerId: 302,
            pointerType: 'touch',
            clientX: 340,
            clientY: 105,
        });

        selectedHandles = Array.from(view.dom.querySelectorAll<HTMLElement>('.dnd-range-selected-handle'));
        expect(selectedHandles).toContain(firstHandle);
        expect(selectedHandles).not.toContain(secondHandle);
        expect(selectedHandles).toContain(farHandle);
        expect(selectedHandles).toHaveLength(2);
        expect(view.dom.querySelector('.dnd-mobile-selection-resize-handle-top')).not.toBeNull();
        expect(view.dom.querySelector('.dnd-range-selected-line')).toBeNull();
        expect(view.dom.querySelectorAll('.dnd-drag-source-line')).toHaveLength(2);
        expect(view.dom.querySelectorAll('.dnd-mobile-selection-resize-handle-top.is-active')).toHaveLength(2);
        expect(view.dom.querySelectorAll('.dnd-mobile-selection-resize-handle-bottom.is-active')).toHaveLength(2);
        expect(document.body.classList.contains('dnd-mobile-gesture-lock')).toBe(false);
        platform.isMobile = false;
        handler.destroy();
    });

    it('enters mobile selection from text long-long-press and appends multiple text ranges', () => {
        platform.isMobile = true;
        const view = createViewStub(10);
        const lines = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line');
        const firstLine = lines[0];
        const middleLine = lines[4];
        const farLine = lines[8];
        expect(firstLine).not.toBeNull();
        expect(middleLine).not.toBeNull();
        expect(farLine).not.toBeNull();

        const firstHandle = appendHandleForBlockStart(view, 0);
        const middleHandle = appendHandleForBlockStart(view, 4);
        const farHandle = appendHandleForBlockStart(view, 8);
        const firstBlock = createBlock('line 1', 0, 0);
        const middleBlock = createBlock('line 5', 4, 4);
        const farBlock = createBlock('line 9', 8, 8);

        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({
                handle: () => null,
                point: (_x, y) => {
                    if (y >= 160) return farBlock;
                    if (y >= 80) return middleBlock;
                    return firstBlock;
                },
            }),
            isBlockInsideRenderedTableCell: () => false,
            isMobileDragModeEnabled: () => true,
            isMobileTextLongPressDragEnabled: () => true,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(firstLine, 'pointerdown', {
            pointerId: 401,
            pointerType: 'touch',
            clientX: 120,
            clientY: 5,
        });
        vi.advanceTimersByTime(920);
        dispatchPointer(window, 'pointerup', {
            pointerId: 401,
            pointerType: 'touch',
            clientX: 120,
            clientY: 5,
        });

        dispatchPointer(middleLine, 'pointerdown', {
            pointerId: 402,
            pointerType: 'touch',
            clientX: 120,
            clientY: 85,
        });
        vi.advanceTimersByTime(920);
        dispatchPointer(window, 'pointerup', {
            pointerId: 402,
            pointerType: 'touch',
            clientX: 120,
            clientY: 85,
        });

        dispatchPointer(farLine, 'pointerdown', {
            pointerId: 403,
            pointerType: 'touch',
            clientX: 120,
            clientY: 165,
        });
        vi.advanceTimersByTime(920);
        dispatchPointer(window, 'pointerup', {
            pointerId: 403,
            pointerType: 'touch',
            clientX: 120,
            clientY: 165,
        });

        const selectedHandles = Array.from(view.dom.querySelectorAll<HTMLElement>('.dnd-range-selected-handle'));
        expect(selectedHandles).toContain(firstHandle);
        expect(selectedHandles).toContain(middleHandle);
        expect(selectedHandles).toContain(farHandle);
        expect(selectedHandles).toHaveLength(3);
        expect(view.dom.querySelectorAll('.dnd-drag-source-line')).toHaveLength(3);
        expect(view.dom.querySelectorAll('.dnd-mobile-selection-resize-handle-top.is-active')).toHaveLength(3);
        expect(view.dom.querySelectorAll('.dnd-mobile-selection-resize-handle-bottom.is-active')).toHaveLength(3);

        platform.isMobile = false;
        handler.destroy();
    });

    it('keeps mobile selection mode open while scrolling the document', () => {
        platform.isMobile = true;
        const view = createViewStub(8);
        appendHandleForBlockStart(view, 0);
        const sourceBlock = createBlock('- item', 0, 0);
        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: () => sourceBlock }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        view.dom.dispatchEvent(new CustomEvent('dnd:enter-mobile-selection-mode', {
            bubbles: true,
            detail: { handled: false },
        }));
        vi.runOnlyPendingTimers();

        dispatchPointer(window, 'pointermove', {
            pointerId: 206,
            pointerType: 'touch',
            clientX: 40,
            clientY: 40,
        });

        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).not.toHaveLength(0);
        expect(view.dom.querySelector('.dnd-mobile-selection-bar')).toBeNull();
        platform.isMobile = false;
        handler.destroy();
    });

    it('clears committed desktop multi-select when pressing escape', () => {
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 1);

        const sourceBlock = createBlock('- item', 1, 1);
        const endBlock = createBlock('line 6', 5, 5);
        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: (_x, y) => (y >= 100 ? endBlock : sourceBlock) }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview: vi.fn(),
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 401,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 401,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });
        dispatchPointer(window, 'pointerup', {
            pointerId: 401,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });

        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).not.toHaveLength(0);

        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        window.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).toHaveLength(0);
        expect(view.dom.querySelectorAll('.dnd-selection-checkbox')).toHaveLength(0);
        handler.destroy();
    });

    it('cancels in-progress desktop range selection when pressing escape', () => {
        const view = createViewStub(8);
        const handle = appendHandleForBlockStart(view, 1);

        const sourceBlock = createBlock('- item', 1, 1);
        const endBlock = createBlock('line 6', 5, 5);
        const onHideDropPreview = vi.fn();
        const handler = new PipelineAdapter(view, createPipelineAdapterDeps({
            resolveBlockSelection: resolveBlockSelectionFromTestBlocks({ handle: () => sourceBlock, point: (_x, y) => (y >= 100 ? endBlock : sourceBlock) }),
            isBlockInsideRenderedTableCell: () => false,
            beginPointerDragSession: vi.fn(),
            finishDragSession: vi.fn(),
            onDropPreview: vi.fn(),
            onHideDropPreview,
            onPlatformCommit: vi.fn(),
        }));

        handler.attach();
        dispatchPointer(handle, 'pointerdown', {
            pointerId: 402,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 30,
        });
        vi.advanceTimersByTime(280);
        dispatchPointer(window, 'pointermove', {
            pointerId: 402,
            pointerType: 'mouse',
            shiftKey: true,
            clientX: 12,
            clientY: 105,
        });

        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).not.toHaveLength(0);

        const event = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
        window.dispatchEvent(event);

        expect(event.defaultPrevented).toBe(true);
        expect(view.dom.querySelectorAll('.dnd-range-selected-handle')).toHaveLength(0);
        expect(onHideDropPreview).not.toHaveBeenCalled();
        handler.destroy();
    });
});

