import { EditorView } from '@codemirror/view';
import { type BlockInfo, mergeLineRanges, isLineNumberInRanges } from 'md-dragger/domain';
import type { HoverContentRect, HoverPointerSnapshot } from './hover-pointer-types';
import {
    DRAG_HANDLE_CLASS,
    DRAG_SOURCE_EMBED_CLASS,
    SELECTED_HANDLE_CLASS,
} from '../../../shared/dom-selectors';
import { getMainContentLineElementForLine } from '../dom/line-dom';
import { resolveLineNumberFromDomNodes } from '../dom/element-probe';
import { isHTMLElement } from '../dom/dom-utils';
import { collectEmbedRoots } from '../dom/embed-probe';
import { addSourceLineClasses, removeSourceLineClasses } from '../handle/source-line-visual';

export interface HandleVisibilityDeps {
    getBlockInfoForHandle: (handle: HTMLElement) => BlockInfo | null;
    getLineNumberAtVerticalPosition: (clientY: number, contentRect: HoverContentRect) => number | null;
    getDraggableBlockAtVerticalPosition: (clientY: number, contentRect: HoverContentRect) => BlockInfo | null;
    getVisibleHandleForBlockStart?: (blockStart: number) => HTMLElement | null;
}

type GrabLineRange = {
    startLineNumber: number;
    endLineNumber: number;
};

type ActiveHoverBlock = {
    startLineNumber: number;
    endLineNumber: number;
    handle: HTMLElement;
};

// Pure DOM projection for hover + grab visuals. Owns no runtime state: the
// platform driver decides *what* ranges are selected; this class only paints
// the current DOM with those ranges and keeps hover-visible handles in sync.
export class HandleVisibilityController {
    private readonly grabbedLineEls = new Set<HTMLElement>();
    private readonly grabbedEmbedEls = new Set<HTMLElement>();
    private readonly grabbedHandleEls = new Set<HTMLElement>();
    private grabbedRanges: GrabLineRange[] = [];
    private activeHandle: HTMLElement | null = null;
    private activeHoverBlock: ActiveHoverBlock | null = null;

    constructor(
        private readonly view: EditorView,
        private readonly deps: HandleVisibilityDeps
    ) { }

    getActiveHandle(): HTMLElement | null {
        return this.activeHandle;
    }

    clearGrabbedLineNumbers(): void {
        this.clearGrabVisualClasses();
        this.grabbedRanges = [];
    }

    // Re-apply the last ranges onto whatever DOM is currently live. Call after
    // CodeMirror rebuilds line/gutter nodes (viewport, selection, geometry).
    refreshGrabVisualState(): void {
        if (this.grabbedRanges.length === 0) return;
        this.clearGrabVisualClasses();
        this.applyGrabVisualState();
    }

    enterGrabVisualState(
        ranges: GrabLineRange[],
        handle: HTMLElement | null
    ): void {
        if (handle) this.setActiveVisibleHandle(handle);
        this.setGrabbedRanges(ranges);
    }

    setActiveVisibleHandle(handle: HTMLElement | null): void {
        if (this.activeHandle === handle) return;

        if (this.activeHandle) {
            // Selected-block handles stay visible via SELECTED_HANDLE_CLASS;
            // only pure hover visibility is stripped when the pointer leaves.
            if (!this.grabbedHandleEls.has(this.activeHandle)
                && !this.activeHandle.classList.contains(SELECTED_HANDLE_CLASS)) {
                this.activeHandle.classList.remove('is-visible');
            }
        }

        this.activeHandle = handle;
        if (!handle) {
            this.activeHoverBlock = null;
            return;
        }
        if (this.activeHoverBlock?.handle !== handle) {
            this.activeHoverBlock = null;
        }
        handle.classList.add('is-visible');
    }

    isPointerInHandleInteractionZone(snapshot: HoverPointerSnapshot): boolean {
        return snapshot.withinHandleInteractionZone;
    }

    isPointerInHoverActivationZone(snapshot: HoverPointerSnapshot): boolean {
        return snapshot.withinHoverActivationZone;
    }

    resolveVisibleHandleFromTarget(target: EventTarget | null): HTMLElement | null {
        if (!isHTMLElement(target)) return null;
        const directHandle = target.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
        if (!directHandle) return null;
        if (this.view.dom.contains(directHandle)) return directHandle;
        return null;
    }

    resolveVisibleHandleFromPointer(snapshot: HoverPointerSnapshot): HTMLElement | null {
        if (!snapshot.withinHoverActivationZone) {
            this.activeHoverBlock = null;
            return null;
        }

        const cachedHandle = this.resolveActiveHoverBlock(snapshot);
        if (cachedHandle) return cachedHandle;

        const blockInfo = this.deps.getDraggableBlockAtVerticalPosition(snapshot.clientY, snapshot.contentRect);
        if (!blockInfo) return null;
        const handle = this.resolveVisibleHandleForBlock(blockInfo);
        if (!handle) {
            this.activeHoverBlock = null;
            return null;
        }
        this.activeHoverBlock = {
            startLineNumber: blockInfo.startLine + 1,
            endLineNumber: blockInfo.endLine + 1,
            handle,
        };
        return handle;
    }

    private clearGrabVisualClasses(): void {
        for (const lineEl of this.grabbedLineEls) {
            removeSourceLineClasses(lineEl);
        }
        this.grabbedLineEls.clear();
        for (const embedEl of this.grabbedEmbedEls) {
            embedEl.classList.remove(DRAG_SOURCE_EMBED_CLASS);
        }
        this.grabbedEmbedEls.clear();
        for (const handleEl of this.grabbedHandleEls) {
            handleEl.classList.remove(SELECTED_HANDLE_CLASS);
            if (handleEl !== this.activeHandle) {
                handleEl.classList.remove('is-visible');
            }
        }
        this.grabbedHandleEls.clear();
    }

    private setGrabbedRanges(ranges: GrabLineRange[]): void {
        this.clearGrabVisualClasses();
        this.grabbedRanges = ranges;
        this.applyGrabVisualState();
    }

    private applyGrabVisualState(): void {
        if (this.grabbedRanges.length === 0) return;
        for (const range of this.normalizeGrabLineRanges(this.grabbedRanges)) {
            const safeStart = Math.max(1, Math.min(this.view.state.doc.lines, range.startLineNumber));
            const safeEnd = Math.max(1, Math.min(this.view.state.doc.lines, range.endLineNumber));
            const from = Math.min(safeStart, safeEnd);
            const to = Math.max(safeStart, safeEnd);
            for (let lineNumber = from; lineNumber <= to; lineNumber++) {
                const lineEl = getMainContentLineElementForLine(this.view, lineNumber);
                if (!lineEl) continue;
                addSourceLineClasses(lineEl, lineNumber, from, to);
                this.grabbedLineEls.add(lineEl);
            }
        }
        this.applyGrabbedEmbedVisualState();
        this.applyGrabbedHandleVisualState();
    }

    private applyGrabbedHandleVisualState(): void {
        for (const range of this.grabbedRanges) {
            const handle = this.deps.getVisibleHandleForBlockStart?.(range.startLineNumber - 1);
            if (!handle) continue;
            handle.classList.add(SELECTED_HANDLE_CLASS, 'is-visible');
            this.grabbedHandleEls.add(handle);
        }
    }

    private applyGrabbedEmbedVisualState(): void {
        const root = this.view.dom;
        if (!root?.instanceOf(HTMLElement)) return;
        for (const embed of collectEmbedRoots(this.view, { normalizeToEmbedRoot: true })) {
            const lineNumber = this.resolveEmbedLineNumber(embed);
            if (lineNumber === null) continue;
            if (!this.isLineNumberInGrabRanges(lineNumber)) continue;
            embed.classList.add(DRAG_SOURCE_EMBED_CLASS);
            this.grabbedEmbedEls.add(embed);
        }
    }

    private resolveEmbedLineNumber(embed: HTMLElement): number | null {
        const probes: Array<Node | null> = [embed];
        if (embed.firstChild) probes.push(embed.firstChild);
        if (embed.parentElement) probes.push(embed.parentElement);
        if (embed.parentElement?.firstChild) probes.push(embed.parentElement.firstChild);
        return resolveLineNumberFromDomNodes(this.view, probes);
    }

    private isLineNumberInGrabRanges(lineNumber: number): boolean {
        return isLineNumberInRanges(lineNumber, this.grabbedRanges);
    }

    private normalizeGrabLineRanges(ranges: GrabLineRange[]): GrabLineRange[] {
        return mergeLineRanges(this.view.state.doc.lines, ranges).map((range) => ({
            startLineNumber: range.startLineNumber,
            endLineNumber: range.endLineNumber,
        }));
    }

    private resolveVisibleHandleForBlock(blockInfo: BlockInfo): HTMLElement | null {
        return this.deps.getVisibleHandleForBlockStart?.(blockInfo.startLine) ?? null;
    }

    private resolveActiveHoverBlock(snapshot: HoverPointerSnapshot): HTMLElement | null {
        if (!this.activeHoverBlock) return null;
        if (this.activeHandle !== this.activeHoverBlock.handle) return null;
        if (!this.activeHoverBlock.handle.isConnected) {
            this.activeHoverBlock = null;
            return null;
        }

        const lineNumber = this.deps.getLineNumberAtVerticalPosition(snapshot.clientY, snapshot.contentRect);
        if (lineNumber === null) return null;
        if (lineNumber < this.activeHoverBlock.startLineNumber || lineNumber > this.activeHoverBlock.endLineNumber) {
            return null;
        }
        if (lineNumber === this.activeHoverBlock.startLineNumber) {
            return this.activeHoverBlock.handle;
        }

        const lineHandle = this.deps.getVisibleHandleForBlockStart?.(lineNumber - 1) ?? null;
        if (lineHandle && lineHandle !== this.activeHoverBlock.handle) {
            return null;
        }
        return this.activeHoverBlock.handle;
    }
}
