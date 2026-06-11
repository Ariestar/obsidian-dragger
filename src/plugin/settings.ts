import { App, PluginSettingTab, Setting } from 'obsidian';
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
    enableCrossFileDrag: false,
    enableMultiLineSelection: true,
    multiLineSelectionLongPressMs: DEFAULT_MULTI_LINE_SELECTION_LONG_PRESS_MS,
    disableMobileDragModeAfterDrop: true,
    enableMobileTextLongPressDrag: true,
    mobileDragModeToggleLocations: ['view-action', 'toolbar-command'],
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

    constructor(app: App, plugin: DragNDropPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    display(): void {
        const { containerEl } = this;
        containerEl.empty();
        const i = t();

        new Setting(containerEl).setName(i.headingAppearance).setHeading();

        const colorSetting = new Setting(containerEl)
            .setName(i.handleColor)
            .setDesc(i.handleColorDesc);

        colorSetting.addDropdown(dropdown => dropdown
            .addOption('theme', i.optionTheme)
            .addOption('custom', i.optionCustom)
            .setValue(this.plugin.settings.handleColorMode)
            .onChange(async (value: 'theme' | 'custom') => {
                this.plugin.settings.handleColorMode = value;
                await this.plugin.saveSettings();
            }));

        colorSetting.addColorPicker(picker => picker
            .setValue(this.plugin.settings.handleColor)
            .onChange(async (value) => {
                this.plugin.settings.handleColor = value;
                await this.plugin.saveSettings();
            }));

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

        new Setting(containerEl)
            .setName(i.handleSize)
            .setDesc(i.handleSizeDesc)
            .addSlider((slider) => slider
                .setLimits(MIN_HANDLE_SIZE_PX, MAX_HANDLE_SIZE_PX, 2)
                .setValue(this.plugin.settings.handleSize)
                .onChange(async (value) => {
                    this.plugin.settings.handleSize = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(i.handleOffset)
            .setDesc(i.handleOffsetDesc)
            .addSlider((slider) => slider
                .setLimits(-80, 80, 1)
                .setValue(this.plugin.settings.handleHorizontalOffsetPx)
                .onChange(async (value) => {
                    this.plugin.settings.handleHorizontalOffsetPx = value;
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
            }));

        indicatorSetting.addColorPicker(picker => picker
            .setValue(this.plugin.settings.indicatorColor)
            .onChange(async (value) => {
                this.plugin.settings.indicatorColor = value;
                await this.plugin.saveSettings();
            }));

        new Setting(containerEl).setName(i.headingBehavior).setHeading();
        new Setting(containerEl)
            .setName(i.multiLineSelection)
            .setDesc(i.multiLineSelectionDesc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableMultiLineSelection)
                .onChange(async (value) => {
                    this.plugin.settings.enableMultiLineSelection = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(i.multiLineSelectionLongPressMs)
            .setDesc(i.multiLineSelectionLongPressMsDesc)
            .addText((text) => {
                const commit = async () => {
                    const normalized = normalizeMultiLineSelectionLongPressMs(Number(text.inputEl.value));
                    const normalizedValue = String(normalized);
                    if (text.inputEl.value !== normalizedValue) {
                        text.setValue(normalizedValue);
                    }
                    if (this.plugin.settings.multiLineSelectionLongPressMs === normalized) {
                        return;
                    }
                    this.plugin.settings.multiLineSelectionLongPressMs = normalized;
                    await this.plugin.saveSettings();
                };

                text.inputEl.type = 'number';
                text.inputEl.inputMode = 'numeric';
                text.inputEl.min = String(MIN_MULTI_LINE_SELECTION_LONG_PRESS_MS);
                text.inputEl.max = String(MAX_MULTI_LINE_SELECTION_LONG_PRESS_MS);
                text.inputEl.step = '1';
                text.setPlaceholder(`${MIN_MULTI_LINE_SELECTION_LONG_PRESS_MS}-${MAX_MULTI_LINE_SELECTION_LONG_PRESS_MS}`);
                text.setValue(String(this.plugin.settings.multiLineSelectionLongPressMs));
                text.inputEl.addEventListener('blur', () => {
                    void commit();
                });
                text.inputEl.addEventListener('keydown', (event: KeyboardEvent) => {
                    if (event.key !== 'Enter') return;
                    event.preventDefault();
                    text.inputEl.blur();
                });
            });

        new Setting(containerEl)
            .setName(i.disableMobileDragModeAfterDrop)
            .setDesc(i.disableMobileDragModeAfterDropDesc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.disableMobileDragModeAfterDrop)
                .onChange(async (value) => {
                    this.plugin.settings.disableMobileDragModeAfterDrop = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName(i.mobileTextLongPressDrag)
            .setDesc(i.mobileTextLongPressDragDesc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableMobileTextLongPressDrag)
                .onChange(async (value) => {
                    this.plugin.settings.enableMobileTextLongPressDrag = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (this.plugin.settings.enableMobileTextLongPressDrag) {
            const toggleLocation = async (location: MobileDragModeToggleLocation, enabled: boolean) => {
                const next = new Set(this.plugin.settings.mobileDragModeToggleLocations);
                if (enabled) {
                    next.add(location);
                } else {
                    next.delete(location);
                }
                this.plugin.settings.mobileDragModeToggleLocations = Array.from(next);
                await this.plugin.saveSettings();
            };
            new Setting(containerEl)
                .setName(i.mobileDragModeToggleLocations)
                .setDesc(i.mobileDragModeToggleLocationsDesc)
                .addToggle(toggle => {
                    toggle.toggleEl.insertAdjacentText('beforebegin', `${i.optionMobileDragModeToggleViewAction} `);
                    return toggle
                        .setTooltip(i.optionMobileDragModeToggleViewAction)
                        .setValue(this.plugin.settings.mobileDragModeToggleLocations.includes('view-action'))
                        .onChange((value) => toggleLocation('view-action', value));
                })
                .addToggle(toggle => {
                    toggle.toggleEl.insertAdjacentText('beforebegin', `${i.optionMobileDragModeToggleToolbarCommand} `);
                    return toggle
                        .setTooltip(i.optionMobileDragModeToggleToolbarCommand)
                        .setValue(this.plugin.settings.mobileDragModeToggleLocations.includes('toolbar-command'))
                        .onChange((value) => toggleLocation('toolbar-command', value));
                });
        }
        new Setting(containerEl)
            .setName(i.enableCrossFileDrag)
            .setDesc(i.enableCrossFileDragDesc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableCrossFileDrag)
                .onChange(async (value) => {
                    this.plugin.settings.enableCrossFileDrag = value;
                    await this.plugin.saveSettings();
                }));
    }
}
