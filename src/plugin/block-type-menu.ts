import { Menu, Notice, setIcon } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { platform } from './platform';
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

let openChildMenu: Menu | null = null;
let openChildTrigger: HTMLElement | null = null;
let openChildMenuEl: HTMLElement | null = null;
let closeChildMenuTimer: number | null = null;
// 1-indexed line the open menu operates on. Module-scoped so the nested
// (asynchronously opened) submenu pages read it after openBlockTypeMenu
// has returned.
let menuBlockLine: number = 0;

export function openBlockTypeMenu(
    view: EditorView,
    event: MouseEvent | PointerEvent | null,
    lineNumber?: number
): void {
    menuBlockLine = lineNumber ?? view.state.doc.lineAt(view.state.selection.main.head).number;
    const menu = new Menu();
    const nestedGroups: NestedConversionGroup[] = [
        {
            label: 'Heading',
            icon: 'heading',
            options: HEADING_BLOCK_TYPE_OPTIONS,
        },
        {
            label: 'List',
            icon: 'list',
            options: LIST_BLOCK_TYPE_OPTIONS,
        },
    ];
    menu.onHide(() => {
        window.setTimeout(() => hideOpenChildMenu(), 150);
    });

    addConversionItem(menu, view, PARAGRAPH_BLOCK_TYPE_OPTION, menuBlockLine);
    for (const group of nestedGroups) {
        addNestedConversionMenu(menu, view, group);
    }
    for (const option of SIMPLE_BLOCK_TYPE_OPTIONS) {
        addConversionItem(menu, view, option, menuBlockLine);
    }

    menu.addSeparator();
    addActionRow(menu, [
        {
            label: 'Copy block',
            icon: 'copy',
            run: () => copyCurrentBlock(view, menuBlockLine),
            failureNotice: 'Unable to copy block.',
        },
        {
            label: 'Cut block',
            icon: 'scissors',
            run: () => cutCurrentBlock(view, menuBlockLine),
            failureNotice: 'Unable to cut block.',
        },
        {
            label: 'Delete block',
            icon: 'trash-2',
            warning: true,
            run: () => deleteCurrentBlock(view, menuBlockLine),
            failureNotice: 'Unable to delete block.',
        },
    ]);

    showMenu(menu, view, event, nestedGroups);
}

function addConversionItem(menu: Menu, view: EditorView, option: BlockTypeConversionOption, lineNumber: number): void {
    menu.addItem((item) => item
        .setTitle(option.label)
        .setIcon(option.icon)
        .onClick(() => {
            if (!convertCurrentBlockType(view, option.target, lineNumber)) {
                new Notice('Unable to change block type.');
                return;
            }
            menu.hide();
        }));
}

function addNestedConversionMenu(
    menu: Menu,
    view: EditorView,
    group: NestedConversionGroup
): void {
    menu.addItem((item) => {
        item
            .setTitle(createSubmenuTitle(group.label))
            .setIcon(group.icon);
        if (platform.isMobile) {
            item.onClick(() => {
                openNestedMenuPage(menu, view, group);
            });
        }
    });
}

function createSubmenuTitle(labelText: string): DocumentFragment {
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

function openNestedMenuPopover(
    view: EditorView,
    group: NestedConversionGroup,
    trigger: HTMLElement
): void {
    cancelChildMenuClose();
    if (openChildMenu && openChildTrigger === trigger) return;

    hideOpenChildMenu();
    const child = createNestedConversionMenu(view, group.options, menuBlockLine);
    openChildMenu = child;
    openChildTrigger = trigger;
    child.onHide(() => {
        if (openChildMenu === child) {
            clearOpenChildMenuState();
        }
    });
    openChildMenuEl = showNestedMenu(child, trigger);
    activeDocument.addEventListener('pointermove', closeChildMenuWhenPointerLeaves, true);
}

function openNestedMenuPage(
    parent: Menu,
    view: EditorView,
    group: NestedConversionGroup
): void {
    parent.hide();
    const child = new Menu();
    child.addItem((item) => item
        .setTitle('Back')
        .setIcon('chevron-left')
        .onClick(() => {
            child.hide();
            openBlockTypeMenu(view, null);
        }));
    for (const option of group.options) {
        addConversionItem(child, view, option, menuBlockLine);
    }
    showMenu(child, view, null);
}

function createNestedConversionMenu(view: EditorView, options: BlockTypeConversionOption[], lineNumber: number): Menu {
    const child = new Menu();
    for (const option of options) {
        addConversionItem(child, view, option, lineNumber);
    }
    return child;
}

function addActionRow(menu: Menu, actions: BlockMenuAction[]): void {
    for (const action of actions) {
        addActionItem(menu, action);
    }
}

function addActionItem(menu: Menu, action: BlockMenuAction): void {
    menu.addItem((item) => {
        item
            .setTitle(action.label)
            .setIcon(action.icon)
            .onClick(() => {
                void executeMenuAction(menu, action);
            });
        if (action.warning) {
            item.setWarning(true);
        }
    });
}

async function executeMenuAction(menu: Menu, action: BlockMenuAction): Promise<void> {
    const ok = await action.run();
    if (!ok) {
        new Notice(action.failureNotice);
        return;
    }
    menu.hide();
}

function prepareNestedMenuItems(view: EditorView, groups: NestedConversionGroup[]): void {
    const isMobile = platform.isMobile;
    const items = activeDocument.querySelectorAll<HTMLElement>('.menu-item');
    for (const item of Array.from(items)) {
        const title = item.querySelector<HTMLElement>('.dnd-block-type-submenu-title-label')?.textContent?.trim();
        const group = groups.find((candidate) => candidate.label === title);
        if (!group) continue;

        if (isMobile || item.dataset.dndSubmenuBound === 'true') continue;

        item.dataset.dndSubmenuBound = 'true';
        item.addEventListener('pointerenter', () => {
            openNestedMenuPopover(view, group, item);
        });
    }
}

function closeChildMenuWhenPointerLeaves(event: PointerEvent): void {
    const target = event.target;
    if (
        target instanceof Node
        && (openChildTrigger?.contains(target) || openChildMenuEl?.contains(target))
    ) {
        cancelChildMenuClose();
        return;
    }

    cancelChildMenuClose();
    closeChildMenuTimer = window.setTimeout(() => {
        hideOpenChildMenu();
    }, 80);
}

function cancelChildMenuClose(): void {
    if (closeChildMenuTimer === null) return;
    window.clearTimeout(closeChildMenuTimer);
    closeChildMenuTimer = null;
}

function hideOpenChildMenu(): void {
    const menu = openChildMenu;
    clearOpenChildMenuState();
    menu?.hide();
}

function clearOpenChildMenuState(): void {
    cancelChildMenuClose();
    activeDocument.removeEventListener('pointermove', closeChildMenuWhenPointerLeaves, true);
    openChildMenu = null;
    openChildTrigger = null;
    openChildMenuEl = null;
}

function showNestedMenu(menu: Menu, trigger: HTMLElement): HTMLElement | null {
    const rect = trigger.getBoundingClientRect();
    const existingMenus = new Set(Array.from(activeDocument.querySelectorAll<HTMLElement>('.menu')));
    menu.showAtPosition({
        x: rect.right,
        y: rect.top,
        width: rect.width,
        overlap: true,
    });
    const menus = Array.from(activeDocument.querySelectorAll<HTMLElement>('.menu'));
    for (let i = menus.length - 1; i >= 0; i--) {
        if (!existingMenus.has(menus[i])) return menus[i];
    }
    return menus[menus.length - 1] ?? null;
}

function showMenu(
    menu: Menu,
    view: EditorView,
    event: MouseEvent | PointerEvent | null,
    nestedGroups: NestedConversionGroup[] = []
): void {
    if (event) {
        menu.showAtMouseEvent(event);
    } else {
        const coords = view.coordsAtPos(view.state.selection.main.head);
        if (coords) {
            menu.showAtPosition({ x: coords.left, y: coords.bottom });
        } else {
            menu.showAtPosition({ x: activeWindow.innerWidth / 2, y: activeWindow.innerHeight / 2 });
        }
    }

    prepareNestedMenuItems(view, nestedGroups);
}
