import { App, Platform, PluginSettingTab } from 'obsidian';
import type { SettingDefinition, SettingDefinitionItem } from 'obsidian';
import DragNDropPlugin from './main';
import { t } from './i18n';
import { CustomBlockStyleModal } from './settings-custom-styles-modal';
import { NUMERIC_SETTING_RANGES } from './settings-types';

// Declarative settings (Obsidian 1.13+): getSettingDefinitions() takes
// precedence over display() and renders the tab, so the plugin exposes all
// options through the declarative API and no imperative renderer remains.
export class DragNDropSettingTab extends PluginSettingTab {
    plugin: DragNDropPlugin;

    constructor(app: App, plugin: DragNDropPlugin) {
        super(app, plugin);
        this.plugin = plugin;
    }

    getSettingDefinitions(): SettingDefinitionItem[] {
        const i = t();
        const numeric = (
            key: string,
            range: { min: number; max: number; step: number },
            name: string,
            desc: string,
        ): SettingDefinition => ({
            name,
            desc,
            control: {
                type: 'slider',
                key,
                min: range.min,
                max: range.max,
                step: range.step,
            },
        });
        const mobileOnly = () => Platform.isMobile && this.plugin.settings.enableMobileTextLongPressDrag;
        return [
            {
                type: 'page',
                name: i.headingAppearance,
                items: [
                    {
                        name: i.handleIcon,
                        desc: i.handleIconDesc,
                        control: {
                            type: 'dropdown',
                            key: 'handleIcon',
                            options: {
                                dot: i.iconDot,
                                'grip-dots': i.iconGripDots,
                                'grip-lines': i.iconGripLines,
                                square: i.iconSquare,
                            },
                        },
                    },
                    {
                        name: i.handleColor,
                        desc: i.handleColorDesc,
                        control: {
                            type: 'dropdown',
                            key: 'handleColorMode',
                            options: { theme: i.optionTheme, custom: i.optionCustom },
                        },
                    },
                    {
                        name: i.handleColor,
                        desc: i.handleColorDesc,
                        visible: () => this.plugin.settings.handleColorMode === 'custom',
                        control: { type: 'color', key: 'handleColor' },
                    },
                    numeric('handleSize', NUMERIC_SETTING_RANGES.handleSize, i.handleSize, i.handleSizeDesc),
                    {
                        name: i.handleVisibility,
                        desc: i.handleVisibilityDesc,
                        control: {
                            type: 'dropdown',
                            key: 'handleVisibility',
                            options: { hover: i.optionHover, always: i.optionAlways, hidden: i.optionHidden },
                        },
                    },
                    {
                        name: i.handleGutterPosition,
                        desc: i.handleGutterPositionDesc,
                        control: {
                            type: 'dropdown',
                            key: 'handleGutterPosition',
                            options: { left: i.optionLeft, right: i.optionRight },
                        },
                    },
                    numeric(
                        'handleHorizontalOffsetPx',
                        NUMERIC_SETTING_RANGES.handleHorizontalOffsetPx,
                        i.handleOffset,
                        i.handleOffsetDesc,
                    ),
                    {
                        name: i.selectionVisualStyle,
                        desc: i.selectionVisualStyleDesc,
                        control: {
                            type: 'dropdown',
                            key: 'selectionVisualStyle',
                            options: {
                                outline: i.optionBlockSelectionVisualOutline,
                                subtle: i.optionBlockSelectionVisualSubtle,
                                filled: i.optionBlockSelectionVisualFilled,
                            },
                        },
                    },
                    {
                        name: i.enableBlockSelectionHighlight,
                        desc: i.enableBlockSelectionHighlightDesc,
                        control: { type: 'toggle', key: 'enableBlockSelectionHighlight' },
                    },
                    {
                        name: i.indicatorColor,
                        desc: i.indicatorColorDesc,
                        control: {
                            type: 'dropdown',
                            key: 'indicatorColorMode',
                            options: { theme: i.optionTheme, custom: i.optionCustom },
                        },
                    },
                    {
                        name: i.indicatorColor,
                        desc: i.indicatorColorDesc,
                        visible: () => this.plugin.settings.indicatorColorMode === 'custom',
                        control: { type: 'color', key: 'indicatorColor' },
                    },
                ],
            },
            {
                type: 'page',
                name: i.headingBehavior,
                items: [
                    {
                        name: i.multiLineSelection,
                        desc: i.multiLineSelectionDesc,
                        control: { type: 'toggle', key: 'enableMultiLineSelection' },
                    },
                    numeric(
                        'mobileDragLongPressMs',
                        NUMERIC_SETTING_RANGES.mobileDragLongPressMs,
                        i.mobileDragLongPressMs,
                        i.mobileDragLongPressMsDesc,
                    ),
                    numeric(
                        'mouseRangeSelectLongPressMs',
                        NUMERIC_SETTING_RANGES.mouseRangeSelectLongPressMs,
                        i.mouseRangeSelectLongPressMs,
                        i.mouseRangeSelectLongPressMsDesc,
                    ),
                    numeric(
                        'autoScrollEdgeZonePx',
                        NUMERIC_SETTING_RANGES.autoScrollEdgeZonePx,
                        i.autoScrollEdgeZonePx,
                        i.autoScrollEdgeZonePxDesc,
                    ),
                    numeric(
                        'autoScrollMaxSpeedPx',
                        NUMERIC_SETTING_RANGES.autoScrollMaxSpeedPx,
                        i.autoScrollMaxSpeedPx,
                        i.autoScrollMaxSpeedPxDesc,
                    ),
                    {
                        name: i.mobileTextLongPressDrag,
                        desc: i.mobileTextLongPressDragDesc,
                        control: {
                            type: 'toggle',
                            key: 'enableMobileTextLongPressDrag',
                            disabled: () => !Platform.isMobile,
                        },
                    },
                    {
                        name: i.disableMobileDragModeAfterDrop,
                        desc: i.disableMobileDragModeAfterDropDesc,
                        visible: mobileOnly,
                        control: { type: 'toggle', key: 'disableMobileDragModeAfterDrop' },
                    },
                    {
                        name: i.optionMobileDragModeToggleViewAction,
                        visible: mobileOnly,
                        control: { type: 'toggle', key: 'mobileDragModeToggleEnabled' },
                    },
                ],
            },
            {
                type: 'page',
                name: i.headingBlockStyles,
                items: [
                    {
                        name: 'Add custom block style',
                        desc: 'Create a new block conversion style with a custom template',
                        action: () => {
                            new CustomBlockStyleModal(
                                this.app,
                                {
                                    id: `custom-${Date.now()}`,
                                    label: 'New style',
                                    icon: 'box',
                                    category: 'custom',
                                    template: '> [!custom]\n${content}',
                                    linePrefix: '> ',
                                },
                                true,
                                (created) => {
                                    this.plugin.settings.customBlockStyles.push(created);
                                    this.saveAndRefresh();
                                },
                            ).open();
                        },
                    },
                    ...this.plugin.settings.customBlockStyles.map(
                        (style, index): SettingDefinitionItem => ({
                            name: style.label,
                            desc: style.template.replace(/\n/g, ' ↵ '),
                            action: () => {
                                new CustomBlockStyleModal(
                                    this.app,
                                    style,
                                    false,
                                    (updated) => {
                                        this.plugin.settings.customBlockStyles[index] = updated;
                                        this.saveAndRefresh();
                                    },
                                    () => {
                                        this.plugin.settings.customBlockStyles.splice(index, 1);
                                        this.saveAndRefresh();
                                    },
                                ).open();
                            },
                        }),
                    ),
                ],
            },
        ];
    }

    private saveAndRefresh(): void {
        void this.plugin.saveSettings().then(() => {
            (this as unknown as { update?: () => void }).update?.();
        });
    }

    getControlValue(key: string): unknown {
        return (this.plugin.settings as unknown as Record<string, unknown>)[key];
    }

    async setControlValue(key: string, value: unknown): Promise<void> {
        (this.plugin.settings as unknown as Record<string, unknown>)[key] = value;
        await this.plugin.saveSettings();
    }
}
