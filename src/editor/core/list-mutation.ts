import { DocLike, ListContext, ListContextValue, MarkerType, ParsedLine } from './protocol-types';

export type MarkerConversionScope = 'root' | 'all';

export function buildTargetMarker(
    target: Pick<ListContextValue, 'markerType'>,
    source: { markerType: MarkerType; marker: string }
): string {
    if (target.markerType === 'ordered') return '1. ';
    if (target.markerType === 'task') {
        if (source.markerType === 'task') return source.marker.replace(/^\s*[-*+]\s\[[ xX]\]\s+/, '- [ ] ');
        return '- [ ] ';
    }
    return '- ';
}

export function buildIndentStringFromSample(sample: string, width: number, tabSize: number): string {
    const safeWidth = Math.max(0, width);
    if (safeWidth === 0) return '';
    if (sample.includes('\t')) {
        const tabs = Math.max(0, Math.floor(safeWidth / tabSize));
        const spaces = Math.max(0, safeWidth - tabs * tabSize);
        return '\t'.repeat(tabs) + ' '.repeat(spaces);
    }
    return ' '.repeat(safeWidth);
}

export function getIndentUnitWidth(sample: string, tabSize: number): number {
    if (sample.includes('\t')) return tabSize;
    if (sample.length >= tabSize) return tabSize;
    return sample.length > 0 ? sample.length : tabSize;
}

export function getListContext(
    doc: DocLike,
    lineNumber: number,
    parseLineWithQuote: (line: string) => ParsedLine
): ListContext {
    return getListContextNearLine(doc, lineNumber, parseLineWithQuote);
}

export interface ListContextNearLineOptions {
    scanUp?: number;
    scanDown?: number;
    skipBlankLines?: boolean;
    stopAtNonListContent?: boolean;
}

function parseListContextFromLine(
    doc: DocLike,
    lineNumber: number,
    parseLineWithQuote: (line: string) => ParsedLine
): { context: ListContextValue | null; isBlank: boolean; isList: boolean } {
    if (lineNumber < 1 || lineNumber > doc.lines) {
        return { context: null, isBlank: true, isList: false };
    }
    const text = doc.line(lineNumber).text;
    const isBlank = text.trim().length === 0;
    const parsed = parseLineWithQuote(text);
    if (!parsed.isListItem) {
        return { context: null, isBlank, isList: false };
    }
    return {
        context: {
            indentWidth: parsed.indentWidth,
            indentRaw: parsed.indentRaw,
            markerType: parsed.markerType,
        },
        isBlank,
        isList: true,
    };
}

export function getListContextNearLine(
    doc: DocLike,
    lineNumber: number,
    parseLineWithQuote: (line: string) => ParsedLine,
    options?: ListContextNearLineOptions
): ListContext {
    const scanUp = Math.max(0, options?.scanUp ?? 8);
    const scanDown = Math.max(0, options?.scanDown ?? 3);
    const skipBlankLines = options?.skipBlankLines ?? true;
    const stopAtNonListContent = options?.stopAtNonListContent ?? true;

    const current = parseListContextFromLine(doc, lineNumber, parseLineWithQuote);
    if (current.context) return current.context;
    if (!skipBlankLines && current.isBlank) return null;

    let stopUp = false;
    let stopDown = false;
    for (let distance = 1; distance <= Math.max(scanUp, scanDown); distance++) {
        if (!stopUp && distance <= scanUp) {
            const upLineNumber = lineNumber - distance;
            if (upLineNumber >= 1) {
                const up = parseListContextFromLine(doc, upLineNumber, parseLineWithQuote);
                if (up.context) return up.context;
                if (!up.isBlank && !up.isList && stopAtNonListContent) {
                    stopUp = true;
                }
            }
        }

        if (!stopDown && distance <= scanDown) {
            const downLineNumber = lineNumber + distance;
            if (downLineNumber <= doc.lines) {
                const down = parseListContextFromLine(doc, downLineNumber, parseLineWithQuote);
                if (down.context) return down.context;
                if (!down.isBlank && !down.isList && stopAtNonListContent) {
                    stopDown = true;
                }
            }
        }

        if (stopUp && stopDown) break;
    }

    return null;
}

export function getSourceListBase(
    lines: string[],
    parseLineWithQuote: (line: string) => ParsedLine
): { indentWidth: number; indentRaw: string } | null {
    for (const line of lines) {
        const parsed = parseLineWithQuote(line);
        if (parsed.isListItem) {
            return { indentWidth: parsed.indentWidth, indentRaw: parsed.indentRaw };
        }
    }
    return null;
}

export interface ListIndentPlan {
    listContextLineNumber: number;
    targetContext: ListContext;
    indentSample: string;
    indentUnitWidth: number;
    indentDelta: number;
    targetIndentWidth: number;
    sourceBaseIndentWidth: number;
}

export function computeListIndentPlan(params: {
    doc: DocLike;
    sourceBase: { indentWidth: number; indentRaw: string };
    targetLineNumber: number;
    parseLineWithQuote: (line: string) => ParsedLine;
    getIndentUnitWidth: (sample: string) => number;
    getListContext?: (doc: DocLike, lineNumber: number) => ListContext;
    listContextLineNumberOverride?: number;
    listIndentDeltaOverride?: number;
    listTargetIndentWidthOverride?: number;
}): ListIndentPlan {
    const {
        doc,
        sourceBase,
        targetLineNumber,
        parseLineWithQuote,
        getIndentUnitWidth: getIndentUnitWidthFn,
        getListContext: getListContextFn,
        listContextLineNumberOverride,
        listIndentDeltaOverride,
        listTargetIndentWidthOverride,
    } = params;

    const listContextLineNumber = listContextLineNumberOverride ?? targetLineNumber;
    const targetContext = getListContextFn
        ? getListContextFn(doc, listContextLineNumber)
        : getListContextNearLine(doc, listContextLineNumber, parseLineWithQuote);
    const indentSample = targetContext ? targetContext.indentRaw : sourceBase.indentRaw;
    const indentUnitWidth = getIndentUnitWidthFn(indentSample || sourceBase.indentRaw);
    const indentDeltaBase = (targetContext ? targetContext.indentWidth : 0) - sourceBase.indentWidth;
    let indentDelta = indentDeltaBase + ((listIndentDeltaOverride ?? 0) * indentUnitWidth);

    if (typeof listTargetIndentWidthOverride === 'number') {
        indentDelta = listTargetIndentWidthOverride - sourceBase.indentWidth;
    }

    return {
        listContextLineNumber,
        targetContext,
        indentSample,
        indentUnitWidth,
        indentDelta,
        targetIndentWidth: sourceBase.indentWidth + indentDelta,
        sourceBaseIndentWidth: sourceBase.indentWidth,
    };
}

export function adjustListToTargetContext(params: {
    doc: DocLike;
    sourceContent: string;
    targetLineNumber: number;
    parseLineWithQuote: (line: string) => ParsedLine;
    getIndentUnitWidth: (sample: string) => number;
    buildIndentStringFromSample: (sample: string, width: number) => string;
    buildTargetMarker: (target: ListContextValue, source: { markerType: MarkerType; marker: string }) => string;
    markerConversionScope?: MarkerConversionScope;
    getListContext?: (doc: DocLike, lineNumber: number) => ListContext;
    listContextLineNumberOverride?: number;
    listIndentDeltaOverride?: number;
    listTargetIndentWidthOverride?: number;
}): string {
    const {
        doc,
        sourceContent,
        targetLineNumber,
        parseLineWithQuote,
        getIndentUnitWidth: getIndentUnitWidthFn,
        buildIndentStringFromSample: buildIndentStringFromSampleFn,
        buildTargetMarker: buildTargetMarkerFn,
        markerConversionScope,
        getListContext: getListContextFn,
        listContextLineNumberOverride,
        listIndentDeltaOverride,
        listTargetIndentWidthOverride,
    } = params;

    const lines = sourceContent.split('\n');
    const sourceBase = getSourceListBase(lines, parseLineWithQuote);
    if (!sourceBase) return sourceContent;
    const indentPlan = computeListIndentPlan({
        doc,
        sourceBase,
        targetLineNumber,
        parseLineWithQuote,
        getIndentUnitWidth: getIndentUnitWidthFn,
        getListContext: getListContextFn,
        listContextLineNumberOverride,
        listIndentDeltaOverride,
        listTargetIndentWidthOverride,
    });
    const markerScope = markerConversionScope ?? 'root';

    const quoteAdjustedLines = lines.map((line) => {
        if (line.trim().length === 0) return line;
        const parsed = parseLineWithQuote(line);
        const rest = parsed.rest;
        if (!parsed.isListItem) {
            if (parsed.indentWidth >= sourceBase.indentWidth) {
                const newIndent = buildIndentStringFromSampleFn(
                    indentPlan.indentSample,
                    parsed.indentWidth + indentPlan.indentDelta
                );
                return `${parsed.quotePrefix}${newIndent}${rest.slice(parsed.indentRaw.length)}`;
            }
            return line;
        }

        const newIndent = buildIndentStringFromSampleFn(
            indentPlan.indentSample,
            parsed.indentWidth + indentPlan.indentDelta
        );
        let marker = parsed.marker;
        const shouldConvertMarker = markerScope === 'all'
            ? !!indentPlan.targetContext
            : !!indentPlan.targetContext && parsed.indentWidth === sourceBase.indentWidth;
        if (shouldConvertMarker && indentPlan.targetContext) {
            marker = buildTargetMarkerFn(indentPlan.targetContext, parsed);
        }
        return `${parsed.quotePrefix}${newIndent}${marker}${parsed.content}`;
    });

    return quoteAdjustedLines.join('\n');
}
