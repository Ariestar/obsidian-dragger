import {
    type App,
    FuzzySuggestModal,
    Modal,
    Platform,
    PluginSettingTab,
    Setting,
    type SettingDefinition,
    type SettingDefinitionItem,
    type TextComponent,
    getIconIds,
    setIcon,
} from 'obsidian';
import DragNDropPlugin from './main';
import type { BlockStyleDefinition } from './block-styles';
import { t } from './i18n';
import { NUMERIC_SETTING_RANGES } from './settings-types';

type SettingDefinitionWithIcon = SettingDefinition & {
    icon?: string;
};

function getAllIconIdentifiers(): string[] {
    const raw = getIconIds();
    const set = new Set<string>();
    for (const id of raw) {
        set.add(id.startsWith('lucide-') ? id.slice(7) : id);
    }
    return Array.from(set).sort();
}

class IconSuggestModal extends FuzzySuggestModal<string> {
    private onChoose: (iconId: string) => void;

    constructor(app: App, onChoose: (iconId: string) => void) {
        super(app);
        this.onChoose = onChoose;
        this.setPlaceholder('Type to search icons...');
    }

    getItems(): string[] {
        return getAllIconIdentifiers();
    }

    getItemText(item: string): string {
        return item;
    }

    renderSuggestion(match: { item: string }, el: HTMLElement): void {
        el.empty();
        const iconSpan = el.createSpan();
        iconSpan.setCssStyles({ display: 'inline-flex', width: '20px', marginRight: '8px' });
        setIcon(iconSpan, match.item);
        el.createSpan({ text: match.item });
    }

    onChooseItem(item: string): void {
        this.onChoose(item);
    }
}

class CustomBlockStyleModal extends Modal {
    private style: BlockStyleDefinition;
    private isNew: boolean;
    private onSave: (style: BlockStyleDefinition) => void;

    constructor(app: App, style: BlockStyleDefinition, isNew: boolean, onSave: (style: BlockStyleDefinition) => void) {
        super(app);
        this.style = { ...style, linePrefix: style.linePrefix ?? '' };
        this.isNew = isNew;
        this.onSave = onSave;
    }

    onOpen(): void {
        const i = t();
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: this.isNew ? i.customStyleModalTitleNew : i.customStyleModalTitleEdit });

        new Setting(contentEl)
            .setName(i.customStyleLabel)
            .setDesc(i.customStyleLabelDesc)
            .addText((text) =>
                text.setValue(this.style.label).onChange((val) => {
                    this.style.label = val;
                }),
            );

        let iconInput: TextComponent | null = null;
        const iconSetting = new Setting(contentEl).setName(i.customStyleIcon).setDesc(i.customStyleIconDesc);

        iconSetting.addExtraButton((btn) => {
            btn.setIcon(this.style.icon || 'box')
                .setTooltip('Choose icon')
                .onClick(() => {
                    new IconSuggestModal(this.app, (chosenIcon) => {
                        this.style.icon = chosenIcon;
                        btn.setIcon(chosenIcon);
                        iconInput?.setValue(chosenIcon);
                    }).open();
                });
        });

        iconSetting.addText((text) => {
            iconInput = text;
            text.setValue(this.style.icon).onChange((val) => {
                this.style.icon = val.trim();
            });
        });

        new Setting(contentEl)
            .setName(i.customStyleTemplate)
            .setDesc(i.customStyleTemplateDesc)
            .addTextArea((text) =>
                text.setValue(this.style.template).onChange((val) => {
                    this.style.template = val;
                }),
            );

        new Setting(contentEl)
            .setName(i.customStyleLinePrefix)
            .setDesc(i.customStyleLinePrefixDesc)
            .addText((text) =>
                text
                    .setPlaceholder('(Optional, e.g. "> " for callouts)')
                    .setValue(this.style.linePrefix ?? '')
                    .onChange((val) => {
                        this.style.linePrefix = val.length > 0 ? val : undefined;
                    }),
            );

        new Setting(contentEl)
            .addButton((btn) =>
                btn
                    .setButtonText(i.customStyleSave)
                    .setCta()
                    .onClick(() => {
                        const label = this.style.label.trim();
                        if (!label) return;
                        let template = this.style.template.trim();
                        if (!template.includes('${content}')) {
                            template = template ? `${template}\n\${content}` : '${content}';
                        }
                        this.style.label = label;
                        this.style.template = template;
                        this.onSave(this.style);
                        this.close();
                    }),
            )
            .addButton((btn) =>
                btn.setButtonText(i.customStyleCancel).onClick(() => {
                    this.close();
                }),
            );
    }

    onClose(): void {
        this.contentEl.empty();
    }
}

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
                name: i.headingCustomBlockStyles,
                items: [
                    {
                        type: 'list',
                        name: i.headingCustomBlockStyles,
                        desc: i.customBlockStylesDesc,
                        emptyState: i.customBlockStylesEmpty,
                        onDelete: (index: number) => {
                            this.plugin.settings.customBlockStyles.splice(index, 1);
                            this.saveAndRefresh();
                        },
                        onReorder: (oldIndex: number, newIndex: number) => {
                            const [moved] = this.plugin.settings.customBlockStyles.splice(oldIndex, 1);
                            if (moved) {
                                this.plugin.settings.customBlockStyles.splice(newIndex, 0, moved);
                                this.saveAndRefresh();
                            }
                        },
                        addItem: {
                            name: i.customBlockStylesAdd,
                            action: () => {
                                new CustomBlockStyleModal(
                                    this.app,
                                    {
                                        id: `custom-${Date.now()}`,
                                        label: '',
                                        icon: 'box',
                                        category: 'custom',
                                        template: '${content}',
                                    },
                                    true,
                                    (created) => {
                                        this.plugin.settings.customBlockStyles.push(created);
                                        this.saveAndRefresh();
                                    },
                                ).open();
                            },
                        },
                        items: this.plugin.settings.customBlockStyles.map(
                            (style, index): SettingDefinitionWithIcon => ({
                                name: style.label,
                                desc: style.template.replace(/\n/g, ' ↵ '),
                                icon: style.icon,
                                action: () => {
                                    new CustomBlockStyleModal(this.app, style, false, (updated) => {
                                        this.plugin.settings.customBlockStyles[index] = updated;
                                        this.saveAndRefresh();
                                    }).open();
                                },
                            }),
                        ),
                    },
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
