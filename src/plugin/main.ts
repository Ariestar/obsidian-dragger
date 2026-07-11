import { MarkdownView, Plugin, setIcon } from 'obsidian';
import { dragHandleExtension } from '../platform/codemirror/runtime/editor-extension';
import {
    HANDLE_CORE_SIZE_RATIO,
    GRIP_DOTS_CORE_SIZE_RATIO,
    setHandleHorizontalOffsetPx,
    setHandleSizePx,
} from '../shared/constants';
import {
    DND_DRAG_SOURCE_HIGHLIGHT_ATTR,
    DND_DRAG_SOURCE_STYLE_ATTR,
    DND_HANDLE_ICON_ATTR,
    DND_LIST_DROP_HIGHLIGHT_ATTR,
} from '../shared/dom-attrs';
import {
    DragNDropSettings,
    DragNDropSettingTab,
    HandleVisibilityMode,
} from './settings';
import { migrateSettings } from './settings-migrations';
import { platform } from './platform';
import { registerMobileToolbarCommands } from './mobile-toolbar-commands';

export default class DragNDropPlugin extends Plugin {
    settings: DragNDropSettings;
    private mobileDragModeActionByView = new WeakMap<MarkdownView, HTMLElement>();
    private readonly mobileDragModeActionEls = new Set<HTMLElement>();
    private mobileDragModeEnabled = false;
    // Suppress native caret/text selection while mobile drag mode is on.
    // Scroll/pan is NOT locked for the whole mode — only during active drag /
    // multi-select sweep (see drag-driver gesture-lock class).
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
        const body = activeDocument.body;
        if (!this.settings.enableMobileTextLongPressDrag) {
            this.mobileDragModeEnabled = false;
        }
        const visibility: HandleVisibilityMode = this.settings.handleVisibility;
        body.classList.toggle('dnd-handles-always', visibility === 'always');
        body.classList.toggle('dnd-handles-hidden', visibility === 'hidden');
        body.classList.toggle('dnd-mobile-handles-hidden', platform.isMobile && !this.settings.enableMobileTextLongPressDrag);
        body.classList.toggle('dnd-mobile-drag-mode-enabled', this.mobileDragModeEnabled);

        const selectionVisualStyle = this.settings.selectionVisualStyle;
        body.setAttribute(DND_DRAG_SOURCE_STYLE_ATTR, selectionVisualStyle);
        body.setAttribute(DND_DRAG_SOURCE_HIGHLIGHT_ATTR, this.settings.enableBlockSelectionHighlight ? 'on' : 'off');
        body.setAttribute(DND_LIST_DROP_HIGHLIGHT_ATTR, this.settings.enableListDropHighlight ? 'on' : 'off');

        const handleOffset = this.settings.handleHorizontalOffsetPx;
        setHandleHorizontalOffsetPx(handleOffset);
        body.setCssProps({
            '--dnd-handle-horizontal-offset-px': `${handleOffset}px`,
        });

        let colorValue = '';
        if (this.settings.handleColorMode === 'theme') {
            colorValue = 'var(--interactive-accent)';
        } else if (this.settings.handleColor) {
            colorValue = this.settings.handleColor;
        }

        if (colorValue) {
            body.setCssProps({
                '--dnd-handle-color': colorValue,
                '--dnd-handle-color-hover': colorValue,
            });
        } else {
            body.setCssProps({
                '--dnd-handle-color': '',
                '--dnd-handle-color-hover': '',
            });
        }

        let indicatorColorValue = '';
        if (this.settings.indicatorColorMode === 'theme') {
            indicatorColorValue = 'var(--interactive-accent)';
        } else if (this.settings.indicatorColor) {
            indicatorColorValue = this.settings.indicatorColor;
        }

        if (indicatorColorValue) {
            body.setCssProps({
                '--dnd-drop-indicator-color': indicatorColorValue,
            });
        } else {
            body.setCssProps({
                '--dnd-drop-indicator-color': '',
            });
        }

        const handleSize = this.settings.handleSize;
        setHandleSizePx(handleSize);
        body.setCssProps({
            '--dnd-handle-size': `${handleSize}px`,
            '--dnd-handle-core-size': `${Math.round(handleSize * HANDLE_CORE_SIZE_RATIO)}px`,
            '--dnd-grip-dots-core-size': `${Math.round(handleSize * GRIP_DOTS_CORE_SIZE_RATIO)}px`,
        });
        body.setAttribute(DND_HANDLE_ICON_ATTR, this.settings.handleIcon);

        window.dispatchEvent(new Event('dnd:settings-updated'));
        this.syncMobileDragModeActionVisibility();
    }

    // Called by the drag-driver when a drop commits. Drives mobile-mode
    // auto-disable — the only cross-cutting concern that needed a drag signal.
    notifyDragDrop(): void {
        if (!platform.isMobile) return;
        if (this.settings.disableMobileDragModeAfterDrop === false) return;
        this.setMobileDragModeEnabled(false);
    }

    isMobileDragModeEnabled(): boolean {
        return this.mobileDragModeEnabled;
    }

    isMobilePlatform(): boolean {
        return platform.isMobile;
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
        if (!platform.isMobile) return;
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
        if (!platform.isMobile) return;
        const win = activeWindow as typeof window;
        const active = activeDocument.activeElement;
        if (!(active instanceof win.HTMLElement)) return;
        const shouldBlur = active.instanceOf(win.HTMLInputElement)
            || active.instanceOf(win.HTMLTextAreaElement)
            || active.isContentEditable
            || !!active.closest('.cm-content');
        if (!shouldBlur) return;
        active.blur();
        this.clearNativeSelection();
    }

    private registerMobileDragModeActions(): void {
        if (!platform.isMobile) return;
        if (!this.isMobileDragModeToggleLocationEnabled('view-action')) {
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

            const actionEl = view.addAction(this.getMobileDragModeActionIcon(), this.getMobileDragModeActionTitle(), (event) => {
                event.preventDefault();
                event.stopPropagation();
                this.toggleMobileDragMode();
            });
            this.mobileDragModeActionByView.set(view, actionEl);
            this.mobileDragModeActionEls.add(actionEl);
            this.syncMobileDragModeActionEl(actionEl);
        }
    }

    private syncMobileDragModeActionVisibility(): void {
        if (!platform.isMobile) return;
        if (!this.isMobileDragModeToggleLocationEnabled('view-action')) {
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

    private isMobileDragModeToggleLocationEnabled(location: 'view-action'): boolean {
        return this.settings.enableMobileTextLongPressDrag
            && this.settings.mobileDragModeToggleLocations.includes(location);
    }
}
