// @vitest-environment jsdom
import { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import type { DocEdit } from 'md-dragger/domain';
import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { EXTERNAL_TARGET_ACTIVE_CLASS } from '../../shared/dom-selectors';
import { createExternalNoteTargets } from './external-note-targets';

function deferred<T>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

function markdownFile(path: string): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path.split('/').at(-1) ?? path;
    file.basename = file.name.replace(/\.md$/i, '');
    file.extension = 'md';
    return file;
}

function internalLink(href: string): HTMLElement {
    const link = document.createElement('a');
    link.className = 'internal-link';
    link.dataset.href = href;
    document.body.appendChild(link);
    return link;
}

function createHarness(options?: {
    cachedRead?: (file: TFile) => Promise<string>;
    process?: (file: TFile, update: (current: string) => string) => Promise<string>;
    viewForFile?: (file: TFile) => EditorView | null;
}) {
    const sourceFile = markdownFile('Source.md');
    const targetFile = markdownFile('Target.md');
    let pointedElement: Element | null = internalLink('Target');
    const cachedRead = vi.fn(options?.cachedRead ?? (async () => 'target'));
    const process = vi.fn(options?.process ?? (async (_file, update) => update('target')));
    const getFirstLinkpathDest = vi.fn(() => targetFile);
    const applyLiveEdits = vi.fn((_edits: DocEdit[]) => undefined);
    const app = {
        vault: { cachedRead, process },
        metadataCache: { getFirstLinkpathDest },
    } as unknown as App;
    const service = createExternalNoteTargets({
        app,
        sourceFile: () => sourceFile,
        viewForFile: options?.viewForFile ?? (() => null),
        elementAtPoint: () => pointedElement,
        applyLiveEdits,
    });
    return {
        service,
        sourceFile,
        targetFile,
        cachedRead,
        process,
        applyLiveEdits,
        setPointedElement: (element: Element | null) => {
            pointedElement = element;
        },
    };
}

const point = { x: 10, y: 20 };
const context = { selection: { blocks: [] } };
const flushPromises = () => new Promise<void>((resolve) => queueMicrotask(resolve));

beforeEach(() => {
    document.body.replaceChildren();
});

describe('external note target lifecycle', () => {
    it('is handled-invalid while loading and resolves an append position when ready', async () => {
        const read = deferred<string>();
        const harness = createHarness({ cachedRead: () => read.promise });

        expect(harness.service.resolve(point, context)).toBeNull();
        read.resolve('target\nline');
        await flushPromises();

        const position = harness.service.resolve(point, context);
        expect(position).toMatchObject({ line: 3, parent: null });
        expect(document.querySelector('.internal-link')?.classList.contains(EXTERNAL_TARGET_ACTIVE_CLASS)).toBe(true);
    });

    it('discards a completed read after the pointer leaves the target', async () => {
        const read = deferred<string>();
        const harness = createHarness({ cachedRead: () => read.promise });

        expect(harness.service.resolve(point, context)).toBeNull();
        harness.setPointedElement(null);
        expect(harness.service.resolve(point, context)).toBeUndefined();
        read.resolve('stale');
        await flushPromises();

        expect(harness.service.resolve(point, context)).toBeUndefined();
        expect(document.querySelector('.internal-link')?.classList.contains(EXTERNAL_TARGET_ACTIVE_CLASS)).toBe(false);
    });

    it('clears highlighting on clear and destroy', async () => {
        const harness = createHarness();
        harness.service.resolve(point, context);
        await flushPromises();
        harness.service.resolve(point, context);

        harness.service.clear();
        expect(document.querySelector('.internal-link')?.classList.contains(EXTERNAL_TARGET_ACTIVE_CLASS)).toBe(false);
        harness.service.destroy();
    });
});

describe('external note target commit', () => {
    it('persists a rebased destination append before applying source deletion', async () => {
        const order: string[] = [];
        let written = '';
        const harness = createHarness({
            process: async (_file, update) => {
                order.push('destination');
                written = update('newer target text');
                return written;
            },
        });
        harness.applyLiveEdits.mockImplementation(() => order.push('source'));
        harness.service.resolve(point, context);
        await flushPromises();
        const position = harness.service.resolve(point, context);
        if (!position) throw new Error('Expected loaded target position');
        const sourceDoc = Text.of(['source', '', 'keep']);
        const edits: DocEdit[] = [
            {
                doc: position.doc,
                changes: [{ from: position.doc.length, to: position.doc.length, insert: '\nsource' }],
            },
            { doc: sourceDoc, changes: [{ from: 0, to: 7, insert: '' }] },
        ];

        await harness.service.apply(edits);

        expect(written).toBe('newer target text\nsource');
        expect(order).toEqual(['destination', 'source']);
        expect(harness.applyLiveEdits).toHaveBeenCalledWith([edits[1]]);
    });

    it('leaves live source edits unapplied when destination persistence fails', async () => {
        const harness = createHarness({ process: async () => Promise.reject(new Error('disk failure')) });
        harness.service.resolve(point, context);
        await flushPromises();
        const position = harness.service.resolve(point, context);
        if (!position) throw new Error('Expected loaded target position');
        const sourceDoc = Text.of(['source']);
        const edits: DocEdit[] = [
            {
                doc: position.doc,
                changes: [{ from: position.doc.length, to: position.doc.length, insert: '\nsource' }],
            },
            { doc: sourceDoc, changes: [{ from: 0, to: sourceDoc.length, insert: '' }] },
        ];

        await expect(harness.service.apply(edits)).rejects.toThrow('disk failure');
        expect(harness.applyLiveEdits).not.toHaveBeenCalled();
    });

    it('delegates edits for live editor targets without vault persistence', () => {
        const liveDoc = Text.of(['open target']);
        const harness = createHarness({ viewForFile: () => ({ state: { doc: liveDoc } }) as EditorView });
        const position = harness.service.resolve(point, context);
        if (!position) throw new Error('Expected live target position');
        const edits: DocEdit[] = [
            { doc: liveDoc, changes: [{ from: liveDoc.length, to: liveDoc.length, insert: '\nsource' }] },
        ];

        harness.service.apply(edits);

        expect(harness.process).not.toHaveBeenCalled();
        expect(harness.applyLiveEdits).toHaveBeenCalledWith(edits);
    });
});
