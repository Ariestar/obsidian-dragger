import { EditorView } from '@codemirror/view';
import { App, Notice, type Command } from 'obsidian';
import { getActiveMarkdownView } from '../platform/obsidian/app-adapter';
import { getCodeMirrorView } from '../platform/obsidian/editor-view';
import { openBlockTypeMenu } from './block-type-menu';
import { platform } from './platform';

export type EnterMobileSelectionModeEvent = CustomEvent<{ handled: boolean }>;

function getActiveEditorView(app: App): EditorView | null {
    const markdownView = getActiveMarkdownView(app);
    if (!markdownView) return null;
    return getCodeMirrorView(markdownView);
}

export function registerMobileToolbarCommands(plugin: {
    app: App;
    addCommand: (command: Command) => Command;
    toggleMobileDragMode: () => boolean;
}): void {
    plugin.addCommand({
        id: 'open-current-block-type-menu',
        name: 'Change current block type',
        icon: 'replace',
        mobileOnly: true,
        checkCallback: (checking) => {
            if (!platform.isMobile) return false;
            const view = getActiveEditorView(plugin.app);
            if (!view) return false;
            if (!checking) {
                openBlockTypeMenu(view, null);
            }
            return true;
        },
    });

    plugin.addCommand({
        id: 'enter-mobile-block-multi-select',
        name: 'Select multiple blocks',
        icon: 'list-checks',
        mobileOnly: true,
        checkCallback: (checking) => {
            if (!platform.isMobile) return false;
            const view = getActiveEditorView(plugin.app);
            if (!view) return false;
            if (!checking) {
                const event: EnterMobileSelectionModeEvent = new CustomEvent('dnd:enter-mobile-selection-mode', {
                    bubbles: true,
                    detail: { handled: false },
                });
                view.dom.dispatchEvent(event);
                if (!event.detail.handled) {
                    new Notice('Unable to enter block selection mode.');
                }
            }
            return true;
        },
    });

    plugin.addCommand({
        id: 'toggle-mobile-drag-mode',
        name: 'Toggle mobile drag mode',
        icon: 'hand',
        mobileOnly: true,
        checkCallback: (checking) => {
            if (!platform.isMobile) return false;
            if (!checking) {
                plugin.toggleMobileDragMode();
            }
            return true;
        },
    });
}
