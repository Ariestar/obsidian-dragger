import { GRIP_DOTS_CORE_SIZE_RATIO, HANDLE_CORE_SIZE_RATIO } from '../shared/constants';
import { DRAG_SOURCE_HIGHLIGHT_ATTR, DRAG_SOURCE_STYLE_ATTR, HANDLE_ICON_ATTR } from '../shared/dom-selectors';
import type { DragNDropSettings } from './settings-types';

/** The body classes, attributes, and CSS variables through which styles.css renders the settings. */
export type SettingsPresentation = {
    classes: Record<string, boolean>;
    attributes: Record<string, string>;
    /** An empty value leaves the variable unset, so the stylesheet's fallback applies. */
    cssProps: Record<string, string>;
};

export function settingsPresentation(
    settings: DragNDropSettings,
    state: { isMobile: boolean; mobileDragModeEnabled: boolean },
): SettingsPresentation {
    const visibility = settings.handleVisibility;
    // A right-side gutter mirrors the offset: the handle sits at the right
    // edge, so the configured shift flips sign to keep the same visual margin
    // as on the left.
    const offset =
        settings.handleGutterPosition === 'right'
            ? -settings.handleHorizontalOffsetPx
            : settings.handleHorizontalOffsetPx;
    const handleColor = settings.handleColorMode === 'theme' ? 'var(--interactive-accent)' : settings.handleColor;
    const size = settings.handleSize;
    return {
        classes: {
            'd-handles-always': visibility === 'always',
            'd-handles-hidden': visibility === 'hidden',
            'd-mobile-handles-hidden': state.isMobile && !settings.enableMobileTextLongPressDrag,
            'd-mobile-drag-mode-enabled': state.mobileDragModeEnabled,
        },
        attributes: {
            [DRAG_SOURCE_STYLE_ATTR]: settings.selectionVisualStyle,
            [DRAG_SOURCE_HIGHLIGHT_ATTR]: settings.enableBlockSelectionHighlight ? 'on' : 'off',
            [HANDLE_ICON_ATTR]: settings.handleIcon,
        },
        cssProps: {
            '--d-handle-horizontal-offset-px': `${offset}px`,
            '--d-handle-color': handleColor,
            '--d-handle-color-hover': handleColor,
            // Theme mode: leave the variable unset so the drop indicator falls
            // back to the same accent-derived color as the source highlight
            // edge (--d-drag-source-border) in the stylesheet.
            '--d-drop-indicator-color': settings.indicatorColorMode === 'custom' ? settings.indicatorColor : '',
            '--d-handle-size': `${size}px`,
            '--d-handle-core-size': `${Math.round(size * HANDLE_CORE_SIZE_RATIO)}px`,
            '--d-grip-dots-core-size': `${Math.round(size * GRIP_DOTS_CORE_SIZE_RATIO)}px`,
        },
    };
}

/**
 * Keeps the settings presented on the body of every document that hosts a Dragger editor: the main window, each
 * pop-out window, and each canvas card's iframe. Obsidian mirrors only part of the main body into card iframes, so
 * each document is presented directly.
 */
export class SettingsPresenter {
    private readonly documents = new Set<Document>();
    private presentation: SettingsPresentation | null = null;

    /** Presents the settings in a document hosting a Dragger editor. Cheap to repeat. */
    presentIn(doc: Document): void {
        if (this.documents.has(doc)) return;
        this.documents.add(doc);
        if (this.presentation !== null) show(doc.body, this.presentation);
    }

    update(presentation: SettingsPresentation): void {
        this.presentation = presentation;
        for (const doc of this.documents) {
            // A closed pop-out window or a card that stopped editing.
            if (doc.defaultView === null) {
                this.documents.delete(doc);
                continue;
            }
            show(doc.body, presentation);
        }
    }

    /** Removes the presentation from every document, and presents nothing until the next update. */
    clear(): void {
        const presentation = this.presentation;
        if (presentation !== null) {
            for (const doc of this.documents) {
                const body = doc.body;
                for (const name of Object.keys(presentation.classes)) body.classList.remove(name);
                for (const name of Object.keys(presentation.attributes)) body.removeAttribute(name);
                for (const name of Object.keys(presentation.cssProps)) body.style.removeProperty(name);
            }
        }
        this.documents.clear();
        this.presentation = null;
    }
}

// Standard DOM only: a card iframe's elements come from another realm, which
// need not carry Obsidian's element helpers (setCssProps and friends).
function show(body: HTMLElement, presentation: SettingsPresentation): void {
    for (const [name, on] of Object.entries(presentation.classes)) body.classList.toggle(name, on);
    for (const [name, value] of Object.entries(presentation.attributes)) body.setAttribute(name, value);
    for (const [name, value] of Object.entries(presentation.cssProps)) {
        if (value === '') body.style.removeProperty(name);
        else body.style.setProperty(name, value);
    }
}
