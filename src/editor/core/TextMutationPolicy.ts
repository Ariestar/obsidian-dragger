import { BlockInfo } from '../../types';
import {
    adjustListToTargetContext,
    buildInsertText as buildInsertTextByPolicy,
    buildTargetMarker,
    getListContext,
} from './block-mutation';
import { DocLike, ListContext, ParsedLine } from './protocol-types';
import { LineParsingService } from './LineParsingService';

export class TextMutationPolicy {
    constructor(
        private readonly lineParsingService: LineParsingService
    ) { }

    parseLineWithQuote(line: string): ParsedLine {
        return this.lineParsingService.parseLine(line);
    }

    getListContext(doc: DocLike, lineNumber: number): ListContext {
        return getListContext(doc, lineNumber, (line) => this.parseLineWithQuote(line));
    }

    getIndentUnitWidth(sample: string): number {
        return this.lineParsingService.getIndentUnitWidth(sample);
    }

    getIndentUnitWidthForDoc(doc: DocLike): number {
        return this.lineParsingService.getIndentUnitWidthForDoc(doc);
    }

    buildInsertText(
        doc: DocLike,
        sourceBlock: BlockInfo,
        targetLineNumber: number,
        sourceContent: string,
        listContextLineNumberOverride?: number,
        listIndentDeltaOverride?: number,
        listTargetIndentWidthOverride?: number
    ): string {
        return buildInsertTextByPolicy({
            sourceBlockType: sourceBlock.type,
            sourceContent,
            adjustListToTargetContext: (content) => adjustListToTargetContext({
                doc,
                sourceContent: content,
                targetLineNumber,
                parseLineWithQuote: (line) => this.parseLineWithQuote(line),
                getIndentUnitWidth: (sample) => this.getIndentUnitWidth(sample),
                buildIndentStringFromSample: (sample, width) =>
                    this.lineParsingService.buildIndentStringFromSample(sample, width),
                buildTargetMarker,
                markerConversionScope: 'root',
                getListContext: (activeDoc, lineNumber) => this.getListContext(activeDoc, lineNumber),
                listContextLineNumberOverride,
                listIndentDeltaOverride,
                listTargetIndentWidthOverride,
            }),
        });
    }
}
