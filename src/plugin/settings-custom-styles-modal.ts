import { type App, FuzzySuggestModal, Modal, Setting, type TextComponent, getIconIds, setIcon } from 'obsidian';
import type { BlockStyleDefinition } from './block-styles';
import { t } from './i18n';

export class IconSuggestModal extends FuzzySuggestModal<string> {
    private onChoose: (iconId: string) => void;

    constructor(app: App, onChoose: (iconId: string) => void) {
        super(app);
        this.onChoose = onChoose;
        this.setPlaceholder('Type to search icons...');
    }

    getItems(): string[] {
        return getIconIds();
    }

    getItemText(item: string): string {
        return item;
    }

    renderSuggestion(match: { item: string }, el: HTMLElement): void {
        el.empty();
        const container = el.createDiv({ cls: 'd-icon-suggestion' });
        const iconSpan = container.createSpan({ cls: 'd-icon-preview' });
        setIcon(iconSpan, match.item);
        container.createSpan({ text: match.item });
    }

    onChooseItem(item: string): void {
        this.onChoose(item);
    }
}

export class CustomBlockStyleModal extends Modal {
    private style: BlockStyleDefinition;
    private isNew: boolean;
    private onSave: (style: BlockStyleDefinition) => void;

    constructor(app: App, style: BlockStyleDefinition, isNew: boolean, onSave: (style: BlockStyleDefinition) => void) {
        super(app);
        this.style = {
            ...style,
            linePrefix: style.linePrefix ?? '',
            variables: style.variables ? { ...style.variables } : undefined,
        };
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

        const actions = new Setting(contentEl);
        actions.addButton((btn) =>
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
        );

        actions.addButton((btn) =>
            btn.setButtonText(i.customStyleCancel).onClick(() => {
                this.close();
            }),
        );
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
