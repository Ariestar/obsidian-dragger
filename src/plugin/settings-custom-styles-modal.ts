import { type App, Modal, Setting } from 'obsidian';
import type { BlockStyleDefinition } from './block-styles';

export class CustomBlockStyleModal extends Modal {
    private style: BlockStyleDefinition;
    private isNew: boolean;
    private onSave: (style: BlockStyleDefinition) => void;
    private onDelete?: () => void;

    constructor(
        app: App,
        style: BlockStyleDefinition,
        isNew: boolean,
        onSave: (style: BlockStyleDefinition) => void,
        onDelete?: () => void,
    ) {
        super(app);
        this.style = { ...style, variables: style.variables ? { ...style.variables } : undefined };
        this.isNew = isNew;
        this.onSave = onSave;
        this.onDelete = onDelete;
    }

    onOpen(): void {
        const { contentEl } = this;
        contentEl.empty();
        contentEl.createEl('h2', { text: this.isNew ? 'New block style' : 'Edit block style' });

        new Setting(contentEl)
            .setName('Label')
            .setDesc('Display name in the handle popup menu')
            .addText((text) =>
                text.setValue(this.style.label).onChange((val) => {
                    this.style.label = val;
                }),
            );

        new Setting(contentEl)
            .setName('Icon')
            .setDesc('Name of the icon')
            .addText((text) =>
                text.setValue(this.style.icon).onChange((val) => {
                    this.style.icon = val;
                }),
            );

        new Setting(contentEl)
            .setName('Template')
            .setDesc('Markdown template containing ${content} and optional ${var} tokens')
            .addTextArea((text) =>
                text.setValue(this.style.template).onChange((val) => {
                    this.style.template = val;
                }),
            );

        new Setting(contentEl)
            .setName('Line prefix')
            .setDesc('Optional prefix applied to each line of content (e.g. "> " for callouts)')
            .addText((text) =>
                text.setValue(this.style.linePrefix ?? '').onChange((val) => {
                    this.style.linePrefix = val.length > 0 ? val : undefined;
                }),
            );

        const actions = new Setting(contentEl);
        actions.addButton((btn) =>
            btn
                .setButtonText('Save')
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

        if (!this.isNew && this.onDelete) {
            actions.addButton((btn) =>
                btn
                    .setButtonText('Delete')
                    .setWarning()
                    .onClick(() => {
                        this.onDelete?.();
                        this.close();
                    }),
            );
        }

        actions.addButton((btn) =>
            btn.setButtonText('Cancel').onClick(() => {
                this.close();
            }),
        );
    }

    onClose(): void {
        this.contentEl.empty();
    }
}
