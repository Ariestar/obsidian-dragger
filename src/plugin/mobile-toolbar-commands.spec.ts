import type { EditorView } from '@codemirror/view';
import type { App, Command } from 'obsidian';
import { Platform } from 'obsidian';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openBlockTypeMenu } from './block-type-menu';
import { registerMobileToolbarCommands } from './mobile-toolbar-commands';
import { DEFAULT_SETTINGS } from './settings-types';

vi.mock('obsidian', () => ({ Platform: { isMobile: true } }));
vi.mock('./block-type-menu', () => ({ openBlockTypeMenu: vi.fn() }));

afterEach(() => {
    Platform.isMobile = true;
    vi.clearAllMocks();
});

function menuCommand(recentView: unknown) {
    const commands: Command[] = [];
    const getMostRecentLeaf = vi.fn(() => (recentView ? { view: recentView } : null));
    const app = { workspace: { getMostRecentLeaf, getActiveViewOfType: vi.fn(() => null) } } as unknown as App;
    registerMobileToolbarCommands({
        app,
        settings: DEFAULT_SETTINGS,
        addCommand: (command) => {
            commands.push(command);
            return command;
        },
        toggleMobileDragMode: vi.fn(() => true),
    });
    return { command: commands[0], getMostRecentLeaf };
}

describe('mobile block menu command', () => {
    it('uses the most-recent root Markdown leaf when a sidebar is focused', () => {
        const cm = {} as EditorView;
        const { command, getMostRecentLeaf } = menuCommand({ getViewType: () => 'markdown', editor: { cm } });
        expect(command.checkCallback?.(true)).toBe(true);
        expect(openBlockTypeMenu).not.toHaveBeenCalled();
        expect(command.checkCallback?.(false)).toBe(true);
        expect(getMostRecentLeaf).toHaveBeenCalledTimes(2);
        expect(openBlockTypeMenu).toHaveBeenCalledWith(cm, null, DEFAULT_SETTINGS);
    });

    it.each([
        null,
        { getViewType: () => 'canvas', editor: { cm: {} } },
        { getViewType: () => 'markdown' },
        { getViewType: () => 'markdown', editor: {} },
    ])('rejects a missing or unsuitable recent editor: %s', (view) => {
        const { command } = menuCommand(view);
        expect(command.checkCallback?.(false)).toBe(false);
        expect(openBlockTypeMenu).not.toHaveBeenCalled();
    });

    it('stays unavailable on desktop without querying the workspace', () => {
        Platform.isMobile = false;
        const { command, getMostRecentLeaf } = menuCommand({ getViewType: () => 'markdown', editor: { cm: {} } });
        expect(command.checkCallback?.(false)).toBe(false);
        expect(getMostRecentLeaf).not.toHaveBeenCalled();
    });
});
