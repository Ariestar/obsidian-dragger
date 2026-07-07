import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../../domain/block/block-types';
import type { HoverContentRect, HoverPointerSnapshot } from '../extension/hover-pointer-types';
import {
    DRAG_HANDLE_CLASS,
    DRAG_SOURCE_EMBED_CLASS,
} from '../../../shared/dom-selectors';
import { getMainContentLineElementForLine } from '../../dom/line-dom';
import { resolveLineNumberFromDomNodes } from '../../dom/element-probe';
import { isHTMLElement } from '../../dom/dom-utils';
import { mergeLineRanges, isLineNumberInRanges } from '../../../domain/markdown/line-range';
import { collectEmbedRoots } from '../../dom/embed-probe';
import { addSourceLineClasses, removeSourceLineClasses } from './source-line-visual';

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

export class HandleVisibilityController {
    private readonly grabbedLineEls = new Set<HTMLElement>();
    private readonly grabbedEmbedEls = new Set<HTMLElement>();
    private grabbedLineRanges: GrabLineRange[] = [];
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
        this.clearGrabbedLineVisualClasses();
        this.grabbedLineRanges = [];
    }

    refreshGrabVisualState(): void {
        if (this.grabbedLineRanges.length === 0) return;
        this.clearGrabbedLineVisualClasses();
        this.applyGrabbedLineVisualState();
    }

    setGrabbedLineNumberRange(startLineNumber: number, endLineNumber: number): void {
        this.setGrabbedLineRanges([{ startLineNumber, endLineNumber }]);
    }

    enterGrabVisualState(
        ranges: GrabLineRange[],
        handle: HTMLElement | null
    ): void {
        this.setActiveVisibleHandle(handle);
        this.setGrabbedLineRanges(ranges);
    }

    enterGrabVisualStateForBlock(
        blockInfo: BlockInfo,
        handle: HTMLElement | null
    ): void {
        this.enterGrabVisualState([{
            startLineNumber: blockInfo.startLine + 1,
            endLineNumber: blockInfo.endLine + 1,
        }], handle);
    }

    setActiveVisibleHandle(handle: HTMLElement | null): void {
        if (this.activeHandle === handle) {
            return;
        }
        if (this.activeHandle) {
            this.activeHandle.classList.remove('is-visible');
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

    enterGrabVisualStateForRange(
        startLineNumber: number,
        endLineNumber: number,
        handle: HTMLElement | null
    ): void {
        this.setActiveVisibleHandle(handle);
        this.setGrabbedLineNumberRange(startLineNumber, endLineNumber);
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
        if (this.view.dom.contains(directHandle)) {
            return directHandle;
        }
        return null;
    }

    resolveVisibleHandleFromPointer(snapshot: HoverPointerSnapshot): HTMLElement | null {
        if (!snapshot.withinHoverActivationZone) {
            this.activeHoverBlock = null;
            return null;
        }

        const cachedHandle = this.resolveActiveHoverBlock(snapshot);
        if (cachedHandle) {
            return cachedHandle;
        }

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

    private clearGrabbedLineVisualClasses(): void {
        for (const lineEl of this.grabbedLineEls) {
            removeSourceLineClasses(lineEl);
        }
        this.grabbedLineEls.clear();
        for (const embedEl of this.grabbedEmbedEls) {
            embedEl.classList.remove(DRAG_SOURCE_EMBED_CLASS);
        }
        this.grabbedEmbedEls.clear();
    }

    private setGrabbedLineRanges(ranges: GrabLineRange[]): void {
        this.clearGrabbedLineVisualClasses();
        this.grabbedLineRanges = this.normalizeGrabLineRanges(ranges);
        this.applyGrabbedLineVisualState();
    }

    private applyGrabbedLineVisualState(): void {
        if (this.grabbedLineRanges.length === 0) return;
        for (const range of this.grabbedLineRanges) {
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
        return isLineNumberInRanges(lineNumber, this.grabbedLineRanges);
    }

    private normalizeGrabLineRanges(ranges: GrabLineRange[]): GrabLineRange[] {
        const docLines = this.view.state.doc.lines;
        const merged = mergeLineRanges(docLines, ranges);
        return merged.map((range) => ({
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
