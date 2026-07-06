import { describe, expect, it, vi } from 'vitest';
import { BlockType, type BlockInfo } from '../../domain/block/block-types';
import type { DropTarget } from '../../domain/command/drop-target';
import type {
    DraggerControllerOptions,
    DraggerMoveInput,
    DraggerPressInput,
    DraggerReleaseInput,
} from './dragger-controller-types';
import { DraggerController } from './dragger-controller';
import type { DocLikeWithRange } from '../../domain/markdown/document-types';

const block: BlockInfo = {
    type: BlockType.Paragraph,
    startLine: 0,
    endLine: 0,
    from: 0,
    to: 5,
    indentLevel: 0,
    content: 'alpha',
};

const target: DropTarget = {
    targetLineNumber: 2,
    placement: 'before',
};

const doc: DocLikeWithRange = {
    lines: 3,
    length: 17,
    line: (lineNumber) => ({
        number: lineNumber,
        from: lineNumber - 1,
        to: lineNumber - 1,
        text: `line ${lineNumber}`,
        length: 6,
    }),
    sliceString: (from, to) => `slice ${from}:${to}`,
};

type TestInput = {
    press?: (input: DraggerPressInput) => void;
    move?: (input: DraggerMoveInput) => void;
    release?: (input: DraggerReleaseInput) => void;
};

function createControllerOptions(
    input: TestInput,
    overrides: Partial<DraggerControllerOptions> = {}
): DraggerControllerOptions {
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
        inspect: {
            press: () => ({
                zone: 'handle',
                block,
                selection: null,
            }),
            drop: () => ({
                target,
                targetLineNumber: target.targetLineNumber,
                placement: target.placement,
                rejectReason: null,
            }),
            commit: (_input, context) => context.drop?.target
                ? {
                    type: 'command',
                    command: {
                        type: 'move',
                        selection: context.selection,
                        target: context.drop.target,
                    },
                    drop: context.drop,
                }
                : {
                    type: 'cancel',
                    drop: context.drop ?? { target: null, rejectReason: 'no_target' },
                    reason: 'no_target',
                },
            document: () => ({ lineCount: 3 }),
        },
        effects: {},
        config: {
            longPressMs: 10,
            dragStartMoveThresholdPx: 1,
            dragCancelMoveThresholdPx: 100,
        },
        ...overrides,
    };
}

describe('DraggerController', () => {
    it('uses platform facts to drive a block move without platform controller logic', () => {
        vi.useFakeTimers();
        const input: TestInput = {};
        const applyCommand = vi.fn();
        const showDropPreview = vi.fn();
        const hideDropPreview = vi.fn();
        const showDragSource = vi.fn();
        const controller = new DraggerController(createControllerOptions(input, {
            effects: {
                applyCommand,
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

        expect(applyCommand).toHaveBeenCalledTimes(1);
        expect(applyCommand).toHaveBeenCalledWith({
            type: 'move',
            selection: expect.objectContaining({
                ranges: [{ startLine: 0, endLine: 0 }],
            }),
            target,
        });
        expect(showDropPreview).toHaveBeenCalledWith(expect.objectContaining({ target }), expect.objectContaining({
            source: 'handle',
            pointer: { id: 1, type: 'mouse' },
        }));
        expect(showDragSource).toHaveBeenCalledWith(expect.objectContaining({
            ranges: [{ startLine: 0, endLine: 0 }],
        }));
        expect(hideDropPreview).toHaveBeenCalled();

        vi.useRealTimers();
    });

    it('does not start dragging before long press is ready', () => {
        vi.useFakeTimers();
        const input: TestInput = {};
        const applyCommand = vi.fn();
        const controller = new DraggerController(createControllerOptions(input, {
            effects: { applyCommand },
        }));

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

        expect(applyCommand).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('rejects drops through rules inside the controller', () => {
        vi.useFakeTimers();
        const input: TestInput = {};
        const applyCommand = vi.fn();
        const hideDropPreview = vi.fn();
        const controller = new DraggerController(createControllerOptions(input, {
            effects: {
                applyCommand,
                hideDropPreview,
            },
            rules: () => ({
                allowed: false,
                reason: 'container_policy',
            }),
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

        expect(applyCommand).not.toHaveBeenCalled();
        expect(hideDropPreview).toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('drives range selection from platform boundaries', () => {
        const input: TestInput = {};
        const showSelection = vi.fn();
        const controller = new DraggerController(createControllerOptions(input, {
            inspect: {
                press: () => ({
                    zone: 'selection_grip',
                    block,
                    selection: null,
                    rangeBoundary: {
                        startLineNumber: 1,
                        endLineNumber: 1,
                        representativeLineNumber: 1,
                    },
                    rangeDoc: doc,
                    rangeBoundaryResolver: (lineNumber) => ({
                        startLineNumber: lineNumber,
                        endLineNumber: lineNumber,
                    }),
                }),
                drop: () => ({
                    target,
                    rejectReason: null,
                }),
                commit: (_input, context) => ({
                    type: 'cancel',
                    drop: context.drop ?? { target: null, rejectReason: 'no_target' },
                    reason: 'no_target',
                }),
                range: () => ({
                    startLineNumber: 3,
                    endLineNumber: 3,
                    representativeLineNumber: 3,
                }),
                document: () => ({ lineCount: 3 }),
            },
            effects: { showSelection },
        }));

        controller.mount();
        input.press?.({
            point: { x: 0, y: 0 },
            pointer: { id: 1, type: 'mouse' },
        });
        input.move?.({
            point: { x: 0, y: 40 },
            pointer: { id: 1, type: 'mouse' },
        });
        input.release?.({
            point: { x: 0, y: 40 },
            pointer: { id: 1, type: 'mouse' },
        });

        expect(showSelection).toHaveBeenLastCalledWith(expect.objectContaining({
            ranges: [
                { startLine: 0, endLine: 0 },
                { startLine: 1, endLine: 1 },
                { startLine: 2, endLine: 2 },
            ],
        }));
        expect(controller.state.type).toBe('selecting');
    });

    it('delegates release commit resolution to inspect.commit', () => {
        vi.useFakeTimers();
        const input: TestInput = {};
        const applyCommand = vi.fn();
        const commit = vi.fn((release: DraggerReleaseInput, context) => ({
            type: 'command' as const,
            command: {
                type: 'convert' as const,
                selection: context.selection,
                to: BlockType.Heading,
            },
            drop: context.drop,
            release,
        }));
        const controller = new DraggerController(createControllerOptions(input, {
            inspect: {
                press: () => ({
                    zone: 'handle',
                    block,
                    selection: null,
                }),
                drop: () => ({
                    target,
                    rejectReason: null,
                }),
                commit,
                document: () => ({ lineCount: 3 }),
            },
            effects: { applyCommand },
        }));

        controller.mount();
        input.press?.({
            point: { x: 0, y: 0 },
            pointer: { id: 1, type: 'mouse' },
            native: 'press-event',
        });
        vi.advanceTimersByTime(10);
        input.move?.({
            point: { x: 4, y: 0 },
            pointer: { id: 1, type: 'mouse' },
            native: 'move-event',
        });
        input.release?.({
            point: { x: 6, y: 0 },
            pointer: { id: 1, type: 'mouse' },
            native: 'release-event',
        });

        expect(commit).toHaveBeenCalledWith(expect.objectContaining({
            native: 'release-event',
        }), expect.objectContaining({
            selection: expect.objectContaining({ ranges: [{ startLine: 0, endLine: 0 }] }),
            source: 'handle',
            pointer: { id: 1, type: 'mouse' },
            drop: expect.objectContaining({ target }),
        }));
        expect(applyCommand).toHaveBeenCalledWith({
            type: 'convert',
            selection: expect.objectContaining({ ranges: [{ startLine: 0, endLine: 0 }] }),
            to: BlockType.Heading,
        });
        vi.useRealTimers();
    });

    it('cleans up input subscriptions and timers on destroy', () => {
        vi.useFakeTimers();
        const input: TestInput = {};
        const applyCommand = vi.fn();
        const controller = new DraggerController(createControllerOptions(input, {
            effects: { applyCommand },
        }));

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
        expect(applyCommand).not.toHaveBeenCalled();
        vi.useRealTimers();
    });

    it('exits guarded interactions without unmounting input subscriptions', () => {
        vi.useFakeTimers();
        const input: TestInput = {};
        const hideDropPreview = vi.fn();
        const finishDragSession = vi.fn();
        const controller = new DraggerController(createControllerOptions(input, {
            inspect: {
                press: () => ({
                    zone: 'handle',
                    block,
                    selection: null,
                    guardDeps: ['drag-mode'],
                }),
                drop: () => ({
                    target,
                    rejectReason: null,
                }),
                commit: (_input, context) => ({
                    type: 'cancel',
                    drop: context.drop ?? { target: null, rejectReason: 'no_target' },
                    reason: 'no_target',
                }),
                document: () => ({ lineCount: 3 }),
            },
            effects: {
                hideDropPreview,
                finishDragSession,
            },
        }));

        controller.mount();
        input.press?.({
            point: { x: 0, y: 0 },
            pointer: { id: 1, type: 'touch' },
        });

        controller.guardUnavailable('drag-mode');

        expect(controller.state.type).toBe('idle');
        expect(input.press).toBeTypeOf('function');
        expect(input.move).toBeTypeOf('function');
        expect(input.release).toBeTypeOf('function');
        expect(hideDropPreview).toHaveBeenCalled();
        expect(finishDragSession).toHaveBeenCalled();
        vi.useRealTimers();
    });
});
