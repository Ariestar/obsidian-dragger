import { MarkdownView, Platform, Plugin, setIcon } from 'obsidian';
import { dragHandleExtension } from '../platform/codemirror/extension/editor-extension';
import { ExternalFileDropController } from '../platform/obsidian/external-file-drop-controller';
import {
    DEFAULT_HANDLE_SIZE_PX,
    HANDLE_CORE_SIZE_RATIO,
    GRIP_DOTS_CORE_SIZE_RATIO,
    MAX_HANDLE_SIZE_PX,
    MIN_HANDLE_SIZE_PX,
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
    DEFAULT_SETTINGS,
    DragNDropSettingTab,
    HandleVisibilityMode,
    normalizeHandleGutterPosition,
    normalizeMultiLineSelectionLongPressMs,
    normalizeBlockSelectionVisualStyle,
    normalizeMobileDragModeToggleLocations,
} from './settings';
import { DragLifecycleEvent, DragLifecycleListener } from '../drag/pipeline/pipeline-output';
import { registerMobileToolbarCommands } from './mobile-toolbar-commands';

export default class DragNDropPlugin extends Plugin {
    settings: DragNDropSettings;
    private readonly dragLifecycleListeners = new Set<DragLifecycleListener>();
    private mobileDragModeActionByView = new WeakMap<MarkdownView, HTMLElement>();
    private readonly mobileDragModeActionEls = new Set<HTMLElement>();
    private mobileDragModeEnabled = false;

    async onload() {

        await this.loadSettings();

        // 注册编辑器扩�?
        this.registerEditorExtension(dragHandleExtension(this));
        registerMobileToolbarCommands(this);
        this.app.workspace.onLayoutReady(() => this.registerMobileDragModeActions());
        this.registerEvent(this.app.workspace.on('layout-change', () => this.registerMobileDragModeActions()));
        this.registerEvent(this.app.workspace.on('active-leaf-change', () => this.registerMobileDragModeActions()));
        this.registerEvent(this.app.workspace.on('file-open', () => this.registerMobileDragModeActions()));
        const externalFileDropController = new ExternalFileDropController(this);
        externalFileDropController.register();

        // 添加设置面板
        this.addSettingTab(new DragNDropSettingTab(this.app, this));
    }

    onunload() {
        this.dragLifecycleListeners.clear();
        for (const actionEl of this.mobileDragModeActionEls) {
            actionEl.remove();
        }
        this.mobileDragModeActionEls.clear();
    }

    async loadSettings() {
        const saved = await this.loadData() as (Partial<DragNDropSettings> & Record<string, unknown>) | null;
        const savedRecord: Record<string, unknown> = saved ?? {};
        this.settings = Object.assign({}, DEFAULT_SETTINGS, savedRecord as Partial<DragNDropSettings>);
        // Migrate legacy alwaysShowHandles boolean
        if ('alwaysShowHandles' in savedRecord && !('handleVisibility' in savedRecord)) {
            this.settings.handleVisibility = (savedRecord as { alwaysShowHandles?: boolean }).alwaysShowHandles ? 'always' : 'hover';
        }
        // Legacy migration: old "none" style implied both highlights were effectively off.
        if (savedRecord.selectionVisualStyle === 'none') {
            if (!('enableBlockSelectionHighlight' in savedRecord)) {
                this.settings.enableBlockSelectionHighlight = false;
            }
            if (!('enableListDropHighlight' in savedRecord)) {
                this.settings.enableListDropHighlight = false;
            }
        }
        this.settings.enableBlockSelectionHighlight = this.settings.enableBlockSelectionHighlight !== false;
        this.settings.enableListDropHighlight = this.settings.enableListDropHighlight !== false;
        this.settings.enableCrossFileDrag = this.settings.enableCrossFileDrag === true;
        this.settings.disableMobileDragModeAfterDrop = this.settings.disableMobileDragModeAfterDrop !== false;
        this.settings.mobileDragModeToggleLocations = normalizeMobileDragModeToggleLocations(
            this.settings.mobileDragModeToggleLocations
        );
        this.settings.multiLineSelectionLongPressMs = normalizeMultiLineSelectionLongPressMs(
            this.settings.multiLineSelectionLongPressMs
        );
        this.settings.handleGutterPosition = normalizeHandleGutterPosition(this.settings.handleGutterPosition);
        delete (this.settings as DragNDropSettings & Record<string, unknown>).requireMobileDragMode;
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
        const visibility: HandleVisibilityMode = this.settings.handleVisibility ?? 'hover';
        body.classList.toggle('dnd-handles-always', visibility === 'always');
        body.classList.toggle('dnd-handles-hidden', visibility === 'hidden');
        body.classList.toggle('dnd-mobile-handles-hidden', Platform.isMobile && !this.settings.enableMobileTextLongPressDrag);
        body.classList.toggle('dnd-mobile-drag-mode-enabled', this.mobileDragModeEnabled);
        this.settings.multiLineSelectionLongPressMs = normalizeMultiLineSelectionLongPressMs(
            this.settings.multiLineSelectionLongPressMs
        );
        this.settings.mobileDragModeToggleLocations = normalizeMobileDragModeToggleLocations(
            this.settings.mobileDragModeToggleLocations
        );

        const selectionVisualStyle = normalizeBlockSelectionVisualStyle(this.settings.selectionVisualStyle);
        this.settings.selectionVisualStyle = selectionVisualStyle;
        body.setAttribute(DND_DRAG_SOURCE_STYLE_ATTR, selectionVisualStyle);
        body.setAttribute(DND_DRAG_SOURCE_HIGHLIGHT_ATTR, this.settings.enableBlockSelectionHighlight ? 'on' : 'off');
        body.setAttribute(DND_LIST_DROP_HIGHLIGHT_ATTR, this.settings.enableListDropHighlight ? 'on' : 'off');

        const rawHandleOffset = Number(this.settings.handleHorizontalOffsetPx);
        const handleOffset = Number.isFinite(rawHandleOffset)
            ? Math.max(-80, Math.min(80, Math.round(rawHandleOffset)))
            : DEFAULT_SETTINGS.handleHorizontalOffsetPx;
        this.settings.handleHorizontalOffsetPx = handleOffset;
        this.settings.handleGutterPosition = normalizeHandleGutterPosition(this.settings.handleGutterPosition);
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

        const handleSize = Math.max(
            MIN_HANDLE_SIZE_PX,
            Math.min(MAX_HANDLE_SIZE_PX, this.settings.handleSize ?? DEFAULT_HANDLE_SIZE_PX)
        );
        setHandleSizePx(handleSize);
        body.setCssProps({
            '--dnd-handle-size': `${handleSize}px`,
            '--dnd-handle-core-size': `${Math.round(handleSize * HANDLE_CORE_SIZE_RATIO)}px`,
            '--dnd-grip-dots-core-size': `${Math.round(handleSize * GRIP_DOTS_CORE_SIZE_RATIO)}px`,
        });
        body.setAttribute(DND_HANDLE_ICON_ATTR, this.settings.handleIcon ?? 'grip-dots');

        window.dispatchEvent(new Event('dnd:settings-updated'));
        this.syncMobileDragModeActionVisibility();
    }

    onDragLifecycleEvent(listener: DragLifecycleListener): () => void {
        this.dragLifecycleListeners.add(listener);
        return () => {
            this.dragLifecycleListeners.delete(listener);
        };
    }

    emitDragLifecycleEvent(event: DragLifecycleEvent): void {
        this.handleMobileDragModeLifecycle(event);
        for (const listener of Array.from(this.dragLifecycleListeners)) {
            try {
                listener(event);
            } catch (error) {
                console.error('[Dragger] drag lifecycle listener failed:', error);
            }
        }
    }

    isMobileDragModeEnabled(): boolean {
        return this.mobileDragModeEnabled;
    }

    toggleMobileDragMode(): boolean {
        if (!this.settings.enableMobileTextLongPressDrag) {
            this.setMobileDragModeEnabled(false);
            return false;
        }
        this.setMobileDragModeEnabled(!this.mobileDragModeEnabled);
        return this.mobileDragModeEnabled;
    }

    isMobileDragModeToolbarCommandEnabled(): boolean {
        return this.isMobileDragModeToggleLocationEnabled('toolbar-command');
    }

    private setMobileDragModeEnabled(enabled: boolean): void {
        if (this.mobileDragModeEnabled === enabled) return;
        this.mobileDragModeEnabled = enabled;
        if (enabled) {
            this.dismissActiveMobileInput();
        }
        this.applySettings();
        this.syncMobileDragModeActionIcons();
    }

    private dismissActiveMobileInput(): void {
        if (!Platform.isMobile) return;
        const win = activeWindow as typeof window;
        const active = activeDocument.activeElement;
        if (!(active instanceof win.HTMLElement)) return;
        const shouldBlur = active.instanceOf(win.HTMLInputElement)
            || active.instanceOf(win.HTMLTextAreaElement)
            || active.isContentEditable
            || !!active.closest('.cm-content');
        if (!shouldBlur) return;
        active.blur();
        try {
            window.getSelection()?.removeAllRanges();
        } catch {
            // ignore selection clear failures on limited mobile webviews
        }
    }

    private handleMobileDragModeLifecycle(event: DragLifecycleEvent): void {
        if (event.type !== 'drag_drop_commit') return;
        if (event.pointerType === 'mouse') return;
        if (this.settings.disableMobileDragModeAfterDrop === false) return;
        this.setMobileDragModeEnabled(false);
    }

    private registerMobileDragModeActions(): void {
        if (!Platform.isMobile) return;
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
        if (!Platform.isMobile) return;
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

    private isMobileDragModeToggleLocationEnabled(location: 'view-action' | 'toolbar-command'): boolean {
        return this.settings.enableMobileTextLongPressDrag
            && this.settings.mobileDragModeToggleLocations.includes(location);
    }
}
