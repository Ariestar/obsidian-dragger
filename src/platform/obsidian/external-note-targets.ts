import { Text } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { applyCommit } from 'md-dragger/adapter/codemirror';
import { type BlockSelection, type Doc, type DocEdit, type DropPosition, rebaseAppendChange } from 'md-dragger/domain';
import type { Point } from 'md-dragger/runtime';
import type { App, TFile } from 'obsidian';
import {
    EXTERNAL_TARGET_ACTIVE_CLASS,
    FILE_EXPLORER_NOTE_SELECTOR,
    INTERNAL_LINK_SELECTOR,
} from '../../shared/dom-selectors';
import { resolveElementTarget } from './note-drop-target';

type Snapshot = {
    file: TFile;
    doc: Doc;
    text: string;
};

export type ExternalNoteTargetService = {
    resolve(point: Point, context: { selection: BlockSelection }): DropPosition | null | undefined;
    apply(edits: DocEdit[]): Promise<void> | void;
    clear(): void;
    destroy(): void;
};

export type ExternalNoteTargetDependencies = {
    app: App;
    sourceFile(): TFile | null;
    viewForFile(file: TFile): EditorView | null;
    elementAtPoint(point: Point): Element | null;
    linkpathAtPoint(point: Point): string | null;
    applyLiveEdits?: (edits: DocEdit[]) => void;
};

export function createExternalNoteTargets(deps: ExternalNoteTargetDependencies): ExternalNoteTargetService {
    return new ExternalNoteTargets(deps);
}

class ExternalNoteTargets implements ExternalNoteTargetService {
    private activeElement: Element | null = null;
    private activeFile: TFile | null = null;
    private snapshot: Snapshot | null = null;
    private requestToken = 0;
    private loading = false;
    private destroyed = false;
    private readonly snapshotByDoc = new WeakMap<Doc, Snapshot>();

    constructor(private readonly deps: ExternalNoteTargetDependencies) {}

    resolve(point: Point, _context: { selection: BlockSelection }): DropPosition | null | undefined {
        if (this.destroyed) return undefined;
        const hit = this.deps.elementAtPoint(point);
        const element = hit?.closest(`${INTERNAL_LINK_SELECTOR}, ${FILE_EXPLORER_NOTE_SELECTOR}`) ?? null;
        if (!element) {
            this.clear();
            return undefined;
        }

        const sourceFile = this.deps.sourceFile();
        const file = sourceFile
            ? resolveElementTarget(element, sourceFile, this.deps.app, this.deps.linkpathAtPoint(point))
            : null;
        if (!file) {
            this.clear();
            return null;
        }

        const liveView = this.deps.viewForFile(file);
        if (liveView) {
            this.activate(element, file);
            this.snapshot = null;
            this.loading = false;
            return { doc: liveView.state.doc, line: liveView.state.doc.lines + 1, parent: null };
        }

        if (this.activeElement !== element || this.activeFile?.path !== file.path) {
            this.beginSnapshotLoad(element, file);
            return null;
        }
        if (this.snapshot) {
            this.markValid(element);
            return { doc: this.snapshot.doc, line: this.snapshot.doc.lines + 1, parent: null };
        }
        if (!this.loading) this.beginSnapshotLoad(element, file);
        return null;
    }

    async apply(edits: DocEdit[]): Promise<void> {
        const externalEdits = edits.filter((edit) => this.snapshotByDoc.has(edit.doc));
        if (externalEdits.length === 0) {
            (this.deps.applyLiveEdits ?? applyCommit)(edits);
            return;
        }
        if (externalEdits.length !== 1) throw new Error('Expected one external destination edit');

        const destinationEdit = externalEdits[0];
        const snapshot = this.snapshotByDoc.get(destinationEdit.doc);
        if (!snapshot) throw new Error('External destination snapshot is unavailable');
        const appendChange = destinationEdit.changes.find(
            (change) =>
                change.from === snapshot.doc.length && change.to === snapshot.doc.length && change.insert.length > 0,
        );
        if (!appendChange) throw new Error('External destination edit is not an append');

        await this.deps.app.vault.process(snapshot.file, (current) => {
            if (current === snapshot.text) return applyTextChanges(current, destinationEdit);
            const currentDoc = Text.of(current.split('\n'));
            const rebased = rebaseAppendChange(snapshot.doc, appendChange, currentDoc);
            if (!rebased) throw new Error('External destination append could not be rebased');
            return current.slice(0, rebased.pos) + rebased.text + current.slice(rebased.pos);
        });

        const liveEdits = edits.filter((edit) => edit !== destinationEdit);
        (this.deps.applyLiveEdits ?? applyCommit)(liveEdits);
    }

    clear(): void {
        this.requestToken += 1;
        this.activeElement?.classList.remove(EXTERNAL_TARGET_ACTIVE_CLASS);
        this.activeElement = null;
        this.activeFile = null;
        this.snapshot = null;
        this.loading = false;
    }

    destroy(): void {
        this.clear();
        this.destroyed = true;
    }

    private activate(element: Element, file: TFile): void {
        if (this.activeElement !== element) this.activeElement?.classList.remove(EXTERNAL_TARGET_ACTIVE_CLASS);
        this.activeElement = element;
        this.activeFile = file;
        this.requestToken += 1;
        this.markValid(element);
    }

    private markValid(element: Element): void {
        element.classList.add(EXTERNAL_TARGET_ACTIVE_CLASS);
    }

    private beginSnapshotLoad(element: Element, file: TFile): void {
        this.activeElement?.classList.remove(EXTERNAL_TARGET_ACTIVE_CLASS);
        this.activeElement = element;
        this.activeFile = file;
        this.snapshot = null;
        this.loading = true;
        const token = ++this.requestToken;
        void this.deps.app.vault.cachedRead(file).then(
            (text) => {
                if (this.destroyed || token !== this.requestToken) return;
                if (this.activeElement !== element || this.activeFile?.path !== file.path) return;
                const doc = Text.of(text.split('\n'));
                const snapshot = { file, doc, text };
                this.snapshot = snapshot;
                this.snapshotByDoc.set(doc, snapshot);
                this.loading = false;
                this.markValid(element);
            },
            () => {
                if (token === this.requestToken) this.loading = false;
            },
        );
    }
}

function applyTextChanges(text: string, edit: DocEdit): string {
    let result = text;
    const changes = [...edit.changes].sort((a, b) => b.from - a.from || b.to - a.to);
    for (const change of changes) {
        result = result.slice(0, change.from) + change.insert + result.slice(change.to);
    }
    return result;
}
