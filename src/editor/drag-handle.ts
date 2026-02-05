import { EditorState, Extension } from '@codemirror/state';
import {
    EditorView,
    ViewPlugin,
    ViewUpdate,
    Decoration,
    DecorationSet,
    WidgetType,
} from '@codemirror/view';
import { detectBlock, detectBlockType, getListItemOwnRangeForHandle } from './block-detector';
import { BlockType, BlockInfo, DragState } from '../types';
import DragNDropPlugin from '../main';

type EmbedHandleEntry = {
    handle: HTMLElement;
    show: () => void;
    hide: (e: MouseEvent) => void;
};

/**
 * 拖拽手柄 Widget
 */
class DragHandleWidget extends WidgetType {
    private blockInfo: BlockInfo;
    private view: EditorView;
    private plugin: DragNDropPlugin;

    constructor(blockInfo: BlockInfo, view: EditorView, plugin: DragNDropPlugin) {
        super();
        this.blockInfo = blockInfo;
        this.view = view;
        this.plugin = plugin;
    }

    toDOM(): HTMLElement {
        const handle = document.createElement('div');
        handle.className = 'dnd-drag-handle';
        handle.setAttribute('draggable', 'true');
        handle.setAttribute('data-block-start', String(this.blockInfo.startLine));
        handle.setAttribute('data-block-end', String(this.blockInfo.endLine));

        // 拖拽图标（六个点）
        handle.innerHTML = `
      <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="9" cy="5" r="2"/>
        <circle cx="15" cy="5" r="2"/>
        <circle cx="9" cy="12" r="2"/>
        <circle cx="15" cy="12" r="2"/>
        <circle cx="9" cy="19" r="2"/>
        <circle cx="15" cy="19" r="2"/>
      </svg>
    `;

        // 拖拽事件
        handle.addEventListener('dragstart', (e) => this.onDragStart(e));
        handle.addEventListener('dragend', (e) => this.onDragEnd(e));

        return handle;
    }

    private onDragStart(e: DragEvent): void {
        if (!e.dataTransfer) return;

        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', this.blockInfo.content);
        e.dataTransfer.setData('application/dnd-block', JSON.stringify(this.blockInfo));

        // 添加拖拽中的类
        document.body.classList.add('dnd-dragging');

        // 创建拖拽时的ghost image
        const ghost = document.createElement('div');
        ghost.className = 'dnd-drag-ghost';
        ghost.textContent = this.blockInfo.content.slice(0, 50) + (this.blockInfo.content.length > 50 ? '...' : '');
        document.body.appendChild(ghost);
        e.dataTransfer.setDragImage(ghost, 0, 0);

        // 延迟移除ghost元素
        setTimeout(() => ghost.remove(), 0);

    }

    private onDragEnd(e: DragEvent): void {
        document.body.classList.remove('dnd-dragging');
        // 清理放置指示器（仅隐藏，保留复用）
        document.querySelectorAll<HTMLElement>('.dnd-drop-indicator').forEach(el => { el.style.display = 'none'; });
        document.querySelectorAll<HTMLElement>('.dnd-drop-highlight').forEach(el => { el.style.display = 'none'; });
    }

    eq(other: DragHandleWidget): boolean {
        return this.blockInfo.from === other.blockInfo.from
            && this.blockInfo.to === other.blockInfo.to;
    }

    ignoreEvent(): boolean {
        return false;
    }
}

/**
 * 创建拖拽手柄ViewPlugin
 */
function createDragHandleViewPlugin(plugin: DragNDropPlugin) {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            observer: MutationObserver;
            plugin: DragNDropPlugin;
            view: EditorView;
            embedHandles: Map<HTMLElement, EmbedHandleEntry>;
            indicatorEl: HTMLDivElement;
            highlightEl: HTMLDivElement;
            pendingDragInfo: { x: number; y: number; dragSource: BlockInfo | null } | null;
            rafId: number | null;
            pendingEmbedScan: boolean;
            onScrollOrResize: () => void;
            onDeactivate: () => void;
            lastDropTargetLineNumber: number | null;

            constructor(view: EditorView) {
                this.view = view;
                this.plugin = plugin;
                this.embedHandles = new Map();
                this.lastDropTargetLineNumber = null;
                this.indicatorEl = document.createElement('div');
                this.indicatorEl.className = 'dnd-drop-indicator';
                this.indicatorEl.style.position = 'fixed';
                this.indicatorEl.style.display = 'none';
                document.body.appendChild(this.indicatorEl);

                this.highlightEl = document.createElement('div');
                this.highlightEl.className = 'dnd-drop-highlight';
                this.highlightEl.style.position = 'fixed';
                this.highlightEl.style.display = 'none';
                document.body.appendChild(this.highlightEl);

                this.pendingDragInfo = null;
                this.rafId = null;
                this.pendingEmbedScan = false;
                this.decorations = this.buildDecorations(view);
                this.setupDropListeners(view);
                this.setupEmbedBlockObserver(view);
                this.onScrollOrResize = () => this.updateEmbedHandlePositions();
                view.scrollDOM.addEventListener('scroll', this.onScrollOrResize, { passive: true });
                window.addEventListener('resize', this.onScrollOrResize);
                this.onDeactivate = () => this.hideAllEmbedHandles();
                view.dom.addEventListener('mouseleave', this.onDeactivate);
                window.addEventListener('blur', this.onDeactivate);
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged) {
                    this.decorations = this.buildDecorations(update.view);
                    // 文档变化后重新扫描渲染块
                    this.addHandlesToEmbedBlocks(update.view);
                    this.updateEmbedHandlePositions();
                }
            }

            buildDecorations(view: EditorView): DecorationSet {
                const decorations: any[] = [];
                const doc = view.state.doc;
                const processedLines = new Set<number>();

                // 遍历可见范围内的行
                for (const { from, to } of view.visibleRanges) {
                    let pos = from;
                    while (pos <= to) {
                        const line = doc.lineAt(pos);
                        const lineNumber = line.number;

                        // 跳过已处理的行
                        if (processedLines.has(lineNumber)) {
                            pos = line.to + 1;
                            continue;
                        }

                        const block = detectBlock(view.state, lineNumber);
                        if (block) {
                            // 在块的起始行添加拖拽手柄
                            const widget = new DragHandleWidget(block, view, plugin);
                            decorations.push(
                                Decoration.widget({
                                    widget,
                                    side: -1, // 在行内容之前
                                }).range(line.from)
                            );

                            // 标记所有属于这个块的行为已处理
                            if (block.type === BlockType.ListItem) {
                                const ownRange = getListItemOwnRangeForHandle(view.state, lineNumber);
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
            }

            setupEmbedBlockObserver(view: EditorView) {
                this.observer = new MutationObserver(() => {
                    if (this.pendingEmbedScan) return;
                    this.pendingEmbedScan = true;
                    requestAnimationFrame(() => {
                        this.pendingEmbedScan = false;
                        this.addHandlesToEmbedBlocks(view);
                        this.updateEmbedHandlePositions();
                    });
                });

                this.observer.observe(view.dom, {
                    childList: true,
                    subtree: true,
                    attributes: false
                });

                // 初始扫描
                this.addHandlesToEmbedBlocks(view);
            }

            addHandlesToEmbedBlocks(view: EditorView) {
                // 扩展选择器以支持更多类型
                const embeds = view.dom.querySelectorAll('.cm-embed-block, .cm-callout, .cm-preview-code-block, .cm-math, .MathJax_Display');

                const handled = new Set<HTMLElement>();

                embeds.forEach(embed => {
                    const rawEl = embed as HTMLElement;
                    const embedEl = (rawEl.closest('.cm-embed-block') as HTMLElement | null) ?? rawEl;

                    if (handled.has(embedEl)) return;
                    handled.add(embedEl);

                    // 清理旧的内嵌手柄（避免残留）
                    embedEl.querySelectorAll(':scope > .dnd-embed-handle').forEach(el => el.remove());

                    const getBlockInfo = () => this.getBlockInfoForEmbed(view, embedEl);
                    const block = getBlockInfo();

                    if (block) {
                        let entry = this.embedHandles.get(embedEl);
                        if (!entry) {
                            const handle = this.createHandleElement(view, getBlockInfo);
                            handle.classList.add('dnd-embed-handle');
                            handle.style.position = 'fixed';
                            document.body.appendChild(handle);

                            const show = () => {
                                if (!this.isEmbedVisible(embedEl)) return;
                                handle.style.display = '';
                                handle.classList.add('is-visible');
                            };
                            const hide = (e: MouseEvent) => {
                                const related = e.relatedTarget as Node | null;
                                if (related && (related === handle || handle.contains(related))) return;
                                handle.classList.remove('is-visible');
                            };

                            embedEl.addEventListener('mouseenter', show);
                            embedEl.addEventListener('mouseleave', hide);
                            handle.addEventListener('mouseenter', show);
                            handle.addEventListener('mouseleave', hide);

                            entry = { handle, show, hide };
                            this.embedHandles.set(embedEl, entry);
                        }

                        this.positionEmbedHandle(embedEl, entry.handle);
                    }
                });

                for (const [embedEl, entry] of this.embedHandles.entries()) {
                    if (!handled.has(embedEl) || !document.body.contains(embedEl)) {
                        embedEl.removeEventListener('mouseenter', entry.show);
                        embedEl.removeEventListener('mouseleave', entry.hide);
                        entry.handle.removeEventListener('mouseenter', entry.show);
                        entry.handle.removeEventListener('mouseleave', entry.hide);
                        entry.handle.remove();
                        this.embedHandles.delete(embedEl);
                    }
                }
            }

            positionEmbedHandle(embedEl: HTMLElement, handle: HTMLElement) {
                if (!this.isEmbedVisible(embedEl)) {
                    handle.classList.remove('is-visible');
                    handle.style.display = 'none';
                    return;
                }

                handle.style.display = '';
                const contentRect = this.view.contentDOM.getBoundingClientRect();
                const embedRect = embedEl.getBoundingClientRect();
                const contentPaddingLeft = parseFloat(getComputedStyle(this.view.contentDOM).paddingLeft) || 0;
                const left = Math.round(contentRect.left + contentPaddingLeft - 42);
                const top = Math.round(embedRect.top + 8);
                handle.style.left = `${left}px`;
                handle.style.top = `${top}px`;
            }

            isEmbedVisible(embedEl: HTMLElement): boolean {
                if (!embedEl.isConnected) return false;
                const style = getComputedStyle(embedEl);
                if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
                    return false;
                }
                const rect = embedEl.getBoundingClientRect();
                if (rect.width === 0 && rect.height === 0) return false;
                if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
                if (rect.right < 0 || rect.left > window.innerWidth) return false;
                return true;
            }

            getBlockInfoForEmbed(view: EditorView, embedEl: HTMLElement): BlockInfo | null {
                // 获取对应的文档位置
                let pos: number | null = null;
                try {
                    pos = view.posAtDOM(embedEl);
                } catch {
                    pos = null;
                }

                // 如果直接获取失败，尝试获取父元素位置
                if (pos === null && embedEl.parentElement) {
                    try {
                        pos = view.posAtDOM(embedEl.parentElement);
                    } catch {
                        pos = null;
                    }
                }

                // 如果仍然失败，尝试使用坐标定位
                if (pos === null) {
                    const rect = embedEl.getBoundingClientRect();
                    const coordsPos = view.posAtCoords({ x: rect.left + 4, y: rect.top + 4 });
                    if (coordsPos !== null) {
                        pos = coordsPos;
                    }
                }

                if (pos === null) return null;

                const line = view.state.doc.lineAt(pos);
                return detectBlock(view.state, line.number);
            }

            updateEmbedHandlePositions() {
                for (const [embedEl, entry] of this.embedHandles.entries()) {
                    if (!document.body.contains(embedEl)) continue;
                    this.positionEmbedHandle(embedEl, entry.handle);
                }
            }

            hideAllEmbedHandles() {
                for (const entry of this.embedHandles.values()) {
                    entry.handle.classList.remove('is-visible');
                    entry.handle.style.display = 'none';
                }
            }

            createHandleElement(view: EditorView, getBlockInfo: () => BlockInfo | null): HTMLElement {
                const handle = document.createElement('div');
                handle.className = 'dnd-drag-handle';
                handle.setAttribute('draggable', 'true');

                handle.innerHTML = `
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <circle cx="9" cy="5" r="2"/>
                    <circle cx="15" cy="5" r="2"/>
                    <circle cx="9" cy="12" r="2"/>
                    <circle cx="15" cy="12" r="2"/>
                    <circle cx="9" cy="19" r="2"/>
                    <circle cx="15" cy="19" r="2"/>
                  </svg>
                `;

                // 复用 DragHandleWidget 的事件处理逻辑
                // 但由于 DragHandleWidget 是 WidgetType，上面的 onDragStart 是 private
                // 我们需要重新绑定或者将逻辑提取出来。
                // 为了简单起见，这里重新实现简单的绑定，调用 widget 的方法（如果如果是 public）
                // 或者直接在这里实现

                handle.addEventListener('dragstart', (e) => {
                    // 复制 widget.onDragStart 的逻辑
                    if (!e.dataTransfer) return;
                    const blockInfo = getBlockInfo();
                    if (!blockInfo) {
                        e.preventDefault();
                        return;
                    }

                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', blockInfo.content);
                    e.dataTransfer.setData('application/dnd-block', JSON.stringify(blockInfo));
                    handle.setAttribute('data-block-start', String(blockInfo.startLine));
                    handle.setAttribute('data-block-end', String(blockInfo.endLine));

                    document.body.classList.add('dnd-dragging');

                    const ghost = document.createElement('div');
                    ghost.className = 'dnd-drag-ghost';
                    ghost.textContent = blockInfo.content.slice(0, 50) + (blockInfo.content.length > 50 ? '...' : '');
                    document.body.appendChild(ghost);
                    e.dataTransfer.setDragImage(ghost, 0, 0);

                    setTimeout(() => ghost.remove(), 0);

                });

                handle.addEventListener('dragend', (e) => {
                    document.body.classList.remove('dnd-dragging');
                    document.querySelectorAll<HTMLElement>('.dnd-drop-indicator').forEach(el => { el.style.display = 'none'; });
                    document.querySelectorAll<HTMLElement>('.dnd-drop-highlight').forEach(el => { el.style.display = 'none'; });
                });

                return handle;
            }

            setupDropListeners(view: EditorView): void {
                const editorDom = view.dom;
                const shouldHandleDrag = (e: DragEvent) => {
                    if (!e.dataTransfer) return false;
                    return Array.from(e.dataTransfer.types).includes('application/dnd-block');
                };

                // 必须在dragenter时也设置dropEffect来防止光标闪烁
                editorDom.addEventListener('dragenter', (e: DragEvent) => {
                    if (!shouldHandleDrag(e)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (e.dataTransfer) {
                        e.dataTransfer.dropEffect = 'move';
                    }
                }, true);

                editorDom.addEventListener('dragover', (e: DragEvent) => {
                    if (!shouldHandleDrag(e)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (!e.dataTransfer) return;

                    e.dataTransfer.dropEffect = 'move';

                    this.scheduleDropIndicatorUpdate(view, e);
                }, true);

                editorDom.addEventListener('dragleave', (e: DragEvent) => {
                    if (!shouldHandleDrag(e)) return;
                    // 只有当离开编辑器区域时才隐藏指示器
                    const rect = editorDom.getBoundingClientRect();
                    if (e.clientX < rect.left || e.clientX > rect.right ||
                        e.clientY < rect.top || e.clientY > rect.bottom) {
                        this.hideDropIndicator();
                    }
                }, true);

                editorDom.addEventListener('drop', (e: DragEvent) => {
                    if (!shouldHandleDrag(e)) return;
                    e.preventDefault();
                    e.stopPropagation();
                    if (!e.dataTransfer) return;

                    const blockDataStr = e.dataTransfer.getData('application/dnd-block');
                    if (!blockDataStr) return;

                    const sourceBlock: BlockInfo = JSON.parse(blockDataStr);
                    const targetInfo = this.getDropTargetInfo(view, {
                        clientX: e.clientX,
                        clientY: e.clientY,
                        dragSource: sourceBlock,
                    });
                    const targetLineNumber = targetInfo?.lineNumber ?? null;
                    const targetPos = targetLineNumber
                        ? (targetLineNumber > view.state.doc.lines
                            ? view.state.doc.length
                            : view.state.doc.line(targetLineNumber).from)
                        : view.posAtCoords({ x: e.clientX, y: e.clientY });

                    if (targetPos === null) return;

                    this.moveBlock(
                        view,
                        sourceBlock,
                        targetPos,
                        targetLineNumber ?? undefined,
                        targetInfo?.listContextLineNumber,
                        targetInfo?.listIndentDelta,
                        targetInfo?.listTargetIndentWidth
                    );
                    this.hideDropIndicator();
                }, true);
            }

            scheduleDropIndicatorUpdate(view: EditorView, e: DragEvent): void {
                const dragSource = this.getDragSourceBlock(e);
                this.pendingDragInfo = { x: e.clientX, y: e.clientY, dragSource };
                if (this.rafId !== null) return;
                this.rafId = requestAnimationFrame(() => {
                    this.rafId = null;
                    const pending = this.pendingDragInfo;
                    if (!pending) return;
                    this.updateDropIndicatorFromPoint(view, pending);
                });
            }

            updateDropIndicatorFromPoint(view: EditorView, info: { x: number; y: number; dragSource: BlockInfo | null }): void {
                const targetInfo = this.getDropTargetInfo(view, {
                    clientX: info.x,
                    clientY: info.y,
                    dragSource: info.dragSource,
                });
                if (!targetInfo) {
                    this.hideDropIndicator();
                    return;
                }

                this.lastDropTargetLineNumber = targetInfo.lineNumber;

                const editorRect = view.dom.getBoundingClientRect();
                const indicatorY = targetInfo.indicatorY;
                const indicatorLeft = targetInfo.lineRect ? targetInfo.lineRect.left : editorRect.left + 35;
                const contentRect = view.contentDOM.getBoundingClientRect();
                const contentPaddingRight = parseFloat(getComputedStyle(view.contentDOM).paddingRight) || 0;
                const indicatorRight = contentRect.right - contentPaddingRight;
                const indicatorWidth = Math.max(8, indicatorRight - indicatorLeft);

                this.indicatorEl.style.top = `${indicatorY}px`;
                this.indicatorEl.style.left = `${indicatorLeft}px`;
                this.indicatorEl.style.width = `${indicatorWidth}px`;
                this.indicatorEl.style.display = '';

                if (targetInfo.highlightRect) {
                    this.highlightEl.style.top = `${targetInfo.highlightRect.top}px`;
                    this.highlightEl.style.left = `${targetInfo.highlightRect.left}px`;
                    this.highlightEl.style.width = `${targetInfo.highlightRect.width}px`;
                    this.highlightEl.style.height = `${targetInfo.highlightRect.height}px`;
                    this.highlightEl.style.display = '';
                } else {
                    this.highlightEl.style.display = 'none';
                }
            }

            hideDropIndicator(): void {
                if (this.rafId !== null) {
                    cancelAnimationFrame(this.rafId);
                    this.rafId = null;
                }
                this.pendingDragInfo = null;
                this.indicatorEl.style.display = 'none';
                this.highlightEl.style.display = 'none';
                this.lastDropTargetLineNumber = null;
            }

            moveBlock(
                view: EditorView,
                sourceBlock: BlockInfo,
                targetPos: number,
                targetLineNumberOverride?: number,
                listContextLineNumberOverride?: number,
                listIndentDeltaOverride?: number,
                listTargetIndentWidthOverride?: number
            ): void {
                const doc = view.state.doc;
                const targetLine = doc.lineAt(targetPos);

                // 检测目标位置是否在多行块内部，如果是则调整到块边界
                const targetBlock = detectBlock(view.state, targetLine.number);
                let targetLineNumber = targetLineNumberOverride ?? targetLine.number;

                if (targetLineNumberOverride === undefined && targetBlock && (targetBlock.type === BlockType.CodeBlock ||
                    targetBlock.type === BlockType.Blockquote ||
                    targetBlock.type === BlockType.Table ||
                    targetBlock.type === BlockType.MathBlock)) {
                    // 使用块的边界
                    if (targetLine.number - 1 <= (targetBlock.startLine + targetBlock.endLine) / 2) {
                        targetLineNumber = targetBlock.startLine + 1;
                    } else {
                        targetLineNumber = targetBlock.endLine + 2; // 插入到块后面
                    }
                }

                targetLineNumber = this.clampTargetLineNumber(doc.lines, targetLineNumber);

                // 转换为0-indexed
                const targetLineIdx = targetLineNumber - 1;

                const inSelfRange = targetLineIdx >= sourceBlock.startLine && targetLineIdx <= sourceBlock.endLine + 1;
                let allowInPlaceIndentChange = false;
                if (inSelfRange && (listTargetIndentWidthOverride !== undefined || listIndentDeltaOverride !== undefined)) {
                    const sourceLineText = doc.line(sourceBlock.startLine + 1).text;
                    const sourceParsed = this.parseListLine(this.splitBlockquotePrefix(sourceLineText).rest);
                    if (sourceParsed.isListItem) {
                        let targetIndentWidth = listTargetIndentWidthOverride;
                        if (targetIndentWidth === undefined) {
                            const listContextLineNumber = listContextLineNumberOverride ?? targetLineNumber;
                            const targetContext = this.getListContext(doc, listContextLineNumber);
                            const indentSample = targetContext ? targetContext.indentRaw : sourceParsed.indentRaw;
                            const indentUnitWidth = this.getIndentUnitWidth(indentSample || sourceParsed.indentRaw);
                            const indentDeltaBase = (targetContext ? targetContext.indentWidth : 0) - sourceParsed.indentWidth;
                            targetIndentWidth = sourceParsed.indentWidth + indentDeltaBase + ((listIndentDeltaOverride ?? 0) * indentUnitWidth);
                        }
                        if (typeof targetIndentWidth === 'number' && targetIndentWidth < sourceParsed.indentWidth) {
                            allowInPlaceIndentChange = true;
                        }
                    }
                }

                // 不能移动到自己的位置（除非仅缩进发生变化）
                if (inSelfRange && !allowInPlaceIndentChange) {
                    return;
                }

                // 获取源块的文档位置
                const sourceStartLine = doc.line(sourceBlock.startLine + 1);
                const sourceEndLine = doc.line(sourceBlock.endLine + 1);
                const sourceFrom = sourceStartLine.from;
                const sourceTo = sourceEndLine.to;
                const sourceContent = doc.sliceString(sourceFrom, sourceTo);
                const insertText = this.buildInsertText(
                    doc,
                    sourceBlock,
                    targetLineNumber,
                    sourceContent,
                    listContextLineNumberOverride,
                    listIndentDeltaOverride,
                    listTargetIndentWidthOverride
                );

                // CodeMirror 的 changes 数组位置都是基于原始文档的，不需要手动计算偏移
                // 但必须按照从后到前的顺序排列 changes（位置大的在前）
                if (targetLineIdx < sourceBlock.startLine) {
                    // 向上移动
                    const insertPos = targetLineNumber > doc.lines
                        ? doc.length
                        : doc.line(targetLineNumber).from;

                    // 删除源块（包括换行符）
                    const deleteFrom = sourceFrom;
                    const deleteTo = Math.min(sourceTo + 1, doc.length);

                    if (allowInPlaceIndentChange && insertPos === deleteFrom) {
                        view.dispatch({
                            changes: { from: deleteFrom, to: deleteTo, insert: insertText },
                            scrollIntoView: false,
                        });
                    } else {
                    view.dispatch({
                        changes: [
                            // 必须按位置从大到小排序
                            { from: deleteFrom, to: deleteTo },  // 删除原位置
                            { from: insertPos, to: insertPos, insert: insertText },  // 插入到目标位置
                        ].sort((a, b) => b.from - a.from),
                        scrollIntoView: false,
                    });
                    }
                } else {
                    // 向下移动
                    const insertPos = targetLineNumber > doc.lines
                        ? doc.length
                        : doc.line(targetLineNumber).from;

                    // 删除源块（包括换行符）
                    const deleteFrom = sourceFrom;
                    const deleteTo = Math.min(sourceTo + 1, doc.length);

                    if (allowInPlaceIndentChange && insertPos === deleteFrom) {
                        view.dispatch({
                            changes: { from: deleteFrom, to: deleteTo, insert: insertText },
                            scrollIntoView: false,
                        });
                    } else {
                    view.dispatch({
                        changes: [
                            // 必须按位置从大到小排序
                            { from: insertPos, to: insertPos, insert: insertText },  // 插入到目标位置
                            { from: deleteFrom, to: deleteTo },  // 删除原位置
                        ].sort((a, b) => b.from - a.from),
                        scrollIntoView: false,
                    });
                    }
                }

                // 有序列表自动重编号（移动前后可能需要修正）
                const sourceLineNumber = sourceBlock.startLine + 1;
                setTimeout(() => {
                    this.renumberOrderedListAround(view, sourceLineNumber);
                    this.renumberOrderedListAround(view, targetLineNumber);
                }, 0);

            }

            buildInsertText(
                doc: { line: (n: number) => { text: string }; lines: number },
                sourceBlock: BlockInfo,
                targetLineNumber: number,
                sourceContent: string,
                listContextLineNumberOverride?: number,
                listIndentDeltaOverride?: number,
                listTargetIndentWidthOverride?: number
            ): string {
                const prevLineNumber = Math.min(Math.max(1, targetLineNumber - 1), doc.lines);
                const prevText = targetLineNumber > 1 ? doc.line(prevLineNumber).text : null;
                const nextText = targetLineNumber <= doc.lines ? doc.line(targetLineNumber).text : null;

                let text = sourceContent;
                text = this.adjustBlockquoteDepth(text, this.getBlockquoteDepthContext(doc, targetLineNumber));
                text = this.adjustListToTargetContext(
                    doc,
                    text,
                    targetLineNumber,
                    listContextLineNumberOverride,
                    listIndentDeltaOverride,
                    listTargetIndentWidthOverride
                );

                const needsLeadingBlank = this.shouldSeparateBlock(sourceBlock.type, prevText);
                const needsTrailingBlank = this.shouldSeparateBlock(sourceBlock.type, nextText);

                if (needsLeadingBlank) text = '\n' + text;
                const trailingNewlines = 1 + (needsTrailingBlank ? 1 : 0);
                text += '\n'.repeat(trailingNewlines);
                return text;
            }

            clampTargetLineNumber(totalLines: number, lineNumber: number): number {
                if (lineNumber < 1) return 1;
                if (lineNumber > totalLines + 1) return totalLines + 1;
                return lineNumber;
            }

            shouldSeparateBlock(type: BlockType, adjacentLineText: string | null): boolean {
                if (!adjacentLineText) return false;
                if (adjacentLineText.trim().length === 0) return false;

                const trimmed = adjacentLineText.trimStart();
                if (type === BlockType.Blockquote) {
                    return false;
                }
                if (type === BlockType.Table) {
                    return trimmed.startsWith('|');
                }

                return false;
            }

            adjustBlockquoteDepth(sourceContent: string, targetDepth: number): string {
                const lines = sourceContent.split('\n');
                let baseDepth = 0;
                for (const line of lines) {
                    if (line.trim().length === 0) continue;
                    baseDepth = this.getBlockquoteDepthFromLine(line);
                    break;
                }

                const delta = targetDepth - baseDepth;
                if (delta === 0) return sourceContent;

                return lines.map((line) => {
                    if (line.trim().length === 0) {
                        return delta > 0 ? `${'> '.repeat(delta)}${line}` : this.stripBlockquoteDepth(line, -delta);
                    }
                    if (delta > 0) {
                        return `${'> '.repeat(delta)}${line}`;
                    }
                    return this.stripBlockquoteDepth(line, -delta);
                }).join('\n');
            }

            stripBlockquoteDepth(line: string, removeDepth: number): string {
                let remaining = line;
                let removed = 0;
                while (removed < removeDepth) {
                    const match = remaining.match(/^(\s*> ?)/);
                    if (!match) break;
                    remaining = remaining.slice(match[0].length);
                    removed += 1;
                }
                return remaining;
            }

            getBlockquoteDepthContext(doc: { line: (n: number) => { text: string }; lines: number }, lineNumber: number): number {
                for (let i = lineNumber; i >= 1; i--) {
                    const text = doc.line(i).text;
                    if (text.trim().length === 0) continue;
                    const depth = this.getBlockquoteDepthFromLine(text);
                    if (depth > 0) return depth;
                    return 0;
                }
                return 0;
            }

            getBlockquoteDepthFromLine(line: string): number {
                const match = line.match(/^(\s*> ?)+/);
                if (!match) return 0;
                const prefix = match[0];
                return (prefix.match(/>/g) || []).length;
            }

            adjustListToTargetContext(
                doc: { line: (n: number) => { text: string }; lines: number },
                sourceContent: string,
                targetLineNumber: number,
                listContextLineNumberOverride?: number,
                listIndentDeltaOverride?: number,
                listTargetIndentWidthOverride?: number
            ): string {
                const lines = sourceContent.split('\n');
                const sourceBase = this.getSourceListBase(lines);
                if (!sourceBase) return sourceContent;

                const listContextLineNumber = listContextLineNumberOverride ?? targetLineNumber;
                const targetContext = this.getListContext(doc, listContextLineNumber);
                const indentSample = targetContext ? targetContext.indentRaw : sourceBase.indentRaw;
                const indentDeltaBase = (targetContext ? targetContext.indentWidth : 0) - sourceBase.indentWidth;
                const indentUnitWidth = this.getIndentUnitWidth(indentSample || sourceBase.indentRaw);
                let indentDelta = indentDeltaBase + ((listIndentDeltaOverride ?? 0) * indentUnitWidth);
                if (typeof listTargetIndentWidthOverride === 'number') {
                    indentDelta = listTargetIndentWidthOverride - sourceBase.indentWidth;
                }

                const quoteAdjustedLines = lines.map((line) => {
                    if (line.trim().length === 0) return line;
                    const quoteInfo = this.splitBlockquotePrefix(line);
                    const rest = quoteInfo.rest;
                    const parsed = this.parseListLine(rest);
                    if (!parsed.isListItem) {
                        if (parsed.indentWidth >= sourceBase.indentWidth) {
                            const newIndent = this.buildIndentStringFromSample(indentSample, parsed.indentWidth + indentDelta);
                            return `${quoteInfo.prefix}${newIndent}${rest.slice(parsed.indentRaw.length)}`;
                        }
                        return line;
                    }

                    const newIndent = this.buildIndentStringFromSample(indentSample, parsed.indentWidth + indentDelta);
                    let marker = parsed.marker;
                    if (targetContext && parsed.indentWidth === sourceBase.indentWidth) {
                        marker = this.buildTargetMarker(targetContext, parsed);
                    }
                    return `${quoteInfo.prefix}${newIndent}${marker}${parsed.content}`;
                });

                return quoteAdjustedLines.join('\n');
            }

            getListContext(doc: { line: (n: number) => { text: string }; lines: number }, lineNumber: number): { indentWidth: number; indentRaw: string; markerType: 'ordered' | 'unordered' | 'task' } | null {
                const current = lineNumber <= doc.lines ? doc.line(lineNumber).text : '';
                const currentParsed = this.parseListLine(this.splitBlockquotePrefix(current).rest);
                if (currentParsed.isListItem) {
                    return { indentWidth: currentParsed.indentWidth, indentRaw: currentParsed.indentRaw, markerType: currentParsed.markerType };
                }

                const prevLineNumber = lineNumber - 1;
                if (prevLineNumber >= 1) {
                    const prevText = doc.line(prevLineNumber).text;
                    const prevParsed = this.parseListLine(this.splitBlockquotePrefix(prevText).rest);
                    if (prevParsed.isListItem) {
                        return { indentWidth: prevParsed.indentWidth, indentRaw: prevParsed.indentRaw, markerType: prevParsed.markerType };
                    }
                }

                return null;
            }

            getSourceListBase(lines: string[]): { indentWidth: number; indentRaw: string } | null {
                for (const line of lines) {
                    const rest = this.splitBlockquotePrefix(line).rest;
                    const parsed = this.parseListLine(rest);
                    if (parsed.isListItem) {
                        return { indentWidth: parsed.indentWidth, indentRaw: parsed.indentRaw };
                    }
                }
                return null;
            }

            splitBlockquotePrefix(line: string): { prefix: string; rest: string } {
                const match = line.match(/^(\s*> ?)+/);
                if (!match) return { prefix: '', rest: line };
                return { prefix: match[0], rest: line.slice(match[0].length) };
            }

            parseListLine(line: string): { isListItem: boolean; indentRaw: string; indentWidth: number; marker: string; markerType: 'ordered' | 'unordered' | 'task'; content: string } {
                const indentMatch = line.match(/^(\s*)/);
                const indentRaw = indentMatch ? indentMatch[1] : '';
                const indentWidth = this.getIndentWidthFromIndentRaw(indentRaw);
                const rest = line.slice(indentRaw.length);

                const taskMatch = rest.match(/^([-*+])\s\[[ xX]\]\s+/);
                if (taskMatch) {
                    const marker = taskMatch[0];
                    return { isListItem: true, indentRaw, indentWidth, marker, markerType: 'task', content: rest.slice(marker.length) };
                }

                const unorderedMatch = rest.match(/^([-*+])\s+/);
                if (unorderedMatch) {
                    const marker = unorderedMatch[0];
                    return { isListItem: true, indentRaw, indentWidth, marker, markerType: 'unordered', content: rest.slice(marker.length) };
                }

                const orderedMatch = rest.match(/^(\d+)[.)]\s+/);
                if (orderedMatch) {
                    const marker = orderedMatch[0];
                    return { isListItem: true, indentRaw, indentWidth, marker, markerType: 'ordered', content: rest.slice(marker.length) };
                }

                return { isListItem: false, indentRaw, indentWidth, marker: '', markerType: 'unordered', content: rest };
            }

            findParentListLineNumber(doc: { line: (n: number) => { text: string }; lines: number }, lineNumber: number): number | null {
                if (lineNumber < 1 || lineNumber > doc.lines) return null;
                const currentText = doc.line(lineNumber).text;
                const currentParsed = this.parseListLine(this.splitBlockquotePrefix(currentText).rest);
                if (!currentParsed.isListItem) return null;
                const currentIndent = currentParsed.indentWidth;

                for (let i = lineNumber - 1; i >= 1; i--) {
                    const text = doc.line(i).text;
                    if (text.trim().length === 0) continue;
                    const parsed = this.parseListLine(this.splitBlockquotePrefix(text).rest);
                    if (!parsed.isListItem) continue;
                    if (parsed.indentWidth < currentIndent) return i;
                }

                return null;
            }

            getListMarkerX(view: EditorView, lineNumber: number): number | null {
                if (lineNumber < 1 || lineNumber > view.state.doc.lines) return null;
                const line = view.state.doc.line(lineNumber);
                const quoteInfo = this.splitBlockquotePrefix(line.text);
                const parsed = this.parseListLine(quoteInfo.rest);
                if (!parsed.isListItem) return null;
                const markerPos = line.from + quoteInfo.prefix.length + parsed.indentRaw.length;
                const coords = view.coordsAtPos(markerPos);
                return coords ? coords.left : null;
            }

            getListDropTarget(
                view: EditorView,
                lineNumber: number,
                clientX: number,
                allowChild: boolean
            ): { lineNumber: number; indentWidth: number; mode: 'child' | 'same' } | null {
                const doc = view.state.doc;
                if (lineNumber < 1 || lineNumber > doc.lines) return null;
                if (!allowChild) {
                    const bounds = this.getListMarkerBounds(view, lineNumber);
                    const parentLine = this.findParentListLineNumber(doc, lineNumber);
                    if (bounds && clientX >= bounds.contentStartX + 2) {
                        const indentWidth = this.getListIndentWidthAtLine(doc, lineNumber);
                        if (typeof indentWidth === 'number') {
                            return { lineNumber, indentWidth, mode: 'same' };
                        }
                    }
                    if (parentLine) {
                        const indentWidth = this.getListIndentWidthAtLine(doc, parentLine);
                        if (typeof indentWidth === 'number') {
                            return { lineNumber: parentLine, indentWidth, mode: 'same' };
                        }
                    }
                    const fallbackIndent = this.getListIndentWidthAtLine(doc, lineNumber);
                    if (typeof fallbackIndent === 'number') {
                        return { lineNumber, indentWidth: fallbackIndent, mode: 'same' };
                    }
                    return null;
                }
                const ancestors = this.getListAncestorLineNumbers(doc, lineNumber);
                if (ancestors.length === 0) return null;

                for (const ancestorLine of ancestors) {
                    const bounds = this.getListMarkerBounds(view, ancestorLine);
                    if (!bounds) continue;
                    if (clientX >= bounds.contentStartX + 2) {
                        const indentWidth = this.getListChildIndentWidth(view, ancestorLine);
                        if (typeof indentWidth === 'number') {
                            return { lineNumber: ancestorLine, indentWidth, mode: 'child' };
                        }
                    }
                    if (clientX >= bounds.markerStartX - 1) {
                        const indentWidth = this.getListIndentWidthAtLine(doc, ancestorLine);
                        if (typeof indentWidth === 'number') {
                            return { lineNumber: ancestorLine, indentWidth, mode: 'same' };
                        }
                    }
                }

                const outerLine = ancestors[ancestors.length - 1];
                const outerIndent = this.getListIndentWidthAtLine(doc, outerLine);
                if (typeof outerIndent === 'number') {
                    return { lineNumber: outerLine, indentWidth: outerIndent, mode: 'same' };
                }

                return null;
            }

            getListMarkerBounds(view: EditorView, lineNumber: number): { markerStartX: number; contentStartX: number } | null {
                if (lineNumber < 1 || lineNumber > view.state.doc.lines) return null;
                const line = view.state.doc.line(lineNumber);
                const quoteInfo = this.splitBlockquotePrefix(line.text);
                const parsed = this.parseListLine(quoteInfo.rest);
                if (!parsed.isListItem) return null;
                const markerStartPos = line.from + quoteInfo.prefix.length + parsed.indentRaw.length;
                const markerEndPos = markerStartPos + parsed.marker.length;
                const start = view.coordsAtPos(markerStartPos);
                const end = view.coordsAtPos(markerEndPos);
                if (!start || !end) return null;
                return { markerStartX: start.left, contentStartX: end.left };
            }

            getListIndentWidthAtLine(doc: { line: (n: number) => { text: string }; lines: number }, lineNumber: number): number | undefined {
                if (lineNumber < 1 || lineNumber > doc.lines) return undefined;
                const text = doc.line(lineNumber).text;
                const parsed = this.parseListLine(this.splitBlockquotePrefix(text).rest);
                if (!parsed.isListItem) return undefined;
                return parsed.indentWidth;
            }

            getListAncestorLineNumbers(doc: { line: (n: number) => { text: string }; lines: number }, lineNumber: number): number[] {
                const result: number[] = [];
                let currentIndent: number | null = null;

                for (let i = lineNumber; i >= 1; i--) {
                    const text = doc.line(i).text;
                    if (text.trim().length === 0) continue;
                    const parsed = this.parseListLine(this.splitBlockquotePrefix(text).rest);
                    if (!parsed.isListItem) {
                        if (currentIndent !== null) break;
                        continue;
                    }

                    if (currentIndent === null) {
                        currentIndent = parsed.indentWidth;
                        result.push(i);
                        continue;
                    }

                    if (parsed.indentWidth < currentIndent) {
                        currentIndent = parsed.indentWidth;
                        result.push(i);
                    }
                }

                return result;
            }

            getListChildIndentWidth(view: EditorView, lineNumber: number): number | undefined {
                const doc = view.state.doc;
                if (lineNumber < 1 || lineNumber > doc.lines) return undefined;
                const text = doc.line(lineNumber).text;
                const parsed = this.parseListLine(this.splitBlockquotePrefix(text).rest);
                if (!parsed.isListItem) return undefined;
                const parentIndent = parsed.indentWidth;
                for (let i = lineNumber + 1; i <= doc.lines; i++) {
                    const nextText = doc.line(i).text;
                    if (nextText.trim().length === 0) continue;
                    const nextParsed = this.parseListLine(this.splitBlockquotePrefix(nextText).rest);
                    if (!nextParsed.isListItem) break;
                    if (nextParsed.indentWidth <= parentIndent) break;
                    return nextParsed.indentWidth;
                }
                const tabSize = view.state.facet(EditorState.tabSize);
                const indentUnit = tabSize > 0 ? tabSize : 4;
                return parentIndent + indentUnit;
            }

            findNearestListAncestorBlock(state: EditorState, blockAtPos: BlockInfo, lineNumber: number): BlockInfo | null {
                const doc = state.doc;
                if (lineNumber < 1 || lineNumber > doc.lines) return null;

                const currentLine = doc.line(blockAtPos.startLine + 1).text;
                const currentParsed = this.parseListLine(this.splitBlockquotePrefix(currentLine).rest);
                if (!currentParsed.isListItem) return null;
                const currentIndent = currentParsed.indentWidth;

                for (let i = blockAtPos.startLine + 1; i >= 1; i--) {
                    const text = doc.line(i).text;
                    const parsed = this.parseListLine(this.splitBlockquotePrefix(text).rest);
                    if (!parsed.isListItem) continue;
                    if (parsed.indentWidth >= currentIndent) continue;

                    const block = detectBlock(state, i);
                    if (!block || block.type !== BlockType.ListItem) continue;
                    if (lineNumber - 1 <= block.endLine) return block;
                }

                return null;
            }

            getIndentUnitWidthFromDoc(doc: { line: (n: number) => { text: string }; lines: number }, state?: EditorState): number | undefined {
                let best = Number.POSITIVE_INFINITY;
                let prevIndent: number | null = null;

                for (let i = 1; i <= doc.lines; i++) {
                    const text = doc.line(i).text;
                    const parsed = this.parseListLine(this.splitBlockquotePrefix(text).rest);
                    if (!parsed.isListItem) continue;
                    if (prevIndent !== null && parsed.indentWidth > prevIndent) {
                        const delta = parsed.indentWidth - prevIndent;
                        if (delta > 0 && delta < best) best = delta;
                    }
                    prevIndent = parsed.indentWidth;
                }

                if (!isFinite(best)) {
                    if (state) {
                        const tabSize = state.facet(EditorState.tabSize);
                        return tabSize > 0 ? tabSize : undefined;
                    }
                    return undefined;
                }
                return Math.max(2, best);
            }


            buildTargetMarker(target: { markerType: 'ordered' | 'unordered' | 'task' }, source: { markerType: 'ordered' | 'unordered' | 'task' }): string {
                if (target.markerType === 'ordered') return '1. ';
                if (target.markerType === 'task') {
                    if (source.markerType === 'task') return source.marker.replace(/^\s*[-*+]\s\[[ xX]\]\s+/, '- [ ] ');
                    return '- [ ] ';
                }
                return '- ';
            }

            buildIndentStringFromSample(sample: string, width: number): string {
                const safeWidth = Math.max(0, width);
                if (safeWidth === 0) return '';
                if (sample.includes('\t')) {
                    const tabSize = this.getTabSize();
                    const tabs = Math.max(0, Math.round(safeWidth / tabSize));
                    return '\t'.repeat(tabs);
                }
                return ' '.repeat(safeWidth);
            }

            getIndentUnitWidth(sample: string): number {
                const tabSize = this.getTabSize();
                if (sample.includes('\t')) return tabSize;
                if (sample.length >= tabSize) return tabSize;
                return sample.length > 0 ? sample.length : tabSize;
            }

            getTabSize(): number {
                const tabSize = this.view?.state?.facet(EditorState.tabSize) ?? 4;
                return tabSize > 0 ? tabSize : 4;
            }

            getIndentWidthFromIndentRaw(indentRaw: string): number {
                const tabSize = this.getTabSize();
                let width = 0;
                for (const ch of indentRaw) {
                    width += ch === '\t' ? tabSize : 1;
                }
                return width;
            }

            renumberOrderedListAround(view: EditorView, lineNumber: number) {
                const doc = view.state.doc;
                if (lineNumber < 1 || lineNumber > doc.lines) return;

                const findOrderedAt = (n: number) => {
                    const text = doc.line(n).text;
                    const quoteInfo = this.splitBlockquotePrefix(text);
                    const parsed = this.parseListLine(quoteInfo.rest);
                    if (parsed.isListItem && parsed.markerType === 'ordered') {
                        return { indentWidth: parsed.indentWidth, quoteDepth: this.getBlockquoteDepthFromLine(text) };
                    }
                    return null;
                };

                let anchor = findOrderedAt(lineNumber);
                if (!anchor && lineNumber > 1) anchor = findOrderedAt(lineNumber - 1);
                if (!anchor && lineNumber < doc.lines) anchor = findOrderedAt(lineNumber + 1);
                if (!anchor) return;

                let start = lineNumber;
                while (start > 1) {
                    const info = findOrderedAt(start - 1);
                    if (!info || info.indentWidth !== anchor.indentWidth || info.quoteDepth !== anchor.quoteDepth) break;
                    start -= 1;
                }

                let end = lineNumber;
                while (end < doc.lines) {
                    const info = findOrderedAt(end + 1);
                    if (!info || info.indentWidth !== anchor.indentWidth || info.quoteDepth !== anchor.quoteDepth) break;
                    end += 1;
                }

                const changes: { from: number; to: number; insert: string }[] = [];
                let number = 1;
                for (let i = start; i <= end; i++) {
                    const line = doc.line(i);
                    const quoteInfo = this.splitBlockquotePrefix(line.text);
                    const parsed = this.parseListLine(quoteInfo.rest);
                    if (!parsed.isListItem || parsed.markerType !== 'ordered' || parsed.indentWidth !== anchor.indentWidth) continue;

                    const newMarker = `${number}. `;
                    const markerStart = line.from + quoteInfo.prefix.length + parsed.indentRaw.length;
                    const markerEnd = markerStart + parsed.marker.length;
                    changes.push({ from: markerStart, to: markerEnd, insert: newMarker });
                    number += 1;
                }

                if (changes.length > 0) {
                    view.dispatch({ changes });
                }
            }

            getDropTargetInfo(
                view: EditorView,
                info: { clientX: number; clientY: number; dragSource?: BlockInfo | null }
            ): {
                lineNumber: number;
                indicatorY: number;
                listContextLineNumber?: number;
                listIndentDelta?: number;
                listTargetIndentWidth?: number;
                lineRect?: { left: number; width: number };
                highlightRect?: { top: number; left: number; width: number; height: number };
            } | null {
                const dragSource = info.dragSource ?? null;
                const isSingleLineBlockquoteDrag = !!dragSource
                    && dragSource.type === BlockType.Blockquote
                    && dragSource.startLine === dragSource.endLine;
                const embedEl = this.getEmbedElementAtPoint(view, info.clientX, info.clientY);
                if (embedEl) {
                    const block = this.getBlockInfoForEmbed(view, embedEl);
                    if (block) {
                        const rect = embedEl.getBoundingClientRect();
                        const showAtBottom = info.clientY > rect.top + rect.height / 2;
                        const lineNumber = this.clampTargetLineNumber(view.state.doc.lines, showAtBottom ? block.endLine + 2 : block.startLine + 1);
                        const indicatorY = showAtBottom ? rect.bottom : rect.top;
                        return { lineNumber, indicatorY, lineRect: { left: rect.left, width: rect.width } };
                    }
                }

                const contentRect = view.contentDOM.getBoundingClientRect();
                const x = this.clampNumber(info.clientX, contentRect.left + 2, contentRect.right - 2);
                const pos = view.posAtCoords({ x, y: info.clientY });
                if (pos === null) return null;

                let line = view.state.doc.lineAt(pos);
                let showAtBottom = false;
                let forcedLineNumber: number | null = null;

                // 检测当前行是否在代码块或引用块内部
                const blockAtPos = detectBlock(view.state, line.number);

                // 如果在多行块（代码块、引用块、表格）内部，将指示器移到块边界
                if (blockAtPos && !isSingleLineBlockquoteDrag && (blockAtPos.type === BlockType.CodeBlock ||
                    blockAtPos.type === BlockType.Table ||
                    blockAtPos.type === BlockType.MathBlock)) {

                    // 判断鼠标位置更接近块的上边界还是下边界
                    const blockStartLine = view.state.doc.line(blockAtPos.startLine + 1);
                    const blockEndLine = view.state.doc.line(blockAtPos.endLine + 1);

                    const startCoords = view.coordsAtPos(blockStartLine.from);
                    const endCoords = view.coordsAtPos(blockEndLine.to);

                    if (startCoords && endCoords) {
                        const mouseY = info.clientY;
                        const midPoint = (startCoords.top + endCoords.bottom) / 2;

                        // 根据鼠标位置选择在块的上方或下方显示指示器
                        if (mouseY < midPoint) {
                            line = blockStartLine;
                            showAtBottom = false;
                            forcedLineNumber = blockAtPos.startLine + 1;
                        } else {
                            line = blockEndLine;
                            showAtBottom = true;
                            forcedLineNumber = blockAtPos.endLine + 2;
                        }
                    }
                }

                if (!forcedLineNumber) {
                    const lineStart = view.coordsAtPos(line.from);
                    const lineEnd = view.coordsAtPos(line.to);
                    if (lineStart && lineEnd) {
                        const midY = (lineStart.top + lineEnd.bottom) / 2;
                        showAtBottom = info.clientY > midY;
                    }
                }

                let listContextLineNumber: number | undefined = undefined;
                let listIndentDelta: number | undefined = undefined;
                let listTargetIndentWidth: number | undefined = undefined;
                let highlightRect: { top: number; left: number; width: number; height: number } | undefined = undefined;
                if (blockAtPos && blockAtPos.type === BlockType.ListItem) {
                    const blockStartLine = view.state.doc.line(blockAtPos.startLine + 1);
                    const blockEndLine = view.state.doc.line(blockAtPos.endLine + 1);
                    const startCoords = view.coordsAtPos(blockStartLine.from);
                    const endCoords = view.coordsAtPos(blockEndLine.to);

                    if (startCoords && endCoords) {
                        const mouseY = info.clientY;
                        const midPoint = (startCoords.top + endCoords.bottom) / 2;
                        if (mouseY < midPoint) {
                            line = blockStartLine;
                            showAtBottom = false;
                            forcedLineNumber = blockAtPos.startLine + 1;
                        } else {
                            line = blockEndLine;
                            showAtBottom = true;
                            forcedLineNumber = blockAtPos.endLine + 2;
                        }
                    }

                    const isSelfTarget = !!dragSource
                        && dragSource.type === BlockType.ListItem
                        && blockStartLine.number === dragSource.startLine + 1;
                    const allowChild = showAtBottom && !isSelfTarget;
                    const dropTarget = this.getListDropTarget(view, blockStartLine.number, info.clientX, allowChild);
                    if (dropTarget) {
                        listContextLineNumber = dropTarget.lineNumber;
                        listIndentDelta = dropTarget.mode === 'child' ? 1 : 0;
                        listTargetIndentWidth = dropTarget.indentWidth;
                        const highlightBlock = detectBlock(view.state, dropTarget.lineNumber);
                        if (highlightBlock && highlightBlock.type === BlockType.ListItem) {
                            highlightRect = this.getBlockRect(view, highlightBlock.startLine + 1, highlightBlock.endLine + 1);
                        }
                    }
                }

                const coords = showAtBottom
                    ? view.coordsAtPos(line.to)
                    : view.coordsAtPos(line.from);
                if (!coords) return null;

                const indicatorY = showAtBottom ? coords.bottom : coords.top;
                const lineNumber = forcedLineNumber ?? (showAtBottom ? line.number + 1 : line.number);
                let lineRect = this.getLineRect(view, line.number);
                if (typeof listTargetIndentWidth === 'number') {
                    const indentPos = this.getLineIndentPosByWidth(view, line.number, listTargetIndentWidth);
                    if (indentPos !== null) {
                        const start = view.coordsAtPos(indentPos);
                        const end = view.coordsAtPos(line.to);
                        if (start && end) {
                            const left = start.left;
                            const width = Math.max(8, (end.right ?? end.left) - left);
                            lineRect = { left, width };
                        }
                    }
                }
                return {
                    lineNumber: this.clampTargetLineNumber(view.state.doc.lines, lineNumber),
                    indicatorY,
                    listContextLineNumber,
                    listIndentDelta,
                    listTargetIndentWidth,
                    lineRect,
                    highlightRect,
                };
            }

            getEmbedElementAtPoint(view: EditorView, clientX: number, clientY: number): HTMLElement | null {
                const el = document.elementFromPoint(clientX, clientY) as HTMLElement | null;
                if (el) {
                    const direct = el.closest('.cm-embed-block, .cm-callout, .cm-preview-code-block, .cm-math, .MathJax_Display') as HTMLElement | null;
                    if (direct) {
                        return (direct.closest('.cm-embed-block') as HTMLElement | null) ?? direct;
                    }
                }

                const editorRect = view.dom.getBoundingClientRect();
                if (clientY < editorRect.top || clientY > editorRect.bottom) return null;
                if (clientX < editorRect.left || clientX > editorRect.right) return null;

                const embeds = Array.from(
                    view.dom.querySelectorAll('.cm-embed-block, .cm-callout, .cm-preview-code-block, .cm-math, .MathJax_Display')
                ) as HTMLElement[];

                let best: HTMLElement | null = null;
                let bestDist = Number.POSITIVE_INFINITY;
                for (const raw of embeds) {
                    const embed = (raw.closest('.cm-embed-block') as HTMLElement | null) ?? raw;
                    const rect = embed.getBoundingClientRect();
                    if (clientY >= rect.top && clientY <= rect.bottom) {
                        const centerY = (rect.top + rect.bottom) / 2;
                        const dist = Math.abs(centerY - clientY);
                        if (dist < bestDist) {
                            bestDist = dist;
                            best = embed;
                        }
                    }
                }

                return best;
            }

            getDragSourceBlock(e: DragEvent): BlockInfo | null {
                if (!e.dataTransfer) return null;
                const data = e.dataTransfer.getData('application/dnd-block');
                if (!data) return null;
                try {
                    return JSON.parse(data) as BlockInfo;
                } catch {
                    return null;
                }
            }

            getLineRect(view: EditorView, lineNumber: number): { left: number; width: number } | undefined {
                const doc = view.state.doc;
                if (lineNumber < 1 || lineNumber > doc.lines) return undefined;
                const line = doc.line(lineNumber);
                const start = view.coordsAtPos(line.from);
                const end = view.coordsAtPos(line.to);
                if (!start || !end) return undefined;
                const left = Math.min(start.left, end.left);
                const right = Math.max(start.left, end.left);
                return { left, width: Math.max(8, right - left) };
            }

            getLineIndentPosByWidth(view: EditorView, lineNumber: number, targetIndentWidth: number): number | null {
                const doc = view.state.doc;
                if (lineNumber < 1 || lineNumber > doc.lines) return null;
                const line = doc.line(lineNumber);
                const text = line.text;
                const tabSize = this.getTabSize();
                let width = 0;
                let idx = 0;
                while (idx < text.length && width < targetIndentWidth) {
                    const ch = text[idx];
                    if (ch === '\t') {
                        width += tabSize;
                    } else if (ch === ' ') {
                        width += 1;
                    } else {
                        break;
                    }
                    idx += 1;
                }
                return line.from + idx;
            }

            getBlockRect(view: EditorView, startLineNumber: number, endLineNumber: number): { top: number; left: number; width: number; height: number } | undefined {
                const doc = view.state.doc;
                if (startLineNumber < 1 || endLineNumber > doc.lines) return undefined;
                let minLeft = Number.POSITIVE_INFINITY;
                let maxRight = 0;
                let top = 0;
                let bottom = 0;

                for (let i = startLineNumber; i <= endLineNumber; i++) {
                    const line = doc.line(i);
                    const start = view.coordsAtPos(line.from);
                    const end = view.coordsAtPos(line.to);
                    if (!start || !end) continue;
                    if (i === startLineNumber) top = start.top;
                    if (i === endLineNumber) bottom = end.bottom;
                    const left = Math.min(start.left, end.left);
                    const right = Math.max(start.left, end.left);
                    minLeft = Math.min(minLeft, left);
                    maxRight = Math.max(maxRight, right);
                }

                if (!isFinite(minLeft) || maxRight === 0 || bottom <= top) return undefined;
                return { top, left: minLeft, width: Math.max(8, maxRight - minLeft), height: bottom - top };
            }

            clampNumber(value: number, min: number, max: number): number {
                if (value < min) return min;
                if (value > max) return max;
                return value;
            }

            destroy(): void {
                if (this.observer) {
                    this.observer.disconnect();
                }
                if (this.rafId !== null) {
                    cancelAnimationFrame(this.rafId);
                    this.rafId = null;
                }
                if (this.onScrollOrResize) {
                    this.view.scrollDOM.removeEventListener('scroll', this.onScrollOrResize);
                    window.removeEventListener('resize', this.onScrollOrResize);
                }
                if (this.onDeactivate) {
                    this.view.dom.removeEventListener('mouseleave', this.onDeactivate);
                    window.removeEventListener('blur', this.onDeactivate);
                }
                for (const [embedEl, entry] of this.embedHandles.entries()) {
                    embedEl.removeEventListener('mouseenter', entry.show);
                    embedEl.removeEventListener('mouseleave', entry.hide);
                    entry.handle.removeEventListener('mouseenter', entry.show);
                    entry.handle.removeEventListener('mouseleave', entry.hide);
                    entry.handle.remove();
                }
                this.embedHandles.clear();
                this.indicatorEl.remove();
                this.highlightEl.remove();
            }
        },
        {
            decorations: (v) => v.decorations,
        }
    );
}

/**
 * 创建拖拽手柄编辑器扩展
 */
export function dragHandleExtension(plugin: DragNDropPlugin): Extension {
    return [createDragHandleViewPlugin(plugin)];
}
