import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../types';
import { validateInPlaceDrop } from '../core/drop-validation';
import { RulePosition, RuleTargetContainerType } from '../core/insertion-rule-matrix';
import { DocLike, DocLikeWithRange, ListContext, ParsedLine } from '../core/protocol-types';
import { ListRenumberer } from './ListRenumberer';

export interface BlockMoverDeps {
    view: EditorView;
    clampTargetLineNumber: (totalLines: number, lineNumber: number) => number;
    getAdjustedTargetLocation: (lineNumber: number, options?: { clientY?: number }) => { lineNumber: number; blockAdjusted: boolean };
    resolveDropRuleAtInsertion: (
        sourceBlock: BlockInfo,
        targetLineNumber: number
    ) => {
        targetContainerType: RuleTargetContainerType;
        position: RulePosition;
        decision: { allowDrop: boolean };
    };
    parseLineWithQuote: (line: string) => ParsedLine;
    getListContext: (doc: DocLike, lineNumber: number) => ListContext;
    getIndentUnitWidth: (sample: string) => number;
    buildInsertText: (
        doc: DocLike,
        sourceBlock: BlockInfo,
        targetLineNumber: number,
        sourceContent: string,
        listContextLineNumberOverride?: number,
        listIndentDeltaOverride?: number,
        listTargetIndentWidthOverride?: number
    ) => string;
}

export class BlockMover {
    private readonly listRenumberer: ListRenumberer;

    constructor(private readonly deps: BlockMoverDeps) {
        this.listRenumberer = new ListRenumberer({
            view: deps.view,
            parseLineWithQuote: deps.parseLineWithQuote,
        });
    }

    moveBlock(params: {
        sourceBlock: BlockInfo;
        targetPos: number;
        targetLineNumberOverride?: number;
        listContextLineNumberOverride?: number;
        listIndentDeltaOverride?: number;
        listTargetIndentWidthOverride?: number;
    }): void {
        const {
            sourceBlock,
            targetPos,
            targetLineNumberOverride,
            listContextLineNumberOverride,
            listIndentDeltaOverride,
            listTargetIndentWidthOverride,
        } = params;

        const view = this.deps.view;
        const doc = view.state.doc as unknown as DocLikeWithRange;
        const targetLine = view.state.doc.lineAt(targetPos);

        let targetLineNumber = targetLineNumberOverride ?? targetLine.number;

        if (targetLineNumberOverride === undefined) {
            const adjusted = this.deps.getAdjustedTargetLocation(targetLine.number);
            if (adjusted.blockAdjusted) {
                targetLineNumber = adjusted.lineNumber;
            }
        }

        targetLineNumber = this.deps.clampTargetLineNumber(doc.lines, targetLineNumber);
        const containerRule = this.deps.resolveDropRuleAtInsertion(sourceBlock, targetLineNumber);
        if (!containerRule.decision.allowDrop) {
            return;
        }

        const inPlaceValidation = validateInPlaceDrop({
            doc,
            sourceBlock,
            targetLineNumber,
            parseLineWithQuote: this.deps.parseLineWithQuote,
            getListContext: this.deps.getListContext,
            getIndentUnitWidth: this.deps.getIndentUnitWidth,
            targetContainerType: containerRule.targetContainerType,
            containerPosition: containerRule.position,
            listContextLineNumberOverride,
            listIndentDeltaOverride,
            listTargetIndentWidthOverride,
        });
        const allowInPlaceIndentChange = inPlaceValidation.allowInPlaceIndentChange;
        if (inPlaceValidation.inSelfRange && !allowInPlaceIndentChange) {
            return;
        }

        const sourceStartLine = doc.line(sourceBlock.startLine + 1);
        const sourceEndLine = doc.line(sourceBlock.endLine + 1);
        const sourceFrom = sourceStartLine.from;
        const sourceTo = sourceEndLine.to;
        const sourceContent = doc.sliceString(sourceFrom, sourceTo);
        const insertText = this.deps.buildInsertText(
            doc,
            sourceBlock,
            targetLineNumber,
            sourceContent,
            listContextLineNumberOverride,
            listIndentDeltaOverride,
            listTargetIndentWidthOverride
        );

        const insertPos = targetLineNumber > doc.lines
            ? doc.length
            : doc.line(targetLineNumber).from;
        const deleteFrom = sourceFrom;
        const deleteTo = Math.min(sourceTo + 1, doc.length);

        if (allowInPlaceIndentChange && insertPos === deleteFrom) {
            view.dispatch({
                changes: { from: deleteFrom, to: deleteTo, insert: insertText },
                scrollIntoView: false,
            });
        } else {
            view.dispatch({
                changes: [
                    { from: insertPos, to: insertPos, insert: insertText },
                    { from: deleteFrom, to: deleteTo },
                ].sort((a, b) => b.from - a.from),
                scrollIntoView: false,
            });
        }

        const sourceLineNumber = sourceBlock.startLine + 1;
        setTimeout(() => {
            this.listRenumberer.renumberOrderedListAround(sourceLineNumber);
            this.listRenumberer.renumberOrderedListAround(targetLineNumber);
        }, 0);
    }
}
