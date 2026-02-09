import { EditorView } from '@codemirror/view';
import { BlockInfo, BlockType } from '../../types';
import { detectBlock, getListItemOwnRangeForHandle } from '../core/block-detector';
import {
    getHandleLeftPxForLine,
    getHandleTopPxForLine,
    viewportXToEditorLocalX,
    viewportYToEditorLocalY,
} from '../core/handle-position';
import { LINE_HANDLE_CLASS } from '../core/selectors';

type LineHandleEntry = {
    handle: HTMLElement;
    lineNumber: number;
};

export interface LineHandleManagerDeps {
    createHandleElement: (getBlockInfo: () => BlockInfo | null) => HTMLElement;
    getDraggableBlockAtLine: (lineNumber: number) => BlockInfo | null;
    shouldRenderLineHandles?: () => boolean;
}

export class LineHandleManager {
    private readonly lineHandles = new Map<number, LineHandleEntry>();
    private pendingScan = false;
    private rafId: number | null = null;
    private destroyed = false;

    constructor(
        private readonly view: EditorView,
        private readonly deps: LineHandleManagerDeps
    ) { }

    private shouldRenderLineHandles(): boolean {
        if (!this.deps.shouldRenderLineHandles) return true;
        return this.deps.shouldRenderLineHandles();
    }

    start(): void {
        this.destroyed = false;
        this.rescan();
    }

    scheduleScan(options?: { urgent?: boolean }): void {
        if (this.destroyed) return;
        if (this.pendingScan) return;
        this.pendingScan = true;

        if (options?.urgent) {
            // Immediate sync scan for urgent requests
            this.pendingScan = false;
            this.rescan();
            return;
        }

        this.rafId = requestAnimationFrame(() => {
            this.rafId = null;
            if (this.destroyed) return;
            this.pendingScan = false;
            this.rescan();
        });
    }

    rescan(): void {
        if (this.destroyed) return;
        if (!this.shouldRenderLineHandles()) {
            for (const entry of this.lineHandles.values()) {
                entry.handle.remove();
            }
            this.lineHandles.clear();
            return;
        }

        const doc = this.view.state.doc;
        const processedLines = new Set<number>();
        const handledLineNumbers = new Set<number>();

        for (const { from, to } of this.view.visibleRanges) {
            let pos = from;
            while (pos <= to) {
                const line = doc.lineAt(pos);
                const lineNumber = line.number;

                if (processedLines.has(lineNumber)) {
                    pos = line.to + 1;
                    continue;
                }

                const block = detectBlock(this.view.state, lineNumber);
                if (block) {
                    const handleLineNumber = block.startLine + 1;
                    handledLineNumbers.add(handleLineNumber);

                    const getBlockInfo = () => this.deps.getDraggableBlockAtLine(handleLineNumber);

                    let entry = this.lineHandles.get(handleLineNumber);
                    if (!entry) {
                        const handle = this.deps.createHandleElement(getBlockInfo);
                        handle.classList.add(LINE_HANDLE_CLASS);
                        this.view.dom.appendChild(handle);
                        entry = { handle, lineNumber: handleLineNumber };
                        this.lineHandles.set(handleLineNumber, entry);
                    }

                    // Always update attributes with fresh block info
                    entry.handle.setAttribute('data-block-start', String(block.startLine));
                    entry.handle.setAttribute('data-block-end', String(block.endLine));
                    this.positionHandle(entry.handle, handleLineNumber);

                    // Mark processed lines based on block type
                    if (block.type === BlockType.ListItem) {
                        const ownRange = getListItemOwnRangeForHandle(this.view.state, lineNumber);
                        if (ownRange) {
                            for (let i = ownRange.startLine; i <= ownRange.endLine; i++) {
                                processedLines.add(i);
                            }
                        } else {
                            processedLines.add(lineNumber);
                        }
                    } else if (block.type === BlockType.Blockquote) {
                        processedLines.add(lineNumber);
                    } else {
                        const startLineNumber = block.startLine + 1;
                        const endLineNumber = block.endLine + 1;
                        for (let ln = startLineNumber; ln <= endLineNumber; ln++) {
                            processedLines.add(ln);
                        }
                    }
                }

                pos = line.to + 1;
            }
        }

        // Remove handles for lines no longer in view
        for (const [lineNum, entry] of this.lineHandles.entries()) {
            if (!handledLineNumbers.has(lineNum)) {
                entry.handle.remove();
                this.lineHandles.delete(lineNum);
            }
        }
    }

    updateHandlePositions(): void {
        if (!this.shouldRenderLineHandles()) return;
        for (const entry of this.lineHandles.values()) {
            this.positionHandle(entry.handle, entry.lineNumber);
        }
    }

    destroy(): void {
        this.destroyed = true;
        this.pendingScan = false;
        if (this.rafId !== null) {
            cancelAnimationFrame(this.rafId);
            this.rafId = null;
        }
        for (const entry of this.lineHandles.values()) {
            entry.handle.remove();
        }
        this.lineHandles.clear();
    }

    isManagedHandle(handle: HTMLElement): boolean {
        for (const entry of this.lineHandles.values()) {
            if (entry.handle === handle) return true;
        }
        return false;
    }

    private positionHandle(handle: HTMLElement, lineNumber: number): void {
        // Check if line is in visible range
        if (lineNumber < 1 || lineNumber > this.view.state.doc.lines) {
            handle.style.display = 'none';
            return;
        }

        const left = getHandleLeftPxForLine(this.view, lineNumber);
        const top = getHandleTopPxForLine(this.view, lineNumber);

        if (left === null || top === null) {
            handle.style.display = 'none';
            return;
        }

        handle.style.display = '';
        const localLeft = viewportXToEditorLocalX(this.view, left);
        const localTop = viewportYToEditorLocalY(this.view, top);
        handle.style.left = `${Math.round(localLeft)}px`;
        handle.style.top = `${Math.round(localTop)}px`;
    }
}
