export type MarkerType = 'ordered' | 'unordered' | 'task';

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

export interface StateWithDoc {
    doc: DocLike;
}
