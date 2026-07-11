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
// 1-indexed line the open menu operates on. Module-scoped so nested submenu
// pages (opened after the parent returns) still know the target block.
let menuBlockLine = 0;

export function openBlockTypeMenu(
    view: EditorView,
    event: MouseEvent | PointerEvent | null,
    lineNumber?: number
): void {
    menuBlockLine = lineNumber ?? view.state.doc.lineAt(view.state.selection.main.head).number;
    const menu = new Menu();
    // Nested popovers need DOM menus; native menus cannot host our child Menu.
    menu.setUseNativeMenu?.(false);

    const nestedGroups: NestedConversionGroup[] = [
        { label: 'Heading', icon: 'heading', options: HEADING_BLOCK_TYPE_OPTIONS },
        { label: 'List', icon: 'list', options: LIST_BLOCK_TYPE_OPTIONS },
    ];

    menu.onHide(() => {
        // Delay teardown so a click that dismissed the parent can still land on
        // a nested child item before the child Menu is destroyed.
        window.setTimeout(() => hideOpenChildMenu(), 200);
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

function addConversionItem(
    menu: Menu,
    view: EditorView,
    option: BlockTypeConversionOption,
    lineNumber: number,
): void {
    // Close over primitives so nested menu teardown cannot race the handler.
    const target = option.target;
    const line = lineNumber;
    menu.addItem((item) => item
        .setTitle(option.label)
        .setIcon(option.icon)
        .onClick(() => {
            // Nested/desktop child menus are often torn down in the same event
            // turn as the click (parent hide cascade). Apply on the next task so
            // conversion still runs after Obsidian finishes menu cleanup.
            window.setTimeout(() => {
                if (!convertCurrentBlockType(view, target, line)) {
                    new Notice('Unable to change block type.');
                    return;
                }
                hideOpenChildMenu();
                menu.hide();
            }, 0);
        }));
}

function addNestedConversionMenu(
    menu: Menu,
    view: EditorView,
    group: NestedConversionGroup,
): void {
    menu.addItem((item) => {
        item
            .setTitle(createSubmenuTitle(group.label))
            .setIcon(group.icon);
        // Mobile has no reliable hover: open a full child page on tap.
        // Desktop opens a side popover on pointerenter (see prepareNestedMenuItems).
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
    trigger: HTMLElement,
): void {
    cancelChildMenuClose();
    if (openChildMenu && openChildTrigger === trigger) return;

    hideOpenChildMenu();
    const child = createNestedConversionMenu(view, group.options, menuBlockLine);
    child.setUseNativeMenu?.(false);
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
    group: NestedConversionGroup,
): void {
    const line = menuBlockLine;
    parent.hide();
    const child = new Menu();
    child.setUseNativeMenu?.(false);
    child.addItem((item) => item
        .setTitle('Back')
        .setIcon('chevron-left')
        .onClick(() => {
            child.hide();
            openBlockTypeMenu(view, null, line);
        }));
    for (const option of group.options) {
        addConversionItem(child, view, option, line);
    }
    showMenu(child, view, null);
}

function createNestedConversionMenu(
    view: EditorView,
    options: BlockTypeConversionOption[],
    lineNumber: number,
): Menu {
    const child = new Menu();
    child.setUseNativeMenu?.(false);
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
    if (platform.isMobile) return;

    // Scope to the menus we just opened — never re-bind foreign menus.
    const menus = Array.from(activeDocument.querySelectorAll<HTMLElement>('.menu'));
    const latest = menus[menus.length - 1];
    if (!latest) return;

    for (const item of Array.from(latest.querySelectorAll<HTMLElement>('.menu-item'))) {
        if (item.dataset.dndSubmenuBound === 'true') continue;
        const title = item.querySelector<HTMLElement>('.dnd-block-type-submenu-title-label')?.textContent?.trim();
        const group = groups.find((candidate) => candidate.label === title);
        if (!group) continue;

        item.dataset.dndSubmenuBound = 'true';
        item.addEventListener('pointerenter', () => {
            openNestedMenuPopover(view, group, item);
        });
        // Keep the child open while the pointer is on the parent row.
        item.addEventListener('pointerleave', (event) => {
            const related = event.relatedTarget;
            if (related instanceof Node && openChildMenuEl?.contains(related)) {
                cancelChildMenuClose();
                return;
            }
            // Fall through to the shared leave handler via a short delay.
            cancelChildMenuClose();
            closeChildMenuTimer = window.setTimeout(() => hideOpenChildMenu(), 120);
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
    }, 120);
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
    nestedGroups: NestedConversionGroup[] = [],
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

    // Bind hover after the menu is in the DOM.
    window.queueMicrotask(() => prepareNestedMenuItems(view, nestedGroups));
}
