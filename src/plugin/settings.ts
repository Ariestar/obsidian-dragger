import {
    type App,
    type FuzzyMatch,
    FuzzySuggestModal,
    Modal,
    Notice,
    Platform,
    PluginSettingTab,
    Setting,
    type SettingDefinition,
    type SettingDefinitionItem,
    type SettingDefinitionList,
    type SettingDefinitionRender,
    type SettingGroupItem,
    type TextComponent,
    getIconIds,
    setIcon,
} from 'obsidian';
import type DragNDropPlugin from './main';
import type { BlockStyleDefinition } from './block-styles';
import { t } from './i18n';
import { NUMERIC_SETTING_RANGES } from './settings-types';
import { getBlockMenuEntries, type BlockMenuListId, type BlockTypeConversionOption } from './block-menu-items';

type SettingDefinitionWithIcon = SettingDefinition & {
    icon?: string;
};

function setMenuItemIcon(row: HTMLElement, icon: string): void {
    let iconSlot = row.querySelector<HTMLElement>(':scope > .setting-item-icon');
    if (!iconSlot) {
        iconSlot = row.ownerDocument.win.createDiv();
        iconSlot.className = 'setting-item-icon';
        row.insertBefore(iconSlot, row.firstChild);
    }
    setIcon(iconSlot, icon);
}

function renderMenuPageIcons(container: HTMLElement, pages: { name: string; icon: string }[]): void {
    if (!container.isConnected) return;
    const rows = Array.from(container.querySelectorAll<HTMLElement>('.setting-item.mod-navigable'));
    if (rows.length === 0) return;
    for (const page of pages) {
        const row = rows.find((item) => item.querySelector('.setting-item-name')?.textContent === page.name);
        if (!row) throw new Error(`Dragger: settings page "${page.name}" is missing`);
        setMenuItemIcon(row, page.icon);
    }
}

function menuRow(
    option: BlockTypeConversionOption,
    editStyle: (style: BlockStyleDefinition) => void,
): SettingDefinition {
    const { style } = option;
    return {
        name: option.label,
        icon: option.icon,
        ...(style ? { action: () => editStyle(style) } : {}),
    } as SettingDefinitionWithIcon;
}

class IconSuggestModal extends FuzzySuggestModal<string> {
    constructor(
        app: App,
        private readonly onChoose: (iconId: string) => void,
    ) {
        super(app);
        this.setPlaceholder(t().customHandleIconSearch);
    }

    getItems(): string[] {
        return Array.from(new Set(getIconIds().map((id) => (id.startsWith('lucide-') ? id.slice(7) : id)))).sort();
    }

    getItemText(item: string): string {
        return item;
    }

    renderSuggestion(match: FuzzyMatch<string>, el: HTMLElement): void {
        el.addClass('d-handle-icon-suggestion');
        setIcon(el.createSpan(), match.item);
        super.renderSuggestion(match, el.createSpan());
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
            btn.setIcon(this.style.icon)
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

        const variables = Object.entries(this.style.variables ?? {}).map(([name, value]) => ({ name, value }));
        const variableHeading = new Setting(contentEl).setName(i.customStyleVariables).setHeading();
        const variableList = contentEl.createDiv();
        const renderVariables = () => {
            variableList.empty();
            for (const variable of variables) {
                new Setting(variableList)
                    .addText((text) =>
                        text
                            .setPlaceholder(i.customStyleVariableName)
                            .setValue(variable.name)
                            .onChange((value) => {
                                variable.name = value;
                            }),
                    )
                    .addText((text) =>
                        text
                            .setPlaceholder(i.customStyleVariableValue)
                            .setValue(variable.value)
                            .onChange((value) => {
                                variable.value = value;
                            }),
                    )
                    .addExtraButton((button) =>
                        button
                            .setIcon('trash-2')
                            .setTooltip(i.customStyleRemoveVariable)
                            .onClick(() => {
                                variables.splice(variables.indexOf(variable), 1);
                                renderVariables();
                            }),
                    );
            }
        };
        variableHeading.addExtraButton((button) =>
            button
                .setIcon('plus')
                .setTooltip(i.customStyleAddVariable)
                .onClick(() => {
                    variables.push({ name: '', value: '' });
                    renderVariables();
                }),
        );
        renderVariables();

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
                        if (!this.style.template.includes('${content}')) {
                            new Notice(i.customStyleTemplateRequired);
                            return;
                        }
                        const names = variables.map((variable) => variable.name.trim());
                        if (
                            names.some((name) => !/^[a-zA-Z0-9_-]+$/.test(name) || name === 'content') ||
                            new Set(names).size !== names.length
                        ) {
                            new Notice(i.customStyleInvalidVariables);
                            return;
                        }
                        if (variables.length > 0) {
                            this.style.variables = Object.fromEntries(
                                variables.map((variable, index) => [names[index], variable.value]),
                            );
                        } else {
                            delete this.style.variables;
                        }
                        this.style.label = label;
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

    override update(): void {
        super.update();
        renderMenuPageIcons(this.containerEl, [{ name: t().headingBlockMenu, icon: 'menu' }]);
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
        const menuList = (listId: BlockMenuListId, items: SettingGroupItem[]): SettingDefinitionList => ({
            type: 'list',
            items,
            onReorder: (oldIndex, newIndex) => {
                const order = this.plugin.settings.blockMenuOrders[listId];
                const moved = order[oldIndex];
                if (
                    !moved ||
                    !Number.isInteger(oldIndex) ||
                    !Number.isInteger(newIndex) ||
                    newIndex < 0 ||
                    newIndex >= order.length
                ) {
                    throw new Error('Dragger: invalid menu reorder indices');
                }
                order.splice(oldIndex, 1);
                order.splice(newIndex, 0, moved);
                this.saveAndRefresh();
            },
        });
        const entries = getBlockMenuEntries(this.plugin.settings);
        const groupIcons = entries.flatMap((entry) =>
            'options' in entry ? [{ name: entry.label, icon: entry.icon }] : [],
        );
        const groupLists = new Map<BlockMenuListId, SettingDefinitionList>();
        const editStyle = (style: BlockStyleDefinition) => {
            new CustomBlockStyleModal(this.app, style, false, (updated) => {
                const styles = this.plugin.settings.customBlockStyles;
                const index = styles.findIndex((candidate) => candidate.id === updated.id);
                if (index < 0) throw new Error('Dragger: custom style is missing');
                styles[index] = updated;
                this.saveAndRefresh();
            }).open();
        };
        for (const entry of entries) {
            if ('options' in entry) {
                const rows = entry.options.map((option) => menuRow(option, editStyle));
                groupLists.set(entry.id, menuList(entry.id, rows));
            }
        }
        const customList = groupLists.get('custom')!;
        customList.onDelete = (index) => {
            const settings = this.plugin.settings;
            const id = settings.blockMenuOrders.custom[index];
            const styleIndex = settings.customBlockStyles.findIndex((style) => style.id === id);
            if (styleIndex < 0) throw new Error('Dragger: custom style is missing');
            settings.blockMenuOrders.custom.splice(index, 1);
            settings.customBlockStyles.splice(styleIndex, 1);
            this.saveAndRefresh();
        };
        customList.addItem = {
            name: i.customBlockStylesAdd,
            action: () => {
                new CustomBlockStyleModal(
                    this.app,
                    { id: crypto.randomUUID(), label: '', icon: 'box', category: 'custom', template: '${content}' },
                    true,
                    (created) => {
                        this.plugin.settings.customBlockStyles.push(created);
                        this.plugin.settings.blockMenuOrders.custom.push(created.id);
                        this.saveAndRefresh();
                    },
                ).open();
            },
        };
        const menuRows: SettingGroupItem[] = entries.map((entry) =>
            'options' in entry
                ? { type: 'page', name: entry.label, items: [groupLists.get(entry.id)!] }
                : menuRow(entry, editStyle),
        );
        // Obsidian adds the native list sorter before finishing the render,
        // but page rows return before its drag-handle decoration. Supply the
        // same handle for every page; the native list still owns all sorting.
        const handleHookIndex = entries.findIndex((entry) => 'target' in entry);
        if (handleHookIndex < 0) throw new Error('Dragger: block menu has no conversion items');
        const handleHook = menuRows[handleHookIndex] as SettingDefinitionRender;
        handleHook.render = (setting, group) => {
            setMenuItemIcon(setting.settingEl, entries[handleHookIndex].icon);
            group.listEl.win.queueMicrotask(() => {
                if (!group.listEl.isConnected) return;
                renderMenuPageIcons(group.listEl, groupIcons);
                const sourceHandle = group.listEl.querySelector<HTMLElement>('.mod-drag-handle');
                if (!sourceHandle) throw new Error('Dragger: native menu reorder handle is missing');
                for (const row of Array.from(group.listEl.querySelectorAll<HTMLElement>(':scope > .setting-item'))) {
                    if (row.querySelector('.mod-drag-handle')) continue;
                    const control = row.querySelector('.setting-item-control');
                    if (!control) throw new Error('Dragger: native menu row control is missing');
                    const handle = sourceHandle.cloneNode(true);
                    handle.addEventListener('click', (event) => event.stopPropagation());
                    control.appendChild(handle);
                }
            });
        };
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
                                'grip-dots': i.iconGripDots,
                                dot: i.iconDot,
                                'grip-lines': i.iconGripLines,
                                square: i.iconSquare,
                                custom: i.optionCustom,
                            },
                        },
                    },
                    {
                        name: i.customHandleIcon,
                        desc: this.plugin.settings.customHandleIcon,
                        visible: () => this.plugin.settings.handleIcon === 'custom',
                        action: () => {
                            new IconSuggestModal(this.app, (iconId) => {
                                void this.setControlValue('customHandleIcon', iconId)
                                    .then(() => this.update())
                                    .catch((error: unknown) => {
                                        console.error('Dragger: failed to save custom handle icon', error);
                                    });
                            }).open();
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
            { type: 'page', name: i.headingBlockMenu, items: [menuList('root', menuRows)] },
        ];
    }

    private saveAndRefresh(): void {
        void this.plugin
            .saveSettings()
            .then(() => this.update())
            .catch((error: unknown) => {
                console.error('Dragger: failed to save settings', error);
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
