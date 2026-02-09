export type MarkerType = 'ordered' | 'unordered' | 'task';

export interface ListContextValue {
    indentWidth: number;
    indentRaw: string;
    markerType: MarkerType;
}

export type ListContext = ListContextValue | null;

export interface ParsedListLine {
    isListItem: boolean;
    indentRaw: string;
    indentWidth: number;
    marker: string;
    markerType: MarkerType;
    content: string;
}

export interface ParsedLine {
    text: string;
    quotePrefix: string;
    quoteDepth: number;
    rest: string;
    isListItem: boolean;
    indentRaw: string;
    indentWidth: number;
    marker: string;
    markerType: MarkerType;
    content: string;
}

export interface DocLineLike {
    text: string;
    from?: number;
    to?: number;
}

export interface DocLike {
    lines: number;
    line: (n: number) => DocLineLike;
}

export interface DocLineWithRange extends DocLineLike {
    from: number;
    to: number;
}

export interface DocLikeWithRange extends DocLike {
    length: number;
    line: (n: number) => DocLineWithRange;
    sliceString: (from: number, to: number) => string;
}

export interface StateWithDoc {
    doc: DocLike;
}

export type DropTargetInfo = {
    lineNumber: number;
    indicatorY: number;
    listContextLineNumber?: number;
    listIndentDelta?: number;
    listTargetIndentWidth?: number;
    lineRect?: { left: number; width: number };
    highlightRect?: { top: number; left: number; width: number; height: number };
};
