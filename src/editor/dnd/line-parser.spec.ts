import { describe, expect, it } from 'vitest';
import {
    getBlockquoteDepthFromLine,
    getIndentWidthFromIndentRaw,
    parseLineWithQuote,
    parseListLine,
    splitBlockquotePrefix,
} from './line-parser';

describe('line-parser', () => {
    it('parses task list lines with quote prefix', () => {
        const parsed = parseLineWithQuote('>   - [x] done', 4);
        expect(parsed.quotePrefix).toBe('> ');
        expect(parsed.isListItem).toBe(true);
        expect(parsed.markerType).toBe('task');
        expect(parsed.content).toBe('done');
    });

    it('parses ordered list markers', () => {
        const parsed = parseListLine('  12. item', 2);
        expect(parsed.isListItem).toBe(true);
        expect(parsed.markerType).toBe('ordered');
        expect(parsed.indentWidth).toBe(2);
        expect(parsed.content).toBe('item');
    });

    it('splits blockquote prefix and computes depth', () => {
        const split = splitBlockquotePrefix('> > nested');
        expect(split.prefix).toBe('> > ');
        expect(split.rest).toBe('nested');
        expect(getBlockquoteDepthFromLine('> > nested')).toBe(2);
    });

    it('computes indent width with tabs', () => {
        expect(getIndentWidthFromIndentRaw('\t  ', 4)).toBe(6);
    });
});
