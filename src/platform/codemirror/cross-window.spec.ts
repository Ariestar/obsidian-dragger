// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { SettingsPresenter, settingsPresentation } from '../../plugin/settings-presentation';
import { DEFAULT_SETTINGS } from '../../plugin/settings-types';
import { dragHandleExtension, type ObsidianDraggerHost } from './obsidian-dragger';

// Obsidian builds a canvas card's editor in the main document, then moves it
// into the card's iframe after the editor extension already exists. Pointer
// events then come from the iframe's window, as instances of its classes.

const host: ObsidianDraggerHost = {
    settings: {
        enableMultiLineSelection: true,
        mouseRangeSelectLongPressMs: 700,
        mobileDragLongPressMs: 200,
        autoScrollEdgeZonePx: 40,
        autoScrollMaxSpeedPx: 12,
        handleGutterPosition: 'left',
    },
    isMobilePlatform: () => false,
    isMobileDragModeEnabled: () => false,
    notifyDragDrop: () => {},
    settingsPresenter: new SettingsPresenter(),
};

const nextFrame = () => new Promise<void>((resolve) => window.requestAnimationFrame(() => resolve()));

let cleanup: (() => void)[] = [];
afterEach(() => {
    for (const fn of cleanup) fn();
    cleanup = [];
});

/** An editor mounted in the main document, then moved into a fresh iframe. */
async function editorMovedIntoFrame(doc: string) {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({ state: EditorState.create({ doc, extensions: dragHandleExtension(host) }), parent });
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const win = frame.contentWindow as Window & typeof globalThis;
    // jsdom has no elementFromPoint; src/test-setup.ts stubs it for the main document only.
    win.document.elementFromPoint = () => null;
    win.document.body.appendChild(parent);
    cleanup.push(() => {
        view.destroy();
        frame.remove();
    });
    await nextFrame();
    const pointer = (type: string, x: number, y: number) =>
        new win.PointerEvent(type, { pointerId: 1, clientX: x, clientY: y, bubbles: true });
    return { view, win, pointer };
}

const draggedLines = (view: EditorView) => view.dom.querySelectorAll('.cm-line.md-dragger-drag-source').length;

describe('platform/codemirror editor moved into an iframe', () => {
    it("starts a drag from pointer events sent through the iframe's window", async () => {
        const { view, win, pointer } = await editorMovedIntoFrame('- item one\n- item two');
        const handle = view.dom.querySelector<HTMLElement>('.md-dragger-handle');
        expect(handle?.ownerDocument).toBe(win.document);

        handle?.dispatchEvent(pointer('pointerdown', 0, 0));
        win.dispatchEvent(pointer('pointermove', 12, 12));
        await nextFrame();

        expect(draggedLines(view)).toBeGreaterThan(0);
    });

    it("presents the settings in the iframe's document before a pointer over the editor can show a handle", async () => {
        const presenter = host.settingsPresenter as SettingsPresenter;
        presenter.update(
            settingsPresentation(
                { ...DEFAULT_SETTINGS, handleIcon: 'square' },
                { isMobile: false, mobileDragModeEnabled: false },
            ),
        );
        cleanup.push(() => presenter.clear());
        const { view, win, pointer } = await editorMovedIntoFrame('- item one\n- item two');
        expect(win.document.body.getAttribute('data-d-handle-icon')).toBeNull();

        view.contentDOM.dispatchEvent(pointer('pointerover', 0, 0));

        expect(win.document.body.getAttribute('data-d-handle-icon')).toBe('square');
    });

    it("ends the drag on Escape pressed in the iframe's window", async () => {
        const { view, win, pointer } = await editorMovedIntoFrame('- item one\n- item two');
        view.dom.querySelector('.md-dragger-handle')?.dispatchEvent(pointer('pointerdown', 0, 0));
        win.dispatchEvent(pointer('pointermove', 12, 12));
        await nextFrame();
        expect(draggedLines(view)).toBeGreaterThan(0);

        win.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
        await nextFrame();

        expect(draggedLines(view)).toBe(0);
        expect(view.state.doc.toString()).toBe('- item one\n- item two');
    });
});
