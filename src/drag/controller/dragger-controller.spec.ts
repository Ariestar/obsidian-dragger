import { describe, expect, it, vi } from 'vitest';
import { BlockType, type BlockInfo } from '../../domain/block/block-types';
import type { DraggerControllerOptions, DraggerMoveInput, DraggerPressInput, DraggerReleaseInput } from './dragger-controller-types';
import { DraggerController } from './dragger-controller';

const block: BlockInfo = {
    type: BlockType.Paragraph,
    startLine: 0,
    endLine: 0,
    from: 0,
    to: 5,
    indentLevel: 0,
    content: 'alpha',
};

type TestInput = {
    press?: (input: DraggerPressInput) => void;
    move?: (input: DraggerMoveInput) => void;
    release?: (input: DraggerReleaseInput) => void;
};

function createControllerOptions(input: TestInput, overrides: Partial<DraggerControllerOptions> = {}): DraggerControllerOptions {
    return {
        input: {
            onPress: (handler) => {
                input.press = handler;
                return () => {
                    input.press = undefined;
                };
            },
            onMove: (handler) => {
                input.move = handler;
                return () => {
                    input.move = undefined;
                };
            },
            onRelease: (handler) => {
                input.release = handler;
                return () => {
                    input.release = undefined;
                };
            },
        },
        read: {
            lineAt: () => 1,
            lineCount: () => 3,
            lineText: () => 'alpha',
            blockAt: () => block,
        },
        move: vi.fn(),
        config: {
            longPressMs: 10,
            dragStartMoveThresholdPx: 1,
            dragCancelMoveThresholdPx: 100,
        },
        ...overrides,
    };
}

describe('DraggerController', () => {
    it('translates press, move, and release into a block move', () => {
        vi.useFakeTimers();
        const input: TestInput = {};
        const move = vi.fn();
        const showDropPreview = vi.fn();
        const hideDropPreview = vi.fn();
        const showDragSource = vi.fn();
        const controller = new DraggerController(createControllerOptions(input, {
            move,
            view: {
                showDropPreview,
                hideDropPreview,
                showDragSource,
            },
        }));

        controller.mount();
        input.press?.({
            point: { x: 0, y: 0 },
            pointer: { id: 1, type: 'mouse' },
        });
        vi.advanceTimersByTime(10);
        input.move?.({
            point: { x: 4, y: 0 },
            pointer: { id: 1, type: 'mouse' },
        });
        input.release?.({
            point: { x: 4, y: 0 },
            pointer: { id: 1, type: 'mouse' },
        });

        expect(move).toHaveBeenCalledTimes(1);
        expect(move.mock.calls[0][0].ranges).toEqual([{ startLine: 0, endLine: 0 }]);
        expect(move.mock.calls[0][1]).toEqual({ lineNumber: 1, placement: 'before' });
        expect(showDropPreview).toHaveBeenCalled();
        expect(showDragSource).toHaveBeenCalledWith(expect.objectContaining({
            ranges: [{ startLine: 0, endLine: 0 }],
        }));
        expect(hideDropPreview).toHaveBeenCalled();

        vi.useRealTimers();
    });

    it('does not start dragging before long press is ready', () => {
        vi.useFakeTimers();
        const input: TestInput = {};
        const move = vi.fn();
        const controller = new DraggerController(createControllerOptions(input, { move }));

        controller.mount();
        input.press?.({
            point: { x: 0, y: 0 },
            pointer: { id: 1, type: 'mouse' },
        });
        input.move?.({
            point: { x: 4, y: 0 },
            pointer: { id: 1, type: 'mouse' },
        });
        input.release?.({
            point: { x: 4, y: 0 },
            pointer: { id: 1, type: 'mouse' },
        });

        expect(move).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('cleans up input subscriptions and timers on destroy', () => {
        vi.useFakeTimers();
        const input: TestInput = {};
        const move = vi.fn();
        const controller = new DraggerController(createControllerOptions(input, { move }));

        controller.mount();
        input.press?.({
            point: { x: 0, y: 0 },
            pointer: { id: 1, type: 'mouse' },
        });
        controller.destroy();
        vi.advanceTimersByTime(10);
        input.move?.({
            point: { x: 4, y: 0 },
            pointer: { id: 1, type: 'mouse' },
        });

        expect(input.press).toBeUndefined();
        expect(input.move).toBeUndefined();
        expect(input.release).toBeUndefined();
        expect(move).not.toHaveBeenCalled();
        vi.useRealTimers();
    });
});
