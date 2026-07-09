import { EditorState } from '@codemirror/state';
import { EditorView, GutterMarker } from '@codemirror/view';
import { detectBlock, type BlockInfo } from 'md-dragger/domain';
import { DRAG_HANDLE_CLASS, HANDLE_CORE_CLASS, LINE_HANDLE_CLASS } from '../../../shared/dom-selectors';

export function resolveHandleBlockAtLine(state: EditorState, lineNumber: number): BlockInfo | null {
    const block = detectBlock(state.doc, lineNumber, { tabSize: state.facet(EditorState.tabSize) });
    if (!block) return null;
    if (block.startLine + 1 !== lineNumber) return null;
    return block;
}

export function createLineDragHandleElement(block: Pick<BlockInfo, 'startLine' | 'endLine'>): HTMLElement {
    const handle = activeDocument.createElement('div');
    handle.className = `${DRAG_HANDLE_CLASS} ${LINE_HANDLE_CLASS} dnd-handle-gutter-bound`;
    handle.setAttribute('data-block-start', String(block.startLine));
    handle.setAttribute('data-block-end', String(block.endLine));

    const core = activeDocument.createElement('span');
    core.className = HANDLE_CORE_CLASS;
    core.setAttribute('aria-hidden', 'true');
    handle.appendChild(core);

    return handle;
}

export function getVisibleHandleForBlockStart(view: EditorView, blockStart: number): HTMLElement | null {
    const handle = view.dom.querySelector<HTMLElement>(
        `.${DRAG_HANDLE_CLASS}.${LINE_HANDLE_CLASS}[data-block-start="${blockStart}"]`
    );
    if (!handle || !handle.isConnected) return null;
    if (handle.closest('.cm-editor') !== view.dom) return null;
    return handle;
}

export class HandleGutterLineMarker extends GutterMarker {
    readonly elementClass = 'dnd-handle-gutter-marker';

    constructor(private readonly block: Pick<BlockInfo, 'startLine' | 'endLine'>) {
        super();
    }

    eq(other: GutterMarker): boolean {
        return other instanceof HandleGutterLineMarker
            && other.block.startLine === this.block.startLine
            && other.block.endLine === this.block.endLine;
    }

    toDOM(_view: EditorView): Node {
        return createLineDragHandleElement(this.block);
    }
}
