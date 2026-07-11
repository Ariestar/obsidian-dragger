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

type MenuAnchor = {
    x: number;
    y: number;
};

const NESTED_GROUPS: NestedConversionGroup[] = [
    { label: 'Heading', icon: 'heading', options: HEADING_BLOCK_TYPE_OPTIONS },
    { label: 'List', icon: 'list', options: LIST_BLOCK_TYPE_OPTIONS },
];

// Session state for the open menu. Nested pages open after the root returns,
// so they read these module values instead of closing over a destroyed Menu.
let menuBlockLine = 0;
let menuAnchor: MenuAnchor | null = null;

/**
 * Block-type menu.
 *
 * One Menu at a time. Groups (Heading / List) replace the root with a child
 * page (Back + options). Desktop also opens that page on hover of the group
 * row. Never a second floating Menu — that model races parent hide against
 * child clicks.
 */
export function openBlockTypeMenu(
    view: EditorView,
    event: MouseEvent | PointerEvent | null,
    lineNumber?: number,
): void {
    menuBlockLine = lineNumber ?? view.state.doc.lineAt(view.state.selection.main.head).number;
    menuAnchor = event
        ? { x: event.clientX, y: event.clientY }
        : coordsAnchor(view);
    showRootMenu(view);
}

function showRootMenu(view: EditorView): void {
    const menu = new Menu();
    // DOM menu required so we can bind hover on group rows after show.
    menu.setUseNativeMenu(false);
    const line = menuBlockLine;

    addConversionItem(menu, view, PARAGRAPH_BLOCK_TYPE_OPTION, line);

    for (const group of NESTED_GROUPS) {
        menu.addItem((item) => item
            .setTitle(createGroupTitle(group.label))
            .setIcon(group.icon)
            .onClick(() => {
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

    const el = showMenuAt(menu, view, menuAnchor);
    // Desktop: hover a group row → same page navigation as click.
    // Mobile stays click-only (no reliable hover).
    if (el && platform.isDesktop) {
        bindGroupHover(view, el, line);
    }
}

function showGroupMenu(
    view: EditorView,
    group: NestedConversionGroup,
    line: number,
): void {
    const menu = new Menu();
    menu.setUseNativeMenu(false);

    menu.addItem((item) => item
        .setTitle('Back')
        .setIcon('chevron-left')
        .onClick(() => {
            showRootMenu(view);
        }));

    for (const option of group.options) {
        addConversionItem(menu, view, option, line);
    }

    showMenuAt(menu, view, menuAnchor);
}

function bindGroupHover(view: EditorView, menuEl: HTMLElement, line: number): void {
    for (const item of Array.from(menuEl.querySelectorAll<HTMLElement>('.menu-item'))) {
        if (item.dataset.dndGroupHoverBound === 'true') continue;
        const title = item
            .querySelector<HTMLElement>('.dnd-block-type-submenu-title-label')
            ?.textContent
            ?.trim();
        const group = NESTED_GROUPS.find((candidate) => candidate.label === title);
        if (!group) continue;

        item.dataset.dndGroupHoverBound = 'true';
        item.addEventListener('pointerenter', () => {
            // Replace root with the group page. Still one Menu; no dual-menu race.
            showGroupMenu(view, group, line);
        });
    }
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

function coordsAnchor(view: EditorView): MenuAnchor {
    const coords = view.coordsAtPos(view.state.selection.main.head);
    if (coords) return { x: coords.left, y: coords.bottom };
    return {
        x: activeWindow.innerWidth / 2,
        y: activeWindow.innerHeight / 2,
    };
}

function showMenuAt(
    menu: Menu,
    view: EditorView,
    anchor: MenuAnchor | null,
): HTMLElement | null {
    const position = anchor ?? coordsAnchor(view);
    const before = new Set(Array.from(activeDocument.querySelectorAll<HTMLElement>('.menu')));
    menu.showAtPosition(position);
    // Keep later pages at the same screen spot as the original open.
    menuAnchor = position;

    const menus = Array.from(activeDocument.querySelectorAll<HTMLElement>('.menu'));
    for (let i = menus.length - 1; i >= 0; i--) {
        if (!before.has(menus[i])) return menus[i];
    }
    return menus[menus.length - 1] ?? null;
}
