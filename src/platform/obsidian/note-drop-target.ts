import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import { FILE_EXPLORER_NOTE_SELECTOR, INTERNAL_LINK_SELECTOR } from '../../shared/dom-selectors';

export function resolveElementTarget(
    element: Element,
    sourceFile: TFile,
    app: App,
    editorLinkpath?: string | null,
): TFile | null {
    if (element.matches(INTERNAL_LINK_SELECTOR)) {
        const raw = element.getAttribute('data-href') ?? element.getAttribute('href') ?? editorLinkpath;
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

/** Return the Wiki or Markdown link destination covering a line-local offset. */
export function internalLinkpathAtOffset(line: string, offset: number): string | null {
    return (
        destinationAtOffset(line, offset, /\[\[([^\]\n]+)\]\]/g, 1) ??
        destinationAtOffset(line, offset, /\[[^\]\n]*\]\(([^)\n]+)\)/g, 1)
    );
}

function destinationAtOffset(line: string, offset: number, pattern: RegExp, destinationGroup: number): string | null {
    for (const match of line.matchAll(pattern)) {
        const start = match.index;
        const end = start + match[0].length;
        if (offset >= start && offset <= end) return match[destinationGroup] ?? null;
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
