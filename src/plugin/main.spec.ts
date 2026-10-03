// @vitest-environment jsdom
import { EditorState, StateEffect, type Extension } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import type { App, PluginManifest } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import DragNDropPlugin from './main';

vi.mock('obsidian', () => ({
    Platform: { isMobile: false },
    MarkdownView: class {},
    Plugin: class {
        app: App;
        loadData = vi.fn(async () => null);
        saveData = vi.fn(async () => undefined);
        registerEditorExtension = vi.fn();
        registerEvent = vi.fn();
        addCommand = vi.fn((command) => command);
        addSettingTab = vi.fn();
        constructor(app: App) {
            this.app = app;
        }
    },
}));
vi.mock('./settings', () => ({ DragNDropSettingTab: class {} }));

let plugin: DragNDropPlugin;
let views: EditorView[] = [];
afterEach(() => {
    for (const view of views) view.destroy();
    views = [];
    plugin?.onunload();
    document.body.replaceChildren();
});

async function mountedPlugin() {
    const updateOptions = vi.fn(() => {
        // Apply the registered array as Obsidian's documented API does.
        for (const view of views) view.dispatch({ effects: StateEffect.reconfigure.of(extensions) });
    });
    const app = { workspace: { updateOptions, on: vi.fn(), onLayoutReady: vi.fn() } } as unknown as App;
    plugin = new DragNDropPlugin(app, {} as PluginManifest);
    await plugin.onload();
    const register = vi.mocked(plugin.registerEditorExtension);
    const extensions = register.mock.calls[0][0] as Extension[];
    for (let i = 0; i < 2; i++) {
        const parent = document.body.appendChild(document.createElement('div'));
        views.push(
            new EditorView({
                parent,
                state: EditorState.create({ doc: 'first\n\nsecond', selection: { anchor: 2 }, extensions }),
            }),
        );
    }
    return { updateOptions, register, extensions };
}

describe('live editor settings', () => {
    it('reconfigures all editors through the registered array without changing text or caret', async () => {
        const { updateOptions, register, extensions } = await mountedPlugin();
        expect(updateOptions).not.toHaveBeenCalled();
        for (const view of views) {
            expect(view.dom.querySelector('.cm-gutters-before .md-dragger-gutter')).not.toBeNull();
        }
        for (const side of ['right', 'left'] as const) {
            plugin.settings.handleGutterPosition = side;
            await plugin.saveSettings();
            expect(register).toHaveBeenCalledOnce();
            expect(register.mock.calls[0][0]).toBe(extensions);
            for (const view of views) {
                const placement = side === 'right' ? 'after' : 'before';
                expect(view.dom.querySelector(`.cm-gutters-${placement} .md-dragger-gutter`)).not.toBeNull();
                expect(view.state.doc.toString()).toBe('first\n\nsecond');
                expect(view.state.selection.main.head).toBe(2);
            }
        }
        expect(updateOptions).toHaveBeenCalledTimes(2);
        await plugin.saveSettings();
        expect(updateOptions).toHaveBeenCalledTimes(2);
    });

    it('updates CSS-only appearance without reconfiguring editors', async () => {
        const { updateOptions } = await mountedPlugin();
        plugin.settings.handleSize = 29;
        plugin.settings.handleIcon = 'square';
        plugin.settings.handleColorMode = 'custom';
        plugin.settings.handleColor = '#123456';
        await plugin.saveSettings();
        expect(document.body.style.getPropertyValue('--d-handle-size')).toBe('29px');
        expect(document.body.style.getPropertyValue('--d-handle-color')).toBe('#123456');
        expect(document.body.getAttribute('data-d-handle-icon')).toBe('square');
        expect(updateOptions).not.toHaveBeenCalled();
    });
});
