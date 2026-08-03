import type { EditorView } from '@codemirror/view';
import type { App, MarkdownView, WorkspaceLeaf } from 'obsidian';

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
