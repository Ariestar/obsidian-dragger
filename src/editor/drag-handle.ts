import { Extension } from '@codemirror/state';
import {
    EditorView,
    ViewPlugin,
    ViewUpdate,
    DecorationSet,
} from '@codemirror/view';
import { BlockInfo, DragLifecycleEvent, DragListIntent } from '../types';
import DragNDropPlugin from '../main';
import {
    ROOT_EDITOR_CLASS,
    MAIN_EDITOR_CONTENT_CLASS,
} from './core/selectors';
import {
    getActiveDragSourceBlock,
} from './core/session';
import {
    isPosInsideRenderedTableCell,
} from './core/table-guard';
import { getPreviousNonEmptyLineNumber as getPreviousNonEmptyLineNumberInDoc } from './core/container-policies';
import { BlockMover } from './movers/BlockMover';
import { DropIndicatorManager } from './managers/DropIndicatorManager';
import { DropTargetCalculator } from './handlers/DropTargetCalculator';
import { DragEventHandler } from './handlers/DragEventHandler';
import { DragSourceResolver } from './handlers/DragSourceResolver';
import { LineParsingService } from './handlers/LineParsingService';
import { GeometryCalculator } from './handlers/GeometryCalculator';
import { ContainerPolicyService } from './handlers/ContainerPolicyService';
import { TextMutationPolicy } from './handlers/TextMutationPolicy';
import {
    beginDragSession,
    finishDragSession,
    getDragSourceBlockFromEvent,
    startDragFromHandle,
} from './handlers/DragTransfer';
import { createDragHandleElement } from './core/handle-dom';
import { DecorationManager } from './managers/DecorationManager';
import { EmbedHandleManager } from './managers/EmbedHandleManager';
import { getLineNumberElementForLine, hasVisibleLineNumberGutter } from './core/handle-position';
import { clampNumber, clampTargetLineNumber } from './utils/coordinate-utils';

const HOVER_HIDDEN_LINE_NUMBER_CLASS = 'dnd-line-number-hover-hidden';

/**
 * 创建拖拽手柄ViewPlugin
 */
function createDragHandleViewPlugin(_plugin: DragNDropPlugin) {
    return ViewPlugin.fromClass(
        class {
            decorations: DecorationSet;
            view: EditorView;
            dropIndicator: DropIndicatorManager;
            blockMover: BlockMover;
            dropTargetCalculator: DropTargetCalculator;
            lineParsingService: LineParsingService;
            geometryCalculator: GeometryCalculator;
            containerPolicyService: ContainerPolicyService;
            textMutationPolicy: TextMutationPolicy;
            decorationManager: DecorationManager;
            embedHandleManager: EmbedHandleManager;
            dragEventHandler: DragEventHandler;
            dragSourceResolver: DragSourceResolver;
            private hiddenHoveredLineNumberEl: HTMLElement | null = null;
            private currentHoveredLineNumber: number | null = null;
            private activeVisibleHandle: HTMLElement | null = null;
            private lastLifecycleSignature: string | null = null;
            private readonly onDocumentPointerMove = (e: PointerEvent) => this.handleDocumentPointerMove(e);

            constructor(view: EditorView) {
                this.view = view;
                this.view.dom.classList.add(ROOT_EDITOR_CLASS);
                this.view.contentDOM.classList.add(MAIN_EDITOR_CONTENT_CLASS);
                this.dragSourceResolver = new DragSourceResolver(this.view);
                this.lineParsingService = new LineParsingService(this.view);
                this.geometryCalculator = new GeometryCalculator(this.view, this.lineParsingService);
                this.containerPolicyService = new ContainerPolicyService(this.view);
                this.textMutationPolicy = new TextMutationPolicy(this.lineParsingService);
                this.dropTargetCalculator = new DropTargetCalculator(this.view, {
                    parseLineWithQuote: this.textMutationPolicy.parseLineWithQuote.bind(this.textMutationPolicy),
                    getAdjustedTargetLocation: this.geometryCalculator.getAdjustedTargetLocation.bind(this.geometryCalculator),
                    clampTargetLineNumber,
                    getPreviousNonEmptyLineNumber: getPreviousNonEmptyLineNumberInDoc,
                    resolveDropRuleAtInsertion:
                        this.containerPolicyService.resolveDropRuleAtInsertion.bind(this.containerPolicyService),
                    getListContext: this.textMutationPolicy.getListContext.bind(this.textMutationPolicy),
                    getIndentUnitWidth: this.textMutationPolicy.getIndentUnitWidth.bind(this.textMutationPolicy),
                    getBlockInfoForEmbed: (embedEl) => this.dragSourceResolver.getBlockInfoForEmbed(embedEl),
                    getIndentUnitWidthForDoc: this.textMutationPolicy.getIndentUnitWidthForDoc.bind(this.textMutationPolicy),
                    getLineRect: this.geometryCalculator.getLineRect.bind(this.geometryCalculator),
                    getInsertionAnchorY: this.geometryCalculator.getInsertionAnchorY.bind(this.geometryCalculator),
                    getLineIndentPosByWidth: this.geometryCalculator.getLineIndentPosByWidth.bind(this.geometryCalculator),
                    getBlockRect: this.geometryCalculator.getBlockRect.bind(this.geometryCalculator),
                    clampNumber,
                    onDragTargetEvaluated: ({ sourceBlock, pointerType, validation }) => {
                        if (!sourceBlock) return;
                        this.emitDragLifecycle({
                            state: 'drag_active',
                            sourceBlock,
                            targetLine: validation.targetLineNumber ?? null,
                            listIntent: this.buildListIntent({
                                listContextLineNumber: validation.listContextLineNumber,
                                listIndentDelta: validation.listIndentDelta,
                                listTargetIndentWidth: validation.listTargetIndentWidth,
                            }),
                            rejectReason: validation.allowed ? null : (validation.reason ?? null),
                            pointerType: pointerType ?? null,
                        });
                    },
                });
                this.dropIndicator = new DropIndicatorManager(view, (info) =>
                    this.dropTargetCalculator.getDropTargetInfo({
                        clientX: info.clientX,
                        clientY: info.clientY,
                        dragSource: info.dragSource ?? getActiveDragSourceBlock(this.view) ?? null,
                        pointerType: info.pointerType ?? null,
                    })
                );
                this.blockMover = new BlockMover({
                    view: this.view,
                    clampTargetLineNumber,
                    getAdjustedTargetLocation: this.geometryCalculator.getAdjustedTargetLocation.bind(this.geometryCalculator),
                    resolveDropRuleAtInsertion:
                        this.containerPolicyService.resolveDropRuleAtInsertion.bind(this.containerPolicyService),
                    parseLineWithQuote: this.textMutationPolicy.parseLineWithQuote.bind(this.textMutationPolicy),
                    getListContext: this.textMutationPolicy.getListContext.bind(this.textMutationPolicy),
                    getIndentUnitWidth: this.textMutationPolicy.getIndentUnitWidth.bind(this.textMutationPolicy),
                    buildInsertText: this.textMutationPolicy.buildInsertText.bind(this.textMutationPolicy),
                });
                this.decorationManager = new DecorationManager({
                    view: this.view,
                    createHandleElement: this.createHandleElement.bind(this),
                    getDraggableBlockAtLine: (lineNumber) => this.dragSourceResolver.getDraggableBlockAtLine(lineNumber),
                    shouldRenderInlineHandles: () => true,
                });
                this.embedHandleManager = new EmbedHandleManager(this.view, {
                    createHandleElement: this.createHandleElement.bind(this),
                    resolveBlockInfoForEmbed: (embedEl) => this.dragSourceResolver.getBlockInfoForEmbed(embedEl),
                    shouldRenderEmbedHandles: () => true,
                });
                this.dragEventHandler = new DragEventHandler(this.view, {
                    getDragSourceBlock: (e) => getDragSourceBlockFromEvent(e, this.view),
                    getBlockInfoForHandle: (handle) => this.dragSourceResolver.getBlockInfoForHandle(handle),
                    getBlockInfoAtPoint: (clientX, clientY) => this.dragSourceResolver.getDraggableBlockAtPoint(clientX, clientY),
                    isBlockInsideRenderedTableCell: (blockInfo) =>
                        isPosInsideRenderedTableCell(this.view, blockInfo.from, { skipLayoutRead: true }),
                    beginPointerDragSession: (blockInfo) => {
                        const lineNumber = blockInfo.startLine + 1;
                        if (lineNumber >= 1 && lineNumber <= this.view.state.doc.lines) {
                            this.setHoveredLineNumber(lineNumber);
                        }
                        this.setActiveVisibleHandle(null, { preserveHoveredLineNumber: true });
                        beginDragSession(blockInfo, this.view);
                    },
                    finishDragSession: () => {
                        this.setActiveVisibleHandle(null);
                        finishDragSession(this.view);
                    },
                    scheduleDropIndicatorUpdate: (clientX, clientY, dragSource, pointerType) =>
                        this.dropIndicator.scheduleFromPoint(clientX, clientY, dragSource, pointerType ?? null),
                    hideDropIndicator: () => this.dropIndicator.hide(),
                    performDropAtPoint: (sourceBlock, clientX, clientY, pointerType) =>
                        this.performDropAtPoint(sourceBlock, clientX, clientY, pointerType ?? null),
                    onDragLifecycleEvent: (event) => this.emitDragLifecycle(event),
                });

                this.decorations = this.decorationManager.buildDecorations();
                this.dragEventHandler.attach();
                this.embedHandleManager.start();
                document.addEventListener('pointermove', this.onDocumentPointerMove, { passive: true });
            }

            update(update: ViewUpdate) {
                if (update.docChanged || update.viewportChanged || update.geometryChanged) {
                    this.decorations = this.decorationManager.buildDecorations();
                    this.embedHandleManager.scheduleScan();
                }
                if (this.activeVisibleHandle && !this.activeVisibleHandle.isConnected) {
                    this.setActiveVisibleHandle(null);
                }
            }
            createHandleElement(getBlockInfo: () => BlockInfo | null): HTMLElement {
                const handle = createDragHandleElement({
                    onDragStart: (e, el) => {
                        this.setActiveVisibleHandle(el);
                        const sourceBlock = getBlockInfo();
                        const started = startDragFromHandle(e, this.view, () => sourceBlock ?? getBlockInfo(), el);
                        if (!started) {
                            this.setActiveVisibleHandle(null);
                            finishDragSession(this.view);
                            this.emitDragLifecycle({
                                state: 'cancelled',
                                sourceBlock: sourceBlock ?? null,
                                targetLine: null,
                                listIntent: null,
                                rejectReason: 'drag_start_failed',
                                pointerType: 'mouse',
                            });
                            this.emitDragLifecycle({
                                state: 'idle',
                                sourceBlock: null,
                                targetLine: null,
                                listIntent: null,
                                rejectReason: null,
                                pointerType: null,
                            });
                            return;
                        }
                        this.emitDragLifecycle({
                            state: 'drag_active',
                            sourceBlock: sourceBlock ?? null,
                            targetLine: null,
                            listIntent: null,
                            rejectReason: null,
                            pointerType: 'mouse',
                        });
                    },
                    onDragEnd: () => {
                        this.setActiveVisibleHandle(null);
                        finishDragSession(this.view);
                        this.emitDragLifecycle({
                            state: 'idle',
                            sourceBlock: null,
                            targetLine: null,
                            listIntent: null,
                            rejectReason: null,
                            pointerType: null,
                        });
                    },
                });
                handle.addEventListener('pointerdown', (e: PointerEvent) => {
                    const blockInfo = getBlockInfo();
                    this.setActiveVisibleHandle(handle);
                    if (blockInfo) {
                        const lineNumber = blockInfo.startLine + 1;
                        if (lineNumber >= 1 && lineNumber <= this.view.state.doc.lines) {
                            this.setHoveredLineNumber(lineNumber);
                        }
                    }
                    this.dragEventHandler.startPointerDragFromHandle(handle, e, () => blockInfo ?? getBlockInfo());
                });
                return handle;
            }

            performDropAtPoint(sourceBlock: BlockInfo, clientX: number, clientY: number, pointerType: string | null): void {
                const view = this.view;
                const validation = this.dropTargetCalculator.resolveValidatedDropTarget({
                    clientX,
                    clientY,
                    dragSource: sourceBlock,
                    pointerType,
                });
                if (!validation.allowed || typeof validation.targetLineNumber !== 'number') {
                    this.emitDragLifecycle({
                        state: 'cancelled',
                        sourceBlock,
                        targetLine: validation.targetLineNumber ?? null,
                        listIntent: this.buildListIntent({
                            listContextLineNumber: validation.listContextLineNumber,
                            listIndentDelta: validation.listIndentDelta,
                            listTargetIndentWidth: validation.listTargetIndentWidth,
                        }),
                        rejectReason: validation.reason ?? 'no_target',
                        pointerType,
                    });
                    return;
                }

                const targetLineNumber = validation.targetLineNumber;
                const targetPos = targetLineNumber > view.state.doc.lines
                    ? view.state.doc.length
                    : view.state.doc.line(targetLineNumber).from;

                this.blockMover.moveBlock({
                    sourceBlock,
                    targetPos,
                    targetLineNumberOverride: targetLineNumber,
                    listContextLineNumberOverride: validation.listContextLineNumber,
                    listIndentDeltaOverride: validation.listIndentDelta,
                    listTargetIndentWidthOverride: validation.listTargetIndentWidth,
                });
                this.emitDragLifecycle({
                    state: 'drop_commit',
                    sourceBlock,
                    targetLine: targetLineNumber,
                    listIntent: this.buildListIntent({
                        listContextLineNumber: validation.listContextLineNumber,
                        listIndentDelta: validation.listIndentDelta,
                        listTargetIndentWidth: validation.listTargetIndentWidth,
                    }),
                    rejectReason: null,
                    pointerType,
                });
            }

            destroy(): void {
                document.removeEventListener('pointermove', this.onDocumentPointerMove);
                this.setActiveVisibleHandle(null);
                finishDragSession(this.view);
                this.dragEventHandler.destroy();
                this.view.dom.classList.remove(ROOT_EDITOR_CLASS);
                this.view.contentDOM.classList.remove(MAIN_EDITOR_CONTENT_CLASS);
                this.embedHandleManager.destroy();
                this.dropIndicator.destroy();
                this.emitDragLifecycle({
                    state: 'idle',
                    sourceBlock: null,
                    targetLine: null,
                    listIntent: null,
                    rejectReason: null,
                    pointerType: null,
                });
            }

            private handleDocumentPointerMove(e: PointerEvent): void {
                if (document.body.classList.contains('dnd-mobile-gesture-lock')) {
                    return;
                }
                if (document.body.classList.contains('dnd-dragging')) {
                    this.setActiveVisibleHandle(null, { preserveHoveredLineNumber: true });
                    return;
                }

                const directHandle = this.resolveVisibleHandleFromTarget(e.target);
                if (directHandle) {
                    this.setActiveVisibleHandle(directHandle);
                    return;
                }

                // When line numbers are visible, keep the original behavior:
                // only show the hovered handle itself.
                if (hasVisibleLineNumberGutter(this.view)) {
                    this.setActiveVisibleHandle(null);
                    return;
                }

                // Without line numbers, hovering anywhere on the current line's right area
                // should reveal the left handle for that line.
                const handle = this.resolveVisibleHandleFromPointerWhenLineNumbersHidden(e.clientX, e.clientY);
                this.setActiveVisibleHandle(handle);
            }

            private clearHoveredLineNumber(): void {
                if (this.hiddenHoveredLineNumberEl) {
                    this.hiddenHoveredLineNumberEl.classList.remove(HOVER_HIDDEN_LINE_NUMBER_CLASS);
                }
                this.hiddenHoveredLineNumberEl = null;
                this.currentHoveredLineNumber = null;
            }

            private setHoveredLineNumber(lineNumber: number): void {
                if (this.currentHoveredLineNumber === lineNumber && this.hiddenHoveredLineNumberEl) {
                    return;
                }
                const lineNumberEl = getLineNumberElementForLine(this.view, lineNumber);
                if (!lineNumberEl) {
                    this.clearHoveredLineNumber();
                    return;
                }
                this.clearHoveredLineNumber();
                lineNumberEl.classList.add(HOVER_HIDDEN_LINE_NUMBER_CLASS);
                this.hiddenHoveredLineNumberEl = lineNumberEl;
                this.currentHoveredLineNumber = lineNumber;
            }

            private setActiveVisibleHandle(
                handle: HTMLElement | null,
                options?: { preserveHoveredLineNumber?: boolean }
            ): void {
                const preserveHoveredLineNumber = options?.preserveHoveredLineNumber === true;
                if (this.activeVisibleHandle === handle) {
                    if (!handle && !preserveHoveredLineNumber) {
                        this.clearHoveredLineNumber();
                    }
                    return;
                }
                if (this.activeVisibleHandle) {
                    this.activeVisibleHandle.classList.remove('is-visible');
                }

                this.activeVisibleHandle = handle;
                if (!handle) {
                    if (!preserveHoveredLineNumber) {
                        this.clearHoveredLineNumber();
                    }
                    return;
                }

                handle.classList.add('is-visible');
                const lineNumber = this.resolveHandleLineNumber(handle);
                if (!lineNumber) {
                    this.clearHoveredLineNumber();
                    return;
                }
                this.setHoveredLineNumber(lineNumber);
            }

            private buildListIntent(raw: {
                listContextLineNumber?: number;
                listIndentDelta?: number;
                listTargetIndentWidth?: number;
            }): DragListIntent | null {
                if (
                    typeof raw.listContextLineNumber !== 'number'
                    && typeof raw.listIndentDelta !== 'number'
                    && typeof raw.listTargetIndentWidth !== 'number'
                ) {
                    return null;
                }
                return {
                    listContextLineNumber: raw.listContextLineNumber,
                    listIndentDelta: raw.listIndentDelta,
                    listTargetIndentWidth: raw.listTargetIndentWidth,
                };
            }

            private emitDragLifecycle(event: DragLifecycleEvent): void {
                const payload: DragLifecycleEvent = {
                    state: event.state,
                    sourceBlock: event.sourceBlock ?? null,
                    targetLine: typeof event.targetLine === 'number' ? event.targetLine : null,
                    listIntent: event.listIntent ?? null,
                    rejectReason: event.rejectReason ?? null,
                    pointerType: event.pointerType ?? null,
                };
                const signature = JSON.stringify({
                    state: payload.state,
                    sourceStart: payload.sourceBlock?.startLine ?? null,
                    sourceEnd: payload.sourceBlock?.endLine ?? null,
                    targetLine: payload.targetLine,
                    listIntent: payload.listIntent,
                    rejectReason: payload.rejectReason,
                    pointerType: payload.pointerType,
                });
                if (signature === this.lastLifecycleSignature) return;
                this.lastLifecycleSignature = signature;
                _plugin.emitDragLifecycleEvent(payload);
            }

            private resolveVisibleHandleFromTarget(target: EventTarget | null): HTMLElement | null {
                if (!(target instanceof HTMLElement)) return null;

                const directHandle = target.closest('.dnd-drag-handle') as HTMLElement | null;
                if (!directHandle) return null;
                if (this.view.dom.contains(directHandle) || this.embedHandleManager.isManagedHandle(directHandle)) {
                    return directHandle;
                }
                return null;
            }

            private resolveVisibleHandleFromPointerWhenLineNumbersHidden(clientX: number, clientY: number): HTMLElement | null {
                const contentRect = this.view.contentDOM.getBoundingClientRect();
                if (
                    clientX < contentRect.left
                    || clientX > contentRect.right
                    || clientY < contentRect.top
                    || clientY > contentRect.bottom
                ) {
                    return null;
                }

                const blockInfo = this.dragSourceResolver.getDraggableBlockAtPoint(clientX, clientY);
                if (!blockInfo) return null;
                return this.resolveVisibleHandleForBlock(blockInfo);
            }

            private resolveVisibleHandleForBlock(blockInfo: BlockInfo): HTMLElement | null {
                const selector = `.dnd-drag-handle[data-block-start="${blockInfo.startLine}"]`;
                const candidates = Array.from(this.view.dom.querySelectorAll(selector)) as HTMLElement[];
                if (candidates.length === 0) return null;

                const inlineHandle = candidates.find((handle) => !handle.classList.contains('dnd-embed-handle'));
                if (inlineHandle) return inlineHandle;

                return candidates.find((handle) => this.embedHandleManager.isManagedHandle(handle)) ?? null;
            }

            private resolveHandleLineNumber(handle: HTMLElement): number | null {
                const startAttr = handle.getAttribute('data-block-start');
                if (startAttr !== null) {
                    const lineNumber = Number(startAttr) + 1;
                    if (Number.isInteger(lineNumber) && lineNumber >= 1 && lineNumber <= this.view.state.doc.lines) {
                        return lineNumber;
                    }
                }

                const blockInfo = this.dragSourceResolver.getBlockInfoForHandle(handle);
                if (!blockInfo) return null;
                const lineNumber = blockInfo.startLine + 1;
                if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > this.view.state.doc.lines) {
                    return null;
                }
                return lineNumber;
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
