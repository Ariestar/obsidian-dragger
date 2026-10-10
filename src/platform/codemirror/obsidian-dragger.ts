import { EditorState, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import {
    HANDLE_CLASS,
    mdDragger,
    dragTransitionEffect,
    dropSeamDecoration,
    elementTarget,
    lineAtPoint,
    scrollPort,
    seamOffset,
    sourceHighlightDecoration,
    sourceLineFromInput as handleSourceLineFromInput,
    type CodeMirrorGeometryOptions,
    type MdDraggerCodeMirrorOptions,
} from 'md-dragger/adapter/codemirror';
import {
    detectBlock,
    isLineNumberInRanges,
    selectionLineRanges,
    type DropPosition,
    type LineRange,
} from 'md-dragger/domain';
import { dragSelectionDoc, dropSeamState, selectionFromOutputs, type PipelineResult } from 'md-dragger/runtime';
import { autoScroll } from 'md-dragger/runtime/modules';
import type { BlockMenuSettings } from '../../plugin/block-menu-items';
import { openBlockTypeMenu } from '../../plugin/block-type-menu';
import {
    CARD_EDITOR_ATTR,
    DRAGGING_BODY_CLASS,
    MOBILE_GESTURE_LOCK_CLASS,
    ROOT_EDITOR_CLASS,
} from '../../shared/dom-selectors';

/** Minimal plugin surface used by the editor extension. */
export type ObsidianDraggerHost = {
    settings: BlockMenuSettings & {
        enableMultiLineSelection: boolean;
        mouseRangeSelectLongPressMs: number;
        mobileDragLongPressMs: number;
        autoScrollEdgeZonePx: number;
        autoScrollMaxSpeedPx: number;
        handleGutterPosition: 'left' | 'right';
    };
    isMobilePlatform(): boolean;
    isMobileDragModeEnabled(): boolean;
    notifyDragDrop(): void;
    /** Puts the settings' body classes, attributes, and CSS variables on documents hosting Dragger editors. */
    settingsPresenter: { presentIn(doc: Document): void };
};

/**
 * Obsidian host: mdDragger + paint/shell only.
 */
// Source-mode list indent: 4 columns per level (Obsidian default).
const LIST_INDENT_UNIT = 4;

export function dragHandleExtension(plugin: ObsidianDraggerHost): Extension {
    const options: MdDraggerCodeMirrorOptions = {
        // tabSize is always read live from EditorState.tabSize by the adapter.
        config: {
            tabSize: 4,
            listIndentUnit: LIST_INDENT_UNIT,
        },
        listIndentWidthPx: (view) => listIndentStepPx(view),
        handle: {
            render: (doc) => createObsidianHandle(doc),
            side: plugin.settings.handleGutterPosition === 'right' ? 'after' : 'before',
        },
        // Obsidian's Live Preview renders tables as HTML widgets; clicking a
        // cell opens a transient nested CM6 editor for that cell's text. The
        // dragger must stay dormant there (no handles, no drags, no gesture
        // interception): its document is just the cell text. The predicate is
        // evaluated per render/press because the nested editor is mounted
        // detached and only becomes identifiable once attached into the
        // table widget.
        enabled: isDraggerView,
        locate: (view) => ({
            sourceLineFromInput: (input) => {
                // Adapter already resolves handle → data-block-start.
                // Host only adds mobile row-as-handle.
                if (!plugin.isMobilePlatform() || !plugin.isMobileDragModeEnabled()) {
                    return handleSourceLineFromInput(view, input);
                }
                const fromHandle = handleSourceLineFromInput(view, input);
                if (fromHandle !== null) return fromHandle;
                const target = elementTarget(input.native);
                if (target && !view.dom.contains(target)) return null;
                return lineAtPoint(view, input.point);
            },
        }),
        // Per view: the port reads this editor's document at scroll time, including
        // after Obsidian moves the editor into a card iframe or a pop-out window.
        ux: (view) => ({
            gesture: () => gestureConfig(plugin),
            modules: [
                autoScroll(
                    scrollPort(() => view.dom.ownerDocument),
                    () => ({
                        edgeZonePx: plugin.settings.autoScrollEdgeZonePx,
                        maxSpeedPx: plugin.settings.autoScrollMaxSpeedPx,
                    }),
                ),
            ],
        }),
        onChange: (result) => {
            for (const item of result.outputs) {
                if (item.type === 'dropped') plugin.notifyDragDrop();
            }
        },
    };

    return [
        EditorView.editorAttributes.of({ class: ROOT_EDITOR_CLASS }),
        presentSettingsInEditorDocument(plugin),
        syncHandleGeometry(),
        ...mdDragger(options),
        dropIndicatorPaint(options),
        selectionPaint(),
        handleHover(),
        gestureShell(plugin),
    ];
}

// Obsidian may move an editor into another document after building it (a
// canvas card's editor goes into the card's iframe), and no CodeMirror or
// Obsidian event reliably says so. The two plugins below re-check the editor's
// document on every update and before any pointer interaction can show a
// handle.

// The settings are presented in the document hosting the editor.
function presentSettingsInEditorDocument(host: ObsidianDraggerHost): Extension {
    return ViewPlugin.fromClass(
        class {
            private readonly present = () => host.settingsPresenter.presentIn(this.view.dom.ownerDocument);

            constructor(private readonly view: EditorView) {
                this.present();
                view.dom.addEventListener('pointerover', this.present, true);
                view.dom.addEventListener('pointerdown', this.present, true);
            }

            update() {
                this.present();
            }

            destroy() {
                this.view.dom.removeEventListener('pointerover', this.present, true);
                this.view.dom.removeEventListener('pointerdown', this.present, true);
            }
        },
    );
}

// Measure the host geometry that CSS cannot know: the distance from the
// handle gutter to the text edge, fold indicator spacing, and card clipping.
function syncHandleGeometry(): Extension {
    return ViewPlugin.fromClass(
        class {
            private readonly measure = () =>
                this.view.requestMeasure({
                    key: this,
                    read: (view) => {
                        const line = view.dom.querySelector<HTMLElement>('.cm-line');
                        const lineLeft =
                            line?.getBoundingClientRect().left ?? view.contentDOM.getBoundingClientRect().left;
                        const gutter = view.dom.querySelector<HTMLElement>('.md-dragger-gutter');
                        const gutterLeft = gutter?.getBoundingClientRect().left ?? lineLeft;
                        const textOffset = Math.max(0, lineLeft - gutterLeft);

                        const collapseIndicator = view.dom.querySelector<HTMLElement>(
                            '.cm-fold-indicator .collapse-indicator',
                        );
                        const collapseLeft = collapseIndicator?.getBoundingClientRect().left;
                        const collapseDistance = collapseLeft !== undefined ? lineLeft - collapseLeft : 0;
                        const collapseIndicatorOffset =
                            collapseDistance > 0 && collapseDistance <= 36 ? collapseDistance : 0;

                        const cardGutterLeft =
                            gutter && view.dom.ownerDocument.defaultView?.frameElement != null
                                ? gutter.getBoundingClientRect().left - view.scrollDOM.getBoundingClientRect().left
                                : null;
                        return {
                            textOffset,
                            collapseIndicatorOffset,
                            cardGutterLeft,
                        };
                    },
                    write: ({ textOffset, collapseIndicatorOffset, cardGutterLeft }, view) => {
                        view.dom.style.setProperty('--d-handle-text-offset', `${textOffset}px`);
                        view.dom.style.setProperty('--d-collapse-indicator-offset', `${collapseIndicatorOffset}px`);
                        if (cardGutterLeft === null) {
                            view.dom.removeAttribute(CARD_EDITOR_ATTR);
                            view.dom.style.removeProperty('--d-gutter-left');
                        } else {
                            view.dom.setAttribute(CARD_EDITOR_ATTR, '');
                            view.dom.style.setProperty('--d-gutter-left', `${cardGutterLeft}px`);
                        }
                    },
                });

            constructor(private readonly view: EditorView) {
                this.measure();
                view.dom.ownerDocument.defaultView?.requestAnimationFrame(() => this.measure());
                view.dom.addEventListener('pointerover', this.measure, true);
            }

            update() {
                this.measure();
            }

            destroy() {
                this.view.dom.removeEventListener('pointerover', this.measure, true);
            }
        },
    );
}

// Rendered pixel width of one list nesting level. Single source of truth:
// Obsidian's own rendering contract — --indent-unit × --indent-size (default
// 0.5625em × 4 = 2.25em) — read straight from the theme. No document scan,
// no fallback: the engine's geometry (level × step, anchor + step) always
// gets the same stable value, and theme changes apply automatically.
// --list-indent itself is a calc() chain (getComputedStyle returns it
// unparsed), so the two literals are read and multiplied instead.
function listIndentStepPx(view: EditorView): number {
    const win = view.dom.ownerDocument.defaultView;
    if (!win) throw new Error('Dragger: editor document has no window');
    const cs = win.getComputedStyle(view.contentDOM);
    const em = parseFloat(cs.getPropertyValue('--indent-unit')) * parseFloat(cs.getPropertyValue('--indent-size'));
    return em * parseFloat(cs.fontSize);
}

function createObsidianHandle(doc: Document): HTMLElement {
    const handle = doc.win.createDiv();
    handle.className = HANDLE_CLASS;
    const core = doc.win.createSpan();
    core.className = 'd-handle-core';
    core.setAttribute('aria-hidden', 'true');
    handle.appendChild(core);
    return handle;
}

// True for real markdown editors only. Obsidian's nested table-cell editor
// lives inside the rendered `.cm-table-widget`; its whole DOM is transient,
// so the check is cheap and is re-evaluated on every render/press.
function isDraggerView(view: EditorView): boolean {
    return view.dom.closest('.cm-table-widget') === null;
}

function gestureConfig(plugin: ObsidianDraggerHost) {
    const mobile = plugin.isMobilePlatform();
    return {
        dragArmMs: mobile ? plugin.settings.mobileDragLongPressMs : 0,
        multiSelectMs: plugin.settings.mouseRangeSelectLongPressMs,
        dragStartMoveThresholdPx: mobile ? 8 : 4,
        dragCancelMoveThresholdPx: Number.POSITIVE_INFINITY,
        multiSelectEnabled: plugin.settings.enableMultiLineSelection !== false,
    };
}

// The drop seam is a plain CM6 line decoration built by the adapter
// (dropSeamDecoration) on the seam row — above the first line, or below the
// previous line. The row itself is untouched — zero layout impact — and it
// rides the editor's render pipeline like the source highlight, so scrolling
// repaints it with the text flow. The visible line is drawn by an
// overflowing ::before/::after pseudo-element (styled by the protocol class
// names in styles.css); its x offset comes from CSS variables that the view
// plugin below fills from the adapter's seamOffset geometry.
function dropIndicatorPaint(options: CodeMirrorGeometryOptions): Extension {
    const dropIndicatorField = StateField.define<DecorationSet>({
        create: () => Decoration.none,
        update(deco, tr) {
            deco = deco.map(tr.changes);
            for (const effect of tr.effects) {
                if (effect.is(dragTransitionEffect)) {
                    deco = dropSeamDecoration(effect.value.outputs, tr.state);
                }
            }
            return deco;
        },
        provide: (field) => EditorView.decorations.from(field),
    });

    return [
        dropIndicatorField,
        ViewPlugin.fromClass(
            class {
                private position: DropPosition | null = null;

                constructor(private readonly view: EditorView) {}

                update(update: ViewUpdate) {
                    let seamMoved = false;
                    for (const tr of update.transactions) {
                        for (const effect of tr.effects) {
                            if (effect.is(dragTransitionEffect)) {
                                this.position = dropSeamState(effect.value.outputs, update.state.doc).position;
                                seamMoved = true;
                            }
                        }
                    }
                    // Refill the geometry CSS variables on every drag_over —
                    // scrolling alone never changes geometry, so waiting for
                    // geometryChanged would leave the seam at a stale offset.
                    if (seamMoved || update.geometryChanged) this.sync();
                }

                private sync() {
                    if (this.position === null) {
                        this.removeSeamVars();
                        return;
                    }
                    const offset = seamOffset(this.view, this.position, options);
                    if (!offset) {
                        // No measurable seam (unrenderable target line): hide
                        // the indicator rather than leave the old position
                        // painted.
                        this.removeSeamVars();
                        return;
                    }
                    this.view.dom.style.setProperty('--d-seam-left', `${offset.left}px`);
                    this.view.dom.style.setProperty('--d-seam-width', `${offset.width}px`);
                }

                private removeSeamVars() {
                    this.view.dom.style.removeProperty('--d-seam-left');
                    this.view.dom.style.removeProperty('--d-seam-width');
                }
            },
        ),
    ];
}

// Selected source rows as CM6 line decorations built by the adapter
// (sourceHighlightDecoration) from the engine's per-view output stream
// (dragTransitionEffect) — no dispatch, no global bus, no cross-view leakage.
// Each row carries its nesting level as the protocol's --d-source-level; the
// rendered indent step is a view-level CSS variable set by the plugin below,
// and the stylesheet multiplies the two so the highlight leaves the nesting
// gap on the left.
const dragSourceLinesField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
        deco = deco.map(tr.changes);
        for (const effect of tr.effects) {
            if (effect.is(dragTransitionEffect)) {
                deco = sourceHighlightDecoration(effect.value.outputs, tr.state);
            }
        }
        return deco;
    },
    provide: (field) => EditorView.decorations.from(field),
});

function selectionPaint(): Extension {
    return [
        dragSourceLinesField,
        ViewPlugin.fromClass(
            class {
                private selectedRanges: LineRange[] = [];
                private indentStepSet = false;

                constructor(private readonly view: EditorView) {}

                update(update: ViewUpdate) {
                    for (const tr of update.transactions) {
                        for (const effect of tr.effects) {
                            if (effect.is(dragTransitionEffect)) {
                                const outputs = effect.value.outputs;
                                // Cross-pane broadcasts reach this view for the
                                // seam only — never sync handles to another
                                // view's drag selection.
                                const sourceDoc = dragSelectionDoc(outputs);
                                if (sourceDoc !== null && sourceDoc !== update.state.doc) continue;
                                const selection = selectionFromOutputs(outputs);
                                this.selectedRanges = selectionLineRanges(
                                    update.state.doc.lines,
                                    selection ?? { blocks: [] },
                                );
                            }
                        }
                    }
                    // The rendered indent step is a view-level CSS variable;
                    // the decoration only carries the nesting level.
                    if (!this.indentStepSet || update.geometryChanged) {
                        this.indentStepSet = true;
                        this.view.dom.style.setProperty('--d-list-indent-step', `${listIndentStepPx(this.view)}px`);
                    }
                    this.syncSelectedHandles();
                }

                destroy() {
                    this.selectedRanges = [];
                    this.syncSelectedHandles();
                }

                private syncSelectedHandles() {
                    const handles = Array.from(this.view.dom.querySelectorAll(`.${HANDLE_CLASS}[data-block-start]`));
                    for (const handle of handles) {
                        const line = Number(handle.getAttribute('data-block-start'));
                        handle.classList.toggle(
                            'is-selected',
                            Number.isInteger(line) && isLineNumberInRanges(line, this.selectedRanges),
                        );
                    }
                }
            },
        ),
    ];
}

/**
 * Host display only: pointer over content → show that block's handle.
 * Uses adapter lineAtPoint + domain detectBlock + data-block-start.
 */
function handleHover(): Extension {
    return ViewPlugin.fromClass(
        class {
            private visible: HTMLElement | null = null;
            private readonly onMove = (e: PointerEvent) => {
                if (!isDraggerView(this.view)) {
                    this.setVisible(null);
                    return;
                }
                if (this.view.dom.ownerDocument.body.classList.contains(DRAGGING_BODY_CLASS)) {
                    this.setVisible(null);
                    return;
                }
                const line = lineAtPoint(this.view, { x: e.clientX, y: e.clientY });
                if (line === null) {
                    this.setVisible(null);
                    return;
                }
                const block = detectBlock(this.view.state.doc, line, {
                    tabSize: this.view.state.facet(EditorState.tabSize),
                });
                if (!block) {
                    this.setVisible(null);
                    return;
                }
                const handle = this.view.dom.querySelector(
                    `.${HANDLE_CLASS}[data-block-start="${block.lines.startLine}"]`,
                );
                this.setVisible(handle as HTMLElement | null);
            };
            private readonly onLeave = () => this.setVisible(null);

            constructor(private readonly view: EditorView) {
                this.view.dom.addEventListener('pointermove', this.onMove);
                this.view.dom.addEventListener('pointerleave', this.onLeave);
            }

            destroy() {
                this.view.dom.removeEventListener('pointermove', this.onMove);
                this.view.dom.removeEventListener('pointerleave', this.onLeave);
                this.setVisible(null);
            }

            private setVisible(handle: HTMLElement | null) {
                if (this.visible === handle) return;
                this.visible?.classList.remove('is-visible');
                this.visible = handle;
                handle?.classList.add('is-visible');
            }
        },
    );
}

// Drag-state classes and the touch-move lock go on the document that contains
// the editor: the main window's, a pop-out window's, or a canvas card's iframe.
function gestureShell(plugin: ObsidianDraggerHost): Extension {
    return ViewPlugin.fromClass(
        class {
            private lastPress: { event: PointerEvent; onHandle: boolean } | null = null;
            private lockedDocument: Document | null = null;
            private readonly onPointerDown = (e: PointerEvent) => {
                // Nested table-cell editors are not dragger views: never
                // record a press or (mobile) block their pointer handling.
                if (!isDraggerView(this.view)) return;
                // Only a short press that started on a handle may open the
                // block menu — cancels from Escape or presses on non-handle
                // space must not.
                this.lastPress = {
                    event: e,
                    onHandle: elementTarget(e)?.closest(`.${HANDLE_CLASS}`) != null,
                };
                if (plugin.isMobilePlatform() && plugin.isMobileDragModeEnabled()) {
                    e.preventDefault();
                }
            };
            private readonly onTouchMove = (e: TouchEvent) => {
                e.preventDefault();
            };
            private readonly onContextMenu = (e: Event) => {
                if (!isDraggerView(this.view)) return;
                if (!plugin.isMobilePlatform() || !plugin.isMobileDragModeEnabled()) return;
                e.preventDefault();
            };

            constructor(private readonly view: EditorView) {
                this.view.dom.addEventListener('pointerdown', this.onPointerDown, true);
                this.view.dom.addEventListener('contextmenu', this.onContextMenu, true);
            }

            update(update: ViewUpdate) {
                for (const tr of update.transactions) {
                    for (const effect of tr.effects) {
                        if (effect.is(dragTransitionEffect)) this.consume(effect.value.outputs);
                    }
                }
            }

            destroy() {
                this.setLock(false);
                // The consuming plugin may be destroyed before the runtime flushes its
                // final state; always clear the dragging class so the cursor
                // never stays stuck in grab mode.
                this.view.dom.ownerDocument.body.classList.remove(DRAGGING_BODY_CLASS);
                this.view.dom.removeEventListener('pointerdown', this.onPointerDown, true);
                this.view.dom.removeEventListener('contextmenu', this.onContextMenu, true);
            }

            consume(outputs: PipelineResult['outputs']) {
                for (const output of outputs) {
                    if (output.type === 'state_changed') {
                        const t = output.state.type;
                        this.setLock(t !== 'idle');
                        this.view.dom.ownerDocument.body.classList.toggle(DRAGGING_BODY_CLASS, t === 'dragging');
                    }
                    if (output.type === 'cancelled' && output.reason === 'press_cancelled') {
                        const press = this.lastPress;
                        this.lastPress = null;
                        const startLine = output.selection?.blocks[0]?.lines.startLine;
                        if (press && press.onHandle && typeof startLine === 'number') {
                            const { clientX, clientY } = press.event;
                            window.requestAnimationFrame(() => {
                                openBlockTypeMenu(
                                    this.view,
                                    { clientX, clientY } as PointerEvent,
                                    plugin.settings,
                                    startLine,
                                );
                            });
                        }
                    }
                    if (output.type === 'dropped' || output.type === 'terminal') {
                        this.lastPress = null;
                    }
                }
            }

            private setLock(locked: boolean) {
                if (locked === (this.lockedDocument !== null)) return;
                if (locked) {
                    const doc = this.view.dom.ownerDocument;
                    doc.body.classList.add(MOBILE_GESTURE_LOCK_CLASS);
                    doc.addEventListener('touchmove', this.onTouchMove, { capture: true, passive: false });
                    this.lockedDocument = doc;
                } else if (this.lockedDocument !== null) {
                    this.lockedDocument.body.classList.remove(MOBILE_GESTURE_LOCK_CLASS);
                    this.lockedDocument.removeEventListener('touchmove', this.onTouchMove, true);
                    this.lockedDocument = null;
                }
            }
        },
    );
}
