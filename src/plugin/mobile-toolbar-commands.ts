import { App, Platform, type Command } from 'obsidian';
import { getActiveMarkdownView, getCodeMirrorView } from '../platform/obsidian/views';
import { openBlockTypeMenu } from './block-type-menu';

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
            if (!Platform.isMobile) return false;
            const markdownView = getActiveMarkdownView(plugin.app);
            if (!markdownView) return false;
            const view = getCodeMirrorView(markdownView);
            if (!view) return false;
            if (!checking) {
                openBlockTypeMenu(view, null);
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
