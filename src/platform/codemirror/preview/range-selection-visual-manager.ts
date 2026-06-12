import { EditorView } from '@codemirror/view';
import {
    CODEMIRROR_GUTTER_ELEMENT_SELECTOR,
    HANDLE_CORE_CLASS,
    HANDLE_GUTTER_MARKER_CLASS,
    MOBILE_SELECTION_RESIZE_HANDLE_BOTTOM_CLASS,
    MOBILE_SELECTION_RESIZE_HANDLE_CLASS,
    MOBILE_SELECTION_RESIZE_HANDLE_TOP_CLASS,
    RANGE_SELECTED_HANDLE_CLASS,
} from '../../../shared/dom-selectors';
import {
    groupSelectedBlocksIntoSegments,
    mergeSelectedBlocks,
    type BlockSelectionSegment,
    type SelectedBlockRange,
} from '../../../domain/selection/block-ranges';
import type { BlockSelection } from '../../../domain/selection/block-selection';
import type { PipelineState } from '../../../drag/pipeline/pipeline-state';
import { getMainContentLineElementForLine } from '../../dom/line-dom';
import { addSourceLineClasses, removeSourceLineClasses } from './source-line-visual';
import { platform } from '../../../plugin/platform';

export type RangeAnchorPoint = {
    x: number;
    y: number;
    host: HTMLElement;
};

export type RangeAnchorSpan = {
    x: number;
    topY: number;
    bottomY: number;
    host: HTMLElement;
};

type ResolveHandleForBlockLineNumber = (blockLineNumber: number) => HTMLElement | null;

type ResolveRangeAnchorSpanOptions = {
    segment: BlockSelectionSegment;
    resolveHandleForBlockLineNumber: ResolveHandleForBlockLineNumber;
    visibleHandles: Iterable<HTMLElement>;
};

export type AnchorEntry = {
    blockLineNumber: number;
    anchor: RangeAnchorPoint;
};

export type AnchorSnapshot = {
    ordered: AnchorEntry[];
    byBlockLineNumber: Map<number, RangeAnchorPoint>;
};

export type RangeSelectionVisualOptions = {
    showSourceOutline?: boolean;
    showMobileResizeHandles?: boolean;
};

function getHandleBlockLineNumber(handle: HTMLElement): number | null {
    const blockStartAttr = handle.getAttribute('data-block-start');
    if (!blockStartAttr) return null;
    const blockStart = Number(blockStartAttr);
    if (!Number.isFinite(blockStart)) return null;
    return blockStart + 1;
}

export function getAnchorPointForHandle(handle: HTMLElement | null): RangeAnchorPoint | null {
    if (!handle) return null;
    const host = handle.closest<HTMLElement>(`${CODEMIRROR_GUTTER_ELEMENT_SELECTOR}.${HANDLE_GUTTER_MARKER_CLASS}`)
        ?? handle.closest<HTMLElement>(`.${HANDLE_GUTTER_MARKER_CLASS}`);
    if (!host) return null;
    const anchorTarget = handle.querySelector<HTMLElement>(`.${HANDLE_CORE_CLASS}`) ?? handle;
    const rect = anchorTarget.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
        x: rect.left + rect.width / 2,
        y: rect.top + rect.height / 2,
        host,
    };
}

function getAnchorPointByBlockLineNumber(
    blockLineNumber: number,
    resolveHandleForBlockLineNumber: ResolveHandleForBlockLineNumber
): RangeAnchorPoint | null {
    const handle = resolveHandleForBlockLineNumber(blockLineNumber);
    return getAnchorPointForHandle(handle);
}

export function emptyAnchorSnapshot(): AnchorSnapshot {
    return {
        ordered: [],
        byBlockLineNumber: new Map<number, RangeAnchorPoint>(),
    };
}

export function buildAnchorSnapshot(
    visibleHandles: Iterable<HTMLElement>
): AnchorSnapshot {
    const snapshot = emptyAnchorSnapshot();
    for (const handle of visibleHandles) {
        const blockLineNumber = getHandleBlockLineNumber(handle);
        if (blockLineNumber === null) continue;
        if (snapshot.byBlockLineNumber.has(blockLineNumber)) continue;
        const anchor = getAnchorPointForHandle(handle);
        if (!anchor) continue;
        snapshot.byBlockLineNumber.set(blockLineNumber, anchor);
        snapshot.ordered.push({ blockLineNumber, anchor });
    }
    snapshot.ordered.sort((a, b) => a.blockLineNumber - b.blockLineNumber);
    return snapshot;
}

type ResolveAnchorSpanOptions = {
    segment: BlockSelectionSegment;
    snapshot: AnchorSnapshot;
    resolveHandleForBlockLineNumber?: ResolveHandleForBlockLineNumber;
};

function findFirstAnchorIndexAtOrAfter(
    ordered: AnchorEntry[],
    startBlockLineNumber: number
): number {
    let low = 0;
    let high = ordered.length;
    while (low < high) {
        const mid = Math.floor((low + high) / 2);
        if (ordered[mid].blockLineNumber < startBlockLineNumber) {
            low = mid + 1;
        } else {
            high = mid;
        }
    }
    return low;
}

export function resolveAnchorSpan(
    options: ResolveAnchorSpanOptions
): RangeAnchorSpan | null {
    const anchors: RangeAnchorPoint[] = [];
    const seenHosts = new Set<HTMLElement>();
    const addAnchor = (anchor: RangeAnchorPoint | null): void => {
        if (!anchor) return;
        if (seenHosts.has(anchor.host)) return;
        seenHosts.add(anchor.host);
        anchors.push(anchor);
    };

    const startAnchor = options.snapshot.byBlockLineNumber.get(options.segment.startBlockLineNumber)
        ?? (options.resolveHandleForBlockLineNumber
            ? getAnchorPointByBlockLineNumber(
                options.segment.startBlockLineNumber,
                options.resolveHandleForBlockLineNumber
            )
            : null);
    const endAnchor = options.snapshot.byBlockLineNumber.get(options.segment.endBlockLineNumber)
        ?? (options.resolveHandleForBlockLineNumber
            ? getAnchorPointByBlockLineNumber(
                options.segment.endBlockLineNumber,
                options.resolveHandleForBlockLineNumber
            )
            : null);

    addAnchor(startAnchor);
    addAnchor(endAnchor);

    const ordered = options.snapshot.ordered;
    for (
        let i = findFirstAnchorIndexAtOrAfter(ordered, options.segment.startBlockLineNumber);
        i < ordered.length && ordered[i].blockLineNumber <= options.segment.endBlockLineNumber;
        i++
    ) {
        addAnchor(ordered[i].anchor);
    }

    if (anchors.length === 0) return null;

    const topAnchor = anchors.reduce((best, current) => (current.y < best.y ? current : best));
    const bottomAnchor = anchors.reduce((best, current) => (current.y > best.y ? current : best));
    return {
        x: (topAnchor.x + bottomAnchor.x) / 2,
        topY: topAnchor.y,
        bottomY: bottomAnchor.y,
        host: topAnchor.host,
    };
}

export function resolveRangeAnchorSpan(options: ResolveRangeAnchorSpanOptions): RangeAnchorSpan | null {
    return resolveAnchorSpan({
        segment: options.segment,
        snapshot: buildAnchorSnapshot(options.visibleHandles),
        resolveHandleForBlockLineNumber: options.resolveHandleForBlockLineNumber,
    });
}

class RangeSelectionBoundaryHandleRenderer {
    private readonly resizeHandleEls = new Map<string, HTMLElement>();

    constructor(
        private readonly view: EditorView,
        private readonly resolveVisibleHandleForBlockStart: (blockStart: number) => HTMLElement | null
    ) { }

    render(
        blocks: SelectedBlockRange[],
        options?: { showMobileResizeHandles?: boolean }
    ): void {
        if (!options?.showMobileResizeHandles || !platform.isMobile) {
            this.clear();
            return;
        }

        const resizeBlocks = groupSelectedBlocksIntoSegments(this.view.state.doc.lines, blocks);
        const nextKeys = new Set<string>();
        for (const block of resizeBlocks) {
            const topHost = this.resolveResizeHandleHost(block.startBlockLineNumber);
            const bottomHost = this.resolveResizeHandleHost(block.endBlockLineNumber);
            if (!topHost || !bottomHost) continue;
            const topKey = this.resizeHandleKey(block, 'top');
            const bottomKey = this.resizeHandleKey(block, 'bottom');
            nextKeys.add(topKey);
            nextKeys.add(bottomKey);
            this.renderResizeHandle(this.getOrCreateResizeHandle(topKey, 'top', block), topHost);
            this.renderResizeHandle(this.getOrCreateResizeHandle(bottomKey, 'bottom', block), bottomHost);
        }
        this.removeStaleResizeHandles(nextKeys);
    }

    clear(): void {
        for (const handleEl of this.resizeHandleEls.values()) {
            handleEl.classList.remove('is-active');
            handleEl.remove();
        }
        this.resizeHandleEls.clear();
    }

    destroy(): void {
        this.clear();
    }

    private renderResizeHandle(
        handleEl: HTMLElement,
        host: HTMLElement
    ): void {
        if (handleEl.parentElement !== host) {
            host.appendChild(handleEl);
        }
        this.syncResizeHandleInlineOffset(handleEl, host);
        handleEl.classList.add('is-active');
    }

    private syncResizeHandleInlineOffset(handleEl: HTMLElement, host: HTMLElement): void {
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        const hostRect = host.getBoundingClientRect();
        if (!Number.isFinite(contentRect.left) || !Number.isFinite(contentRect.right) || contentRect.right <= contentRect.left) {
            handleEl.style.removeProperty('--dnd-selection-resize-handle-left');
            return;
        }
        if (!Number.isFinite(hostRect.left)) {
            handleEl.style.removeProperty('--dnd-selection-resize-handle-left');
            return;
        }
        const contentCenterX = (contentRect.left + contentRect.right) / 2;
        const hostLocalCenterX = contentCenterX - hostRect.left;
        handleEl.style.setProperty('--dnd-selection-resize-handle-left', `${hostLocalCenterX.toFixed(2)}px`);
    }

    private resolveResizeHandleHost(blockLineNumber: number): HTMLElement | null {
        const handle = this.resolveVisibleHandleForBlockStart(blockLineNumber - 1);
        if (!handle) return null;
        return handle.closest<HTMLElement>(`${CODEMIRROR_GUTTER_ELEMENT_SELECTOR}.${HANDLE_GUTTER_MARKER_CLASS}`)
            ?? handle.closest<HTMLElement>(`.${HANDLE_GUTTER_MARKER_CLASS}`);
    }

    private createResizeHandle(position: 'top' | 'bottom'): HTMLElement {
        const handle = activeDocument.createElement('div');
        handle.className = `${MOBILE_SELECTION_RESIZE_HANDLE_CLASS} ${position === 'top'
            ? MOBILE_SELECTION_RESIZE_HANDLE_TOP_CLASS
            : MOBILE_SELECTION_RESIZE_HANDLE_BOTTOM_CLASS}`;
        handle.textContent = '::';
        handle.setAttribute('data-dnd-mobile-selection-handle', position);
        handle.setAttribute('aria-label', position === 'top' ? 'Adjust selection start' : 'Adjust selection end');
        return handle;
    }

    private getOrCreateResizeHandle(
        key: string,
        position: 'top' | 'bottom',
        block: SelectedBlockRange
    ): HTMLElement {
        const existing = this.resizeHandleEls.get(key);
        if (existing) return existing;
        const handle = this.createResizeHandle(position);
        handle.setAttribute('data-dnd-mobile-selection-start-line', String(block.startLineNumber));
        handle.setAttribute('data-dnd-mobile-selection-end-line', String(block.endLineNumber));
        this.resizeHandleEls.set(key, handle);
        return handle;
    }

    private resizeHandleKey(block: SelectedBlockRange, position: 'top' | 'bottom'): string {
        return `${block.startLineNumber}:${block.endLineNumber}:${position}`;
    }

    private removeStaleResizeHandles(nextKeys: Set<string>): void {
        for (const [key, handleEl] of this.resizeHandleEls) {
            if (nextKeys.has(key)) continue;
            handleEl.remove();
            this.resizeHandleEls.delete(key);
        }
    }
}

export function renderRangeSelectionPreview(
    state: PipelineState,
    rangeVisual: RangeSelectionVisualManager
): void {
    if (state.type === 'selecting') {
        renderSelectionContext(state.selection, rangeVisual);
        return;
    }
    if ((state.type === 'holding' || state.type === 'ready_to_drag') && state.hold.retainedSelection) {
        renderSelectionContext(state.hold.retainedSelection, rangeVisual);
        return;
    }
    rangeVisual.clear();
}

function renderSelectionContext(
    selection: Extract<PipelineState, { type: 'selecting' }>['selection'],
    rangeVisual: RangeSelectionVisualManager
): void {
    const isMobileSelection = selection.guardDeps.includes('mobile-text-drag-mode');
    rangeVisual.renderInteractiveSelection(selection.rangeState?.selectionBlocks ?? selectionBlocksFromSelection(selection.selection), {
        showSourceOutline: isMobileSelection,
        showMobileResizeHandles: isMobileSelection,
    });
}

function selectionBlocksFromSelection(selection: { ranges: Array<{ startLine: number; endLine: number }> }): SelectedBlockRange[] {
    return selection.ranges.map((range) => ({
        startLineNumber: range.startLine + 1,
        endLineNumber: range.endLine + 1,
    }));
}

export class RangeSelectionVisualManager {
    private static readonly selectedCheckboxClass = 'dnd-selection-checkbox';
    private readonly handleElements = new Set<HTMLElement>();
    private readonly sourceLineElements = new Set<HTMLElement>();
    private readonly boundaryHandleRenderer: RangeSelectionBoundaryHandleRenderer;
    private handleAnchorSnapshot: AnchorSnapshot = emptyAnchorSnapshot();
    private refreshRafHandle: number | null = null;
    private scrollContainer: HTMLElement | null = null;
    private readonly onScroll: () => void;
    private currentVisualOptions: RangeSelectionVisualOptions = {};

    constructor(
        private readonly view: EditorView,
        private readonly onRefreshRequested: () => void,
        private readonly resolveVisibleHandleForBlockStart: (blockStart: number) => HTMLElement | null
    ) {
        this.boundaryHandleRenderer = new RangeSelectionBoundaryHandleRenderer(
            this.view,
            this.resolveVisibleHandleForBlockStart
        );

        this.onScroll = () => this.scheduleRefresh();
        this.bindScrollListener();
    }

    renderInteractiveSelection(blocks: SelectedBlockRange[], options: RangeSelectionVisualOptions): void {
        this.currentVisualOptions = options;
        this.render(blocks, options);
    }

    renderDragSourceSelection(selection: BlockSelection): void {
        this.render(selectionBlocksFromSelection(selection), {
            showSourceOutline: true,
            showMobileResizeHandles: false,
        });
    }

    private render(blocks: SelectedBlockRange[], options: RangeSelectionVisualOptions): void {
        const normalizedBlocks = mergeSelectedBlocks(this.view.state.doc.lines, blocks);
        const nextHandleElements = new Set<HTMLElement>();
        const nextSourceLineElements = new Set<HTMLElement>();
        for (const block of normalizedBlocks) {
            const handleEl = this.resolveHandleElementForBlockStart(block.startLineNumber - 1);
            if (handleEl) {
                nextHandleElements.add(handleEl);
            }
            if (options?.showSourceOutline) {
                this.collectSourceLineElements(block, nextSourceLineElements);
            }
        }
        this.handleAnchorSnapshot = buildAnchorSnapshot(nextHandleElements);
        this.syncSelectionElements(
            this.handleElements,
            nextHandleElements,
            RANGE_SELECTED_HANDLE_CLASS
        );
        this.syncSourceLineElements(nextSourceLineElements);
        this.boundaryHandleRenderer.render(normalizedBlocks, {
            showMobileResizeHandles: options?.showMobileResizeHandles,
        });
    }

    clear(): void {
        for (const handleEl of this.handleElements) {
            handleEl.classList.remove(RANGE_SELECTED_HANDLE_CLASS);
            this.removeSelectionCheckbox(handleEl);
        }
        this.clearSourceLineElements();
        this.handleElements.clear();
        this.handleAnchorSnapshot = emptyAnchorSnapshot();
        this.currentVisualOptions = {};
        this.boundaryHandleRenderer.clear();
    }

    scheduleRefresh(): void {
        if (this.refreshRafHandle !== null) return;
        this.refreshRafHandle = window.requestAnimationFrame(() => {
            this.refreshRafHandle = null;
            this.onRefreshRequested();
        });
    }

    cancelScheduledRefresh(): void {
        if (this.refreshRafHandle === null) return;
        window.cancelAnimationFrame(this.refreshRafHandle);
        this.refreshRafHandle = null;
    }

    destroy(): void {
        this.clear();
        this.boundaryHandleRenderer.destroy();
        this.cancelScheduledRefresh();
        this.unbindScrollListener();
    }

    private bindScrollListener(): void {
        this.unbindScrollListener();
        const scroller = this.view.scrollDOM
            ?? this.view.dom.querySelector<HTMLElement>('.cm-scroller')
            ?? null;
        if (!scroller) return;
        scroller.addEventListener('scroll', this.onScroll, { passive: true });
        this.scrollContainer = scroller;
    }

    private unbindScrollListener(): void {
        if (!this.scrollContainer) return;
        this.scrollContainer.removeEventListener('scroll', this.onScroll);
        this.scrollContainer = null;
    }

    private syncSelectionElements(
        current: Set<HTMLElement>,
        next: Set<HTMLElement>,
        className: string
    ): void {
        for (const el of current) {
            if (next.has(el)) {
                el.classList.add(className);
                if (className === RANGE_SELECTED_HANDLE_CLASS) {
                    this.ensureSelectionCheckbox(el);
                }
                continue;
            }
            el.classList.remove(className);
            if (className === RANGE_SELECTED_HANDLE_CLASS) {
                this.removeSelectionCheckbox(el);
            }
        }
        for (const el of next) {
            if (current.has(el)) continue;
            el.classList.add(className);
            if (className === RANGE_SELECTED_HANDLE_CLASS) {
                this.ensureSelectionCheckbox(el);
            }
        }
        current.clear();
        for (const el of next) {
            current.add(el);
        }
    }

    private ensureSelectionCheckbox(handleEl: HTMLElement): void {
        const existing = handleEl.querySelector<HTMLInputElement>(`:scope > .${RangeSelectionVisualManager.selectedCheckboxClass}`);
        if (existing) {
            existing.checked = true;
            return;
        }
        const checkbox = activeDocument.createElement('input');
        checkbox.type = 'checkbox';
        checkbox.checked = true;
        checkbox.tabIndex = -1;
        checkbox.className = RangeSelectionVisualManager.selectedCheckboxClass;
        checkbox.setAttribute('aria-hidden', 'true');
        handleEl.appendChild(checkbox);
    }

    private removeSelectionCheckbox(handleEl: HTMLElement): void {
        const checkbox = handleEl.querySelector<HTMLInputElement>(`:scope > .${RangeSelectionVisualManager.selectedCheckboxClass}`);
        checkbox?.remove();
    }

    private collectSourceLineElements(block: SelectedBlockRange, target: Set<HTMLElement>): void {
        for (let lineNumber = block.startLineNumber; lineNumber <= block.endLineNumber; lineNumber++) {
            const lineEl = getMainContentLineElementForLine(this.view, lineNumber);
            if (!lineEl) continue;
            addSourceLineClasses(lineEl, lineNumber, block.startLineNumber, block.endLineNumber);
            target.add(lineEl);
        }
    }

    private syncSourceLineElements(next: Set<HTMLElement>): void {
        for (const lineEl of this.sourceLineElements) {
            if (next.has(lineEl)) continue;
            removeSourceLineClasses(lineEl);
        }
        this.sourceLineElements.clear();
        for (const lineEl of next) {
            this.sourceLineElements.add(lineEl);
        }
    }

    private clearSourceLineElements(): void {
        for (const lineEl of this.sourceLineElements) {
            removeSourceLineClasses(lineEl);
        }
        this.sourceLineElements.clear();
    }

    private resolveHandleElementForBlockStart(blockStart: number): HTMLElement | null {
        return this.resolveVisibleHandleForBlockStart(blockStart);
    }

    resolveRangeAnchorSpan(segment: BlockSelectionSegment): RangeAnchorSpan | null {
        return resolveAnchorSpan({
            segment,
            snapshot: this.handleAnchorSnapshot,
            resolveHandleForBlockLineNumber: (lineNumber) => this.resolveHandleElementForBlockStart(lineNumber - 1),
        });
    }
}
