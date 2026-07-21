import type { Extension } from '@codemirror/state';
import { EditorView, ViewPlugin, Decoration, type DecorationSet, type ViewUpdate } from '@codemirror/view';
import {
  HANDLE_CLASS,
  mdDragger,
  dropSeam,
  lineAtPoint,
  sourceLineFromInput as handleSourceLineFromInput,
} from 'md-dragger/adapter/codemirror';
import type { BlockSelection, DropPosition } from 'md-dragger/domain';
import type { PipelineResult, PressInput } from 'md-dragger/runtime';
import { autoScroll } from 'md-dragger/runtime/modules';
import { openBlockTypeMenu } from '../../plugin/block-type-menu';
import {
  DROP_INDICATOR_CLASS,
  DRAGGING_BODY_CLASS,
  DRAG_SOURCE_LINE_CLASS,
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
export function dragHandleExtension(plugin: ObsidianDraggerHost): Extension {
  return [
    EditorView.editorAttributes.of({ class: ROOT_EDITOR_CLASS }),
    ...mdDragger({
      // tabSize is always read live from EditorState.tabSize by the adapter.
      config: {
        tabSize: 4,
        listIndentUnit: 2,
      },
      handle: {
        render: () => createObsidianHandle(),
      },
      locate: (view) => ({
        sourceLineFromInput: (input) => sourceLineFromInput(view, input, plugin),
      }),
      ux: {
        gesture: () => gestureConfig(plugin),
        modules: [
          autoScroll(
            {
              nudge: (point, cfg) => {
                const scroller = document.elementFromPoint(point.x, point.y)
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
    }),
    dropIndicatorPaint(),
    selectionPaint(),
    gestureShell(plugin),
  ];
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

function sourceLineFromInput(
  view: EditorView,
  input: PressInput,
  plugin: ObsidianDraggerHost,
): number | null {
  const fromHandle = handleSourceLineFromInput(view, input);
  if (fromHandle !== null) return fromHandle;

  const event = input.native instanceof PointerEvent ? input.native : null;
  const target = event?.target instanceof Element ? event.target : null;
  if (target && !view.dom.contains(target)) return null;

  const mobileDrag = plugin.isMobilePlatform() && plugin.isMobileDragModeEnabled();
  if (mobileDrag) {
    return resolveSourceLineAtPoint(view, input.point, target);
  }

  // Desktop: only arm from non-handle presses on replaced widgets
  // (table/callout/hr/math…). Plain cm-line text stays for caret editing.
  if (target && isReplacedWidgetTarget(target)) {
    return resolveSourceLineAtPoint(view, input.point, target);
  }
  return null;
}

function isReplacedWidgetTarget(target: Element): boolean {
  return !!target.closest(
    [
      '.cm-embed-block',
      '.cm-callout',
      '.cm-table-widget',
      '.table-wrapper',
      '.cm-preview-code-block',
      '.cm-math',
      '.math',
      '.HyperMD-hr-line',
      'hr',
      '.cm-hr',
      '.MathJax',
      '.mjx-container',
    ].join(','),
  );
}

/** Map a press on source lines or replaced widgets to a 1-based source line. */
function resolveSourceLineAtPoint(
  view: EditorView,
  point: { x: number; y: number },
  target: Element | null,
): number | null {
  if (target) {
    const fromDom = lineFromWidgetOrLineDom(view, target);
    if (fromDom !== null) return fromDom;
  }

  const fromPoint = lineAtPoint(view, point);
  if (fromPoint !== null) return fromPoint;

  if (typeof document !== 'undefined') {
    const hit = document.elementFromPoint(point.x, point.y);
    if (hit && view.dom.contains(hit)) {
      return lineFromWidgetOrLineDom(view, hit);
    }
  }
  return null;
}

/**
 * Obsidian LP replaces tables/callouts/hr/math with widgets.
 * Walk to a cm-line or embed root and resolve via posAtDOM.
 */
function lineFromWidgetOrLineDom(view: EditorView, target: Element): number | null {
  const lineEl = target.closest('.cm-line');
  if (lineEl && view.dom.contains(lineEl)) {
    const line = lineFromDom(view, lineEl);
    if (line !== null) return line;
  }

  const widget = target.closest(
    [
      '.cm-embed-block',
      '.cm-callout',
      '.cm-table-widget',
      '.table-wrapper',
      '.cm-preview-code-block',
      '.cm-math',
      '.math',
      '.HyperMD-hr-line',
      'hr',
      '.cm-hr',
      '.MathJax',
      '.mjx-container',
    ].join(','),
  );
  if (widget && view.dom.contains(widget)) {
    const line = lineFromDom(view, widget);
    if (line !== null) return line;
    const siblingLine = widget.parentElement?.querySelector('.cm-line');
    if (siblingLine) {
      const sibling = lineFromDom(view, siblingLine);
      if (sibling !== null) return sibling;
    }
  }

  return null;
}

function lineFromDom(view: EditorView, el: Element): number | null {
  try {
    const pos = view.posAtDOM(el, 0);
    return view.state.doc.lineAt(pos).number;
  } catch {
    return null;
  }
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

function dropIndicatorPaint(): Extension {
  return ViewPlugin.fromClass(class {
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
        } else if (
          output.type === 'dropped'
          || output.type === 'cancelled'
          || output.type === 'terminal'
        ) {
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
      const seam = dropSeam(this.view, this.position);
      if (!seam) {
        this.el.classList.add(HIDDEN_CLASS);
        return;
      }
      this.el.classList.remove(HIDDEN_CLASS);
      this.el.setCssStyles({
        top: `${seam.y}px`,
        left: `${seam.left}px`,
        width: `${Math.max(8, seam.right - seam.left)}px`,
      });
    }
  });
}

function selectionPaint(): Extension {
  return ViewPlugin.fromClass(class {
    decorations: DecorationSet = Decoration.none;
    private selection: BlockSelection | null = null;
    private readonly unsub: () => void;

    constructor(private readonly view: EditorView) {
      this.unsub = paintBus.add(this);
    }

    update(update: ViewUpdate) {
      if (update.docChanged || update.viewportChanged || update.geometryChanged) {
        this.decorations = buildSelectionDecorations(this.view, this.selection);
        this.syncSelectedHandles();
      }
    }

    destroy() {
      this.unsub();
      this.selection = null;
      this.decorations = Decoration.none;
      this.syncSelectedHandles();
    }

    consume(outputs: PipelineResult['outputs']) {
      let next: BlockSelection | null | undefined;
      for (const output of outputs) {
        if (output.type === 'selection_changed' || output.type === 'drag_source_changed') {
          next = output.selection;
        } else if (
          output.type === 'cancelled'
          || output.type === 'terminal'
          || output.type === 'dropped'
        ) {
          next = null;
        }
      }
      if (next === undefined) return;
      this.selection = next;
      this.decorations = buildSelectionDecorations(this.view, this.selection);
      this.syncSelectedHandles();
    }

    private syncSelectedHandles() {
      const starts = new Set(
        this.selection?.blocks.map((block) => block.lines.startLine) ?? [],
      );
      const handles = Array.from(
        this.view.dom.querySelectorAll(`.${HANDLE_CLASS}[data-block-start]`),
      ) as HTMLElement[];
      for (const handle of handles) {
        const line = Number(handle.getAttribute('data-block-start'));
        handle.classList.toggle('is-selected', Number.isInteger(line) && starts.has(line));
      }
    }
  }, {
    decorations: (value) => value.decorations,
  });
}

function buildSelectionDecorations(view: EditorView, selection: BlockSelection | null): DecorationSet {
  if (!selection?.blocks.length) return Decoration.none;
  const ranges = [];
  for (const block of selection.blocks) {
    const fromLine = Math.max(1, block.lines.startLine);
    const toLine = Math.min(view.state.doc.lines, block.lines.endLine);
    for (let line = fromLine; line <= toLine; line++) {
      ranges.push(sourceLineDecoration.range(view.state.doc.line(line).from));
    }
  }
  return Decoration.set(ranges, true);
}

const sourceLineDecoration = Decoration.line({ class: DRAG_SOURCE_LINE_CLASS });

function gestureShell(plugin: ObsidianDraggerHost): Extension {
  return ViewPlugin.fromClass(class {
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
            requestAnimationFrame(() => {
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
  });
}
