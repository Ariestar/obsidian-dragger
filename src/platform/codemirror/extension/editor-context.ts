import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../../domain/block/block-types';
import { createLineParsingContext } from '../../../domain/markdown/line-parsing-service';
import { getListContext } from '../../../domain/mutation/list-mutation';
import { buildInsertTextForDrop } from '../../../domain/mutation/text-mutation-policy';
import { resolveDropRuleAtInsertion } from '../../../domain/rules/container-policy-service';
import { BlockSelectionResolver } from '../selection/block-selection-resolver';
import {
    getAdjustedTargetLocation,
    getBlockRect,
    getInsertionAnchorY,
    getLineIndentPosByWidth,
    getLineRect,
} from '../selection/geometry';
import { DocLike } from '../../../domain/markdown/document-types';
import type { ListDropTarget } from '../../../domain/command/drop-target';

export function createEditorContext(view: EditorView) {
    const tabSize = view.state.facet(EditorState.tabSize);
    const selection = new BlockSelectionResolver(view);
    const lineParsing = createLineParsingContext(tabSize);
    const getListContextForDoc = (doc: DocLike, lineNumber: number) =>
        getListContext(doc, lineNumber, lineParsing.parseLine);

    return {
        view,
        tabSize,
        selection,
        parseLine: lineParsing.parseLine,
        getAdjustedTargetLocation: (lineNumber: number, options?: { clientY?: number }) =>
            getAdjustedTargetLocation(view, lineNumber, options),
        slotAt: (
            sourceBlock: BlockInfo,
            targetLineNumber: number,
            options?: Parameters<typeof resolveDropRuleAtInsertion>[3]
        ) => resolveDropRuleAtInsertion(view.state, sourceBlock, targetLineNumber, {
            ...options,
            tabSize,
        }),
        listCtx: getListContextForDoc,
        indentUnit: lineParsing.getIndentUnitWidth,
        indentUnitForDoc: lineParsing.getIndentUnitWidthForDoc,
        getBlockInfoForEmbed: (element: HTMLElement) => selection.getBlockInfoForEmbed(element),
        getLineRect: (lineNumber: number) => getLineRect(view, lineNumber),
        getInsertionAnchorY: (lineNumber: number) => getInsertionAnchorY(view, lineNumber),
        getLineIndentPosByWidth: (lineNumber: number, width: number) =>
            getLineIndentPosByWidth(view, lineParsing, lineNumber, width),
        getBlockRect: (startLineNumber: number, endLineNumber: number) =>
            getBlockRect(view, startLineNumber, endLineNumber),
        insertText: (
            doc: DocLike,
            sourceBlock: BlockInfo,
            targetLineNumber: number,
            sourceContent: string,
            listIntent?: ListDropTarget
        ) => buildInsertTextForDrop({
            lineParsing,
            doc,
            sourceBlock,
            targetLineNumber,
            sourceContent,
            listIntent,
        }),
    };
}

export type EditorContext = ReturnType<typeof createEditorContext>;
