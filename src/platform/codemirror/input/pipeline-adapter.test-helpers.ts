import { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, vi } from 'vitest';
import { BlockInfo, BlockType } from '../../../domain/block/block-types';
import { makeBlockSelection, type BlockSelection } from '../selection/block-selection-resolver';
import type { BlockSelectionRequest } from '../selection/block-selection-resolver';
import { buildSelectionFromSelectedBlocks, buildSingleBlockSelectionRanges } from '../selection/block-selection-resolver';
import type { BlockCommand } from '../../../domain/command/block-command';
import type { DragDropSnapshot } from '../../../drag/pipeline/pipeline-drop';
import type { DragLifecycleEvent } from '../../../drag/pipeline/pipeline-output';
import type { PointerDropCommitResolution } from './pointer-hit-test';
import type { PipelineOutputExecutor, PipelineAdapterDeps } from './pipeline-adapter';
import { DRAG_HANDLE_CLASS, LINE_HANDLE_CLASS } from '../../../shared/dom-selectors';

type RectLike = {
    left: number;
    top: number;
    right: number;
    bottom: number;
    width: number;
    height: number;
    x: number;
    y: number;
    toJSON: () => Record<string, never>;
};

const originalVibrate = (navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean }).vibrate;
let originalElementFromPoint: ((this: void, x: number, y: number) => Element | null) | undefined;

type PipelineAdapterTestDeps = Omit<
    Partial<PipelineAdapterDeps>,
    'resolveDropSnapshotAtPoint' | 'buildBlockCommandAtPoint' | 'pipelineOutputExecutor'
> & {
    resolveBlockSelection: PipelineAdapterDeps['resolveBlockSelection'];
    isBlockInsideRenderedTableCell: PipelineAdapterDeps['isBlockInsideRenderedTableCell'];
    beginPointerDragSession: PipelineAdapterDeps['beginPointerDragSession'];
    finishDragSession: PipelineAdapterDeps['finishDragSession'];
    resolveDropSnapshotAtPoint?: (clientX: number, clientY: number, source: BlockSelection, pointerType: string | null) => DragDropSnapshot;
    buildBlockCommandAtPoint?: (source: BlockSelection, clientX: number, clientY: number, pointerType: string | null) => PointerDropCommitResolution;
    pipelineOutputExecutor?: PipelineOutputExecutor;
    onDropPreview?: (clientX: number, clientY: number, source: BlockSelection | null, pointerType: string | null) => void;
    onHideDropPreview?: () => void;
    applyBlockCommand?: (command: BlockCommand) => void;
    onPlatformCommit?: (source: BlockSelection, clientX: number, clientY: number, pointerType: string | null) => void;
    onDragLifecycleEvent?: (event: DragLifecycleEvent) => void;
};

export function createPipelineAdapterDeps(deps: PipelineAdapterTestDeps): PipelineAdapterDeps {
    let lastDropPoint: { clientX: number; clientY: number } | null = null;
    const resolveDropSnapshotAtPoint = (
        clientX: number,
        clientY: number,
        source: BlockSelection,
        pointerType: string | null
    ): DragDropSnapshot => {
        lastDropPoint = { clientX, clientY };
        return deps.resolveDropSnapshotAtPoint?.(clientX, clientY, source, pointerType)
            ?? { target: null, rejectReason: null };
    };
    const buildBlockCommandAtPoint = (
        source: BlockSelection,
        clientX: number,
        clientY: number,
        pointerType: string | null
    ): PointerDropCommitResolution => {
        if (deps.buildBlockCommandAtPoint) {
            return deps.buildBlockCommandAtPoint(source, clientX, clientY, pointerType);
        }
        if (deps.onPlatformCommit) {
            deps.onPlatformCommit(source, clientX, clientY, pointerType);
            return { type: 'platform_commit', drop: { target: null, rejectReason: null } };
        }
        return { type: 'cancel', drop: { target: null, rejectReason: 'no_target' }, reason: 'no_target' };
    };
    const pipelineOutputExecutor = deps.pipelineOutputExecutor ?? {
        showDropPreview: (selection, _drop, pointerType) => {
            if (!lastDropPoint) return;
            deps.onDropPreview?.(lastDropPoint.clientX, lastDropPoint.clientY, selection, pointerType);
        },
        hideDropPreview: () => deps.onHideDropPreview?.(),
        applyCommand: (command) => deps.applyBlockCommand?.(command),
        emitLifecycle: (event) => deps.onDragLifecycleEvent?.(event),
    } satisfies PipelineOutputExecutor;

    return {
        ...deps,
        isMobileDragModeEnabled: deps.isMobileDragModeEnabled ?? (() => true),
        getVisibleHandleForBlockStart: deps.getVisibleHandleForBlockStart
            ?? ((blockStart) => activeDocument.querySelector<HTMLElement>(
                `.${DRAG_HANDLE_CLASS}.${LINE_HANDLE_CLASS}[data-block-start="${blockStart}"]`
            )),
        resolveDropSnapshotAtPoint,
        buildBlockCommandAtPoint,
        pipelineOutputExecutor,
    };
}

export function createRect(left: number, top: number, width: number, height: number): RectLike {
    return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
    };
}

export function createBlock(content = '- item', startLine = 0, endLine = startLine): BlockInfo {
    const start = Math.max(0, startLine);
    const end = Math.max(start, endLine);
    return {
        type: BlockType.ListItem,
        startLine: start,
        endLine: end,
        from: 0,
        to: content.length,
        indentLevel: 0,
        content,
    };
}

export function resolveBlockSelectionFromTestBlocks(params: {
    handle?: ((handle: HTMLElement) => BlockInfo | null) | BlockInfo | null;
    nativeSelection?: ((handle: HTMLElement) => BlockSelection | null) | BlockSelection | null;
    point?: ((clientX: number, clientY: number) => BlockInfo | null) | BlockInfo | null;
}): (request: BlockSelectionRequest) => BlockSelection | null {
    return (request) => {
        const resolveBlock = (value: ((...args: never[]) => BlockInfo | null) | BlockInfo | null | undefined, args: never[]): BlockInfo | null => {
            if (typeof value === 'function') return value(...args);
            return value ?? null;
        };
        const resolveSelection = (
            value: ((...args: never[]) => BlockSelection | null) | BlockSelection | null | undefined,
            args: never[]
        ): BlockSelection | null => {
            if (typeof value === 'function') return value(...args);
            return value ?? null;
        };
        switch (request.kind) {
            case 'handle': {
                const block = resolveBlock(params.handle, [request.handle as never]);
                return block ? makeBlockSelection(block, buildSingleBlockSelectionRanges(block)) : null;
            }
            case 'native-selection':
                return resolveSelection(params.nativeSelection, [request.handle as never]);
            case 'point': {
                const block = resolveBlock(params.point, [request.clientX as never, request.clientY as never]);
                return block ? makeBlockSelection(block, buildSingleBlockSelectionRanges(block)) : null;
            }
            case 'block':
                return makeBlockSelection(request.block, buildSingleBlockSelectionRanges(request.block));
            case 'selection': {
                return buildSelectionFromSelectedBlocks(request.doc, request.blocks, request.templateBlock);
            }
        }
    };
}

export function createViewStub(lineCountOrLines: number | string[] = 1): EditorView {
    const root = activeDocument.createElement('div');
    const content = activeDocument.createElement('div');
    root.appendChild(content);
    activeDocument.body.appendChild(root);

    const lineTexts = Array.isArray(lineCountOrLines)
        ? lineCountOrLines
        : Array.from({ length: lineCountOrLines }, (_, i) => `line ${i + 1}`);
    const state = EditorState.create({
        doc: lineTexts.join('\n'),
    });
    const lineElements: HTMLElement[] = [];
    for (const text of lineTexts) {
        const lineEl = activeDocument.createElement('div');
        lineEl.className = 'cm-line';
        lineEl.textContent = text;
        content.appendChild(lineEl);
        lineElements.push(lineEl);
    }
    const docLength = state.doc.length;

    Object.defineProperty(root, 'getBoundingClientRect', {
        configurable: true,
        value: () => createRect(0, 0, 400, 200),
    });
    Object.defineProperty(content, 'getBoundingClientRect', {
        configurable: true,
        value: () => createRect(0, 0, 360, 200),
    });

    return {
        dom: root,
        contentDOM: content,
        state,
        hasFocus: false,
        visibleRanges: [{ from: 0, to: docLength }],
        coordsAtPos: (pos: number) => {
            const line = state.doc.lineAt(pos);
            const top = (line.number - 1) * 20;
            return { left: 40, right: 120, top, bottom: top + 20 };
        },
        posAtCoords: (coords: { x: number; y: number }) => {
            if (!Number.isFinite(coords.y)) return null;
            const lineNumber = Math.max(1, Math.min(state.doc.lines, Math.floor(coords.y / 20) + 1));
            return state.doc.line(lineNumber).from;
        },
        viewport: { from: 0, to: docLength },
        documentTop: 0,
        lineBlockAt: (pos: number) => {
            const line = state.doc.lineAt(pos);
            const top = (line.number - 1) * 20;
            return { from: line.from, to: line.to, top, bottom: top + 20 };
        },
        lineBlockAtHeight: (height: number) => {
            const lineNumber = Math.max(1, Math.min(state.doc.lines, Math.floor(height / 20) + 1));
            const line = state.doc.line(lineNumber);
            const top = (line.number - 1) * 20;
            return { from: line.from, to: line.to, top, bottom: top + 20 };
        },
        domAtPos: (pos: number) => {
            const line = state.doc.lineAt(pos);
            const node = lineElements[Math.max(0, line.number - 1)] ?? content;
            return { node, offset: 0 };
        },
        posAtDOM: (node: Node) => {
            const lineIndex = Math.max(0, lineElements.findIndex((lineEl) => lineEl === node || lineEl.contains(node)));
            return state.doc.line(Math.min(state.doc.lines, lineIndex + 1)).from;
        },
    } as unknown as EditorView;
}

export function ensureHandleGutter(view: EditorView): HTMLElement {
    const editorRoot = view.dom;
    editorRoot.classList.add('cm-editor');
    const existing = editorRoot.querySelector<HTMLElement>('.cm-dnd-handle-gutter');
    if (existing) return existing;
    const gutter = activeDocument.createElement('div');
    gutter.className = 'cm-dnd-handle-gutter';
    editorRoot.appendChild(gutter);
    return gutter;
}

export function appendHandleForBlockStart(
    view: EditorView,
    blockStart: number,
    resolveTop?: () => number,
    blockEnd?: number
): HTMLElement {
    const lineNumber = blockStart + 1;
    const gutter = ensureHandleGutter(view);
    let marker = gutter.querySelector<HTMLElement>(`.cm-gutterElement.dnd-handle-gutter-marker[data-line-number="${lineNumber}"]`);
    if (!marker) {
        marker = activeDocument.createElement('div');
        marker.className = 'cm-gutterElement dnd-handle-gutter-marker';
        marker.setAttribute('data-line-number', String(lineNumber));
        Object.defineProperty(marker, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(8, blockStart * 20, 2, 20),
        });
        gutter.appendChild(marker);
    }
    const handle = activeDocument.createElement('div');
    handle.className = `${DRAG_HANDLE_CLASS} ${LINE_HANDLE_CLASS}`;
    handle.setAttribute('data-block-start', String(blockStart));
    handle.setAttribute('data-block-end', String(blockEnd ?? blockStart));
    Object.defineProperty(handle, 'getBoundingClientRect', {
        configurable: true,
        value: () => createRect(8, resolveTop ? resolveTop() : (blockStart * 20 + 2), 16, 16),
    });
    marker.appendChild(handle);
    return handle;
}

export function appendHandleGutterMarker(
    view: EditorView,
    lineNumber: number,
    resolveTop?: () => number
): HTMLElement {
    const gutter = ensureHandleGutter(view);
    const marker = activeDocument.createElement('div');
    marker.className = 'cm-gutterElement dnd-handle-gutter-marker';
    marker.setAttribute('data-line-number', String(lineNumber));
    Object.defineProperty(marker, 'getBoundingClientRect', {
        configurable: true,
        value: () => createRect(8, resolveTop ? resolveTop() : ((lineNumber - 1) * 20), 2, 20),
    });
    gutter.appendChild(marker);
    return marker;
}

export function dispatchPointer(
    target: EventTarget,
    type: string,
    init: { pointerId: number; pointerType: string; clientX: number; clientY: number; button?: number; buttons?: number; shiftKey?: boolean }
): PointerEvent {
    const event = new Event(type, { bubbles: true, cancelable: true }) as PointerEvent;
    const inferredButtons = init.buttons ?? (
        init.pointerType === 'mouse'
            ? (type === 'pointerup' || type === 'pointercancel' ? 0 : 1)
            : 0
    );
    Object.defineProperty(event, 'pointerId', { value: init.pointerId });
    Object.defineProperty(event, 'pointerType', { value: init.pointerType });
    Object.defineProperty(event, 'clientX', { value: init.clientX });
    Object.defineProperty(event, 'clientY', { value: init.clientY });
    Object.defineProperty(event, 'button', { value: init.button ?? 0 });
    Object.defineProperty(event, 'buttons', { value: inferredButtons });
    Object.defineProperty(event, 'shiftKey', { value: init.shiftKey ?? false });
    target.dispatchEvent(event);
    return event;
}

export function dispatchTouchMove(target: EventTarget): TouchEvent {
    const event = new Event('touchmove', { bubbles: true, cancelable: true }) as TouchEvent;
    target.dispatchEvent(event);
    return event;
}

export function registerMouseHandlerTestHooks(): void {
    beforeEach(() => {
        if (!originalElementFromPoint && typeof activeDocument.elementFromPoint === 'function') {
            const nativeElementFromPoint = activeDocument.elementFromPoint.bind(activeDocument) as (x: number, y: number) => Element | null;
            originalElementFromPoint = (x: number, y: number) => nativeElementFromPoint(x, y);
        }
        vi.useFakeTimers();
    });

    afterEach(() => {
        activeDocument.body.innerHTML = '';
        activeDocument.body.className = '';
        vi.restoreAllMocks();
        vi.useRealTimers();
        Object.defineProperty(window.navigator, 'vibrate', {
            configurable: true,
            writable: true,
            value: originalVibrate,
        });
        Object.defineProperty(activeDocument, 'elementFromPoint', {
            configurable: true,
            writable: true,
            value: originalElementFromPoint,
        });
    });
}
