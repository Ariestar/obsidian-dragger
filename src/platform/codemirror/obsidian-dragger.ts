import { EditorState, StateField, type Extension } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import {
    HANDLE_CLASS,
    mdDragger,
    dragTransitionEffect,
    dropSeamDecoration,
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
import { openBlockTypeMenu } from '../../plugin/block-type-menu';
import { DRAGGING_BODY_CLASS, MOBILE_GESTURE_LOCK_CLASS, ROOT_EDITOR_CLASS } from '../../shared/dom-selectors';

/** Minimal plugin surface used by the editor extension. */
export type ObsidianDraggerHost = {
    settings: {
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
            render: () => createObsidianHandle(),
            side: plugin.settings.handleGutterPosition === 'right' ? 'after' : 'before',
        },
        locate: (view) => ({
            sourceLineFromInput: (input) => {
                // Adapter already resolves handle → data-block-start.
                // Host only adds mobile row-as-handle.
                if (!plugin.isMobilePlatform() || !plugin.isMobileDragModeEnabled()) {
                    return handleSourceLineFromInput(view, input);
                }
                const fromHandle = handleSourceLineFromInput(view, input);
                if (fromHandle !== null) return fromHandle;
                const event = input.native instanceof PointerEvent ? input.native : null;
                const target = event?.target instanceof Element ? event.target : null;
                if (target && !view.dom.contains(target)) return null;
                return lineAtPoint(view, input.point);
            },
        }),
        ux: {
            gesture: () => gestureConfig(plugin),
            modules: [
                autoScroll(
                    // Adapter port scrolls the .cm-scroller under the pointer;
                    // activeDocument keeps pop-out windows working.
                    scrollPort(() => activeDocument),
                    () => ({
                        edgeZonePx: plugin.settings.autoScrollEdgeZonePx,
                        maxSpeedPx: plugin.settings.autoScrollMaxSpeedPx,
                    }),
                ),
            ],
        },
        onChange: (result) => {
            for (const item of result.outputs) {
                if (item.type === 'dropped') plugin.notifyDragDrop();
            }
        },
    };

    return [
        EditorView.editorAttributes.of({ class: ROOT_EDITOR_CLASS }),
        ...mdDragger(options),
        dropIndicatorPaint(options),
        selectionPaint(),
        handleHover(),
        gestureShell(plugin),
    ];
}

// Rendered pixel width of one list nesting level. Single source of truth:
// Obsidian's own rendering contract — --indent-unit × --indent-size (default
// 0.5625em × 4 = 2.25em) — read straight from the theme. No document scan,
// no fallback: the engine's geometry (level × step, anchor + step) always
// gets the same stable value, and theme changes apply automatically.
// --list-indent itself is a calc() chain (getComputedStyle returns it
// unparsed), so the two literals are read and multiplied instead.
function listIndentStepPx(view: EditorView): number {
    const cs = getComputedStyle(view.contentDOM);
    const em = parseFloat(cs.getPropertyValue('--indent-unit')) * parseFloat(cs.getPropertyValue('--indent-size'));
    return em * parseFloat(cs.fontSize);
}

function createObsidianHandle(): HTMLElement {
    const handle = activeDocument.createElement('div');
    handle.className = HANDLE_CLASS;
    const core = activeDocument.createElement('span');
    core.className = 'd-handle-core';
    core.setAttribute('aria-hidden', 'true');
    handle.appendChild(core);
    return handle;
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
                if (activeDocument.body.classList.contains(DRAGGING_BODY_CLASS)) {
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

function gestureShell(plugin: ObsidianDraggerHost): Extension {
    return ViewPlugin.fromClass(
        class {
            private lastPress: { event: PointerEvent; onHandle: boolean } | null = null;
            private locked = false;
            private readonly onPointerDown = (e: PointerEvent) => {
                // Only a short press that started on a handle may open the
                // block menu — cancels from Escape or presses on non-handle
                // space must not.
                this.lastPress = {
                    event: e,
                    onHandle: e.target instanceof Element && e.target.closest(`.${HANDLE_CLASS}`) !== null,
                };
                if (plugin.isMobilePlatform() && plugin.isMobileDragModeEnabled()) {
                    e.preventDefault();
                }
            };
            private readonly onTouchMove = (e: TouchEvent) => {
                e.preventDefault();
            };
            private readonly onContextMenu = (e: Event) => {
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
                // final state; always clear the global dragging class so the cursor
                // never stays stuck in grab mode.
                activeDocument.body.classList.remove(DRAGGING_BODY_CLASS);
                this.view.dom.removeEventListener('pointerdown', this.onPointerDown, true);
                this.view.dom.removeEventListener('contextmenu', this.onContextMenu, true);
            }

            consume(outputs: PipelineResult['outputs']) {
                for (const output of outputs) {
                    if (output.type === 'state_changed') {
                        const t = output.state.type;
                        this.setLock(t !== 'idle');
                        activeDocument.body.classList.toggle(DRAGGING_BODY_CLASS, t === 'dragging');
                    }
                    if (output.type === 'cancelled' && output.reason === 'press_cancelled') {
                        const press = this.lastPress;
                        this.lastPress = null;
                        const startLine = output.selection?.blocks[0]?.lines.startLine;
                        if (press && press.onHandle && typeof startLine === 'number') {
                            const { clientX, clientY } = press.event;
                            window.requestAnimationFrame(() => {
                                openBlockTypeMenu(this.view, { clientX, clientY } as PointerEvent, startLine);
                            });
                        }
                    }
                    if (output.type === 'dropped' || output.type === 'terminal') {
                        this.lastPress = null;
                    }
                }
            }

            private setLock(locked: boolean) {
                if (this.locked === locked) return;
                this.locked = locked;
                activeDocument.body.classList.toggle(MOBILE_GESTURE_LOCK_CLASS, locked);
                if (locked) {
                    activeDocument.addEventListener('touchmove', this.onTouchMove, { capture: true, passive: false });
                } else {
                    activeDocument.removeEventListener('touchmove', this.onTouchMove, true);
                }
            }
        },
    );
}
