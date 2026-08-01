import type { Extension } from '@codemirror/state';
import { EditorState } from '@codemirror/state';
import { EditorView, ViewPlugin, type ViewUpdate } from '@codemirror/view';
import {
    HANDLE_CLASS,
    mdDragger,
    dropSeam,
    lineBand,
    lineAtPoint,
    sourceLineFromInput as handleSourceLineFromInput,
    type CodeMirrorGeometryOptions,
    type MdDraggerCodeMirrorOptions,
} from 'md-dragger/adapter/codemirror';
import { detectBlock, parseLine, type BlockSelection, type DropPosition } from 'md-dragger/domain';
import type { PipelineResult } from 'md-dragger/runtime';
import { autoScroll } from 'md-dragger/runtime/modules';
import { openBlockTypeMenu } from '../../plugin/block-type-menu';
import {
    DROP_INDICATOR_CLASS,
    DRAGGING_BODY_CLASS,
    DRAG_SOURCE_BOX_CLASS,
    HIDDEN_CLASS,
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
        selectionPaint(options),
        handleHover(),
        gestureShell(plugin),
    ];
}

// Rendered pixel width of one list nesting level, measured from real rendered
// list lines (theme-proof). No fallbacks: if the document has no list pair
// with increasing indent there is nothing to measure — fail explicitly.
function obsidianListIndentWidthPx(view: EditorView, indentUnit: number): number {
    const step = measureListIndentStep(view, indentUnit);
    if (step == null) {
        throw new Error('obsidian-dragger: cannot measure list indent width — need a nested list line in the document');
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
    core.className = 'dnd-handle-core';
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

function dropIndicatorPaint(options: CodeMirrorGeometryOptions): Extension {
    return ViewPlugin.fromClass(
        class {
            private readonly el: HTMLDivElement;
            private position: DropPosition | null = null;
            private raf: number | null = null;
            private readonly unsub: () => void;

            constructor(private readonly view: EditorView) {
                this.el = activeDocument.createElement('div');
                this.el.className = `${DROP_INDICATOR_CLASS} ${HIDDEN_CLASS}`;
                activeDocument.body.appendChild(this.el);
                this.unsub = paintBus.add(this);
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.geometryChanged || update.viewportChanged) this.queue();
            }

            destroy() {
                this.unsub();
                if (this.raf !== null) window.cancelAnimationFrame(this.raf);
                this.el.remove();
            }

            consume(outputs: PipelineResult['outputs']) {
                for (const output of outputs) {
                    if (output.type === 'drag_over') {
                        // Only paint on the view that owns the drop doc.
                        const position = output.drop.rejectReason == null ? output.drop.position : null;
                        this.position = position && position.doc === this.view.state.doc ? position : null;
                        this.paint();
                    } else if (output.type === 'dropped' || output.type === 'cancelled' || output.type === 'terminal') {
                        this.position = null;
                        this.paint();
                    }
                }
            }

            private queue() {
                if (this.raf !== null) return;
                this.raf = window.requestAnimationFrame(() => {
                    this.raf = null;
                    this.paint();
                });
            }

            private paint() {
                if (!this.position) {
                    this.el.classList.add(HIDDEN_CLASS);
                    return;
                }
                const seam = dropSeam(this.view, this.position, paintGeometry(options, this.view));
                if (!seam) {
                    this.el.classList.add(HIDDEN_CLASS);
                    return;
                }
                this.el.classList.remove(HIDDEN_CLASS);
                this.el.setCssStyles({
                    top: `${seam.y}px`,
                    left: `${seam.left}px`,
                    width: `${seam.right - seam.left}px`,
                });
            }
        },
    );
}

function selectionPaint(options: CodeMirrorGeometryOptions): Extension {
    return ViewPlugin.fromClass(
        class {
            private readonly layer: HTMLDivElement;
            private boxes: HTMLDivElement[] = [];
            private selection: BlockSelection | null = null;
            private raf: number | null = null;
            private readonly unsub: () => void;
            // Fixed-position overlay uses viewport coords, so it must repaint when the
            // scroller moves — the native scroll event is the authoritative signal.
            private readonly onScroll = () => this.queue();

            constructor(private readonly view: EditorView) {
                this.layer = activeDocument.createElement('div');
                this.layer.className = 'dnd-drag-source-layer';
                activeDocument.body.appendChild(this.layer);
                this.unsub = paintBus.add(this);
                view.scrollDOM.addEventListener('scroll', this.onScroll, { passive: true });
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged || update.geometryChanged) {
                    this.queue();
                }
            }

            destroy() {
                this.unsub();
                this.view.scrollDOM.removeEventListener('scroll', this.onScroll);
                if (this.raf !== null) window.cancelAnimationFrame(this.raf);
                this.layer.remove();
                this.selection = null;
                this.syncSelectedHandles();
            }

            consume(outputs: PipelineResult['outputs']) {
                let next: BlockSelection | null | undefined;
                for (const output of outputs) {
                    if (output.type === 'selection_changed' || output.type === 'drag_source_changed') {
                        next = output.selection;
                    } else if (output.type === 'cancelled' || output.type === 'terminal' || output.type === 'dropped') {
                        next = null;
                    }
                }
                if (next === undefined) return;
                this.selection = next;
                this.paint();
                this.syncSelectedHandles();
            }

            private queue() {
                if (this.raf !== null) return;
                this.raf = window.requestAnimationFrame(() => {
                    this.raf = null;
                    this.paint();
                });
            }

            private paint() {
                const rects = selectedBandRects(this.view, this.selection, paintGeometry(options, this.view));
                while (this.boxes.length < rects.length) {
                    const box = activeDocument.createElement('div');
                    box.className = `${DRAG_SOURCE_BOX_CLASS} ${HIDDEN_CLASS}`;
                    this.layer.appendChild(box);
                    this.boxes.push(box);
                }
                for (let i = 0; i < this.boxes.length; i++) {
                    const box = this.boxes[i];
                    const rect = rects[i];
                    if (!rect) {
                        box.classList.add(HIDDEN_CLASS);
                        continue;
                    }
                    box.classList.remove(HIDDEN_CLASS);
                    box.setCssStyles({
                        top: `${rect.top}px`,
                        left: `${rect.left}px`,
                        width: `${Math.max(0, rect.right - rect.left)}px`,
                        height: `${Math.max(0, rect.bottom - rect.top)}px`,
                    });
                }
            }

            private syncSelectedHandles() {
                const starts = new Set(this.selection?.blocks.map((block) => block.lines.startLine) ?? []);
                const handles = Array.from(this.view.dom.querySelectorAll(`.${HANDLE_CLASS}[data-block-start]`));
                for (const handle of handles) {
                    const line = Number(handle.getAttribute('data-block-start'));
                    handle.classList.toggle('is-selected', Number.isInteger(line) && starts.has(line));
                }
            }
        },
    );
}

function selectedBandRects(
    view: EditorView,
    selection: BlockSelection | null,
    options: CodeMirrorGeometryOptions,
): Array<{ left: number; right: number; top: number; bottom: number }> {
    if (!selection?.blocks.length) return [];
    const rects = [];
    for (const block of selection.blocks) {
        const fromLine = Math.max(1, block.lines.startLine);
        const toLine = Math.min(view.state.doc.lines, block.lines.endLine);
        for (let line = fromLine; line <= toLine; line++) {
            const band = lineBand(view, line, options);
            if (band) rects.push(band);
        }
    }
    return rects;
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
