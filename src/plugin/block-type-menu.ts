import { Menu, Notice, setIcon } from 'obsidian';
import { EditorView } from '@codemirror/view';
import {
    copyCurrentBlock,
    cutCurrentBlock,
    deleteCurrentBlock,
    HEADING_BLOCK_TYPE_OPTIONS,
    LIST_BLOCK_TYPE_OPTIONS,
    PARAGRAPH_BLOCK_TYPE_OPTION,
    SIMPLE_BLOCK_TYPE_OPTIONS,
    type BlockTypeConversionOption,
    convertCurrentBlockType,
} from './block-type-commands';

type BlockMenuAction = {
    label: string;
    icon: string;
    warning?: boolean;
    run: () => boolean | Promise<boolean>;
    failureNotice: string;
};

type NestedConversionGroup = {
    label: string;
    icon: string;
    options: BlockTypeConversionOption[];
};

const NESTED_GROUPS: NestedConversionGroup[] = [
    { label: 'Heading', icon: 'heading', options: HEADING_BLOCK_TYPE_OPTIONS },
    { label: 'List', icon: 'list', options: LIST_BLOCK_TYPE_OPTIONS },
];

// Single source of truth for the block this menu session operates on.
// Nested pages open after the parent returns, so they read this module value.
let menuBlockLine = 0;

/**
 * Block-type menu.
 *
 * Architecture: one Menu at a time. Groups (Heading / List) open a child page
 * that replaces the root — never a second floating Menu. That avoids the
 * parent-hide → child-destroy race that made nested item clicks no-ops.
 */
export function openBlockTypeMenu(
    view: EditorView,
    event: MouseEvent | PointerEvent | null,
    lineNumber?: number,
): void {
    menuBlockLine = lineNumber ?? view.state.doc.lineAt(view.state.selection.main.head).number;
    showRootMenu(view, event);
}

function showRootMenu(view: EditorView, event: MouseEvent | PointerEvent | null): void {
    const menu = new Menu();
    const line = menuBlockLine;

    addConversionItem(menu, view, PARAGRAPH_BLOCK_TYPE_OPTION, line);

    for (const group of NESTED_GROUPS) {
        menu.addItem((item) => item
            .setTitle(createGroupTitle(group.label))
            .setIcon(group.icon)
            .onClick(() => {
                // Replace root with the group page. Parent hide is intentional
                // and complete before the child is shown — no dual-menu race.
                showGroupMenu(view, group, line);
            }));
    }

    for (const option of SIMPLE_BLOCK_TYPE_OPTIONS) {
        addConversionItem(menu, view, option, line);
    }

    menu.addSeparator();
    addActionItem(menu, {
        label: 'Copy block',
        icon: 'copy',
        run: () => copyCurrentBlock(view, line),
        failureNotice: 'Unable to copy block.',
    });
    addActionItem(menu, {
        label: 'Cut block',
        icon: 'scissors',
        run: () => cutCurrentBlock(view, line),
        failureNotice: 'Unable to cut block.',
    });
    addActionItem(menu, {
        label: 'Delete block',
        icon: 'trash-2',
        warning: true,
        run: () => deleteCurrentBlock(view, line),
        failureNotice: 'Unable to delete block.',
    });

    showMenuAt(menu, view, event);
}

function showGroupMenu(
    view: EditorView,
    group: NestedConversionGroup,
    line: number,
): void {
    const menu = new Menu();

    menu.addItem((item) => item
        .setTitle('Back')
        .setIcon('chevron-left')
        .onClick(() => {
            showRootMenu(view, null);
        }));

    for (const option of group.options) {
        addConversionItem(menu, view, option, line);
    }

    showMenuAt(menu, view, null);
}

function addConversionItem(
    menu: Menu,
    view: EditorView,
    option: BlockTypeConversionOption,
    line: number,
): void {
    const target = option.target;
    menu.addItem((item) => item
        .setTitle(option.label)
        .setIcon(option.icon)
        .onClick(() => {
            if (!convertCurrentBlockType(view, target, line)) {
                new Notice('Unable to change block type.');
                return;
            }
            menu.hide();
        }));
}

function addActionItem(menu: Menu, action: BlockMenuAction): void {
    menu.addItem((item) => {
        item
            .setTitle(action.label)
            .setIcon(action.icon)
            .onClick(() => {
                void (async () => {
                    const ok = await action.run();
                    if (!ok) {
                        new Notice(action.failureNotice);
                        return;
                    }
                    menu.hide();
                })();
            });
        if (action.warning) item.setWarning(true);
    });
}

function createGroupTitle(labelText: string): DocumentFragment {
    const fragment = activeDocument.createDocumentFragment();
    const title = activeDocument.createElement('span');
    title.className = 'dnd-block-type-submenu-title';

    const label = activeDocument.createElement('span');
    label.className = 'dnd-block-type-submenu-title-label';
    label.textContent = labelText;

    const chevron = activeDocument.createElement('span');
    chevron.className = 'dnd-block-type-submenu-title-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    setIcon(chevron, 'chevron-right');

    title.append(label, chevron);
    fragment.appendChild(title);
    return fragment;
}

function showMenuAt(
    menu: Menu,
    view: EditorView,
    event: MouseEvent | PointerEvent | null,
): void {
    if (event) {
        menu.showAtMouseEvent(event);
        return;
    }
    const coords = view.coordsAtPos(view.state.selection.main.head);
    if (coords) {
        menu.showAtPosition({ x: coords.left, y: coords.bottom });
        return;
    }
    menu.showAtPosition({
        x: activeWindow.innerWidth / 2,
        y: activeWindow.innerHeight / 2,
    });
}
