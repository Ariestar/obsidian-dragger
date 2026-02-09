import { EditorView } from '@codemirror/view';
import { detectBlock } from './block-detector';
import { BlockType } from '../../types';
import {
    GeometryFrameCache,
    getCoordsAtPos as getCoordsAtPosCached,
    getLineRect as getLineRectByLineNumber,
    getInsertionAnchorY as getInsertionAnchorYByLineNumber,
    getLineIndentPosByWidth as getLineIndentPosByWidthWithTabSize,
    getBlockRect as getBlockRectByRange,
} from './drop-target';
import { clampTargetLineNumber } from '../utils/coordinate-utils';
import { LineParsingService } from './LineParsingService';

export class GeometryCalculator {
    constructor(
        private readonly view: EditorView,
        private readonly lineParsingService: LineParsingService
    ) { }

    getAdjustedTargetLocation(
        lineNumber: number,
        options?: { clientY?: number; frameCache?: GeometryFrameCache }
    ): { lineNumber: number; blockAdjusted: boolean } {
        const doc = this.view.state.doc;
        if (lineNumber < 1 || lineNumber > doc.lines) {
            return { lineNumber: clampTargetLineNumber(doc.lines, lineNumber), blockAdjusted: false };
        }

        const block = detectBlock(this.view.state, lineNumber);
        if (!block || (block.type !== BlockType.CodeBlock && block.type !== BlockType.Table && block.type !== BlockType.MathBlock)) {
            return { lineNumber, blockAdjusted: false };
        }

        if (typeof options?.clientY === 'number') {
            const blockStartLine = doc.line(block.startLine + 1);
            const blockEndLine = doc.line(block.endLine + 1);
            const startCoords = getCoordsAtPosCached(this.view, blockStartLine.from, options.frameCache);
            const endCoords = getCoordsAtPosCached(this.view, blockEndLine.to, options.frameCache);
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

    getLineRect(lineNumber: number, frameCache?: GeometryFrameCache): { left: number; width: number } | undefined {
        return getLineRectByLineNumber(this.view, lineNumber, frameCache);
    }

    getInsertionAnchorY(lineNumber: number, frameCache?: GeometryFrameCache): number | null {
        return getInsertionAnchorYByLineNumber(this.view, lineNumber, frameCache);
    }

    getLineIndentPosByWidth(lineNumber: number, targetIndentWidth: number): number | null {
        return getLineIndentPosByWidthWithTabSize(
            this.view,
            lineNumber,
            targetIndentWidth,
            this.lineParsingService.getTabSize()
        );
    }

    getBlockRect(
        startLineNumber: number,
        endLineNumber: number,
        frameCache?: GeometryFrameCache
    ): { top: number; left: number; width: number; height: number } | undefined {
        return getBlockRectByRange(this.view, startLineNumber, endLineNumber, frameCache);
    }
}
