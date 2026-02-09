import { Plugin } from 'obsidian';
import { dragHandleExtension } from './editor/drag-handle';
import { setHandleHorizontalOffsetPx } from './editor/core/handle-position';
import { setHandleSizePx } from './editor/core/constants';
import { DragNDropSettings, DEFAULT_SETTINGS, DragNDropSettingTab, HandleVisibilityMode } from './settings';
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
        const saved = await this.loadData() ?? {};
        this.settings = Object.assign({}, DEFAULT_SETTINGS, saved);
        // Migrate legacy alwaysShowHandles boolean
        if ('alwaysShowHandles' in saved && !('handleVisibility' in saved)) {
            this.settings.handleVisibility = (saved as { alwaysShowHandles?: boolean }).alwaysShowHandles ? 'always' : 'hover';
        }
        if (this.settings.enableCrossFileDrag) {
            this.settings.enableCrossFileDrag = false;
        }
        await this.saveData(this.settings);
        this.applySettings();
    }

    async saveSettings() {
        this.applySettings();
        await this.saveData(this.settings);
    }

    applySettings() {
        const body = document.body;
        const visibility: HandleVisibilityMode = this.settings.handleVisibility ?? 'hover';
        body.classList.toggle('dnd-handles-always', visibility === 'always');
        body.classList.toggle('dnd-handles-hidden', visibility === 'hidden');
        const rawHandleOffset = Number(this.settings.handleHorizontalOffsetPx);
        const handleOffset = Number.isFinite(rawHandleOffset)
            ? Math.max(-80, Math.min(80, Math.round(rawHandleOffset)))
            : 0;
        this.settings.handleHorizontalOffsetPx = handleOffset;
        setHandleHorizontalOffsetPx(handleOffset);
        body.style.setProperty('--dnd-handle-horizontal-offset-px', `${handleOffset}px`);

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

        const handleSize = Math.max(12, Math.min(28, this.settings.handleSize ?? 16));
        setHandleSizePx(handleSize);
        body.style.setProperty('--dnd-handle-size', `${handleSize}px`);
        body.style.setProperty('--dnd-handle-core-size', `${Math.round(handleSize * 0.5)}px`);
        body.setAttribute('data-dnd-handle-icon', this.settings.handleIcon ?? 'dot');

        window.dispatchEvent(new Event('dnd:settings-updated'));
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
