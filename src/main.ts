import { Plugin } from 'obsidian';
import { dragHandleExtension } from './editor/drag-handle';
import { DragNDropSettings, DEFAULT_SETTINGS, DragNDropSettingTab } from './settings';
import { DragLifecycleEvent, DragLifecycleListener } from './types';

export default class DragNDropPlugin extends Plugin {
    settings: DragNDropSettings;
    private readonly dragLifecycleListeners = new Set<DragLifecycleListener>();

    async onload() {

        await this.loadSettings();

        // 注册编辑器扩展
        this.registerEditorExtension(dragHandleExtension(this));

        // 添加设置面板
        this.addSettingTab(new DragNDropSettingTab(this.app, this));
    }

    onunload() {
        this.dragLifecycleListeners.clear();
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
        if (this.settings.enableCrossFileDrag) {
            this.settings.enableCrossFileDrag = false;
            await this.saveData(this.settings);
        }
        this.applySettings();
    }

    async saveSettings() {
        this.applySettings();
        await this.saveData(this.settings);
    }

    applySettings() {
        const body = document.body;
        body.classList.toggle('dnd-handles-always', this.settings.alwaysShowHandles);

        let colorValue = '';
        if (this.settings.handleColorMode === 'theme') {
            colorValue = 'var(--interactive-accent)';
        } else if (this.settings.handleColor) {
            colorValue = this.settings.handleColor;
        }

        if (colorValue) {
            body.style.setProperty('--dnd-handle-color', colorValue);
            body.style.setProperty('--dnd-handle-color-hover', colorValue);
        } else {
            body.style.removeProperty('--dnd-handle-color');
            body.style.removeProperty('--dnd-handle-color-hover');
        }

        let indicatorColorValue = '';
        if (this.settings.indicatorColorMode === 'theme') {
            indicatorColorValue = 'var(--interactive-accent)';
        } else if (this.settings.indicatorColor) {
            indicatorColorValue = this.settings.indicatorColor;
        }

        if (indicatorColorValue) {
            body.style.setProperty('--dnd-drop-indicator-color', indicatorColorValue);
        } else {
            body.style.removeProperty('--dnd-drop-indicator-color');
        }
    }

    onDragLifecycleEvent(listener: DragLifecycleListener): () => void {
        this.dragLifecycleListeners.add(listener);
        return () => {
            this.dragLifecycleListeners.delete(listener);
        };
    }

    emitDragLifecycleEvent(event: DragLifecycleEvent): void {
        for (const listener of Array.from(this.dragLifecycleListeners)) {
            try {
                listener(event);
            } catch (error) {
                console.error('[Dragger] drag lifecycle listener failed:', error);
            }
        }
    }
}
