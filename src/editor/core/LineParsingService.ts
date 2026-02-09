import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { DocLike, ParsedLine } from './protocol-types';
import {
    buildIndentStringFromSample,
    getIndentUnitWidth,
    getIndentUnitWidthForDoc,
    normalizeTabSize,
    parseLineWithQuote,
} from '../utils/indent-utils';

export class LineParsingService {
    constructor(private readonly view: EditorView) { }

    getTabSize(state?: EditorState): number {
        return normalizeTabSize((state ?? this.view.state).facet(EditorState.tabSize));
    }

    parseLine(line: string, state?: EditorState): ParsedLine {
        return parseLineWithQuote(line, this.getTabSize(state));
    }

    getIndentUnitWidth(sample: string, state?: EditorState): number {
        return getIndentUnitWidth(sample, this.getTabSize(state));
    }

    getIndentUnitWidthForDoc(doc: DocLike, state?: EditorState): number {
        const activeState = state ?? this.view.state;
        return getIndentUnitWidthForDoc(
            doc,
            (line) => this.parseLine(line, activeState),
            this.getTabSize(activeState)
        );
    }

    buildIndentStringFromSample(sample: string, width: number, state?: EditorState): string {
        return buildIndentStringFromSample(sample, width, this.getTabSize(state));
    }
}
