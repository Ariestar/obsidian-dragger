// @vitest-environment jsdom

import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    collectEmbedRoots,
    findEmbedElementAtPoint,
} from './embed-probe';

const originalElementFromPoint = (document as Document & {
    elementFromPoint?: (x: number, y: number) => Element | null;
}).elementFromPoint;

function createRect(left: number, top: number, width: number, height: number): DOMRect {
    return {
        left,
        top,
        right: left + width,
        bottom: top + height,
        width,
        height,
        x: left,
        y: top,
        toJSON: () => ({}),
    };
}

afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        writable: true,
        value: originalElementFromPoint,
    });
});

describe('embed-hit', () => {
    it('normalizes direct hit to .cm-embed-block root by default', () => {
        const root = document.createElement('div');
        root.className = 'cm-editor';
        const embedRoot = document.createElement('div');
        embedRoot.className = 'cm-embed-block';
        const child = document.createElement('div');
        child.className = 'cm-callout';
        embedRoot.appendChild(child);
        root.appendChild(embedRoot);
        document.body.appendChild(root);

        Object.defineProperty(document, 'elementFromPoint', {
            configurable: true,
            writable: true,
            value: vi.fn(() => child),
        });

        const view = { dom: root } as unknown as EditorView;
        const hit = findEmbedElementAtPoint(view, 50, 20);
        expect(hit).toBe(embedRoot);
    });

    it('returns null when direct embed hit misses', () => {
        const root = document.createElement('div');
        root.className = 'cm-editor';
        const embedA = document.createElement('div');
        embedA.className = 'cm-callout';
        const embedB = document.createElement('div');
        embedB.className = 'cm-callout';
        root.append(embedA, embedB);
        document.body.appendChild(root);

        Object.defineProperty(root, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(0, 0, 300, 200),
        });
        Object.defineProperty(embedA, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(50, 10, 50, 20),
        });
        Object.defineProperty(embedB, 'getBoundingClientRect', {
            configurable: true,
            value: () => createRect(50, 40, 50, 20),
        });
        Object.defineProperty(document, 'elementFromPoint', {
            configurable: true,
            writable: true,
            value: vi.fn(() => null),
        });

        const view = { dom: root } as unknown as EditorView;
        expect(findEmbedElementAtPoint(view, 45, 45)).toBeNull();
    });

    it('collectEmbedRoots de-duplicates normalized embed roots', () => {
        const root = document.createElement('div');
        root.className = 'cm-editor';
        const embedRoot = document.createElement('div');
        embedRoot.className = 'cm-embed-block';
        const child = document.createElement('div');
        child.className = 'cm-callout';
        embedRoot.appendChild(child);
        root.appendChild(embedRoot);
        document.body.appendChild(root);

        const view = { dom: root } as unknown as EditorView;
        const embeds = collectEmbedRoots(view, { normalizeToEmbedRoot: true });
        expect(embeds).toHaveLength(1);
        expect(embeds[0]).toBe(embedRoot);
    });
});
