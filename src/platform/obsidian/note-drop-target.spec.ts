// @vitest-environment jsdom
import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import { describe, expect, it, vi } from 'vitest';
import { internalLinkpathAtOffset, resolveElementTarget } from './note-drop-target';

function markdownFile(path: string): TFile {
    const file = new TFile();
    file.path = path;
    file.name = path.split('/').at(-1) ?? path;
    file.basename = file.name.replace(/\.md$/i, '');
    file.extension = 'md';
    return file;
}

function appWithTarget(target: TFile | null) {
    const getFirstLinkpathDest = vi.fn(() => target);
    const getAbstractFileByPath = vi.fn(() => target);
    const app = {
        metadataCache: { getFirstLinkpathDest },
        vault: { getAbstractFileByPath },
    } as unknown as App;
    return { app, getFirstLinkpathDest, getAbstractFileByPath };
}

function internalLink(href: string): HTMLElement {
    const link = document.createElement('a');
    link.className = 'internal-link';
    link.dataset.href = href;
    return link;
}

function navFile(path: string): HTMLElement {
    const item = document.createElement('div');
    item.className = 'nav-file-title';
    item.dataset.path = path;
    return item;
}

function livePreviewLink(): HTMLElement {
    const link = document.createElement('span');
    link.className = 'cm-hmd-internal-link';
    return link;
}

describe('resolveElementTarget', () => {
    it.each([
        ['Wiki%20Folder/Target.md#Heading', 'Wiki Folder/Target.md'],
        ['Target|Alias', 'Target'],
        ['Target#^block-id', 'Target'],
    ])('normalizes internal link %s before metadata resolution', (raw, normalized) => {
        const source = markdownFile('Folder/Source.md');
        const target = markdownFile('Wiki Folder/Target.md');
        const { app, getFirstLinkpathDest } = appWithTarget(target);

        expect(resolveElementTarget(internalLink(raw), source, app)).toBe(target);
        expect(getFirstLinkpathDest).toHaveBeenCalledWith(normalized, source.path);
    });

    it('resolves a markdown File Explorer item by its vault path', () => {
        const source = markdownFile('Source.md');
        const target = markdownFile('Notes/Target.md');
        const { app, getAbstractFileByPath } = appWithTarget(target);

        expect(resolveElementTarget(navFile(target.path), source, app)).toBe(target);
        expect(getAbstractFileByPath).toHaveBeenCalledWith(target.path);
    });

    it('resolves a Live Preview link using the linkpath read from the editor document', () => {
        const source = markdownFile('Folder/Source.md');
        const target = markdownFile('Folder/Target.md');
        const { app, getFirstLinkpathDest } = appWithTarget(target);

        const resolved = resolveElementTarget(livePreviewLink(), source, app, 'Target#Heading');

        expect(resolved).toBe(target);
        expect(getFirstLinkpathDest).toHaveBeenCalledWith('Target', source.path);
    });

    it('extracts the linkpath at a Live Preview document position', () => {
        expect(internalLinkpathAtOffset('before [[Folder/Target|Alias]] after', 17)).toBe('Folder/Target|Alias');
        expect(internalLinkpathAtOffset('before [Alias](Folder/Target.md#Heading) after', 17)).toBe(
            'Folder/Target.md#Heading',
        );
    });

    it('rejects folders, non-markdown files, malformed links, and unrelated elements', () => {
        const source = markdownFile('Source.md');
        const png = markdownFile('asset.png');
        png.extension = 'png';
        const { app } = appWithTarget(png);

        expect(resolveElementTarget(navFile('asset.png'), source, app)).toBeNull();
        expect(resolveElementTarget(internalLink('%E0%A4%A'), source, app)).toBeNull();
        expect(resolveElementTarget(document.createElement('div'), source, app)).toBeNull();
    });
});
