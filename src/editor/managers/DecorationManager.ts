import { Decoration, DecorationSet, EditorView, WidgetType } from '@codemirror/view';
import { detectBlock, getListItemOwnRangeForHandle } from '../block-detector';
import { BlockInfo, BlockType } from '../../types';
import { alignInlineHandleToHandleColumn } from '../core/handle-position';

export interface DecorationManagerDeps {
    view: EditorView;
    createHandleElement: (getBlockInfo: () => BlockInfo | null) => HTMLElement;
    getDraggableBlockAtLine: (lineNumber: number) => BlockInfo | null;
    shouldRenderInlineHandles?: () => boolean;
}

class DragHandleWidget extends WidgetType {
    constructor(
        private readonly blockInfo: BlockInfo,
        private readonly deps: DecorationManagerDeps
    ) {
        super();
    }

    toDOM(): HTMLElement {
        const lineNumber = this.blockInfo.startLine + 1;
        const handle = this.deps.createHandleElement(
            () => this.deps.getDraggableBlockAtLine(lineNumber) ?? this.blockInfo
        );
        requestAnimationFrame(() => {
            if (!handle.isConnected) return;
            alignInlineHandleToHandleColumn(this.deps.view, handle, lineNumber);
        });
        handle.setAttribute('data-block-start', String(this.blockInfo.startLine));
        handle.setAttribute('data-block-end', String(this.blockInfo.endLine));
        return handle;
    }

    eq(other: DragHandleWidget): boolean {
        return this.blockInfo.from === other.blockInfo.from
            && this.blockInfo.to === other.blockInfo.to;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

export class DecorationManager {
    constructor(private readonly deps: DecorationManagerDeps) { }

    buildDecorations(): DecorationSet {
        if (this.deps.shouldRenderInlineHandles && !this.deps.shouldRenderInlineHandles()) {
            return Decoration.none;
        }

        try {
            const decorations: any[] = [];
            const doc = this.deps.view.state.doc;
            const processedLines = new Set<number>();

            for (const { from, to } of this.deps.view.visibleRanges) {
                let pos = from;
                while (pos <= to) {
                    const line = doc.lineAt(pos);
                    const lineNumber = line.number;

                    if (processedLines.has(lineNumber)) {
                        pos = line.to + 1;
                        continue;
                    }

                    const block = detectBlock(this.deps.view.state, lineNumber);
                    if (block) {
                        const widget = new DragHandleWidget(block, this.deps);
                        decorations.push(
                            Decoration.widget({
                                widget,
                                side: -1,
                            }).range(line.from)
                        );

                        if (block.type === BlockType.ListItem) {
                            const ownRange = getListItemOwnRangeForHandle(this.deps.view.state, lineNumber);
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
                            for (let i = block.startLine; i <= block.endLine; i++) {
                                processedLines.add(i + 1);
                            }
                        }
                    }

                    pos = line.to + 1;
                }
            }

            return Decoration.set(decorations, true);
        } catch (error) {
            console.error('[Dragger] buildDecorations failed:', error);
            return Decoration.none;
        }
    }
}
