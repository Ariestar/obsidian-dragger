import { EditorState, StateEffect, StateField, type Extension, type Range } from '@codemirror/state';
import { Decoration, EditorView, ViewPlugin, WidgetType, type DecorationSet } from '@codemirror/view';
import {
    HANDLE_CLASS,
    mdDragger,
    dropSeam,
    lineAtPoint,
    sourceLineFromInput as handleSourceLineFromInput,
    type CodeMirrorGeometryOptions,
    type MdDraggerCodeMirrorOptions,
} from 'md-dragger/adapter/codemirror';
import {
    detectBlock,
    isLineNumberInRanges,
    parseLine,
    selectionLineRanges,
    type BlockSelection,
    type DropPosition,
    type LineRange,
} from 'md-dragger/domain';
import type { PipelineResult } from 'md-dragger/runtime';
import { autoScroll } from 'md-dragger/runtime/modules';
import { openBlockTypeMenu } from '../../plugin/block-type-menu';
import {
    DROP_INDICATOR_CLASS,
    DRAG_SOURCE_LINE_CLASS,
    DRAGGING_BODY_CLASS,
    MOBILE_GESTURE_LOCK_CLASS,
    ROOT_EDITOR_CLASS,
} from '../../shared/dom-selectors';

/** Minimal plugin surface used by the editor extension. */
export type ObsidianDraggerHost = {
    settings: {
        enableMultiLineSelection: boolean;
        mouseRangeSelectLongPressMs: number;
        mobileDragLongPressMs: number;
        autoScrollEdgeZonePx: number;
        autoScrollMaxSpeedPx: number;
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
        listIndentWidthPx: (view) => obsidianListIndentWidthPx(view, LIST_INDENT_UNIT),
        handle: {
            render: () => createObsidianHandle(),
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
                    {
                        nudge: (point, cfg) => {
                            const scroller = activeDocument
                                .elementFromPoint(point.x, point.y)
                                ?.closest('.cm-scroller') as HTMLElement | null;
                            if (!scroller) return;
                            const rect = scroller.getBoundingClientRect();
                            let dy = 0;
                            const top = point.y - rect.top;
                            const bottom = rect.bottom - point.y;
                            if (top >= 0 && top < cfg.edgeZonePx) {
                                dy = -cfg.maxSpeedPx * (1 - top / cfg.edgeZonePx);
                            } else if (bottom >= 0 && bottom < cfg.edgeZonePx) {
                                dy = cfg.maxSpeedPx * (1 - bottom / cfg.edgeZonePx);
                            }
                            if (dy !== 0) scroller.scrollTop += dy;
                        },
                    },
                    () => ({
                        edgeZonePx: plugin.settings.autoScrollEdgeZonePx,
                        maxSpeedPx: plugin.settings.autoScrollMaxSpeedPx,
                    }),
                ),
            ],
        },
        onChange: (result) => {
            paintBus.emit(result);
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

// Rendered pixel width of one list nesting level, measured from real rendered
// list lines (theme-proof). When the document has no nested list pair to
// measure, use a zero offset instead of throwing: it is exact for level-0
// list lines (0 × step = 0) and leaves nested drop seams at their anchor
// position. A throw here would wedge the drag paint chain on plain documents.
function obsidianListIndentWidthPx(view: EditorView, indentUnit: number): number {
    const step = measureListIndentStep(view, indentUnit);
    if (step == null) {
        return 0;
    }
    return step;
}

// First pair of list lines with increasing indent: per-column px from their
// rendered marker-left difference, scaled to one indent unit.
function measureListIndentStep(view: EditorView, indentUnit: number): number | null {
    const tabSize = view.state.facet(EditorState.tabSize);
    let previous: { indent: number; left: number } | null = null;
    for (let lineNo = 1; lineNo <= view.state.doc.lines; lineNo++) {
        const line = view.state.doc.line(lineNo);
        const parsed = parseLine(line.text, tabSize);
        if (parsed.marker?.kind !== 'list') continue;
        const left = listMarkerLeft(view, line.from);
        if (left == null) continue;
        if (previous && parsed.indent.width > previous.indent) {
            const perColumn = (left - previous.left) / (parsed.indent.width - previous.indent);
            const step = perColumn * indentUnit;
            if (Number.isFinite(step) && step > 0) return step;
        }
        previous = { indent: parsed.indent.width, left };
    }
    return null;
}

// Rendered left edge of a list line's marker span (the bullet column).
function listMarkerLeft(view: EditorView, from: number): number | null {
    const node = view.domAtPos(from).node as Element | null;
    const lineEl = node?.nodeType === 1 ? node.closest('.cm-line') : (node?.parentElement?.closest('.cm-line') ?? null);
    const marker = lineEl?.querySelector('.cm-formatting-list') as HTMLElement | null;
    return marker?.getBoundingClientRect().left ?? null;
}

// Per-paint geometry with the live rendered step resolved once per frame.
function paintGeometry(options: CodeMirrorGeometryOptions, view: EditorView): CodeMirrorGeometryOptions {
    return { ...options, listIndentWidthPx: obsidianListIndentWidthPx(view, LIST_INDENT_UNIT) };
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
    const multiSelectEnabled = plugin.settings.enableMultiLineSelection !== false;
    const multiSelectMs = plugin.settings.mouseRangeSelectLongPressMs;
    if (plugin.isMobilePlatform()) {
        return {
            dragArmMs: plugin.settings.mobileDragLongPressMs,
            multiSelectMs,
            dragStartMoveThresholdPx: 8,
            dragCancelMoveThresholdPx: Number.POSITIVE_INFINITY,
            multiSelectEnabled,
        };
    }
    return {
        dragArmMs: 0,
        multiSelectMs,
        dragStartMoveThresholdPx: 4,
        dragCancelMoveThresholdPx: Number.POSITIVE_INFINITY,
        multiSelectEnabled,
    };
}

type PaintHost = { consume(outputs: PipelineResult['outputs']): void };

const paintBus = {
    hosts: new Set<PaintHost>(),
    emit(result: PipelineResult) {
        for (const host of paintBus.hosts) host.consume(result.outputs);
    },
    add(host: PaintHost) {
        paintBus.hosts.add(host);
        return () => paintBus.hosts.delete(host);
    },
};

// The drop seam is a height-0 CM6 block widget: it takes no layout space (no
// line gap) yet rides the editor's render pipeline — same as the gutter
// handle — so scrolling repaints it with the text flow; no overlay, no lag.
// The visible 2px line is drawn by an overflowing ::before pseudo-element.
// eq() returns false so updateDOM drives an in-place restyle of one reused
// DOM node across the whole drag: the seam slides between rows instead of
// rebuilding.
const setDropIndicator = StateEffect.define<{ position: DropPosition; invalid: boolean } | null>();

class DropSeamWidget extends WidgetType {
    constructor(
        private readonly position: DropPosition,
        private readonly invalid: boolean,
        private readonly geometryOptions: CodeMirrorGeometryOptions,
    ) {
        super();
    }

    // eq() returns false on purpose: CodeMirror's widget update only reaches
    // updateDOM on its second pass (when eq does not match). Returning true
    // from updateDOM then reuses the same DOM node and restyles it in place,
    // so the drag keeps one persistent element — no rebuild flash.
    eq(): boolean {
        return false;
    }

    get estimatedHeight(): number {
        return 0;
    }

    toDOM(view: EditorView): HTMLElement {
        const el = activeDocument.createElement('div');
        el.className = DROP_INDICATOR_CLASS;
        this.applySeamGeometry(view, el);
        return el;
    }

    updateDOM(dom: HTMLElement, view: EditorView): boolean {
        this.applySeamGeometry(view, dom);
        return true;
    }

    private applySeamGeometry(view: EditorView, el: HTMLElement): void {
        el.classList.toggle('is-invalid', this.invalid);
        // The widget's slot is already the seam row; only the x offset within
        // the content band depends on rendered geometry. A null seam (row not
        // rendered) keeps the minimal line — never a crash in the paint path.
        const seam = dropSeam(view, this.position, paintGeometry(this.geometryOptions, view));
        if (seam) {
            const contentLeft = view.contentDOM.getBoundingClientRect().left;
            el.style.marginLeft = `${Math.max(0, seam.left - contentLeft)}px`;
            el.style.width = `${Math.max(0, seam.right - seam.left)}px`;
        }
    }
}

function buildDropIndicatorDecoration(
    value: { position: DropPosition; invalid: boolean } | null,
    state: EditorState,
    options: CodeMirrorGeometryOptions,
): DecorationSet {
    if (value === null) return Decoration.none;
    const line = Math.min(Math.max(value.position.line, 1), state.doc.lines);
    const from = state.doc.line(line).from;
    return Decoration.set([
        Decoration.widget({
            widget: new DropSeamWidget(value.position, value.invalid, options),
            block: true,
            side: -1,
        }).range(from),
    ]);
}

function dropIndicatorPaint(options: CodeMirrorGeometryOptions): Extension {
    const dropIndicatorField = StateField.define<DecorationSet>({
        create: () => Decoration.none,
        update(deco, tr) {
            deco = deco.map(tr.changes);
            for (const effect of tr.effects) {
                if (effect.is(setDropIndicator)) {
                    deco = buildDropIndicatorDecoration(effect.value, tr.state, options);
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
                private invalid = false;
                private readonly unsub: () => void;

                constructor(private readonly view: EditorView) {
                    this.unsub = paintBus.add(this);
                }

                destroy() {
                    this.unsub();
                }

                consume(outputs: PipelineResult['outputs']) {
                    let next: DropPosition | null = null;
                    let invalid = false;
                    for (const output of outputs) {
                        if (output.type === 'drag_over') {
                            // Only paint on the view that owns the drop doc. A
                            // rejected drop (e.g. re-inserting a block in place)
                            // still shows a grey seam instead of hiding the
                            // indicator entirely.
                            const drop = output.drop;
                            const onView =
                                drop.position && drop.position.doc === this.view.state.doc ? drop.position : null;
                            next = onView;
                            invalid = onView !== null && drop.rejectReason != null;
                        } else if (
                            output.type === 'dropped' ||
                            output.type === 'cancelled' ||
                            output.type === 'terminal'
                        ) {
                            next = null;
                        }
                    }
                    if (next === this.position && invalid === this.invalid) return;
                    this.position = next;
                    this.invalid = invalid;
                    this.view.dispatch({
                        effects: setDropIndicator.of(next === null ? null : { position: next, invalid }),
                    });
                }
            },
        ),
    ];
}

// Selected source rows as CM6 line decorations: they ride the editor's own
// render pipeline (same as the gutter handle), so scrolling repaints them
// with the text flow — no absolute-position overlay, no scroll listener,
// no rAF chase, no lag.
const setDragSourceRanges = StateEffect.define<LineRange[]>();

const dragSourceLinesField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update(deco, tr) {
        deco = deco.map(tr.changes);
        for (const effect of tr.effects) {
            if (effect.is(setDragSourceRanges)) {
                deco = buildDragSourceDecoration(effect.value, tr.state);
            }
        }
        return deco;
    },
    provide: (field) => EditorView.decorations.from(field),
});

function buildDragSourceDecoration(ranges: LineRange[], state: EditorState): DecorationSet {
    const decorations: Range<Decoration>[] = [];
    for (const range of ranges) {
        for (let line = range.startLine; line <= range.endLine; line++) {
            if (line < 1 || line > state.doc.lines) continue;
            decorations.push(Decoration.line({ class: DRAG_SOURCE_LINE_CLASS }).range(state.doc.line(line).from));
        }
    }
    return Decoration.set(decorations);
}

function selectionPaint(): Extension {
    return [
        dragSourceLinesField,
        ViewPlugin.fromClass(
            class {
                private selectedRanges: LineRange[] = [];
                private readonly unsub: () => void;

                constructor(private readonly view: EditorView) {
                    this.unsub = paintBus.add(this);
                }

                // The line decoration follows the text flow natively; only the
                // gutter handle is a separate marker whose DOM re-materializes
                // per viewport, so re-apply its selected state on every update.
                update() {
                    this.syncSelectedHandles();
                }

                destroy() {
                    this.unsub();
                    this.selectedRanges = [];
                    this.syncSelectedHandles();
                }

                consume(outputs: PipelineResult['outputs']) {
                    let next: BlockSelection | null | undefined;
                    for (const output of outputs) {
                        if (output.type === 'selection_changed' || output.type === 'drag_source_changed') {
                            next = output.selection;
                        } else if (
                            output.type === 'cancelled' ||
                            output.type === 'terminal' ||
                            output.type === 'dropped'
                        ) {
                            next = null;
                        }
                    }
                    if (next === undefined) return;
                    const ranges = selectionLineRanges(this.view.state.doc.lines, next ?? { blocks: [] });
                    if (sameLineRanges(ranges, this.selectedRanges)) return;
                    this.selectedRanges = ranges;
                    this.view.dispatch({ effects: setDragSourceRanges.of(ranges) });
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

function sameLineRanges(a: LineRange[], b: LineRange[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i].startLine !== b[i].startLine || a[i].endLine !== b[i].endLine) return false;
    }
    return true;
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
            private lastPress: PointerEvent | null = null;
            private locked = false;
            private readonly unsub: () => void;
            private readonly onPointerDown = (e: PointerEvent) => {
                this.lastPress = e;
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
                this.unsub = paintBus.add(this);
            }

            destroy() {
                this.unsub();
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
                        if (press && typeof startLine === 'number') {
                            const { clientX, clientY } = press;
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
