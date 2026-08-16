import type { EditorView } from '@codemirror/view';
import type { App, MarkdownView, TFile, WorkspaceLeaf } from 'obsidian';

export function getActiveMarkdownView(app: App): MarkdownView | null {
    const leaf: WorkspaceLeaf | null = app.workspace.getMostRecentLeaf() ?? null;
    if (!leaf) return null;
    const view = leaf.view;
    return view.getViewType?.() === 'markdown' ? (view as MarkdownView) : null;
}

type MarkdownViewWithCm = MarkdownView & {
    editor?: {
        cm?: EditorView;
    };
};

export function getCodeMirrorView(markdownView: MarkdownView): EditorView | null {
    const maybeView = (markdownView as MarkdownViewWithCm).editor?.cm;
    return maybeView ?? null;
}

export function getMarkdownFileForCodeMirror(app: App, editorView: EditorView): TFile | null {
    for (const leaf of app.workspace.getLeavesOfType('markdown')) {
        if (leaf.view.getViewType?.() !== 'markdown') continue;
        const markdownView = leaf.view as MarkdownView;
        if (getCodeMirrorView(markdownView) === editorView) return markdownView.file ?? null;
    }
    return null;
}

export function getCodeMirrorViewForFile(app: App, file: TFile): EditorView | null {
    for (const leaf of app.workspace.getLeavesOfType('markdown')) {
        if (leaf.view.getViewType?.() !== 'markdown') continue;
        const markdownView = leaf.view as MarkdownView;
        if (markdownView.file?.path === file.path) return getCodeMirrorView(markdownView);
    }
    return null;
}
