import { Menu, Notice, Platform, setIcon } from 'obsidian';
import { EditorView } from '@codemirror/view';
import { pointInTopDocument } from 'md-dragger/adapter/codemirror';
import type { BlockStyleDefinition } from './block-styles';
import { t } from './i18n';
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
    customStyles?: BlockStyleDefinition[],
): void {
    disposeFlyout();
    menuBlockLine = lineNumber ?? view.state.doc.lineAt(view.state.selection.main.head).number;
    showRootMenu(view, event, customStyles);
}

function showRootMenu(
    view: EditorView,
    event: MouseEvent | PointerEvent | null,
    customStyles?: BlockStyleDefinition[],
): void {
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

    const groups: NestedConversionGroup[] = [...NESTED_GROUPS];
    if (customStyles && customStyles.length > 0) {
        groups.push({
            label: t().headingCustomBlockStyles,
            icon: 'sparkles',
            options: customStyles.map((style) => ({
                target: style,
                label: style.label,
                icon: style.icon,
            })),
        });
    }

    for (const group of groups) {
        menu.addItem((item) => {
            item.setTitle(createGroupTitle(group.label)).setIcon(group.icon);
            if (Platform.isMobile) {
                item.onClick(() => {
                    showMobileGroupPage(view, group, line, customStyles);
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

    const doc = showMenuAt(menu, view, event);

    if (Platform.isDesktop) {
        // Bind hover after the menu is in the DOM.
        window.queueMicrotask(() => bindDesktopGroupHover(view, line, doc, groups));
    }
}

function showMobileGroupPage(
    view: EditorView,
    group: NestedConversionGroup,
    line: number,
    customStyles?: BlockStyleDefinition[],
): void {
    const menu = new Menu();
    menu.setUseNativeMenu(false);

    menu.addItem((item) =>
        item
            .setTitle('Back')
            .setIcon('chevron-left')
            .onClick(() => {
                showRootMenu(view, null, customStyles);
            }),
    );

    for (const option of group.options) {
        addConversionItem(menu, view, option, line, () => menu.hide());
    }

    showMenuAt(menu, view, null);
}

function bindDesktopGroupHover(view: EditorView, line: number, doc: Document, groups: NestedConversionGroup[]): void {
    const menuEl = latestMenuElement(doc);
    if (!menuEl) return;

    for (const item of Array.from(menuEl.querySelectorAll<HTMLElement>('.menu-item'))) {
        if (item.dataset.dGroupHoverBound === 'true') continue;
        const title = item.querySelector<HTMLElement>('.d-block-type-submenu-title-label')?.textContent?.trim();
        const group = groups.find((candidate) => candidate.label === title);
        if (!group) continue;

        item.dataset.dGroupHoverBound = 'true';
        item.addEventListener('pointerenter', () => {
            openFlyout(view, group, item, line);
        });
        item.addEventListener('pointerleave', (event) => {
            const related = event.relatedTarget;
            if (isNode(related) && flyoutEl?.contains(related)) {
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

    // The flyout goes into the menu's document: the trigger is a menu item.
    const doc = trigger.doc;
    const panel = doc.win.createDiv();
    panel.className = `menu ${FLYOUT_CLASS}`;
    panel.setAttribute('role', 'menu');

    for (const option of group.options) {
        panel.appendChild(createFlyoutItem(doc, view, option, line));
    }

    panel.addEventListener('pointerenter', () => {
        cancelFlyoutClose();
    });
    panel.addEventListener('pointerleave', (event) => {
        const related = event.relatedTarget;
        if (isNode(related) && flyoutTrigger?.contains(related)) {
            cancelFlyoutClose();
            return;
        }
        scheduleFlyoutClose();
    });

    doc.body.appendChild(panel);
    positionFlyout(panel, trigger);

    flyoutEl = panel;
    flyoutTrigger = trigger;
}

function createFlyoutItem(
    doc: Document,
    view: EditorView,
    option: BlockTypeConversionOption,
    line: number,
): HTMLElement {
    const target = option.target;
    const row = doc.win.createDiv();
    row.className = `menu-item ${FLYOUT_ITEM_CLASS}`;
    row.setAttribute('role', 'menuitem');
    row.tabIndex = 0;

    const icon = doc.win.createDiv();
    icon.className = 'menu-item-icon';
    setIcon(icon, option.icon);

    const title = doc.win.createDiv();
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
    const win = trigger.win;
    const rect = trigger.getBoundingClientRect();
    // Measure after attach so we can flip if near the right edge.
    const width = panel.offsetWidth || 160;
    const height = panel.offsetHeight || 0;
    let x = rect.right + 4;
    let y = rect.top;
    if (x + width > win.innerWidth - 8) {
        x = Math.max(8, rect.left - width - 4);
    }
    if (y + height > win.innerHeight - 8) {
        y = Math.max(8, win.innerHeight - height - 8);
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

function latestMenuElement(doc: Document): HTMLElement | null {
    const menus = Array.from(doc.querySelectorAll<HTMLElement>('.menu'));
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
    const fragment = activeWindow.createFragment();
    const title = activeWindow.createSpan();
    title.className = 'd-block-type-submenu-title';

    const label = activeWindow.createSpan();
    label.className = 'd-block-type-submenu-title-label';
    label.textContent = labelText;

    const chevron = activeWindow.createSpan();
    chevron.className = 'd-block-type-submenu-title-chevron';
    chevron.setAttribute('aria-hidden', 'true');
    setIcon(chevron, 'chevron-right');

    title.append(label, chevron);
    fragment.appendChild(title);
    return fragment;
}

/**
 * Opens the menu at the event's point, or else at the cursor, in the window
 * the user is looking at: a pop-out window's editor gets the menu in that
 * window; a canvas card's editor (in an iframe) gets it in the main window at
 * the point's on-screen position. Returns the document the menu is shown in.
 */
function showMenuAt(menu: Menu, view: EditorView, event: MouseEvent | PointerEvent | null): Document {
    // Always position by coordinates. Never showAtMouseEvent for a short-tap
    // re-open: the originating touch is finished, and on mobile that API can
    // bind the leftover click as an outside-dismiss.
    const editorDoc = view.dom.ownerDocument;
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
        // Standard DOM: a card iframe's window need not carry Obsidian's helpers.
        const win = editorDoc.defaultView;
        if (!win) throw new Error('Dragger: editor document has no window');
        x = win.innerWidth / 2;
        y = win.innerHeight / 2;
    }
    const at = pointInTopDocument(editorDoc, x, y);
    menu.showAtPosition({ x: at.x, y: at.y }, at.doc);
    return at.doc;
}

/** Cross-window safe `instanceof Node`. */
function isNode(value: unknown): value is Node {
    return typeof value === 'object' && value !== null && typeof (value as Node).nodeType === 'number';
}
