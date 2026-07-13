// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { DraggerRuntime } from 'md-dragger/runtime';
import type { InputSource, PressInput, MoveInput, ReleaseInput, Pointer, DropTarget } from 'md-dragger/runtime';

// End-to-end coverage for DefaultUx through DraggerRuntime.
// Key invariant: multi-select entry requires long-press; a short click must
// not leave the pipeline in selecting/holding.
function makeDoc() {
    return EditorState.create({ doc: '- alpha\n- beta\n- gamma\n- delta\n- epsilon' }).doc;
}

function mockInput() {
    let pressH: ((i: PressInput) => void) | null = null;
    let moveH: ((i: MoveInput) => void) | null = null;
    let releaseH: ((i: ReleaseInput) => void) | null = null;
    const source: InputSource = {
        onPress: (h) => { pressH = h; return () => { pressH = null; }; },
        onMove: (h) => { moveH = h; return () => { moveH = null; }; },
        onRelease: (h) => { releaseH = h; return () => { releaseH = null; }; },
    };
    return {
        source,
        press: (i: PressInput) => pressH?.(i),
        move: (i: MoveInput) => moveH?.(i),
        release: (i: ReleaseInput) => releaseH?.(i),
    };
}

const pointer: Pointer = { id: 1, type: 'mouse' };

function pressAt(): PressInput {
    return {
        point: { x: 10, y: 20 },
        pointer,
        button: 0,
        modifiers: {},
        native: {},
        claim: () => {},
        capture: () => {},
        releaseCapture: () => {},
    };
}

describe('runtime default-ux gesture (end-to-end)', () => {
    it('single-block: press -> ready -> move -> drag -> release commits', () => {
        const doc = makeDoc();
        const input = mockInput();
        const commits: unknown[] = [];
        const dropTarget: DropTarget = { targetDoc: doc, targetLineNumber: 4, placement: 'before' };

        const rt = new DraggerRuntime({
            input: input.source,
            document: { getDoc: () => doc },
            locate: { sourceLineFromInput: () => 1, lineFromPoint: () => 1, resolveDropTarget: () => dropTarget },
            commit: { apply: (edits) => { commits.push(edits); } },
            config: { tabSize: 4, listIndentUnit: 2 },
        });
        rt.mount();

        input.press(pressAt());
        expect(rt.state.type).toBe('ready_to_drag');

        input.move({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {} });
        expect(rt.state.type).toBe('dragging');

        input.release({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {}, releaseCapture: () => {} });
        expect(rt.state.type).toBe('idle');
        expect(commits.length).toBe(1);

        rt.destroy();
    });

    it('multi-select: short click does not enter selecting, cancels with press_cancelled', () => {
        const doc = makeDoc();
        const input = mockInput();
        let timerCallback: (() => void) | null = null;
        const dropTarget: DropTarget = { targetDoc: doc, targetLineNumber: 5, placement: 'before' };
        const cancelled: Array<{ reason: string }> = [];

        const rt = new DraggerRuntime({
            input: input.source,
            document: { getDoc: () => doc },
            locate: { sourceLineFromInput: () => 1, lineFromPoint: () => 1, resolveDropTarget: () => dropTarget },
            commit: { apply: () => {} },
            config: { tabSize: 4, listIndentUnit: 2 },
            onChange: (result) => {
                for (const item of result.outputs) {
                    if (item.type === 'cancelled') cancelled.push({ reason: item.reason });
                }
            },
            ux: {
                gesture: {
                    multiSelectMs: 250,
                    multiSelectEnabled: true,
                },
            },
            scheduler: {
                setTimer: (callback) => {
                    timerCallback = callback;
                    return 1 as unknown as ReturnType<typeof setTimeout>;
                },
                clearTimer: () => {
                    timerCallback = null;
                },
            },
        });
        rt.mount();

        input.press(pressAt());
        // dragArmMs=0: immediately ready; multiSelect timer still armed.
        // Platform must not paint ready_to_drag / holding as multi-select.
        expect(rt.state.type).toBe('ready_to_drag');
        expect(timerCallback).not.toBeNull();

        input.release({ point: { x: 10, y: 20 }, pointer, native: {}, claim: () => {}, releaseCapture: () => {} });
        expect(rt.state.type).toBe('idle');
        expect(cancelled.some((c) => c.reason === 'press_cancelled')).toBe(true);

        rt.destroy();
    });

    it('multi-select enabled: press + move past threshold starts drag (does not enter selecting)', () => {
        const doc = makeDoc();
        const input = mockInput();
        const commits: unknown[] = [];
        const dropTarget: DropTarget = { targetDoc: doc, targetLineNumber: 5, placement: 'before' };
        let timerCallback: (() => void) | null = null;

        const rt = new DraggerRuntime({
            input: input.source,
            document: { getDoc: () => doc },
            locate: {
                sourceLineFromInput: () => 1,
                lineFromPoint: () => 1,
                resolveDropTarget: () => dropTarget,
            },
            commit: { apply: (edits) => { commits.push(edits); } },
            config: { tabSize: 4, listIndentUnit: 2 },
            ux: {
                gesture: {
                    multiSelectMs: 250,
                    dragCancelMoveThresholdPx: Number.POSITIVE_INFINITY,
                    multiSelectEnabled: true,
                },
            },
            scheduler: {
                setTimer: (callback) => {
                    timerCallback = callback;
                    return 1 as unknown as ReturnType<typeof setTimeout>;
                },
                clearTimer: () => {
                    timerCallback = null;
                },
            },
        });
        rt.mount();

        input.press(pressAt());
        expect(rt.state.type).toBe('ready_to_drag');
        expect(timerCallback).not.toBeNull();

        // Move before multi-select matures → drag, not multi-select.
        input.move({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {} });
        expect(rt.state.type).toBe('dragging');
        expect(timerCallback).toBeNull();

        input.release({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {}, releaseCapture: () => {} });
        expect(rt.state.type).toBe('idle');
        expect(commits.length).toBe(1);

        rt.destroy();
    });

    it('multi-block: long-press -> selecting -> move draws range -> second long-press drags the whole range', () => {
        const doc = makeDoc();
        const input = mockInput();
        const commits: unknown[] = [];
        const dropTarget: DropTarget = { targetDoc: doc, targetLineNumber: 5, placement: 'before' };
        let sourceLine = 1;
        let lineAtPoint = 2;
        let multiSelectMs = 100;
        let dragArmMs = 0;
        let timerCallback: (() => void) | null = null;

        const rt = new DraggerRuntime({
            input: input.source,
            document: { getDoc: () => doc },
            locate: { sourceLineFromInput: () => sourceLine, lineFromPoint: () => lineAtPoint, resolveDropTarget: () => dropTarget },
            commit: { apply: (edits) => { commits.push(edits); } },
            config: { tabSize: 4, listIndentUnit: 2 },
            ux: {
                gesture: () => ({ dragArmMs, multiSelectMs, multiSelectEnabled: true }),
            },
            scheduler: {
                setTimer: (callback) => {
                    timerCallback = callback;
                    return 1 as unknown as ReturnType<typeof setTimeout>;
                },
                clearTimer: () => {
                    timerCallback = null;
                },
            },
        });
        rt.mount();

        // First entry: dragArmMs=0 ready immediately; multiSelectMs timer enters selecting.
        input.press(pressAt());
        expect(rt.state.type).toBe('ready_to_drag');
        expect(timerCallback).not.toBeNull();
        timerCallback?.();
        expect(rt.state.type).toBe('selecting');

        input.move({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {} });
        expect(rt.state.type).toBe('selecting');
        if (rt.state.type !== 'selecting') return;
        expect(rt.state.selection.selection.ranges).toEqual([
            { startLine: 0, endLine: 0 },
            { startLine: 1, endLine: 1 },
        ]);

        input.release({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {}, releaseCapture: () => {} });
        expect(rt.state.type).toBe('selecting');
        expect(commits.length).toBe(0);

        sourceLine = 1;
        lineAtPoint = 5;
        multiSelectMs = 100;
        dragArmMs = 100;

        input.press(pressAt());
        expect(rt.state.type).toBe('selecting');
        expect(timerCallback).not.toBeNull();
        timerCallback?.();

        input.move({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {} });
        expect(rt.state.type).toBe('dragging');

        input.release({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {}, releaseCapture: () => {} });
        expect(rt.state.type).toBe('idle');
        expect(commits.length).toBe(1);

        rt.destroy();
    });

    it('multi-block: retained selection can be swept again to toggle selected blocks off', () => {
        const doc = makeDoc();
        const input = mockInput();
        const dropTarget: DropTarget = { targetDoc: doc, targetLineNumber: 5, placement: 'before' };
        let sourceLine = 1;
        let lineAtPoint = 3;
        let multiSelectMs = 0;
        let dragArmMs = 0;

        const rt = new DraggerRuntime({
            input: input.source,
            document: { getDoc: () => doc },
            locate: { sourceLineFromInput: () => sourceLine, lineFromPoint: () => lineAtPoint, resolveDropTarget: () => dropTarget },
            commit: { apply: () => {} },
            config: { tabSize: 4, listIndentUnit: 2 },
            ux: {
                gesture: () => ({ dragArmMs, multiSelectMs, multiSelectEnabled: true }),
            },
        });
        rt.mount();

        // multiSelectMs 0 = synchronous multi-select entry (for sweep tests).
        input.press(pressAt());
        input.move({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {} });
        input.release({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {}, releaseCapture: () => {} });

        expect(rt.state.type).toBe('selecting');
        if (rt.state.type !== 'selecting') return;
        expect(rt.state.selection.selection.ranges).toEqual([
            { startLine: 0, endLine: 0 },
            { startLine: 1, endLine: 1 },
            { startLine: 2, endLine: 2 },
        ]);

        multiSelectMs = 100;
        dragArmMs = 100;
        sourceLine = 2;
        lineAtPoint = 2;

        input.press(pressAt());
        input.move({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {} });
        input.release({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {}, releaseCapture: () => {} });

        expect(rt.state.type).toBe('selecting');
        if (rt.state.type !== 'selecting') return;
        expect(rt.state.selection.selection.ranges).toEqual([
            { startLine: 0, endLine: 0 },
            { startLine: 2, endLine: 2 },
        ]);

        rt.destroy();
    });
});
