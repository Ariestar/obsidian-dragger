// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { dragHandleExtension, type ObsidianDraggerHost } from './obsidian-dragger';

function mockPlugin(): ObsidianDraggerHost {
    return {
        settings: {
            enableMultiLineSelection: true,
            mouseRangeSelectLongPressMs: 700,
            mobileDragLongPressMs: 200,
            autoScrollEdgeZonePx: 40,
            autoScrollMaxSpeedPx: 12,
        },
        isMobilePlatform: () => false,
        isMobileDragModeEnabled: () => false,
        notifyDragDrop: () => {},
    };
}

function makeView(doc: string, settingsOverrides?: Partial<ObsidianDraggerHost['settings']>): EditorView {
    const plugin = mockPlugin();
    if (settingsOverrides) plugin.settings = { ...plugin.settings, ...settingsOverrides };
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    return new EditorView({
        state: EditorState.create({ doc, extensions: dragHandleExtension(plugin) }),
        parent,
    });
}

function pointer(type: string, x: number, y: number): PointerEvent {
    return new PointerEvent(type, { pointerId: 1, clientX: x, clientY: y, bubbles: true });
}

const nextFrame = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

describe('platform/codemirror drag paint', () => {
    it('highlights the source rows while dragging a plain document', async () => {
        const view = makeView('plain paragraph\nanother line');
        await nextFrame();

        const handle = view.dom.querySelector<HTMLElement>('.md-dragger-handle');
        expect(handle).not.toBeNull();
        if (!handle) return;

        // Press the handle and move past the drag-arm threshold: this drives
        // the drag_source_changed → selectionPaint → line-decoration path
        // whose list-indent measurement used to throw on plain documents.
        handle.dispatchEvent(pointer('pointerdown', 0, 0));
        window.dispatchEvent(pointer('pointermove', 0, 0));
        window.dispatchEvent(pointer('pointermove', 12, 12));
        await nextFrame();

        // The source rows carry the highlight as CM6 line decorations.
        expect(view.dom.querySelectorAll('.cm-line.d-drag-source-line').length).toBeGreaterThan(0);
        view.destroy();
    });

    it('highlights the source rows while dragging a single-level list document', async () => {
        const view = makeView('- item one\n- item two');
        await nextFrame();

        const handle = view.dom.querySelector<HTMLElement>('.md-dragger-handle');
        expect(handle).not.toBeNull();
        if (!handle) return;

        handle.dispatchEvent(pointer('pointerdown', 0, 0));
        window.dispatchEvent(pointer('pointermove', 0, 0));
        window.dispatchEvent(pointer('pointermove', 12, 12));
        await nextFrame();

        expect(view.dom.querySelectorAll('.cm-line.d-drag-source-line').length).toBeGreaterThan(0);
        view.destroy();
    });

    it('paints a rejected in-place seam as a grey indicator widget', async () => {
        // List rows resolve a drop position in jsdom without DOM measurement
        // (the list branch of lineBand uses the indent step, not coordsAtPos),
        // so hovering back over the source row yields a real in-place seam.
        const view = makeView('- item one\n- item two');
        await nextFrame();

        const handle = view.dom.querySelector<HTMLElement>('.md-dragger-handle');
        expect(handle).not.toBeNull();
        if (!handle) return;

        handle.dispatchEvent(pointer('pointerdown', 0, 0));
        // Move far enough to start dragging, then hover back over the source
        // handle position (a rejected in-place seam).
        window.dispatchEvent(pointer('pointermove', 40, 40));
        window.dispatchEvent(pointer('pointermove', 0, 0));
        await nextFrame();

        // The seam row carries the line decoration, marked grey (invalid).
        const row = view.dom.querySelector<HTMLElement>('.cm-line.d-drop-seam');
        expect(row).not.toBeNull();
        expect(row?.classList.contains('is-invalid')).toBe(true);
        view.destroy();
    });

    it('clears the source highlight when pressing non-block space after a long-press multi-select', async () => {
        // Short long-press so the range sweep (selecting) arms quickly.
        const view = makeView('- item one\n- item two\n- item three', { mouseRangeSelectLongPressMs: 10 });
        await nextFrame();

        const handle = view.dom.querySelector<HTMLElement>('.md-dragger-handle');
        expect(handle).not.toBeNull();
        if (!handle) return;

        // Long-press the handle → range sweep enters 'selecting' → the
        // selection highlight is painted.
        handle.dispatchEvent(pointer('pointerdown', 0, 0));
        await new Promise((resolve) => window.setTimeout(resolve, 40));
        await nextFrame();
        expect(view.dom.querySelectorAll('.cm-line.d-drag-source-line').length).toBeGreaterThan(0);

        // Release without dragging: the multi-select (and its highlight) stays.
        window.dispatchEvent(pointer('pointerup', 0, 0));
        await nextFrame();
        expect(view.dom.querySelectorAll('.cm-line.d-drag-source-line').length).toBeGreaterThan(0);

        // Press on non-block space (editor background, not a handle) must
        // clear the pending selection and its highlight.
        view.dom.dispatchEvent(pointer('pointerdown', 400, 400));
        await nextFrame();
        expect(view.dom.querySelectorAll('.cm-line.d-drag-source-line').length).toBe(0);
        view.destroy();
    });
});
