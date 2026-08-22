import type { EditorView } from '@codemirror/view';
import type { App } from 'obsidian';
import { TFile } from 'obsidian';
import { describe, expect, it } from 'vitest';
import { getCodeMirrorViewForFile, getMarkdownFileForCodeMirror } from './views';

function markdownFile(path: string): TFile {
    const file = new TFile();
    file.path = path;
    file.extension = 'md';
    return file;
}

function appWithLeaves(leaves: unknown[]): App {
    return {
        workspace: { getLeavesOfType: () => leaves },
    } as unknown as App;
}

describe('markdown CodeMirror view lookup', () => {
    it('finds the source file that owns a CodeMirror view', () => {
        const editorView = {} as EditorView;
        const file = markdownFile('Source.md');
        const app = appWithLeaves([{ view: { getViewType: () => 'markdown', file, editor: { cm: editorView } } }]);

        expect(getMarkdownFileForCodeMirror(app, editorView)).toBe(file);
    });

    it('finds an open CodeMirror view by file path', () => {
        const editorView = {} as EditorView;
        const file = markdownFile('Target.md');
        const app = appWithLeaves([{ view: { getViewType: () => 'markdown', file, editor: { cm: editorView } } }]);

        expect(getCodeMirrorViewForFile(app, file)).toBe(editorView);
        expect(getCodeMirrorViewForFile(app, markdownFile('Closed.md'))).toBeNull();
    });

    it('continues past a matching leaf without CodeMirror to find a later live view', () => {
        const editorView = {} as EditorView;
        const file = markdownFile('Target.md');
        const app = appWithLeaves([
            { view: { getViewType: () => 'markdown', file } },
            { view: { getViewType: () => 'markdown', file, editor: { cm: editorView } } },
        ]);

        expect(getCodeMirrorViewForFile(app, file)).toBe(editorView);
    });
});
