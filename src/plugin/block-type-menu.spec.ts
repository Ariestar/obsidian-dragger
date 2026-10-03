// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    Platform,
    type App,
    type SettingDefinitionPage,
    type SettingDefinitionAction,
    type SettingDefinitionList,
    type SettingDefinitionRender,
    type Setting,
    type SettingGroup,
} from 'obsidian';
import { openBlockTypeMenu } from './block-type-menu';
import { selectTranslations } from './i18n';
import { DragNDropSettingTab } from './settings';
import { migrateSettings } from './settings-migrations';
import { DEFAULT_SETTINGS } from './settings-types';
import { getBlockMenuEntries } from './block-menu-items';
import type DragNDropPlugin from './main';

const mock = vi.hoisted(() => ({
    language: 'zh-cn',
    menus: [] as HTMLElement[][],
    notices: [] as string[],
    convert: vi.fn(() => false),
    modal: null as {
        style: { id: string; label: string; icon: string; template: string };
        onSave: (style: { id: string; label: string; icon: string; template: string }) => void;
    } | null,
}));

vi.mock('obsidian', () => ({
    getLanguage: () => mock.language,
    Platform: { isDesktop: true, isMobile: false },
    setIcon: (el: HTMLElement, icon: string) => el.setAttribute('data-icon', icon),
    FuzzySuggestModal: class {},
    Modal: class {
        constructor() {
            mock.modal = this as unknown as typeof mock.modal;
        }
        open() {}
    },
    PluginSettingTab: class {
        app: App;
        update = vi.fn();
        constructor(app: App) {
            this.app = app;
        }
    },
    Notice: class {
        constructor(message: string) {
            mock.notices.push(message);
        }
    },
    Menu: class {
        items: HTMLElement[] = [];
        constructor() {
            mock.menus.push(this.items);
        }
        setUseNativeMenu() {}
        onHide() {}
        hide() {}
        addSeparator() {
            const separator = document.createElement('div');
            separator.className = 'menu-separator';
            this.items.push(separator);
        }
        addItem(build: (item: object) => void) {
            const row = document.createElement('div');
            row.className = 'menu-item';
            Object.defineProperty(row, 'doc', { value: document });
            const title = row.appendChild(document.createElement('div'));
            title.className = 'menu-item-title';
            const item = {
                setTitle(value: string | DocumentFragment) {
                    title.append(value);
                    return item;
                },
                setIcon() {
                    return item;
                },
                setWarning() {
                    return item;
                },
                onClick(callback: () => void) {
                    row.addEventListener('click', callback);
                    return item;
                },
            };
            build(item);
            this.items.push(row);
        }
        showAtPosition() {
            const menu = document.createElement('div');
            menu.className = 'menu';
            menu.append(...this.items);
            document.body.append(menu);
        }
    },
}));

vi.mock('./block-type-commands', () => ({
    convertCurrentBlockType: mock.convert,
    copyCurrentBlock: () => false,
    cutCurrentBlock: () => false,
    deleteCurrentBlock: () => false,
}));

const view = {
    state: EditorState.create({ doc: 'alpha' }),
    dom: document.createElement('div'),
    coordsAtPos: () => ({ left: 10, bottom: 20 }),
} as unknown as EditorView;
const customStyles = [{ id: 'custom', label: 'My style', icon: 'box', template: '${content}' }];
const titles = (items: HTMLElement[]) => items.map((item) => item.textContent);

afterEach(() => {
    document.body.replaceChildren();
    mock.menus.length = 0;
    mock.notices.length = 0;
    mock.convert.mockClear();
    vi.restoreAllMocks();
});

describe('block menu translations', () => {
    it.each(['zh-cn', 'en', 'ru'])('uses %s for root, mobile pages and notices', (language) => {
        mock.language = language;
        Platform.isMobile = true;
        Platform.isDesktop = false;
        const i = selectTranslations(language);
        openBlockTypeMenu(view, new MouseEvent('click'), migrateSettings({ customBlockStyles: customStyles }), 1);
        const root = mock.menus[0];
        expect(titles(root)).toEqual([
            i.blockMenuParagraph,
            i.blockMenuHeading,
            i.blockMenuList,
            i.blockMenuQuote,
            i.blockMenuCallout,
            i.blockMenuCodeBlock,
            i.blockMenuMathBlock,
            i.blockMenuCustom,
            '',
            i.blockMenuCopy,
            i.blockMenuCut,
            i.blockMenuDelete,
        ]);
        root[0].click();
        expect(mock.notices).toEqual([i.blockMenuConversionFailed]);
        root[1].click();
        expect(titles(mock.menus.at(-1)!)).toEqual([
            i.blockMenuBack,
            ...[1, 2, 3, 4, 5, 6].map((level) => `${i.blockMenuHeading} ${level}`),
        ]);
        root[2].click();
        expect(titles(mock.menus.at(-1)!)).toEqual([
            i.blockMenuBack,
            i.blockMenuBulletList,
            i.blockMenuNumberedList,
            i.blockMenuTaskList,
        ]);
        root[4].click();
        const callouts = mock.menus.at(-1)!;
        expect(titles(callouts)).toEqual([
            i.blockMenuBack,
            i.blockMenuCalloutNote,
            i.blockMenuCalloutTip,
            i.blockMenuCalloutWarning,
        ]);
        callouts[2].click();
        expect(mock.convert).toHaveBeenLastCalledWith(view, { template: '> [!tip]\n${content}', linePrefix: '> ' }, 1);
        root[7].click();
        expect(titles(mock.menus.at(-1)!)).toEqual([i.blockMenuBack, 'My style']);
    });

    it.each(['zh-cn', 'en', 'ru'])('uses %s for desktop flyouts after reopening', async (language) => {
        mock.language = language;
        Platform.isMobile = false;
        Platform.isDesktop = true;
        const i = selectTranslations(language);
        openBlockTypeMenu(view, new MouseEvent('click'), migrateSettings({ customBlockStyles: customStyles }), 1);
        await Promise.resolve();
        const root = mock.menus[0];
        root[1].dispatchEvent(new MouseEvent('pointerenter'));
        expect(titles(Array.from(document.querySelectorAll<HTMLElement>('.d-block-type-flyout-item')))).toEqual(
            [1, 2, 3, 4, 5, 6].map((level) => `${i.blockMenuHeading} ${level}`),
        );
        root[4].dispatchEvent(new MouseEvent('pointerenter'));
        expect(titles(Array.from(document.querySelectorAll<HTMLElement>('.d-block-type-flyout-item')))).toEqual([
            i.blockMenuCalloutNote,
            i.blockMenuCalloutTip,
            i.blockMenuCalloutWarning,
        ]);
        root[7].dispatchEvent(new MouseEvent('pointerenter'));
        expect(titles(Array.from(document.querySelectorAll<HTMLElement>('.d-block-type-flyout-item')))).toEqual([
            'My style',
        ]);
    });

    it('opens every desktop group through native menu activation', async () => {
        Platform.isMobile = false;
        Platform.isDesktop = true;
        const settings = migrateSettings({ customBlockStyles: customStyles });
        const entries = getBlockMenuEntries(settings);
        for (const entry of entries) {
            if (!('options' in entry)) continue;
            openBlockTypeMenu(view, null, settings, 1);
            await Promise.resolve();
            const root = mock.menus.at(-1)!;
            root[entries.indexOf(entry)].dispatchEvent(new MouseEvent('pointerenter'));
            root[entries.indexOf(entry)].click();
            const page = mock.menus.at(-1)!;
            expect(titles(page)).toEqual([
                selectTranslations(mock.language).blockMenuBack,
                ...entry.options.map((option) => option.label),
            ]);
            expect(document.querySelector('.d-block-type-flyout')).toBeNull();
            page[0].click();
            expect(titles(mock.menus.at(-1)!)).toEqual(titles(root));
        }
    });

    it('keeps Callouts available when no custom styles are configured', () => {
        mock.language = 'zh-cn';
        Platform.isMobile = true;
        Platform.isDesktop = false;
        const i = selectTranslations(mock.language);
        openBlockTypeMenu(view, new MouseEvent('click'), DEFAULT_SETTINGS, 1);
        expect(titles(mock.menus[0])).toContain(i.blockMenuCallout);
        expect(titles(mock.menus[0])).not.toContain(i.blockMenuCustom);
    });

    it.each([false, true])('persists settings reordering in the editor menu (mobile=%s)', async (mobile) => {
        mock.language = 'zh-cn';
        Platform.isMobile = mobile;
        Platform.isDesktop = !mobile;
        const i = selectTranslations(mock.language);
        const plugin = {
            settings: migrateSettings({ customBlockStyles: customStyles }),
            saveSettings: vi.fn(async () => undefined),
        };
        const tab = new DragNDropSettingTab({} as App, plugin as unknown as DragNDropPlugin);
        const page = tab
            .getSettingDefinitions()
            .find(
                (item) => 'type' in item && item.type === 'page' && item.name === i.headingBlockMenu,
            ) as SettingDefinitionPage;
        const list = page.items![0] as SettingDefinitionList;
        expect(list.items!.map((item) => item.name)).toEqual([
            i.blockMenuParagraph,
            i.blockMenuHeading,
            i.blockMenuList,
            i.blockMenuQuote,
            i.blockMenuCallout,
            i.blockMenuCodeBlock,
            i.blockMenuMathBlock,
            i.blockMenuCustom,
        ]);
        for (const index of [0, 3, 5, 6]) {
            expect((list.items![index] as { icon?: string }).icon).toBeDefined();
        }
        expect(list.onDelete).toBeUndefined();
        expect(page.desc).toBeUndefined();
        for (const index of [1, 2, 4, 7]) {
            const groupPage = list.items![index] as SettingDefinitionPage;
            expect(groupPage.items).toBeDefined();
            expect(groupPage.desc).toBeUndefined();
        }
        list.onReorder!(7, 0);
        list.onReorder!(5, 1);
        await Promise.resolve();
        expect(plugin.saveSettings).toHaveBeenCalledTimes(2);
        expect(tab.update).toHaveBeenCalledTimes(2);
        const saved = migrateSettings(JSON.parse(JSON.stringify(plugin.settings)));
        expect(saved.blockMenuOrders.root.slice(0, 2)).toEqual(['custom', 'callout']);
        openBlockTypeMenu(view, new MouseEvent('click'), saved, 1);
        await Promise.resolve();
        const root = mock.menus[0];
        expect(titles(root).slice(0, 4)).toEqual([
            i.blockMenuCustom,
            i.blockMenuCallout,
            i.blockMenuParagraph,
            i.blockMenuHeading,
        ]);
        expect(titles(root).slice(-4)).toEqual(['', i.blockMenuCopy, i.blockMenuCut, i.blockMenuDelete]);
        if (mobile) {
            root[0].click();
            expect(titles(mock.menus.at(-1)!)).toEqual([i.blockMenuBack, 'My style']);
            mock.menus.at(-1)![0].click();
            expect(titles(mock.menus.at(-1)!).slice(0, 2)).toEqual([i.blockMenuCustom, i.blockMenuCallout]);
        } else {
            root[0].dispatchEvent(new MouseEvent('pointerenter'));
            expect(titles(Array.from(document.querySelectorAll<HTMLElement>('.d-block-type-flyout-item')))).toEqual([
                'My style',
            ]);
        }
    });

    it('retains custom style management inside the reordered Custom entry', async () => {
        mock.language = 'zh-cn';
        const i = selectTranslations(mock.language);
        const styles = [
            { ...customStyles[0], id: 'a', label: 'A' },
            { ...customStyles[0], id: 'b', label: 'B' },
        ];
        const plugin = {
            settings: migrateSettings({ customBlockStyles: styles }),
            saveSettings: vi.fn(async () => undefined),
        };
        const tab = new DragNDropSettingTab({} as App, plugin as unknown as DragNDropPlugin);
        const page = tab
            .getSettingDefinitions()
            .find(
                (item) => 'type' in item && item.type === 'page' && item.name === i.headingBlockMenu,
            ) as SettingDefinitionPage;
        const list = page.items![0] as SettingDefinitionList;
        const customPage = list.items!.find((item) => item.name === i.blockMenuCustom) as SettingDefinitionPage;
        const customList = customPage.items![0] as SettingDefinitionList;
        expect(customList.addItem).toBeDefined();
        const staleAction = (customList.items![1] as SettingDefinitionAction).action;
        customList.onReorder!(0, 1);
        expect(plugin.settings.blockMenuOrders.custom).toEqual(['b', 'a']);
        customList.onDelete!(1);
        staleAction({} as HTMLElement, 1);
        mock.modal!.onSave({ ...mock.modal!.style, label: 'Edited B' });
        expect(plugin.settings.customBlockStyles.map((style) => [style.id, style.label])).toEqual([['b', 'Edited B']]);
        await Promise.resolve();
        expect(plugin.saveSettings).toHaveBeenCalledTimes(3);
    });

    it('reports a rejected reorder save without refreshing the settings tab', async () => {
        const failure = new Error('disk full');
        const report = vi.spyOn(console, 'error').mockImplementation(() => undefined);
        const plugin = { settings: migrateSettings(null), saveSettings: vi.fn().mockRejectedValue(failure) };
        const tab = new DragNDropSettingTab({} as App, plugin as unknown as DragNDropPlugin);
        const page = tab.getSettingDefinitions()[2] as SettingDefinitionPage;
        const list = page.items![0] as SettingDefinitionList;
        list.onReorder!(0, 1);
        await vi.waitFor(() => expect(report).toHaveBeenCalledWith('Dragger: failed to save settings', failure));
        expect(tab.update).not.toHaveBeenCalled();
    });

    it('supplies native page drag handles without replacing native page navigation', async () => {
        mock.language = 'zh-cn';
        const plugin = { settings: migrateSettings(null), saveSettings: vi.fn(async () => undefined) };
        const tab = new DragNDropSettingTab({} as App, plugin as unknown as DragNDropPlugin);
        const page = tab.getSettingDefinitions()[2] as SettingDefinitionPage;
        const list = page.items![0] as SettingDefinitionList;
        const listEl = document.body.appendChild(document.createElement('div'));
        const rows = list.items!.map((definition) => {
            const row = listEl.appendChild(document.createElement('div'));
            row.className = 'type' in definition ? 'setting-item mod-navigable' : 'setting-item';
            const name = row.appendChild(document.createElement('div'));
            name.className = 'setting-item-name';
            name.textContent = definition.name;
            const control = row.appendChild(document.createElement('div'));
            control.className = 'setting-item-control';
            if (!('type' in definition)) {
                const handle = control.appendChild(document.createElement('div'));
                handle.className = 'mod-drag-handle';
            }
            return row;
        });
        const hookIndex = list.items!.findIndex((definition) => 'render' in definition);
        const hook = list.items![hookIndex] as SettingDefinitionRender;
        const setting = { settingEl: rows[hookIndex] } as Setting;
        hook.render(setting, { listEl } as SettingGroup);
        await Promise.resolve();
        expect(rows[hookIndex].querySelector('.setting-item-icon')?.getAttribute('data-icon')).toBe('pilcrow');
        for (const row of rows) expect(row.querySelectorAll('.mod-drag-handle')).toHaveLength(1);
        const navigate = vi.fn();
        rows[1].addEventListener('click', navigate);
        rows[1].querySelector<HTMLElement>('.mod-drag-handle')!.click();
        expect(navigate).not.toHaveBeenCalled();
        rows[1].click();
        expect(navigate).toHaveBeenCalledOnce();
        hook.render(setting, { listEl } as SettingGroup);
        await Promise.resolve();
        for (const row of rows) expect(row.querySelectorAll('.mod-drag-handle')).toHaveLength(1);
        expect(rows[hookIndex].querySelectorAll('.setting-item-icon')).toHaveLength(1);
    });

    it.each([
        ['heading', false],
        ['heading', true],
        ['list', false],
        ['list', true],
        ['callout', false],
        ['callout', true],
    ] as const)('persists %s child order in the editor menu (mobile=%s)', async (groupId, mobile) => {
        mock.language = 'zh-cn';
        Platform.isMobile = mobile;
        Platform.isDesktop = !mobile;
        const plugin = { settings: migrateSettings(null), saveSettings: vi.fn(async () => undefined) };
        const tab = new DragNDropSettingTab({} as App, plugin as unknown as DragNDropPlugin);
        const entries = getBlockMenuEntries(plugin.settings);
        const group = entries.find((entry) => entry.id === groupId)!;
        if (!('options' in group)) throw new Error('Group is missing');
        const page = tab.getSettingDefinitions()[2] as SettingDefinitionPage;
        const rootList = page.items![0] as SettingDefinitionList;
        const childPage = rootList.items!.find((item) => item.name === group.label) as SettingDefinitionPage;
        const childList = childPage.items![0] as SettingDefinitionList;
        childList.onReorder!(0, group.options.length - 1);
        await Promise.resolve();
        const saved = migrateSettings(JSON.parse(JSON.stringify(plugin.settings)));
        const expected = [...group.options.slice(1), group.options[0]];
        expect(saved.blockMenuOrders[groupId]).toEqual(expected.map((option) => option.id));
        expect(plugin.saveSettings).toHaveBeenCalledOnce();
        openBlockTypeMenu(view, new MouseEvent('click'), saved, 1);
        await Promise.resolve();
        const trigger = mock.menus[0][saved.blockMenuOrders.root.indexOf(groupId)];
        if (mobile) {
            trigger.click();
            const rows = mock.menus.at(-1)!;
            expect(titles(rows).slice(1)).toEqual(expected.map((option) => option.label));
            rows[1].click();
        } else {
            trigger.dispatchEvent(new MouseEvent('pointerenter'));
            const rows = Array.from(document.querySelectorAll<HTMLElement>('.d-block-type-flyout-item'));
            expect(titles(rows)).toEqual(expected.map((option) => option.label));
            rows[0].dispatchEvent(new MouseEvent('pointerdown'));
        }
        expect(mock.convert).toHaveBeenLastCalledWith(view, expected[0].target, 1);
    });

    it('edits and deletes the selected custom style after reordering by ID', async () => {
        mock.language = 'zh-cn';
        const styles = [
            { ...customStyles[0], id: 'a', label: 'A' },
            { ...customStyles[0], id: 'b', label: 'B' },
        ];
        const plugin = {
            settings: migrateSettings({ customBlockStyles: styles }),
            saveSettings: vi.fn(async () => undefined),
        };
        const tab = new DragNDropSettingTab({} as App, plugin as unknown as DragNDropPlugin);
        const list = () => {
            const page = tab.getSettingDefinitions()[2] as SettingDefinitionPage;
            const root = page.items![0] as SettingDefinitionList;
            const custom = root.items![7] as SettingDefinitionPage;
            return custom.items![0] as SettingDefinitionList;
        };
        list().onReorder!(0, 1);
        const edit = list().items![0] as { action: () => void };
        edit.action();
        expect(mock.modal!.style.id).toBe('b');
        mock.modal!.onSave({ ...mock.modal!.style, label: 'B edited' });
        expect(plugin.settings.customBlockStyles.map((style) => style.label)).toEqual(['A', 'B edited']);
        list().onDelete!(0);
        expect(plugin.settings.customBlockStyles.map((style) => style.id)).toEqual(['a']);
        expect(plugin.settings.blockMenuOrders.custom).toEqual(['a']);
        await Promise.resolve();
        expect(migrateSettings(plugin.settings)).toEqual(plugin.settings);
    });

    it('registers a new custom style in the shared order map', async () => {
        mock.language = 'zh-cn';
        const plugin = { settings: migrateSettings(null), saveSettings: vi.fn(async () => undefined) };
        const tab = new DragNDropSettingTab({} as App, plugin as unknown as DragNDropPlugin);
        const page = tab.getSettingDefinitions()[2] as SettingDefinitionPage;
        const root = page.items![0] as SettingDefinitionList;
        const childPage = root.items![7] as SettingDefinitionPage;
        const childList = childPage.items![0] as SettingDefinitionList;
        childList.addItem!.action(document.createElement('div'));
        const style = { ...mock.modal!.style, label: 'New style' };
        mock.modal!.onSave(style);
        expect(plugin.settings.customBlockStyles).toEqual([style]);
        expect(plugin.settings.blockMenuOrders.custom).toEqual([style.id]);
        expect(migrateSettings(plugin.settings)).toEqual(plugin.settings);
        await Promise.resolve();
        expect(plugin.saveSettings).toHaveBeenCalledOnce();
    });
});
