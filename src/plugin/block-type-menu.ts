import { Menu, Notice, Platform, setIcon } from 'obsidian';
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

const FLYOUT_CLASS = 'd-block-type-flyout';
const FLYOUT_ITEM_CLASS = 'd-block-type-flyout-item';

// Session: which block the open menu operates on (1-indexed line).
let menuBlockLine = 0;

// Desktop flyout state. Not an Obsidian Menu — a plain DOM panel — so parent
// Menu hide cannot tear down the child before a click lands.
let flyoutEl: HTMLElement | null = null;
let flyoutTrigger: HTMLElement | null = null;
let flyoutCloseTimer: number | null = null;
let rootMenu: Menu | null = null;

/**
 * Block-type menu.
 *
 * Desktop: Heading / List open a side flyout on hover (no Back page).
 * The flyout is plain DOM, not a second Menu, so item clicks always apply.
 * Mobile: group click opens a replacement page with Back (no hover).
 */
export function openBlockTypeMenu(
    view: EditorView,
    event: MouseEvent | PointerEvent | null,
    lineNumber?: number,
): void {
    disposeFlyout();
    menuBlockLine = lineNumber ?? view.state.doc.lineAt(view.state.selection.main.head).number;
    showRootMenu(view, event);
}

function showRootMenu(view: EditorView, event: MouseEvent | PointerEvent | null): void {
    const menu = new Menu();
    menu.setUseNativeMenu(false);
    rootMenu = menu;
    const line = menuBlockLine;

    menu.onHide(() => {
        // Root closed → drop any open flyout. Delay one frame so a flyout click
        // that also dismisses the root can still complete its pointerup first.
        window.requestAnimationFrame(() => {
            if (rootMenu === menu) rootMenu = null;
            disposeFlyout();
        });
    });

    addConversionItem(menu, view, PARAGRAPH_BLOCK_TYPE_OPTION, line, () => menu.hide());

    for (const group of NESTED_GROUPS) {
        menu.addItem((item) => {
            item.setTitle(createGroupTitle(group.label)).setIcon(group.icon);
            if (Platform.isMobile) {
                item.onClick(() => {
                    showMobileGroupPage(view, group, line);
                });
            }
        });
    }

    for (const option of SIMPLE_BLOCK_TYPE_OPTIONS) {
        addConversionItem(menu, view, option, line, () => menu.hide());
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

    if (Platform.isDesktop) {
        // Bind hover after the menu is in the DOM.
        window.queueMicrotask(() => bindDesktopGroupHover(view, line));
    }
}

function showMobileGroupPage(view: EditorView, group: NestedConversionGroup, line: number): void {
    const menu = new Menu();
    menu.setUseNativeMenu(false);

    menu.addItem((item) =>
        item
            .setTitle('Back')
            .setIcon('chevron-left')
            .onClick(() => {
                showRootMenu(view, null);
            }),
    );

    for (const option of group.options) {
        addConversionItem(menu, view, option, line, () => menu.hide());
    }

    showMenuAt(menu, view, null);
}

function bindDesktopGroupHover(view: EditorView, line: number): void {
    const menuEl = latestMenuElement();
    if (!menuEl) return;

    for (const item of Array.from(menuEl.querySelectorAll<HTMLElement>('.menu-item'))) {
        if (item.dataset.dGroupHoverBound === 'true') continue;
        const title = item.querySelector<HTMLElement>('.d-block-type-submenu-title-label')?.textContent?.trim();
        const group = NESTED_GROUPS.find((candidate) => candidate.label === title);
        if (!group) continue;

        item.dataset.dGroupHoverBound = 'true';
        item.addEventListener('pointerenter', () => {
            openFlyout(view, group, item, line);
        });
        item.addEventListener('pointerleave', (event) => {
            const related = event.relatedTarget;
            if (related instanceof Node && flyoutEl?.contains(related)) {
                cancelFlyoutClose();
                return;
            }
            scheduleFlyoutClose();
        });
    }
}

function openFlyout(view: EditorView, group: NestedConversionGroup, trigger: HTMLElement, line: number): void {
    cancelFlyoutClose();
    if (flyoutEl && flyoutTrigger === trigger) return;

    disposeFlyout();

    const panel = activeDocument.createElement('div');
    panel.className = `menu ${FLYOUT_CLASS}`;
    panel.setAttribute('role', 'menu');

    for (const option of group.options) {
        panel.appendChild(createFlyoutItem(view, option, line));
    }

    panel.addEventListener('pointerenter', () => {
        cancelFlyoutClose();
    });
    panel.addEventListener('pointerleave', (event) => {
        const related = event.relatedTarget;
        if (related instanceof Node && flyoutTrigger?.contains(related)) {
            cancelFlyoutClose();
            return;
        }
        scheduleFlyoutClose();
    });

    activeDocument.body.appendChild(panel);
    positionFlyout(panel, trigger);

    flyoutEl = panel;
    flyoutTrigger = trigger;
}

function createFlyoutItem(view: EditorView, option: BlockTypeConversionOption, line: number): HTMLElement {
    const target = option.target;
    const row = activeDocument.createElement('div');
    row.className = `menu-item ${FLYOUT_ITEM_CLASS}`;
    row.setAttribute('role', 'menuitem');
    row.tabIndex = 0;

    const icon = activeDocument.createElement('div');
    icon.className = 'menu-item-icon';
    setIcon(icon, option.icon);

    const title = activeDocument.createElement('div');
    title.className = 'menu-item-title';
    title.textContent = option.label;

    row.append(icon, title);

    // Use pointerdown so conversion commits even if the root Menu starts
    // hiding on the subsequent click (outside-click dismiss).
    const apply = (event: Event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!convertCurrentBlockType(view, target, line)) {
            new Notice('Unable to change block type.');
            return;
        }
        disposeFlyout();
        rootMenu?.hide();
    };
    row.addEventListener('pointerdown', apply);
    row.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        apply(event);
    });

    return row;
}

function positionFlyout(panel: HTMLElement, trigger: HTMLElement): void {
    const rect = trigger.getBoundingClientRect();
    // Measure after attach so we can flip if near the right edge.
    const width = panel.offsetWidth || 160;
    const height = panel.offsetHeight || 0;
    let x = rect.right + 4;
    let y = rect.top;
    if (x + width > activeWindow.innerWidth - 8) {
        x = Math.max(8, rect.left - width - 4);
    }
    if (y + height > activeWindow.innerHeight - 8) {
        y = Math.max(8, activeWindow.innerHeight - height - 8);
    }
    panel.setCssStyles({
        position: 'fixed',
        left: `${x}px`,
        top: `${y}px`,
        zIndex: '10000',
    });
}

function scheduleFlyoutClose(): void {
    cancelFlyoutClose();
    flyoutCloseTimer = window.setTimeout(() => {
        disposeFlyout();
    }, 100);
}

function cancelFlyoutClose(): void {
    if (flyoutCloseTimer === null) return;
    window.clearTimeout(flyoutCloseTimer);
    flyoutCloseTimer = null;
}

function disposeFlyout(): void {
    cancelFlyoutClose();
    flyoutEl?.remove();
    flyoutEl = null;
    flyoutTrigger = null;
}

function latestMenuElement(): HTMLElement | null {
    const menus = Array.from(activeDocument.querySelectorAll<HTMLElement>('.menu'));
    return menus[menus.length - 1] ?? null;
}

function addConversionItem(
    menu: Menu,
    view: EditorView,
    option: BlockTypeConversionOption,
    line: number,
    afterApply: () => void,
): void {
    const target = option.target;
    menu.addItem((item) =>
        item
            .setTitle(option.label)
            .setIcon(option.icon)
            .onClick(() => {
                if (!convertCurrentBlockType(view, target, line)) {
                    new Notice('Unable to change block type.');
                    return;
                }
                afterApply();
            }),
    );
}

function addActionItem(menu: Menu, action: BlockMenuAction): void {
    menu.addItem((item) => {
        item.setTitle(action.label)
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
    title.className = 'd-block-type-submenu-title';

    const label = activeDocument.createElement('span');
    label.className = 'd-block-type-submenu-title-label';
    label.textContent = labelText;

    const chevron = activeDocument.createElement('span');
    chevron.className = 'd-block-type-submenu-title-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    setIcon(chevron, 'chevron-right');

    title.append(label, chevron);
    fragment.appendChild(title);
    return fragment;
}

function showMenuAt(menu: Menu, view: EditorView, event: MouseEvent | PointerEvent | null): void {
    // Always position by coordinates. Never showAtMouseEvent for a short-tap
    // re-open: the originating touch is finished, and on mobile that API can
    // bind the leftover click as an outside-dismiss.
    let x: number | null = null;
    let y: number | null = null;
    if (event && typeof event.clientX === 'number' && typeof event.clientY === 'number') {
        x = event.clientX;
        y = event.clientY;
    } else {
        const coords = view.coordsAtPos(view.state.selection.main.head);
        if (coords) {
            x = coords.left;
            y = coords.bottom;
        }
    }
    if (x === null || y === null) {
        x = activeWindow.innerWidth / 2;
        y = activeWindow.innerHeight / 2;
    }
    menu.showAtPosition({ x, y });
}
