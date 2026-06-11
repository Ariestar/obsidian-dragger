import { App, Platform, PluginSettingTab, Setting } from 'obsidian';
import DragNDropPlugin from './main';
import { t } from './i18n';
import {
    DEFAULT_HANDLE_SIZE_PX,
    MAX_HANDLE_SIZE_PX,
    MIN_HANDLE_SIZE_PX,
} from '../shared/constants';
import type {
    DragNDropSettings,
    BlockSelectionVisualStyle,
    HandleGutterPosition,
    HandleIconStyle,
    HandleVisibilityMode,
    MobileDragModeToggleLocation,
} from './settings-types';

export type {
    DragNDropSettings,
    BlockSelectionVisualStyle,
    HandleGutterPosition,
    HandleIconStyle,
    HandleVisibilityMode,
    MobileDragModeToggleLocation,
} from './settings-types';

export const DEFAULT_MULTI_LINE_SELECTION_LONG_PRESS_MS = 900;
const MIN_MULTI_LINE_SELECTION_LONG_PRESS_MS = 300;
const MAX_MULTI_LINE_SELECTION_LONG_PRESS_MS = 2000;

export function normalizeMultiLineSelectionLongPressMs(value: unknown): number {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return DEFAULT_MULTI_LINE_SELECTION_LONG_PRESS_MS;
    }
    return Math.max(
        MIN_MULTI_LINE_SELECTION_LONG_PRESS_MS,
        Math.min(MAX_MULTI_LINE_SELECTION_LONG_PRESS_MS, Math.round(value))
    );
}

export const DEFAULT_SETTINGS: DragNDropSettings = {
    handleColorMode: 'theme',
    handleColor: '#8a8a8a',
    handleVisibility: 'hover',
    handleIcon: 'grip-dots',
    handleSize: DEFAULT_HANDLE_SIZE_PX,
    indicatorColorMode: 'theme',
    indicatorColor: '#7a7a7a',
    enableCrossFileDrag: true,
    enableMultiLineSelection: true,
    multiLineSelectionLongPressMs: DEFAULT_MULTI_LINE_SELECTION_LONG_PRESS_MS,
    disableMobileDragModeAfterDrop: true,
    enableMobileTextLongPressDrag: true,
    mobileDragModeToggleLocations: ['view-action'],
    enableBlockSelectionHighlight: true,
    enableListDropHighlight: true,
    selectionVisualStyle: 'subtle',
    handleHorizontalOffsetPx: -8,
    handleGutterPosition: 'left',
};

export function normalizeHandleGutterPosition(value: unknown): HandleGutterPosition {
    return value === 'right' ? 'right' : 'left';
}

export function normalizeBlockSelectionVisualStyle(value: unknown): BlockSelectionVisualStyle {
    if (value === 'outline' || value === 'subtle' || value === 'filled') {
        return value;
    }
    // Legacy migration: old "none" is mapped to minimal-but-on style.
    if (value === 'none') {
        return 'outline';
    }
    return 'subtle';
}

export function normalizeMobileDragModeToggleLocations(value: unknown): MobileDragModeToggleLocation[] {
    if (!Array.isArray(value)) return [...DEFAULT_SETTINGS.mobileDragModeToggleLocations];
    const locations = value.filter((entry): entry is MobileDragModeToggleLocation => (
        entry === 'view-action' || entry === 'toolbar-command'
    ));
    return Array.from(new Set(locations));
}

export class DragNDropSettingTab extends PluginSettingTab {
    plugin: DragNDropPlugin;
    private activeTab: 'appearance' | 'behavior' = 'appearance';

    constructor(app: App, plugin: DragNDropPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        const i = t();

        // ── Tab Nav ──
        const nav = containerEl.createDiv('dnd-settings-nav');
        const tabAppearance = nav.createEl('button', {
            text: i.headingAppearance,
            cls: `dnd-settings-tab ${this.activeTab === 'appearance' ? 'is-active' : ''}`,
        });
        const tabBehavior = nav.createEl('button', {
            text: i.headingBehavior,
            cls: `dnd-settings-tab ${this.activeTab === 'behavior' ? 'is-active' : ''}`,
        });
        tabAppearance.addEventListener('click', () => { this.activeTab = 'appearance'; this.display(); });
        tabBehavior.addEventListener('click', () => { this.activeTab = 'behavior'; this.display(); });

        if (this.activeTab === 'appearance') {
            this.displayAppearance(containerEl, i);
        } else {
            this.displayBehavior(containerEl, i);
        }
    }

    private displayAppearance(containerEl: HTMLElement, i: ReturnType<typeof t>): void {
        new Setting(containerEl).setName(i.headingHandle).setHeading();

        new Setting(containerEl)
            .setName(i.handleIcon)
            .setDesc(i.handleIconDesc)
            .addDropdown(dropdown => dropdown
                .addOption('dot', i.iconDot)
                .addOption('grip-dots', i.iconGripDots)
                .addOption('grip-lines', i.iconGripLines)
                .addOption('square', i.iconSquare)
                .setValue(this.plugin.settings.handleIcon)
                .onChange(async (value: HandleIconStyle) => {
                    this.plugin.settings.handleIcon = value;
                    await this.plugin.saveSettings();
                }));

        const colorSetting = new Setting(containerEl)
            .setName(i.handleColor)
            .setDesc(i.handleColorDesc);

        const themeAccent = this.resolveThemeAccent();

        colorSetting.addDropdown(dropdown => dropdown
            .addOption('theme', i.optionTheme)
            .addOption('custom', i.optionCustom)
            .setValue(this.plugin.settings.handleColorMode)
            .onChange(async (value: 'theme' | 'custom') => {
                this.plugin.settings.handleColorMode = value;
                await this.plugin.saveSettings();
                this.display();
            }));

        colorSetting.addColorPicker(picker => {
            const isTheme = this.plugin.settings.handleColorMode === 'theme';
            picker
                .setValue(isTheme ? themeAccent : this.plugin.settings.handleColor)
                .setDisabled(isTheme)
                .onChange(async (value) => {
                    this.plugin.settings.handleColor = value;
                    await this.plugin.saveSettings();
                });
        });

        let sizeInput!: import('obsidian').TextComponent;
        new Setting(containerEl)
            .setName(i.handleSize)
            .setDesc(i.handleSizeDesc)
            .addSlider((slider) => slider
                .setLimits(MIN_HANDLE_SIZE_PX, MAX_HANDLE_SIZE_PX, 2)
                .setValue(this.plugin.settings.handleSize)
                .onChange(async (value) => {
                    this.plugin.settings.handleSize = value;
                    sizeInput.setValue(String(value));
                    await this.plugin.saveSettings();
                }))
            .addText((text) => {
                sizeInput = text;
                text.inputEl.type = 'number';
                text.inputEl.addClass('dnd-setting-number-input');
                text.setValue(String(this.plugin.settings.handleSize));
                text.inputEl.addEventListener('blur', async () => {
                    const v = Math.round(Math.max(MIN_HANDLE_SIZE_PX, Math.min(MAX_HANDLE_SIZE_PX, Number(text.inputEl.value) || MIN_HANDLE_SIZE_PX)));
                    text.setValue(String(v));
                    this.plugin.settings.handleSize = v;
                    await this.plugin.saveSettings();
                    this.display();
                });
                text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter') { e.preventDefault(); text.inputEl.blur(); }
                });
            });

        new Setting(containerEl)
            .setName(i.handleVisibility)
            .setDesc(i.handleVisibilityDesc)
            .addDropdown(dropdown => dropdown
                .addOption('hover', i.optionHover)
                .addOption('always', i.optionAlways)
                .addOption('hidden', i.optionHidden)
                .setValue(this.plugin.settings.handleVisibility)
                .onChange(async (value: HandleVisibilityMode) => {
                    this.plugin.settings.handleVisibility = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(i.handleGutterPosition)
            .setDesc(i.handleGutterPositionDesc)
            .addDropdown(dropdown => dropdown
                .addOption('left', i.optionLeft)
                .addOption('right', i.optionRight)
                .setValue(this.plugin.settings.handleGutterPosition)
                .onChange(async (value: HandleGutterPosition) => {
                    this.plugin.settings.handleGutterPosition = value;
                    await this.plugin.saveSettings();
                }));

        let offsetInput!: import('obsidian').TextComponent;
        new Setting(containerEl)
            .setName(i.handleOffset)
            .setDesc(i.handleOffsetDesc)
            .addSlider((slider) => slider
                .setLimits(-80, 80, 1)
                .setValue(this.plugin.settings.handleHorizontalOffsetPx)
                .onChange(async (value) => {
                    this.plugin.settings.handleHorizontalOffsetPx = value;
                    offsetInput.setValue(String(value));
                    await this.plugin.saveSettings();
                }))
            .addText((text) => {
                offsetInput = text;
                text.inputEl.type = 'number';
                text.inputEl.addClass('dnd-setting-number-input');
                text.setValue(String(this.plugin.settings.handleHorizontalOffsetPx));
                text.inputEl.addEventListener('blur', async () => {
                    const v = Math.round(Math.max(-80, Math.min(80, Number(text.inputEl.value) || 0)));
                    text.setValue(String(v));
                    this.plugin.settings.handleHorizontalOffsetPx = v;
                    await this.plugin.saveSettings();
                    this.display();
                });
                text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter') { e.preventDefault(); text.inputEl.blur(); }
                });
            });

        new Setting(containerEl).setName(i.headingHighlight).setHeading();

        new Setting(containerEl)
            .setName(i.selectionVisualStyle)
            .setDesc(i.selectionVisualStyleDesc)
            .addDropdown(dropdown => dropdown
                .addOption('outline', i.optionBlockSelectionVisualOutline)
                .addOption('subtle', i.optionBlockSelectionVisualSubtle)
                .addOption('filled', i.optionBlockSelectionVisualFilled)
                .setValue(this.plugin.settings.selectionVisualStyle)
                .onChange(async (value: BlockSelectionVisualStyle) => {
                    this.plugin.settings.selectionVisualStyle = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(i.enableBlockSelectionHighlight)
            .setDesc(i.enableBlockSelectionHighlightDesc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableBlockSelectionHighlight)
                .onChange(async (value) => {
                    this.plugin.settings.enableBlockSelectionHighlight = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(i.enableListDropHighlight)
            .setDesc(i.enableListDropHighlightDesc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableListDropHighlight)
                .onChange(async (value) => {
                    this.plugin.settings.enableListDropHighlight = value;
                    await this.plugin.saveSettings();
                }));

        const indicatorSetting = new Setting(containerEl)
            .setName(i.indicatorColor)
            .setDesc(i.indicatorColorDesc);

        indicatorSetting.addDropdown(dropdown => dropdown
            .addOption('theme', i.optionTheme)
            .addOption('custom', i.optionCustom)
            .setValue(this.plugin.settings.indicatorColorMode)
            .onChange(async (value: 'theme' | 'custom') => {
                this.plugin.settings.indicatorColorMode = value;
                await this.plugin.saveSettings();
                this.display();
            }));

        indicatorSetting.addColorPicker(picker => {
            const isTheme = this.plugin.settings.indicatorColorMode === 'theme';
            picker
                .setValue(isTheme ? themeAccent : this.plugin.settings.indicatorColor)
                .setDisabled(isTheme)
                .onChange(async (value) => {
                    this.plugin.settings.indicatorColor = value;
                    await this.plugin.saveSettings();
                });
        });
    }

    private displayBehavior(containerEl: HTMLElement, i: ReturnType<typeof t>): void {
        new Setting(containerEl)
            .setName(i.multiLineSelection)
            .setDesc(i.multiLineSelectionDesc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableMultiLineSelection)
                .onChange(async (value) => {
                    this.plugin.settings.enableMultiLineSelection = value;
                    await this.plugin.saveSettings();
                }));

        let longPressInput!: import('obsidian').TextComponent;
        new Setting(containerEl)
            .setName(i.multiLineSelectionLongPressMs)
            .setDesc(i.multiLineSelectionLongPressMsDesc)
            .addSlider((slider) => slider
                .setLimits(MIN_MULTI_LINE_SELECTION_LONG_PRESS_MS, MAX_MULTI_LINE_SELECTION_LONG_PRESS_MS, 50)
                .setValue(this.plugin.settings.multiLineSelectionLongPressMs)
                .onChange(async (value) => {
                    this.plugin.settings.multiLineSelectionLongPressMs = value;
                    longPressInput.setValue(String(value));
                    await this.plugin.saveSettings();
                }))
            .addText((text) => {
                longPressInput = text;
                text.inputEl.type = 'number';
                text.inputEl.addClass('dnd-setting-number-input');
                text.setValue(String(this.plugin.settings.multiLineSelectionLongPressMs));
                text.inputEl.addEventListener('blur', async () => {
                    const v = normalizeMultiLineSelectionLongPressMs(Number(text.inputEl.value));
                    text.setValue(String(v));
                    this.plugin.settings.multiLineSelectionLongPressMs = v;
                    await this.plugin.saveSettings();
                    this.display();
                });
                text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter') { e.preventDefault(); text.inputEl.blur(); }
                });
            });

        new Setting(containerEl)
            .setName(i.enableCrossFileDrag)
            .setDesc(i.enableCrossFileDragDesc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableCrossFileDrag)
                .onChange(async (value) => {
                    this.plugin.settings.enableCrossFileDrag = value;
                    await this.plugin.saveSettings();
                }));

        const isMobile = Platform.isMobile;
        const disabledCls = isMobile ? '' : 'dnd-setting-disabled';

        new Setting(containerEl).setName(i.headingMobile).setHeading();

        if (!isMobile) {
            new Setting(containerEl).setDesc(i.mobileOnlyNotice);
        }

        new Setting(containerEl)
            .setName(i.mobileTextLongPressDrag)
            .setDesc(i.mobileTextLongPressDragDesc)
            .setClass(disabledCls)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableMobileTextLongPressDrag)
                .setDisabled(!isMobile)
                .onChange(async (value) => {
                    this.plugin.settings.enableMobileTextLongPressDrag = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (this.plugin.settings.enableMobileTextLongPressDrag && isMobile) {
            new Setting(containerEl)
                .setName(i.mobileDragModeToggleLocations)
                .setDesc(i.mobileDragModeToggleLocationsDesc);

            const toggleLocation = async (location: MobileDragModeToggleLocation, enabled: boolean) => {
                const next = new Set(this.plugin.settings.mobileDragModeToggleLocations);
                if (enabled) { next.add(location); } else { next.delete(location); }
                this.plugin.settings.mobileDragModeToggleLocations = Array.from(next);
                await this.plugin.saveSettings();
            };

            new Setting(containerEl)
                .setName(i.optionMobileDragModeToggleViewAction)
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.mobileDragModeToggleLocations.includes('view-action'))
                    .onChange((value) => toggleLocation('view-action', value)));

            new Setting(containerEl)
                .setName(i.optionMobileDragModeToggleToolbarCommand)
                .addToggle(toggle => toggle
                    .setValue(this.plugin.settings.mobileDragModeToggleLocations.includes('toolbar-command'))
                    .onChange((value) => toggleLocation('toolbar-command', value)));
        }

        new Setting(containerEl)
            .setName(i.disableMobileDragModeAfterDrop)
            .setDesc(i.disableMobileDragModeAfterDropDesc)
            .setClass(disabledCls)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.disableMobileDragModeAfterDrop)
                .setDisabled(!isMobile)
                .onChange(async (value) => {
                    this.plugin.settings.disableMobileDragModeAfterDrop = value;
                    await this.plugin.saveSettings();
                }));
    }

    private resolveThemeAccent(): string {
        const el = document.body.createEl('div');
        el.style.display = 'none';
        el.style.backgroundColor = 'var(--interactive-accent)';
        const rgb = getComputedStyle(el).backgroundColor;
        el.remove();
        const match = rgb.match(/(\d+),\s*(\d+),\s*(\d+)/);
        if (!match) return '#7b6cd9';
        const [, r, g, b] = match;
        return `#${[r, g, b].map(c => Number(c).toString(16).padStart(2, '0')).join('')}`;
    }
}
