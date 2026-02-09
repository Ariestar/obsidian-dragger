import { EditorState } from '@codemirror/state';
import { parseLineWithQuote } from './line-parsing';
import { DocLike, StateWithDoc } from './protocol-types';
import { isHorizontalRuleLine, isCalloutLine } from './line-type-guards';
import { nowMs } from '../utils/timing';
import { normalizeTabSize } from '../utils/indent-utils';

export interface LineMeta {
    isEmpty: boolean;
    isList: boolean;
    isQuote: boolean;
    isCallout: boolean;
    isTable: boolean;
    isHr: boolean;
    indentWidth: number;
    quoteDepth: number;
}

export interface LineMap {
    doc: DocLike;
    lineMeta: LineMeta[];
    prevNonEmpty: Int32Array;
    nextNonEmpty: Int32Array;
    prevListLine: Int32Array;
    listParentLine: Int32Array;
    listSubtreeEndLine: Int32Array;
    tabSize: number;
}

type LineMapPerfDurationKey = 'line_map_get' | 'line_map_build';

let lineMapPerfRecorder: ((key: LineMapPerfDurationKey, durationMs: number) => void) | null = null;

const lineMapCache = new WeakMap<object, Map<number, LineMap>>();

type LineMapChangeDescLike = {
    iterChanges: (
        callback: (
            fromA: number,
            toA: number,
            fromB: number,
            toB: number,
            inserted: unknown
        ) => void
    ) => void;
};

type DocLikeWithOffsets = DocLike & {
    length: number;
    lineAt: (pos: number) => { number: number };
};

const EMPTY_LINE_META: LineMeta = {
    isEmpty: true,
    isList: false,
    isQuote: false,
    isCallout: false,
    isTable: false,
    isHr: false,
    indentWidth: 0,
    quoteDepth: 0,
};

function recordLineMapPerf(key: LineMapPerfDurationKey, durationMs: number): void {
    if (!lineMapPerfRecorder) return;
    if (!isFinite(durationMs) || durationMs < 0) return;
    lineMapPerfRecorder(key, durationMs);
}

export function setLineMapPerfRecorder(
    recorder: ((key: LineMapPerfDurationKey, durationMs: number) => void) | null
): void {
    lineMapPerfRecorder = recorder;
}

function resolveStateTabSize(state: unknown): number {
    if (!state || typeof state !== 'object') return 4;
    try {
        const withFacet = state as EditorState;
        if (typeof withFacet.facet === 'function') {
            return normalizeTabSize(withFacet.facet(EditorState.tabSize));
        }
    } catch {
        // ignore tab size extraction failures on non-EditorState stubs
    }
    return 4;
}

function createLineMetaFromText(text: string, tabSize: number): LineMeta {
    const parsed = parseLineWithQuote(text, tabSize);
    const isEmpty = text.trim().length === 0;
    return {
        isEmpty,
        isList: parsed.isListItem,
        isQuote: parsed.quoteDepth > 0,
        isCallout: isCalloutLine(text),
        isTable: text.trimStart().startsWith('|'),
        isHr: isHorizontalRuleLine(text),
        indentWidth: parsed.indentWidth,
        quoteDepth: parsed.quoteDepth,
    };
}

function createLineMetaArray(doc: DocLike, tabSize: number): LineMeta[] {
    const lineMeta: LineMeta[] = new Array(doc.lines + 1);
    lineMeta[0] = EMPTY_LINE_META;
    for (let i = 1; i <= doc.lines; i++) {
        lineMeta[i] = createLineMetaFromText(doc.line(i).text ?? '', tabSize);
    }
    return lineMeta;
}

function buildLineMapIndexes(
    lineMeta: LineMeta[],
    totalLines: number
): {
    prevNonEmpty: Int32Array;
    nextNonEmpty: Int32Array;
    prevListLine: Int32Array;
    listParentLine: Int32Array;
    listSubtreeEndLine: Int32Array;
} {
    const prevNonEmpty = new Int32Array(totalLines + 2);
    const nextNonEmpty = new Int32Array(totalLines + 2);
    const prevListLine = new Int32Array(totalLines + 2);
    const listParentLine = new Int32Array(totalLines + 2);
    const listSubtreeEndLine = new Int32Array(totalLines + 2);

    let previous = 0;
    let previousList = 0;
    const listStack: number[] = [];
    for (let i = 1; i <= totalLines; i++) {
        const meta = lineMeta[i] ?? EMPTY_LINE_META;
        if (!meta.isEmpty) {
            previous = i;
        }
        prevNonEmpty[i] = previous;

        if (meta.isEmpty) {
            prevListLine[i] = previousList;
            continue;
        }

        while (listStack.length > 0) {
            const topLine = listStack[listStack.length - 1];
            const topMeta = lineMeta[topLine] ?? EMPTY_LINE_META;
            if (meta.indentWidth > topMeta.indentWidth) {
                break;
            }
            listStack.pop();
        }

        for (const ancestorLine of listStack) {
            listSubtreeEndLine[ancestorLine] = i;
        }

        prevListLine[i] = previousList;
        if (!meta.isList) {
            continue;
        }
        listParentLine[i] = listStack.length > 0
            ? listStack[listStack.length - 1]
            : 0;
        listSubtreeEndLine[i] = i;
        listStack.push(i);
        previousList = i;
    }

    let next = 0;
    for (let i = totalLines; i >= 1; i--) {
        const meta = lineMeta[i] ?? EMPTY_LINE_META;
        if (!meta.isEmpty) {
            next = i;
        }
        nextNonEmpty[i] = next;
    }

    return {
        prevNonEmpty,
        nextNonEmpty,
        prevListLine,
        listParentLine,
        listSubtreeEndLine,
    };
}

function createLineMapFromMeta(doc: DocLike, tabSize: number, lineMeta: LineMeta[]): LineMap {
    const indexes = buildLineMapIndexes(lineMeta, doc.lines);
    return {
        doc,
        lineMeta,
        prevNonEmpty: indexes.prevNonEmpty,
        nextNonEmpty: indexes.nextNonEmpty,
        prevListLine: indexes.prevListLine,
        listParentLine: indexes.listParentLine,
        listSubtreeEndLine: indexes.listSubtreeEndLine,
        tabSize,
    };
}

export function buildLineMap(
    state: StateWithDoc,
    options?: { tabSize?: number }
): LineMap {
    const doc = state.doc;
    const tabSize = normalizeTabSize(options?.tabSize ?? resolveStateTabSize(state));
    const lineMeta = createLineMetaArray(doc, tabSize);
    return createLineMapFromMeta(doc, tabSize, lineMeta);
}

function getCachedLineMapForDoc(doc: DocLike | null | undefined, tabSize: number): LineMap | null {
    if (!doc || typeof doc !== 'object') return null;
    return lineMapCache.get(doc as object)?.get(tabSize) ?? null;
}

function setCachedLineMapForDoc(doc: DocLike, tabSize: number, lineMap: LineMap): void {
    const byTabSize = lineMapCache.get(doc as object);
    if (byTabSize) {
        byTabSize.set(tabSize, lineMap);
        return;
    }
    lineMapCache.set(doc as object, new Map<number, LineMap>([[tabSize, lineMap]]));
}

function clampDocPos(doc: DocLikeWithOffsets, pos: number): number {
    if (pos <= 0) return 0;
    if (pos >= doc.length) return doc.length;
    return pos;
}

function lineNumberAtPosInclusive(doc: DocLikeWithOffsets, pos: number): number {
    const clamped = clampDocPos(doc, pos);
    return doc.lineAt(clamped).number;
}

function lineNumberAtPosExclusive(doc: DocLikeWithOffsets, fromPos: number, toPos: number): number {
    if (toPos <= fromPos) {
        return lineNumberAtPosInclusive(doc, fromPos);
    }
    return lineNumberAtPosInclusive(doc, Math.max(fromPos, toPos - 1));
}

function isLineMetaEqual(a: LineMeta, b: LineMeta): boolean {
    return a.isEmpty === b.isEmpty
        && a.isList === b.isList
        && a.isQuote === b.isQuote
        && a.isCallout === b.isCallout
        && a.isTable === b.isTable
        && a.isHr === b.isHr
        && a.indentWidth === b.indentWidth
        && a.quoteDepth === b.quoteDepth;
}

function collectChangedLinePairs(
    oldDoc: DocLikeWithOffsets,
    newDoc: DocLikeWithOffsets,
    changes: LineMapChangeDescLike
): Array<{ oldLine: number; newLine: number }> | null {
    if (oldDoc.lines !== newDoc.lines) return null;
    const pairs: Array<{ oldLine: number; newLine: number }> = [];
    let valid = true;
    changes.iterChanges((fromA, toA, fromB, toB) => {
        if (!valid) return;
        const oldStartLine = lineNumberAtPosInclusive(oldDoc, fromA);
        const oldEndLine = lineNumberAtPosExclusive(oldDoc, fromA, toA);
        const newStartLine = lineNumberAtPosInclusive(newDoc, fromB);
        const newEndLine = lineNumberAtPosExclusive(newDoc, fromB, toB);
        const oldCount = oldEndLine - oldStartLine + 1;
        const newCount = newEndLine - newStartLine + 1;
        if (oldCount !== newCount) {
            valid = false;
            return;
        }
        for (let i = 0; i < oldCount; i++) {
            pairs.push({
                oldLine: oldStartLine + i,
                newLine: newStartLine + i,
            });
        }
    });
    if (!valid) return null;
    return pairs;
}

function tryReuseUnchangedIndexes(
    previousLineMap: LineMap,
    nextState: StateWithDoc,
    changes: LineMapChangeDescLike,
    tabSize: number
): LineMap | null {
    const oldDoc = previousLineMap.doc as Partial<DocLikeWithOffsets>;
    const newDoc = nextState.doc as Partial<DocLikeWithOffsets>;
    if (
        typeof oldDoc.lineAt !== 'function'
        || typeof oldDoc.length !== 'number'
        || typeof newDoc.lineAt !== 'function'
        || typeof newDoc.length !== 'number'
    ) {
        return null;
    }
    const oldDocTyped = oldDoc as DocLikeWithOffsets;
    const newDocTyped = newDoc as DocLikeWithOffsets;
    const pairs = collectChangedLinePairs(oldDocTyped, newDocTyped, changes);
    if (!pairs) return null;

    const checkedNewLines = new Set<number>();
    for (const pair of pairs) {
        if (checkedNewLines.has(pair.newLine)) continue;
        checkedNewLines.add(pair.newLine);
        const previousMeta = previousLineMap.lineMeta[pair.oldLine] ?? EMPTY_LINE_META;
        const nextMeta = createLineMetaFromText(newDocTyped.line(pair.newLine).text ?? '', tabSize);
        if (!isLineMetaEqual(previousMeta, nextMeta)) {
            return null;
        }
    }

    return {
        doc: nextState.doc,
        lineMeta: previousLineMap.lineMeta,
        prevNonEmpty: previousLineMap.prevNonEmpty,
        nextNonEmpty: previousLineMap.nextNonEmpty,
        prevListLine: previousLineMap.prevListLine,
        listParentLine: previousLineMap.listParentLine,
        listSubtreeEndLine: previousLineMap.listSubtreeEndLine,
        tabSize,
    };
}

function buildLineMapIncremental(
    previousLineMap: LineMap,
    nextState: StateWithDoc,
    changes: LineMapChangeDescLike,
    tabSize: number
): LineMap | null {
    const oldDoc = previousLineMap.doc as DocLikeWithOffsets;
    const newDoc = nextState.doc as DocLikeWithOffsets;
    const lineMeta: LineMeta[] = new Array(newDoc.lines + 1);
    lineMeta[0] = EMPTY_LINE_META;

    let oldCursorLine = 1;
    let newCursorLine = 1;
    let failed = false;

    const copyUnchangedSegment = (
        oldStartLine: number,
        oldEndLine: number,
        newStartLine: number,
        newEndLine: number
    ): void => {
        if (oldEndLine < oldStartLine && newEndLine < newStartLine) return;
        const oldCount = oldEndLine >= oldStartLine ? (oldEndLine - oldStartLine + 1) : 0;
        const newCount = newEndLine >= newStartLine ? (newEndLine - newStartLine + 1) : 0;
        if (oldCount !== newCount) {
            failed = true;
            return;
        }
        for (let i = 0; i < oldCount; i++) {
            lineMeta[newStartLine + i] = previousLineMap.lineMeta[oldStartLine + i] ?? EMPTY_LINE_META;
        }
    };

    const parseChangedSegment = (newStartLine: number, newEndLine: number): void => {
        if (newEndLine < newStartLine) return;
        for (let line = newStartLine; line <= newEndLine; line++) {
            const text = newDoc.line(line).text ?? '';
            lineMeta[line] = createLineMetaFromText(text, tabSize);
        }
    };

    changes.iterChanges((fromA, toA, fromB, toB) => {
        if (failed) return;
        const oldChangedStartLine = lineNumberAtPosInclusive(oldDoc, fromA);
        const oldChangedEndLine = lineNumberAtPosExclusive(oldDoc, fromA, toA);
        const newChangedStartLine = lineNumberAtPosInclusive(newDoc, fromB);
        const newChangedEndLine = lineNumberAtPosExclusive(newDoc, fromB, toB);

        copyUnchangedSegment(
            oldCursorLine,
            oldChangedStartLine - 1,
            newCursorLine,
            newChangedStartLine - 1
        );
        if (failed) return;

        parseChangedSegment(newChangedStartLine, newChangedEndLine);

        oldCursorLine = oldChangedEndLine + 1;
        newCursorLine = newChangedEndLine + 1;
    });

    if (failed) return null;

    copyUnchangedSegment(oldCursorLine, oldDoc.lines, newCursorLine, newDoc.lines);
    if (failed) return null;

    for (let line = 1; line <= newDoc.lines; line++) {
        if (lineMeta[line]) continue;
        const text = newDoc.line(line).text ?? '';
        lineMeta[line] = createLineMetaFromText(text, tabSize);
    }

    return createLineMapFromMeta(newDoc, tabSize, lineMeta);
}

export function primeLineMapFromTransition(params: {
    previousState: StateWithDoc;
    nextState: StateWithDoc;
    changes: LineMapChangeDescLike;
    tabSize?: number;
}): LineMap {
    const startedAt = nowMs();
    const tabSize = normalizeTabSize(
        params.tabSize
        ?? resolveStateTabSize(params.nextState)
    );
    const previousDoc = params.previousState.doc as Partial<DocLikeWithOffsets>;
    const nextDoc = params.nextState.doc as Partial<DocLikeWithOffsets>;
    const hasOffsetHelpers = typeof previousDoc.lineAt === 'function'
        && typeof previousDoc.length === 'number'
        && typeof nextDoc.lineAt === 'function'
        && typeof nextDoc.length === 'number';
    if (!hasOffsetHelpers) {
        const rebuildStartedAt = nowMs();
        const rebuilt = buildLineMap(params.nextState, { tabSize });
        recordLineMapPerf('line_map_build', nowMs() - rebuildStartedAt);
        setCachedLineMapForDoc(params.nextState.doc, tabSize, rebuilt);
        recordLineMapPerf('line_map_get', nowMs() - startedAt);
        return rebuilt;
    }
    const previousCached = getCachedLineMapForDoc(params.previousState.doc, tabSize)
        ?? buildLineMap(params.previousState, { tabSize });
    const fastReuseStartedAt = nowMs();
    const fastReused = tryReuseUnchangedIndexes(previousCached, params.nextState, params.changes, tabSize);
    if (fastReused) {
        recordLineMapPerf('line_map_build', nowMs() - fastReuseStartedAt);
        setCachedLineMapForDoc(params.nextState.doc, tabSize, fastReused);
        recordLineMapPerf('line_map_get', nowMs() - startedAt);
        return fastReused;
    }
    const incrementalStartedAt = nowMs();
    const incremental = buildLineMapIncremental(previousCached, params.nextState, params.changes, tabSize);
    let result: LineMap;
    if (incremental) {
        result = incremental;
        recordLineMapPerf('line_map_build', nowMs() - incrementalStartedAt);
    } else {
        const rebuildStartedAt = nowMs();
        result = buildLineMap(params.nextState, { tabSize });
        recordLineMapPerf('line_map_build', nowMs() - rebuildStartedAt);
    }
    setCachedLineMapForDoc(params.nextState.doc, tabSize, result);
    recordLineMapPerf('line_map_get', nowMs() - startedAt);
    return result;
}

export function getLineMap(
    state: StateWithDoc,
    options?: { tabSize?: number }
): LineMap {
    const startedAt = nowMs();
    const tabSize = normalizeTabSize(options?.tabSize ?? resolveStateTabSize(state));
    if (!state || typeof state !== 'object') {
        const buildStartedAt = nowMs();
        const built = buildLineMap(state, { tabSize });
        recordLineMapPerf('line_map_build', nowMs() - buildStartedAt);
        recordLineMapPerf('line_map_get', nowMs() - startedAt);
        return built;
    }
    const doc = state.doc;
    if (!doc || typeof doc !== 'object') {
        const buildStartedAt = nowMs();
        const built = buildLineMap(state, { tabSize });
        recordLineMapPerf('line_map_build', nowMs() - buildStartedAt);
        recordLineMapPerf('line_map_get', nowMs() - startedAt);
        return built;
    }
    const cached = getCachedLineMapForDoc(doc, tabSize);
    if (cached) {
        recordLineMapPerf('line_map_get', nowMs() - startedAt);
        return cached;
    }

    const buildStartedAt = nowMs();
    const built = buildLineMap(state, { tabSize });
    recordLineMapPerf('line_map_build', nowMs() - buildStartedAt);
    setCachedLineMapForDoc(doc, tabSize, built);
    recordLineMapPerf('line_map_get', nowMs() - startedAt);
    return built;
}

export function peekCachedLineMap(
    state: StateWithDoc,
    options?: { tabSize?: number }
): LineMap | null {
    const tabSize = normalizeTabSize(options?.tabSize ?? resolveStateTabSize(state));
    if (!state || typeof state !== 'object') return null;
    const doc = state.doc;
    if (!doc || typeof doc !== 'object') return null;
    return getCachedLineMapForDoc(doc, tabSize);
}

export function getLineMetaAt(lineMap: LineMap, lineNumber: number): LineMeta | null {
    if (lineNumber < 1 || lineNumber >= lineMap.lineMeta.length) return null;
    return lineMap.lineMeta[lineNumber] ?? null;
}

export function getNearestListLineAtOrBefore(lineMap: LineMap, lineNumber: number): number | null {
    if (lineMap.doc.lines <= 0) return null;
    const clamped = Math.max(1, Math.min(lineMap.doc.lines, lineNumber));
    const meta = getLineMetaAt(lineMap, clamped);
    if (meta?.isList) return clamped;
    const prevListLine = lineMap.prevListLine[clamped];
    return prevListLine > 0 ? prevListLine : null;
}
