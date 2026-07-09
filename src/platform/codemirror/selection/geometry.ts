import { EditorView } from '@codemirror/view';
import { EditorState } from '@codemirror/state';
import { detectBlock, BlockType, clampTargetLineNumber, LineParsingContext } from 'md-dragger/domain';
import {
    getCoordsAtPos as getCoordsAtPosCached,
    getLineRect as getLineRectByLineNumber,
    getInsertionAnchorY as getInsertionAnchorYByLineNumber,
    getLineIndentPosByWidth as getLineIndentPosByWidthWithTabSize,
    getBlockRect as getBlockRectByRange,
} from './rect-calculator';
import { isEditorLineCollapsed } from '../../obsidian/editor-fold';

export function getAdjustedTargetLocation(
    view: EditorView,
    lineNumber: number,
    options?: { clientY?: number }
): { lineNumber: number; blockAdjusted: boolean } {
    const doc = view.state.doc;
    if (lineNumber < 1 || lineNumber > doc.lines) {
        return { lineNumber: clampTargetLineNumber(doc.lines, lineNumber), blockAdjusted: false };
    }

    const block = detectBlock(view.state.doc, lineNumber, { tabSize: view.state.facet(EditorState.tabSize) });
    if (!block) return { lineNumber, blockAdjusted: false };

    const isAtomicBlock = block.type === BlockType.CodeBlock
        || block.type === BlockType.Table
        || block.type === BlockType.MathBlock;
    const isCollapsedBlock = (block.startLine !== block.endLine)
        && isEditorLineCollapsed(view, block.startLine + 1);

    if (!isAtomicBlock && !isCollapsedBlock) {
        return { lineNumber, blockAdjusted: false };
    }

    if (typeof options?.clientY === 'number') {
        const blockStartLine = doc.line(block.startLine + 1);
        const blockEndLine = doc.line(block.endLine + 1);
        const startCoords = getCoordsAtPosCached(view, blockStartLine.from);
        const endCoords = getCoordsAtPosCached(view, blockEndLine.to);
        if (startCoords && endCoords) {
            const midPoint = (startCoords.top + endCoords.bottom) / 2;
            const insertAfter = options.clientY > midPoint;
            const adjustedLineNumber = insertAfter ? block.endLine + 2 : block.startLine + 1;
            return {
                lineNumber: clampTargetLineNumber(doc.lines, adjustedLineNumber),
                blockAdjusted: true,
            };
        }
    }

    const lineIndex = lineNumber - 1;
    const midLine = (block.startLine + block.endLine) / 2;
    const adjustedLineNumber = lineIndex <= midLine ? block.startLine + 1 : block.endLine + 2;
    return {
        lineNumber: clampTargetLineNumber(doc.lines, adjustedLineNumber),
        blockAdjusted: true,
    };
}

export function getLineRect(view: EditorView, lineNumber: number): { left: number; width: number } | undefined {
    return getLineRectByLineNumber(view, lineNumber);
}

export function getInsertionAnchorY(view: EditorView, lineNumber: number): number | null {
    return getInsertionAnchorYByLineNumber(view, lineNumber);
}

export function getLineIndentPosByWidth(
    view: EditorView,
    lineParsing: LineParsingContext,
    lineNumber: number,
    targetIndentWidth: number
): number | null {
    return getLineIndentPosByWidthWithTabSize(
        view,
        lineNumber,
        targetIndentWidth,
        lineParsing.getTabSize()
    );
}

export function getBlockRect(
    view: EditorView,
    startLineNumber: number,
    endLineNumber: number
): { top: number; left: number; width: number; height: number } | undefined {
    return getBlockRectByRange(view, startLineNumber, endLineNumber);
}
