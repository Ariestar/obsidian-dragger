import { EditorState, type Text } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import {
    detectBlock,
    getHeadingSectionRange,
    BlockType,
    createBlockSelection as buildBlockSelection,
    groupSelectedBlocksIntoSegments,
    mergeSelectedBlocks,
    normalizeCompositeRanges,
    clampLineNumber,
    type BlockInfo,
    type BlockSelection,
    type BlockSelectionRange,
    type SelectedBlockRange,
} from 'md-dragger/domain';
import { findEmbedElementAtPoint } from '../../dom/embed-probe';
import {
    resolveLineNumberAtCoords,
    resolveLineNumberFromBlockStartAttribute,
    resolveLineNumberFromDomNodes,
    resolveLineNumberFromPos,
} from '../../dom/element-probe';
import { getRenderedMainLineNumberAtPoint } from '../../dom/line-hit';
import { isEditorLineCollapsed } from '../../obsidian/editor-fold';
import { CODEMIRROR_LINE_SELECTOR, EMBED_ROOT_SELECTOR } from '../../../shared/dom-selectors';

export type { BlockSelection, BlockSelectionRange };

export type BlockSelectionRequest =
    | { kind: 'handle'; handle: HTMLElement }
    | { kind: 'point'; clientX: number; clientY: number }
    | { kind: 'block'; block: BlockInfo }
    | {
        kind: 'selection';
        doc: Text;
        blocks: SelectedBlockRange[];
        templateBlock: BlockInfo;
    };

export function makeBlockSelection(block: BlockInfo, ranges: BlockSelectionRange[]): BlockSelection {
    return buildBlockSelection(block, ranges);
}

export function normalizeBlockSelectionRanges(ranges: BlockSelectionRange[], totalLines: number): BlockSelectionRange[] {
    return normalizeCompositeRanges(ranges, totalLines).map((range) => ({
        startLine: range.startLine,
        endLine: range.endLine,
    }));
}

export function buildSingleBlockSelectionRanges(block: BlockInfo): BlockSelectionRange[] {
    return [{ startLine: block.startLine, endLine: block.endLine }];
}

function buildAnchorBlockFromRange(
    doc: Text,
    startLineNumber: number,
    endLineNumber: number,
    template: BlockInfo
): BlockInfo {
    const safeStart = clampLineNumber(doc.lines, startLineNumber);
    const safeEnd = Math.max(safeStart, clampLineNumber(doc.lines, endLineNumber));
    const startLine = doc.line(safeStart);
    const endLine = doc.line(safeEnd);
    return {
        type: template.type,
        startLine: safeStart - 1,
        endLine: safeEnd - 1,
        from: startLine.from,
        to: endLine.to,
        indentLevel: template.indentLevel,
        content: doc.sliceString(startLine.from, endLine.to),
    };
}

export function buildSelectionFromSelectedBlocks(
    doc: Text,
    blocks: SelectedBlockRange[],
    template: BlockInfo
): BlockSelection | null {
    const normalizedBlocks = mergeSelectedBlocks(doc.lines, blocks);
    if (normalizedBlocks.length === 0) return null;

    const segments = groupSelectedBlocksIntoSegments(doc.lines, normalizedBlocks);
    const firstSegment = segments[0];
    if (!firstSegment) return null;

    return makeBlockSelection(
        buildAnchorBlockFromRange(
            doc,
            firstSegment.startLineNumber,
            firstSegment.endLineNumber,
            template
        ),
        segments.map((segment) => ({
            startLine: segment.startLineNumber - 1,
            endLine: segment.endLineNumber - 1,
        }))
    );
}

type VerticalContentRect = Pick<DOMRect | DOMRectReadOnly, 'top' | 'bottom'>;

export class BlockSelectionResolver {
    constructor(private readonly view: EditorView) { }

    resolveSelection(request: BlockSelectionRequest): BlockSelection | null {
        if (request.kind === 'selection') {
            return buildSelectionFromSelectedBlocks(request.doc, request.blocks, request.templateBlock);
        }

        const block = this.resolveRequestedBlock(request);
        if (!block) return null;
        return makeBlockSelection(block, buildSingleBlockSelectionRanges(block));
    }

    getBlockInfoForHandle(handle: HTMLElement): BlockInfo | null {
        // Line handles are absolutely positioned overlays, so DOM position can drift
        // from the bound source line (especially on rendered blocks like `---`).
        // Prefer handle attributes as the authoritative source.
        const startLine = resolveLineNumberFromBlockStartAttribute(this.view, handle);
        if (startLine === null) return null;
        return this.getDraggableBlockAtLine(startLine);
    }

    getDraggableBlockAtLine(lineNumber: number): BlockInfo | null {
        const block = detectBlock(this.view.state, lineNumber, {
            tabSize: this.view.state.facet(EditorState.tabSize),
        });
        if (!block) return null;
        return this.expandHeadingBlockIfCollapsed(block);
    }

    getLineNumberAtVerticalPosition(clientY: number, contentRect?: VerticalContentRect): number | null {
        const activeContentRect = contentRect ?? this.view.contentDOM.getBoundingClientRect();
        if (clientY < activeContentRect.top || clientY > activeContentRect.bottom) return null;

        try {
            const lineBlock = this.view.lineBlockAtHeight(clientY - this.view.documentTop);
            return resolveLineNumberFromPos(this.view, lineBlock.from);
        } catch {
            return null;
        }
    }

    getDraggableBlockAtVerticalPosition(clientY: number, contentRect?: VerticalContentRect): BlockInfo | null {
        const lineNumber = this.getLineNumberAtVerticalPosition(clientY, contentRect);
        if (lineNumber === null) return null;

        return this.getDraggableBlockAtLine(lineNumber);
    }

    getDraggableBlockAtPoint(clientX: number, clientY: number): BlockInfo | null {
        const embedAtPoint = this.getEmbedElementAtPoint(clientX, clientY);
        if (embedAtPoint) {
            const embedBlock = this.getBlockInfoForEmbed(embedAtPoint);
            if (embedBlock) return embedBlock;
        }

        const renderedLineNumber = getRenderedMainLineNumberAtPoint(this.view, clientX, clientY);
        if (renderedLineNumber !== null) {
            const renderedBlock = this.getDraggableBlockAtLine(renderedLineNumber);
            if (renderedBlock) return renderedBlock;
        }

        const contentRect = this.view.contentDOM.getBoundingClientRect();
        if (clientY < contentRect.top || clientY > contentRect.bottom) return null;

        const lineNumber = resolveLineNumberAtCoords(this.view, clientX, clientY, contentRect);
        if (lineNumber === null) return null;
        return this.getDraggableBlockAtLine(lineNumber);
    }

    getBlockInfoForEmbed(embedEl: HTMLElement): BlockInfo | null {
        const candidates = this.collectEmbedProbeCandidates(embedEl);
        for (const candidate of candidates) {
            const lineNumber = resolveLineNumberFromDomNodes(this.view, [candidate]);
            if (lineNumber === null) continue;
            const block = this.getDraggableBlockAtLine(lineNumber);
            if (block) return block;
        }
        return null;
    }

    private resolveRequestedBlock(request: BlockSelectionRequest): BlockInfo | null {
        switch (request.kind) {
            case 'handle':
                return this.getBlockInfoForHandle(request.handle);
            case 'point':
                return this.getDraggableBlockAtPoint(request.clientX, request.clientY);
            case 'block':
                return request.block;
            default:
                return null;
        }
    }

    private collectEmbedProbeCandidates(embedEl: HTMLElement): HTMLElement[] {
        const seen = new Set<HTMLElement>();
        const candidates: HTMLElement[] = [];
        const push = (el: HTMLElement | null | undefined) => {
            if (!el) return;
            if (seen.has(el)) return;
            seen.add(el);
            candidates.push(el);
        };

        push(embedEl.closest<HTMLElement>(EMBED_ROOT_SELECTOR));
        push(embedEl.closest<HTMLElement>(CODEMIRROR_LINE_SELECTOR));
        push(embedEl);

        let current: HTMLElement | null = embedEl.parentElement;
        while (current) {
            push(current);
            if (current === this.view.dom) break;
            current = current.parentElement;
        }

        return candidates;
    }

    private getEmbedElementAtPoint(clientX: number, clientY: number): HTMLElement | null {
        return findEmbedElementAtPoint(this.view, clientX, clientY, {
            requireDirectWithinRoot: true,
            normalizeToEmbedRoot: true,
        });
    }

    private expandHeadingBlockIfCollapsed(block: BlockInfo): BlockInfo {
        if (block.type !== BlockType.Heading) return block;
        const headingLineNumber = block.startLine + 1;
        if (!isEditorLineCollapsed(this.view, headingLineNumber)) return block;

        const range = getHeadingSectionRange(this.view.state.doc, headingLineNumber);
        if (!range || range.endLine <= headingLineNumber) return block;

        const endLineObj = this.view.state.doc.line(range.endLine);
        let content = '';
        for (let i = headingLineNumber; i <= range.endLine; i++) {
            content += this.view.state.doc.line(i).text;
            if (i < range.endLine) content += '\n';
        }

        return {
            ...block,
            endLine: range.endLine - 1,
            to: endLineObj.to,
            content,
        };
    }
}
