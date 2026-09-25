import { MarkdownView, Platform, Plugin, setIcon } from 'obsidian';
import { dragHandleExtension } from '../platform/codemirror/obsidian-dragger';
import { DragNDropSettingTab } from './settings';
import { SettingsPresenter, settingsPresentation } from './settings-presentation';
import type { DragNDropSettings } from './settings-types';
import { migrateSettings } from './settings-migrations';
import { registerMobileToolbarCommands } from './mobile-toolbar-commands';

export default class DragNDropPlugin extends Plugin {
    settings: DragNDropSettings;
    // The editor extension hands it each document that hosts an editor.
    readonly settingsPresenter = new SettingsPresenter();
    private mobileDragModeActionByView = new WeakMap<MarkdownView, HTMLElement>();
    private readonly mobileDragModeActionEls = new Set<HTMLElement>();
    private mobileDragModeEnabled = false;
    // Suppress native caret/text selection while mobile drag mode is on.
    // Scroll/pan is NOT locked for the whole mode — only during active gesture
    // (see mobile gesture lock class driven by state_changed).
    private readonly onSelectStartWhileDragMode = (event: Event) => {
        if (!this.mobileDragModeEnabled) return;
        event.preventDefault();
    };
    private readonly onSelectionChangeWhileDragMode = () => {
        if (!this.mobileDragModeEnabled) return;
        this.clearNativeSelection();
    };

    async onload() {
        await this.loadSettings();

        // 注册编辑器扩�?
        this.registerEditorExtension(dragHandleExtension(this));
        registerMobileToolbarCommands(this);
        this.app.workspace.onLayoutReady(() => this.registerMobileDragModeActions());
        this.registerEvent(this.app.workspace.on('layout-change', () => this.registerMobileDragModeActions()));
        this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.registerMobileDragModeActions()));
        this.registerEvent(this.app.workspace.on('file-open', () => this.registerMobileDragModeActions()));
        // 添加设置面板
        this.addSettingTab(new DragNDropSettingTab(this.app, this));
    }

    onunload() {
        this.setMobileDragModeEnabled(false);
        this.settingsPresenter.clear();
        for (const actionEl of this.mobileDragModeActionEls) {
            actionEl.remove();
        }
        this.mobileDragModeActionEls.clear();
    }

    async loadSettings() {
        this.settings = migrateSettings(await this.loadData());
        await this.saveData(this.settings);
        this.applySettings();
    }

    async saveSettings() {
        this.applySettings();
        await this.saveData(this.settings);
    }

    applySettings() {
        if (!this.settings.enableMobileTextLongPressDrag) {
            this.mobileDragModeEnabled = false;
        }
        this.settingsPresenter.update(
            settingsPresentation(this.settings, {
                isMobile: Platform.isMobile,
                mobileDragModeEnabled: this.mobileDragModeEnabled,
            }),
        );
        this.syncMobileDragModeActionVisibility();
    }

    // Called when a drop commits. Drives mobile-mode auto-disable.
    notifyDragDrop(): void {
        if (!Platform.isMobile) return;
        if (this.settings.disableMobileDragModeAfterDrop === false) return;
        this.setMobileDragModeEnabled(false);
    }

    isMobileDragModeEnabled(): boolean {
        return this.mobileDragModeEnabled;
    }

    isMobilePlatform(): boolean {
        return Platform.isMobile;
    }

    toggleMobileDragMode(): boolean {
        if (!this.settings.enableMobileTextLongPressDrag) {
            this.setMobileDragModeEnabled(false);
            return false;
        }
        this.setMobileDragModeEnabled(!this.mobileDragModeEnabled);
        return this.mobileDragModeEnabled;
    }

    private setMobileDragModeEnabled(enabled: boolean): void {
        if (this.mobileDragModeEnabled === enabled) return;
        this.mobileDragModeEnabled = enabled;
        if (enabled) {
            this.dismissActiveMobileInput();
            this.installMobileSelectionLock();
        } else {
            this.removeMobileSelectionLock();
        }
        this.applySettings();
        this.syncMobileDragModeActionIcons();
    }

    private installMobileSelectionLock(): void {
        if (!Platform.isMobile) return;
        // Capture phase so we win over editor selection handlers.
        activeDocument.addEventListener('selectstart', this.onSelectStartWhileDragMode, true);
        activeDocument.addEventListener('selectionchange', this.onSelectionChangeWhileDragMode, true);
        this.clearNativeSelection();
    }

    private removeMobileSelectionLock(): void {
        activeDocument.removeEventListener('selectstart', this.onSelectStartWhileDragMode, true);
        activeDocument.removeEventListener('selectionchange', this.onSelectionChangeWhileDragMode, true);
    }

    private clearNativeSelection(): void {
        try {
            const selection = activeWindow.getSelection?.() ?? window.getSelection?.();
            if (selection && selection.rangeCount > 0) selection.removeAllRanges();
        } catch {
            // ignore selection clear failures on limited mobile webviews
        }
    }

    private dismissActiveMobileInput(): void {
        if (!Platform.isMobile) return;
        const win = activeWindow as typeof window;
        const active = activeDocument.activeElement;
        if (!(active instanceof win.HTMLElement)) return;
        const shouldBlur =
            active.instanceOf(win.HTMLInputElement) ||
            active.instanceOf(win.HTMLTextAreaElement) ||
            active.isContentEditable ||
            !!active.closest('.cm-content');
        if (!shouldBlur) return;
        active.blur();
        this.clearNativeSelection();
    }

    private registerMobileDragModeActions(): void {
        if (!Platform.isMobile) return;
        if (!this.isMobileDragModeToggleEnabled()) {
            this.removeMobileDragModeActions();
            return;
        }

        for (const leaf of this.app.workspace.getLeavesOfType('markdown')) {
            const view = leaf.view;
            if (!(view instanceof MarkdownView)) continue;

            const existingActionEl = this.mobileDragModeActionByView.get(view);
            if (existingActionEl?.isConnected) continue;
            if (existingActionEl) {
                this.mobileDragModeActionEls.delete(existingActionEl);
            }

            const actionEl = view.addAction(
                this.getMobileDragModeActionIcon(),
                this.getMobileDragModeActionTitle(),
                (event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    this.toggleMobileDragMode();
                },
            );
            this.mobileDragModeActionByView.set(view, actionEl);
            this.mobileDragModeActionEls.add(actionEl);
            this.syncMobileDragModeActionEl(actionEl);
        }
    }

    private syncMobileDragModeActionVisibility(): void {
        if (!Platform.isMobile) return;
        if (!this.isMobileDragModeToggleEnabled()) {
            this.removeMobileDragModeActions();
            return;
        }
        this.registerMobileDragModeActions();
    }

    private removeMobileDragModeActions(): void {
        for (const actionEl of Array.from(this.mobileDragModeActionEls)) {
            actionEl.remove();
        }
        this.mobileDragModeActionEls.clear();
        this.mobileDragModeActionByView = new WeakMap<MarkdownView, HTMLElement>();
    }

    private syncMobileDragModeActionIcons(): void {
        for (const actionEl of Array.from(this.mobileDragModeActionEls)) {
            if (!actionEl.isConnected) {
                this.mobileDragModeActionEls.delete(actionEl);
                continue;
            }
            this.syncMobileDragModeActionEl(actionEl);
        }
    }

    private syncMobileDragModeActionEl(actionEl: HTMLElement): void {
        const title = this.getMobileDragModeActionTitle();
        setIcon(actionEl, this.getMobileDragModeActionIcon());
        actionEl.setAttribute('aria-label', title);
        actionEl.setAttribute('aria-pressed', String(this.mobileDragModeEnabled));
        actionEl.setAttribute('title', title);
    }

    private getMobileDragModeActionIcon(): string {
        return this.mobileDragModeEnabled ? 'check' : 'hand';
    }

    private getMobileDragModeActionTitle(): string {
        return this.mobileDragModeEnabled ? 'Drag mode enabled' : 'Drag mode disabled';
    }

    private isMobileDragModeToggleEnabled(): boolean {
        return this.settings.enableMobileTextLongPressDrag && this.settings.mobileDragModeToggleEnabled;
    }
}
