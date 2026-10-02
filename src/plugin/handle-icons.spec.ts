// @vitest-environment jsdom
import fs from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { App, FuzzyMatch, SettingDefinitionAction, SettingDefinitionPage } from 'obsidian';
import { getIcon } from 'obsidian';
import { DragNDropSettingTab } from './settings';
import { migrateSettings } from './settings-migrations';
import { DEFAULT_SETTINGS } from './settings-types';
import { SettingsPresenter, settingsPresentation } from './settings-presentation';
import type DragNDropPlugin from './main';

type IconPicker = {
    getItems(): string[];
    onChooseItem(item: string): void;
    renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement): void;
};
const mock = vi.hoisted(() => ({ picker: null as IconPicker | null }));
vi.mock('obsidian', () => ({
    getLanguage: () => 'en',
    Platform: { isMobile: false },
    getIconIds: () => ['grip-vertical', 'star'],
    getIcon: vi.fn((id: string) => {
        if (!['grip-vertical', 'star'].includes(id)) return null;
        const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        icon.setAttribute('viewBox', '0 0 24 24');
        icon.setAttribute('data-icon', id);
        return icon;
    }),
    setIcon: (el: HTMLElement, id: string) => el.setAttribute('data-icon', id),
    FuzzySuggestModal: class {
        constructor() {
            mock.picker = this as unknown as IconPicker;
        }
        setPlaceholder() {}
        open() {}
        renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement) {
            el.textContent = match.item;
        }
    },
    PluginSettingTab: class {
        app: App;
        update = vi.fn();
        constructor(app: App) {
            this.app = app;
        }
    },
}));

const desktop = { isMobile: false, mobileDragModeEnabled: false };
afterEach(() => {
    document.body.replaceChildren();
    document.body.removeAttribute('data-d-handle-icon');
    document.body.style.cssText = '';
    vi.clearAllMocks();
});

describe('handle icons', () => {
    it('defaults to the six-dot grip and preserves existing icon choices', () => {
        expect(migrateSettings(null).handleIcon).toBe('grip-dots');
        expect(migrateSettings({ handleIcon: 'dot' }).handleIcon).toBe('dot');
        expect(migrateSettings({ handleIcon: 'custom', customHandleIcon: 'star' }).customHandleIcon).toBe('star');
    });

    it('offers the registered icons and persists a selection through the settings control', async () => {
        const plugin = { settings: migrateSettings(null), saveSettings: vi.fn(async () => undefined) };
        const tab = new DragNDropSettingTab({} as App, plugin as unknown as DragNDropPlugin);
        const page = tab.getSettingDefinitions()[0] as SettingDefinitionPage;
        const row = page.items!.find(
            (item) => 'name' in item && item.name === 'Custom handle icon',
        ) as SettingDefinitionAction;
        expect((row.visible as () => boolean)()).toBe(false);
        await tab.setControlValue('handleIcon', 'custom');
        expect((row.visible as () => boolean)()).toBe(true);
        row.action();
        expect(mock.picker!.getItems()).toEqual(['grip-vertical', 'star']);
        mock.picker!.onChooseItem('star');
        await Promise.resolve();
        await Promise.resolve();
        expect(plugin.settings.customHandleIcon).toBe('star');
        expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
        expect(tab.update).toHaveBeenCalledOnce();
    });

    it('updates and clears the icon mask in every editor document', () => {
        const presenter = new SettingsPresenter();
        const frame = document.body.appendChild(document.createElement('iframe'));
        const docs = [document, frame.contentDocument!];
        for (const doc of docs) presenter.presentIn(doc);
        const presentation = settingsPresentation(
            { ...DEFAULT_SETTINGS, handleIcon: 'custom', customHandleIcon: 'star' },
            desktop,
        );
        presenter.update(presentation);
        expect(getIcon).toHaveBeenCalledWith('star');
        const mask = presentation.cssProps['--d-custom-handle-icon'];
        const svg = decodeURIComponent(mask.slice('url("data:image/svg+xml,'.length, -2));
        expect(svg).toContain('xmlns="http://www.w3.org/2000/svg"');
        expect(svg).toContain('data-icon="star"');
        for (const doc of docs) {
            expect(doc.body.style.getPropertyValue('--d-custom-handle-icon')).toBe(mask);
            expect(doc.body.getAttribute('data-d-handle-icon')).toBe('custom');
        }
        presenter.update(settingsPresentation(DEFAULT_SETTINGS, desktop));
        for (const doc of docs) expect(doc.body.style.getPropertyValue('--d-custom-handle-icon')).toBe('');
        presenter.clear();
    });

    it('fails explicitly when the selected icon is no longer registered', () => {
        expect(() =>
            settingsPresentation({ ...DEFAULT_SETTINGS, handleIcon: 'custom', customHandleIcon: 'missing' }, desktop),
        ).toThrow('Dragger: custom handle icon "missing" is not registered');
    });

    it('keeps the selection checkbox unmasked for a custom icon', () => {
        const style = document.body.appendChild(document.createElement('style'));
        style.textContent = fs.readFileSync('styles.css', 'utf8');
        document.body.setAttribute('data-d-handle-icon', 'custom');
        const handle = document.body.appendChild(document.createElement('div'));
        handle.className = 'md-dragger-handle is-selected';
        const core = handle.appendChild(document.createElement('span'));
        core.className = 'd-handle-core';
        expect(window.getComputedStyle(core).getPropertyValue('mask')).toBe('none');
    });
});
