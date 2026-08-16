import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import { FILE_EXPLORER_NOTE_SELECTOR, INTERNAL_LINK_SELECTOR } from '../../shared/dom-selectors';

export function resolveElementTarget(element: Element, sourceFile: TFile, app: App): TFile | null {
    if (element.matches(INTERNAL_LINK_SELECTOR)) {
        const raw = element.getAttribute('data-href') ?? element.getAttribute('href');
        const linkpath = raw ? normalizeLinkpath(raw) : null;
        if (!linkpath) return null;
        return markdownFile(app.metadataCache.getFirstLinkpathDest(linkpath, sourceFile.path));
    }

    if (element.matches(FILE_EXPLORER_NOTE_SELECTOR)) {
        const path = element.getAttribute('data-path');
        if (!path) return null;
        return markdownFile(app.vault.getAbstractFileByPath(path));
    }

    return null;
}

function normalizeLinkpath(raw: string): string | null {
    try {
        const decoded = decodeURIComponent(raw);
        const withoutAlias = decoded.split('|', 1)[0];
        const withoutSubpath = withoutAlias.split('#', 1)[0].trim();
        return withoutSubpath || null;
    } catch {
        return null;
    }
}

function markdownFile(file: unknown): TFile | null {
    return file instanceof TFile && file.extension.toLowerCase() === 'md' ? file : null;
}
