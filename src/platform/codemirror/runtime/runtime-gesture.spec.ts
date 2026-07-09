// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { describe, expect, it } from 'vitest';
import { DraggerRuntime } from 'md-dragger/runtime';
import type { InputSource, PressInput, MoveInput, ReleaseInput, Point, Pointer, DropTarget } from 'md-dragger/runtime';

// Regression coverage for the headless runtime's default ux end-to-end.
// Previously a bug cleared the press session on beginDrag, so neither the
// in-flight pointer moves (drag_over) nor the release (commitDrop) ever
// reached the runtime — dragging silently did nothing. These tests drive the
// full press → drag → release path through the default ux.
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
            gestureConfig: { longPressMs: 0, dragStartMoveThresholdPx: 4, dragCancelMoveThresholdPx: 12, multiSelectEnabled: false },
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

    it('multi-block: long-press -> selecting -> move draws range -> drag commits the whole range', () => {
        const doc = makeDoc();
        const input = mockInput();
        const commits: unknown[] = [];
        const dropTarget: DropTarget = { targetDoc: doc, targetLineNumber: 5, placement: 'before' };

        const rt = new DraggerRuntime({
            input: input.source,
            document: { getDoc: () => doc },
            locate: { sourceLineFromInput: () => 1, lineFromPoint: () => 2, resolveDropTarget: () => dropTarget },
            commit: { apply: (edits) => { commits.push(edits); } },
            gestureConfig: { longPressMs: 0, dragStartMoveThresholdPx: 4, dragCancelMoveThresholdPx: 12, multiSelectEnabled: true },
        });
        rt.mount();

        input.press(pressAt());
        expect(rt.state.type).toBe('selecting');

        input.move({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {} });
        expect(rt.state.type).toBe('dragging');

        input.release({ point: { x: 10, y: 80 }, pointer, native: {}, claim: () => {}, releaseCapture: () => {} });
        expect(rt.state.type).toBe('idle');
        expect(commits.length).toBe(1);

        rt.destroy();
    });
});
