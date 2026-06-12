import { App, PluginSettingTab, Setting } from 'obsidian';
import DragNDropPlugin from './main';
import { t } from './i18n';
import {
    DEFAULT_SETTINGS,
    NUMERIC_SETTING_RANGES,
} from './settings-types';
import type {
    BlockSelectionVisualStyle,
    HandleGutterPosition,
    HandleIconStyle,
    HandleVisibilityMode,
    MobileDragModeToggleLocation,
} from './settings-types';
import { platform } from './platform';

export {
    DEFAULT_SETTINGS,
    DEFAULT_MULTI_LINE_SELECTION_LONG_PRESS_MS,
} from './settings-types';
export type {
    DragNDropSettings,
    BlockSelectionVisualStyle,
    HandleGutterPosition,
    HandleIconStyle,
    HandleVisibilityMode,
    MobileDragModeToggleLocation,
} from './settings-types';

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

        this.addNumericSetting(containerEl, {
            name: i.handleSize, desc: i.handleSizeDesc,
            ...NUMERIC_SETTING_RANGES.handleSize,
            value: this.plugin.settings.handleSize,
            defaultValue: DEFAULT_SETTINGS.handleSize,
            onChange: async (v) => { this.plugin.settings.handleSize = v; await this.plugin.saveSettings(); },
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

        this.addNumericSetting(containerEl, {
            name: i.handleOffset, desc: i.handleOffsetDesc,
            ...NUMERIC_SETTING_RANGES.handleHorizontalOffsetPx,
            value: this.plugin.settings.handleHorizontalOffsetPx,
            defaultValue: DEFAULT_SETTINGS.handleHorizontalOffsetPx,
            onChange: async (v) => { this.plugin.settings.handleHorizontalOffsetPx = v; await this.plugin.saveSettings(); },
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

        this.addNumericSetting(containerEl, {
            name: i.multiLineSelectionLongPressMs, desc: i.multiLineSelectionLongPressMsDesc,
            ...NUMERIC_SETTING_RANGES.multiLineSelectionLongPressMs,
            value: this.plugin.settings.multiLineSelectionLongPressMs,
            defaultValue: DEFAULT_SETTINGS.multiLineSelectionLongPressMs,
            onChange: async (v) => { this.plugin.settings.multiLineSelectionLongPressMs = v; await this.plugin.saveSettings(); },
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

        this.addNumericSetting(containerEl, {
            name: i.mobileDragLongPressMs, desc: i.mobileDragLongPressMsDesc,
            ...NUMERIC_SETTING_RANGES.mobileDragLongPressMs,
            value: this.plugin.settings.mobileDragLongPressMs,
            defaultValue: DEFAULT_SETTINGS.mobileDragLongPressMs,
            onChange: async (v) => { this.plugin.settings.mobileDragLongPressMs = v; await this.plugin.saveSettings(); },
        });

        this.addNumericSetting(containerEl, {
            name: i.mouseRangeSelectLongPressMs, desc: i.mouseRangeSelectLongPressMsDesc,
            ...NUMERIC_SETTING_RANGES.mouseRangeSelectLongPressMs,
            value: this.plugin.settings.mouseRangeSelectLongPressMs,
            defaultValue: DEFAULT_SETTINGS.mouseRangeSelectLongPressMs,
            onChange: async (v) => { this.plugin.settings.mouseRangeSelectLongPressMs = v; await this.plugin.saveSettings(); },
        });

        this.addNumericSetting(containerEl, {
            name: i.autoScrollEdgeZonePx, desc: i.autoScrollEdgeZonePxDesc,
            ...NUMERIC_SETTING_RANGES.autoScrollEdgeZonePx,
            value: this.plugin.settings.autoScrollEdgeZonePx,
            defaultValue: DEFAULT_SETTINGS.autoScrollEdgeZonePx,
            onChange: async (v) => { this.plugin.settings.autoScrollEdgeZonePx = v; await this.plugin.saveSettings(); },
        });

        this.addNumericSetting(containerEl, {
            name: i.autoScrollMaxSpeedPx, desc: i.autoScrollMaxSpeedPxDesc,
            ...NUMERIC_SETTING_RANGES.autoScrollMaxSpeedPx,
            value: this.plugin.settings.autoScrollMaxSpeedPx,
            defaultValue: DEFAULT_SETTINGS.autoScrollMaxSpeedPx,
            onChange: async (v) => { this.plugin.settings.autoScrollMaxSpeedPx = v; await this.plugin.saveSettings(); },
        });

        const isMobile = platform.isMobile;

        new Setting(containerEl).setName(i.headingMobile).setHeading();

        if (!isMobile) {
            new Setting(containerEl).setDesc(i.mobileOnlyNotice);
        }

        new Setting(containerEl)
            .setName(i.mobileTextLongPressDrag)
            .setDesc(i.mobileTextLongPressDragDesc)
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.enableMobileTextLongPressDrag)
                .setDisabled(!isMobile)
                .onChange(async (value) => {
                    this.plugin.settings.enableMobileTextLongPressDrag = value;
                    await this.plugin.saveSettings();
                    this.display();
                }));

        if (this.plugin.settings.enableMobileTextLongPressDrag && isMobile) {
            new Setting(containerEl).setName(i.mobileDragModeToggleLocations).setHeading();

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
            .addToggle(toggle => toggle
                .setValue(this.plugin.settings.disableMobileDragModeAfterDrop)
                .setDisabled(!isMobile)
                .onChange(async (value) => {
                    this.plugin.settings.disableMobileDragModeAfterDrop = value;
                    await this.plugin.saveSettings();
                }));
    }

    private addNumericSetting(
        containerEl: HTMLElement,
        opts: {
            name: string;
            desc: string;
            min: number;
            max: number;
            step: number;
            value: number;
            defaultValue: number;
            onChange: (value: number) => Promise<void>;
        },
    ): void {
        let textInput!: import('obsidian').TextComponent;
        let resetBtn!: import('obsidian').ExtraButtonComponent;
        let currentValue = opts.value;

        const updateResetVisibility = () => {
            resetBtn.extraSettingsEl.toggle(currentValue !== opts.defaultValue);
        };

        new Setting(containerEl)
            .setName(opts.name)
            .setDesc(opts.desc)
            .addSlider((slider) => slider
                .setLimits(opts.min, opts.max, opts.step)
                .setValue(opts.value)
                .onChange(async (value) => {
                    currentValue = value;
                    textInput.setValue(String(value));
                    updateResetVisibility();
                    await opts.onChange(value);
                }))
            .addText((text) => {
                textInput = text;
                text.inputEl.type = 'number';
                text.inputEl.addClass('dnd-setting-number-input');
                text.setValue(String(opts.value));
                text.inputEl.addEventListener('blur', () => {
                    const v = Math.round(Math.max(opts.min, Math.min(opts.max, Number(text.inputEl.value) || opts.defaultValue)));
                    currentValue = v;
                    text.setValue(String(v));
                    updateResetVisibility();
                    void opts.onChange(v);
                });
                text.inputEl.addEventListener('keydown', (e: KeyboardEvent) => {
                    if (e.key === 'Enter') { e.preventDefault(); text.inputEl.blur(); }
                });
            })
            .addExtraButton((btn) => {
                resetBtn = btn;
                btn.setIcon('reset')
                    .onClick(() => {
                        void opts.onChange(opts.defaultValue).then(() => this.display());
                    });
                btn.extraSettingsEl.toggle(opts.value !== opts.defaultValue);
            });
    }

    private resolveThemeAccent(): string {
        const el = activeDocument.body.createEl('div', { cls: 'dnd-theme-accent-probe' });
        const rgb = getComputedStyle(el).backgroundColor;
        el.remove();
        const match = rgb.match(/(\d+),\s*(\d+),\s*(\d+)/);
        if (!match) return '#7b6cd9';
        const [, r, g, b] = match;
        return `#${[r, g, b].map(c => Number(c).toString(16).padStart(2, '0')).join('')}`;
    }
}
