import { type App, type MarkdownView, Platform, type Command } from 'obsidian';
import type { EditorView } from '@codemirror/view';
import type { BlockMenuSettings } from './block-menu-items';
import { openBlockTypeMenu } from './block-type-menu';

export function registerMobileToolbarCommands(plugin: {
    app: App;
    settings: BlockMenuSettings;
    addCommand: (command: Command) => Command;
    toggleMobileDragMode: () => boolean;
}): void {
    plugin.addCommand({
        id: 'open-current-block-type-menu',
        name: 'Change current block type',
        icon: 'replace',
        mobileOnly: true,
        checkCallback: (checking) => {
            if (!Platform.isMobile) return false;
            const markdownView = plugin.app.workspace.getMostRecentLeaf()?.view;
            if (markdownView?.getViewType() !== 'markdown') return false;
            const view = ((markdownView as MarkdownView).editor as { cm?: EditorView } | undefined)?.cm;
            if (!view) return false;
            if (!checking) {
                openBlockTypeMenu(view, null, plugin.settings);
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
            if (!Platform.isMobile) return false;
            if (!checking) {
                plugin.toggleMobileDragMode();
            }
            return true;
        },
    });
}
