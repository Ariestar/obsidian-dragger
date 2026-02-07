import { EditorView } from '@codemirror/view';
import { detectBlock, getHeadingSectionRange } from '../block-detector';
import { BlockInfo, BlockType } from '../../types';

export class DragSourceResolver {
    constructor(private readonly view: EditorView) { }

    getBlockInfoForHandle(handle: HTMLElement): BlockInfo | null {
        const startAttr = handle.getAttribute('data-block-start');
        const startLine = startAttr !== null ? Number(startAttr) + 1 : NaN;
        if (Number.isInteger(startLine) && startLine >= 1 && startLine <= this.view.state.doc.lines) {
            const block = this.getDraggableBlockAtLine(startLine);
            if (block) return block;
        }

        try {
            const pos = this.view.posAtDOM(handle);
            const lineNumber = this.view.state.doc.lineAt(pos).number;
            return this.getDraggableBlockAtLine(lineNumber);
        } catch {
            return null;
        }
    }

    getDraggableBlockAtLine(lineNumber: number): BlockInfo | null {
        const block = detectBlock(this.view.state, lineNumber);
        if (!block) return null;
        return this.expandHeadingBlockIfCollapsed(block);
    }

    getDraggableBlockAtPoint(clientX: number, clientY: number): BlockInfo | null {
        const contentRect = this.view.contentDOM.getBoundingClientRect();
        if (clientY < contentRect.top || clientY > contentRect.bottom) return null;

        const x = Math.min(Math.max(clientX, contentRect.left + 2), contentRect.right - 2);
        const pos = this.view.posAtCoords({ x, y: clientY });
        if (pos === null) return null;

        const lineNumber = this.view.state.doc.lineAt(pos).number;
        return this.getDraggableBlockAtLine(lineNumber);
    }

    getBlockInfoForEmbed(embedEl: HTMLElement): BlockInfo | null {
        const candidates = [embedEl, embedEl.parentElement].filter((el): el is HTMLElement => !!el);
        for (const candidate of candidates) {
            try {
                const pos = this.view.posAtDOM(candidate);
                const line = this.view.state.doc.lineAt(pos);
                const block = detectBlock(this.view.state, line.number);
                if (block) return block;
            } catch {
                // try next candidate
            }
        }
        return null;
    }

    private expandHeadingBlockIfCollapsed(block: BlockInfo): BlockInfo {
        if (block.type !== BlockType.Heading) return block;
        const headingLineNumber = block.startLine + 1;
        if (!this.isHeadingLineCollapsed(headingLineNumber)) return block;

        const range = getHeadingSectionRange(this.view.state.doc, headingLineNumber);
        if (!range || range.endLine <= headingLineNumber) return block;

        const endLineObj = this.view.state.doc.line(range.endLine);
        let content = '';
        for (let i = headingLineNumber; i <= range.endLine; i++) {
            content += this.view.state.doc.line(i).text;
            if (i < range.endLine) content += '\n';
        }

        return {
            ...block,
            endLine: range.endLine - 1,
            to: endLineObj.to,
            content,
        };
    }

    private isHeadingLineCollapsed(lineNumber: number): boolean {
        try {
            const line = this.view.state.doc.line(lineNumber);
            const domAtPos = this.view.domAtPos(line.from);
            const base = domAtPos.node.nodeType === Node.TEXT_NODE ? domAtPos.node.parentElement : domAtPos.node;
            if (!(base instanceof Element)) return false;
            const lineEl = base.closest('.cm-line');
            if (!lineEl) return false;

            if (lineEl.classList.contains('is-collapsed') || lineEl.classList.contains('cm-folded')) {
                return true;
            }

            if (lineEl.querySelector('.cm-foldPlaceholder, .cm-fold-indicator.is-collapsed, .collapse-indicator.is-collapsed')) {
                return true;
            }
        } catch {
            return false;
        }
        return false;
    }
}
