import { Extension } from '@codemirror/state';
import {
    EditorView,
    ViewPlugin,
    ViewUpdate,
} from '@codemirror/view';
import { BlockInfo, DragLifecycleEvent } from '../types';
import DragNDropPlugin from '../main';
import {
    ROOT_EDITOR_CLASS,
    MAIN_EDITOR_CONTENT_CLASS,
    MOBILE_GESTURE_LOCK_CLASS,
    DRAGGING_BODY_CLASS,
} from './core/selectors';
import {
    getActiveDragSourceBlock,
} from './core/session';
import {
    isPosInsideRenderedTableCell,
} from './core/table-guard';
import { prewarmFenceScan } from './core/block-detector';
import { BlockMover } from './movers/BlockMover';
import { DropIndicatorManager } from './managers/DropIndicatorManager';
import { DropTargetCalculator } from './handlers/DropTargetCalculator';
import { DragEventHandler } from './handlers/DragEventHandler';
import {
    beginDragSession,
    finishDragSession,
    getDragSourceBlockFromEvent,
    startDragFromHandle,
} from './handlers/DragTransfer';
import { createDragHandleElement } from './core/handle-dom';
import { LineHandleManager } from './managers/LineHandleManager';
import { EmbedHandleManager } from './managers/EmbedHandleManager';
import { HandleVisibilityController } from './managers/HandleVisibilityController';
import { SemanticRefreshScheduler } from './managers/SemanticRefreshScheduler';
import { LineMapPrewarmer } from './managers/LineMapPrewarmer';
import { DragPerfSessionManager } from './managers/DragPerfSessionManager';
import { ServiceContainer } from './core/ServiceContainer';
import { hasVisibleLineNumberGutter } from './core/handle-position';
import {
    DragLifecycleEmitter,
    buildListIntent,
} from './core/DragLifecycleEmitter';

/**
 * 创建拖拽手柄ViewPlugin
 */
function createDragHandleViewPlugin(_plugin: DragNDropPlugin) {
    return ViewPlugin.fromClass(
        class {
            // decorations removed - now using LineHandleManager with independent DOM elements
            view: EditorView;
            services: ServiceContainer;
            dropIndicator: DropIndicatorManager;
            blockMover: BlockMover;
            dropTargetCalculator: DropTargetCalculator;
            lineHandleManager: LineHandleManager;
            embedHandleManager: EmbedHandleManager;
            dragEventHandler: DragEventHandler;
            handleVisibility: HandleVisibilityController;
            private readonly lifecycleEmitter = new DragLifecycleEmitter(
                (event) => _plugin.emitDragLifecycleEvent(event)
            );
            private readonly lineMapPrewarmer = new LineMapPrewarmer();
            dragPerfManager: DragPerfSessionManager;
            semanticRefreshScheduler: SemanticRefreshScheduler;
            private readonly onDocumentPointerMove = (e: PointerEvent) => this.handleDocumentPointerMove(e);
            private readonly onSettingsUpdated = () => this.handleSettingsUpdated();

            constructor(view: EditorView) {
                this.view = view;
                this.view.dom.classList.add(ROOT_EDITOR_CLASS);
                this.view.contentDOM.classList.add(MAIN_EDITOR_CONTENT_CLASS);
                this.syncGutterClass();
                this.services = new ServiceContainer(this.view);
                this.handleVisibility = new HandleVisibilityController(this.view, {
                    getBlockInfoForHandle: (handle) => this.services.dragSource.getBlockInfoForHandle(handle),
                    getDraggableBlockAtPoint: (clientX, clientY) => this.services.dragSource.getDraggableBlockAtPoint(clientX, clientY),
                    isManagedEmbedHandle: (handle) => this.embedHandleManager?.isManagedHandle(handle) ?? false,
                });
                this.dragPerfManager = new DragPerfSessionManager(this.view);
                this.dropTargetCalculator = new DropTargetCalculator(this.view,
                    this.services.buildDropTargetCalculatorDeps({
                        recordPerfDuration: (key, durationMs) => {
                            this.dragPerfManager.recordDuration(key, durationMs);
                        },
                        incrementPerfCounter: (key, delta = 1) => {
                            this.dragPerfManager.incrementCounter(key, delta);
                        },
                        onDragTargetEvaluated: ({ sourceBlock, pointerType, validation }) => {
                            if (!sourceBlock) return;
                            this.emitDragLifecycle({
                                state: 'drag_active',
                                sourceBlock,
                                targetLine: validation.targetLineNumber ?? null,
                                listIntent: buildListIntent({
                                    listContextLineNumber: validation.listContextLineNumber,
                                    listIndentDelta: validation.listIndentDelta,
                                    listTargetIndentWidth: validation.listTargetIndentWidth,
                                }),
                                rejectReason: validation.allowed ? null : (validation.reason ?? null),
                                pointerType: pointerType ?? null,
                            });
                        },
                    }),
                );
                this.dropIndicator = new DropIndicatorManager(view, (info) =>
                    this.dropTargetCalculator.getDropTargetInfo({
                        clientX: info.clientX,
                        clientY: info.clientY,
                        dragSource: info.dragSource ?? getActiveDragSourceBlock(this.view) ?? null,
                        pointerType: info.pointerType ?? null,
                    })
                    , {
                        recordPerfDuration: (key, durationMs) => {
                            this.dragPerfManager.recordDuration(key, durationMs);
                        },
                        onFrameMetrics: (metrics) => {
                            this.dragPerfManager.incrementCounter('drop_indicator_frames');
                            if (metrics.skipped) {
                                this.dragPerfManager.incrementCounter('drop_indicator_skipped_frames');
                            }
                            if (metrics.reused) {
                                this.dragPerfManager.incrementCounter('drop_indicator_reused_frames');
                            }
                        },
                    }
                );
                this.blockMover = new BlockMover({
                    view: this.view,
                    ...this.services.buildBlockMoverDeps(),
                });
                this.lineHandleManager = new LineHandleManager(this.view, {
                    createHandleElement: this.createHandleElement.bind(this),
                    getDraggableBlockAtLine: (lineNumber) => this.services.dragSource.getDraggableBlockAtLine(lineNumber),
                    shouldRenderLineHandles: () => true,
                });
                this.embedHandleManager = new EmbedHandleManager(this.view, {
                    createHandleElement: this.createHandleElement.bind(this),
                    resolveBlockInfoForEmbed: (embedEl) => this.services.dragSource.getBlockInfoForEmbed(embedEl),
                    shouldRenderEmbedHandles: () => true,
                });
                this.dragEventHandler = new DragEventHandler(this.view, {
                    getDragSourceBlock: (e) => getDragSourceBlockFromEvent(e, this.view),
                    getBlockInfoForHandle: (handle) =>
                        this.resolveInteractionBlockInfo({
                            handle,
                            clientX: Number.NaN,
                            clientY: Number.NaN,
                        }),
                    getBlockInfoAtPoint: (clientX, clientY) =>
                        this.resolveInteractionBlockInfo({
                            clientX,
                            clientY,
                        }),
                    isBlockInsideRenderedTableCell: (blockInfo) =>
                        isPosInsideRenderedTableCell(this.view, blockInfo.from, { skipLayoutRead: true }),
                    isMultiLineSelectionEnabled: () => _plugin.settings.enableMultiLineSelection,
                    beginPointerDragSession: (blockInfo) => {
                        this.ensureDragPerfSession();
                        const startLineNumber = blockInfo.startLine + 1;
                        const endLineNumber = blockInfo.endLine + 1;
                        this.handleVisibility.enterGrabVisualState(startLineNumber, endLineNumber, null);
                        beginDragSession(blockInfo, this.view);
                    },
                    finishDragSession: () => {
                        this.handleVisibility.clearGrabbedLineNumbers();
                        this.handleVisibility.setActiveVisibleHandle(null);
                        finishDragSession(this.view);
                        this.flushDragPerfSession('finish_drag_session');
                        this.refreshDecorationsAndEmbeds();
                    },
                    scheduleDropIndicatorUpdate: (clientX, clientY, dragSource, pointerType) =>
                        this.dropIndicator.scheduleFromPoint(clientX, clientY, dragSource, pointerType ?? null),
                    hideDropIndicator: () => this.dropIndicator.hide(),
                    performDropAtPoint: (sourceBlock, clientX, clientY, pointerType) =>
                        this.performDropAtPoint(sourceBlock, clientX, clientY, pointerType ?? null),
                    onDragLifecycleEvent: (event) => this.emitDragLifecycle(event),
                });

                this.semanticRefreshScheduler = new SemanticRefreshScheduler(this.view, {
                    performRefresh: () => this.refreshDecorationsAndEmbeds(),
                    isGestureActive: () => this.dragEventHandler.isGestureActive(),
                    refreshSelectionVisual: () => this.dragEventHandler.refreshSelectionVisual(),
                });

                this.lineHandleManager.start();
                this.dragEventHandler.attach();
                this.embedHandleManager.start();
                this.semanticRefreshScheduler.bindViewportScrollFallback();
                document.addEventListener('pointermove', this.onDocumentPointerMove, { passive: true });
                window.addEventListener('dnd:settings-updated', this.onSettingsUpdated);

                // Pre-warm fence scan during idle to ensure code/math block boundaries are ready
                const warmupFenceScan = () => prewarmFenceScan(view.state.doc);
                const requestIdle = (window as any).requestIdleCallback as
                    | ((cb: () => void, options?: { timeout?: number }) => number)
                    | undefined;
                if (typeof requestIdle === 'function') {
                    requestIdle(warmupFenceScan, { timeout: 1000 });
                } else {
                    window.setTimeout(warmupFenceScan, 100);
                }
            }

            update(update: ViewUpdate) {
                // Viewport changes have highest priority - refresh visible decorations immediately
                if (update.viewportChanged) {
                    this.refreshDecorationsAndEmbeds();
                    this.dragEventHandler.refreshSelectionVisual();
                    // Deferred rescan to catch layout shifts after viewport/file switch
                    this.lineHandleManager.scheduleScan();
                    // Still schedule line-map prewarm if doc changed
                    if (update.docChanged) {
                        this.lineMapPrewarmer.schedule(update);
                    }
                    const activeHandle = this.handleVisibility.getActiveHandle();
                    if (activeHandle && !activeHandle.isConnected) {
                        this.handleVisibility.setActiveVisibleHandle(null);
                    }
                    return;
                }

                if (update.docChanged) {
                    // Mark semantic refresh pending - LineHandleManager will update on refresh
                    this.semanticRefreshScheduler.markSemanticRefreshPending();
                    this.lineMapPrewarmer.schedule(update);
                } else if (update.geometryChanged) {
                    this.refreshDecorationsAndEmbeds();
                }

                if (update.docChanged || update.geometryChanged) {
                    this.dragEventHandler.refreshSelectionVisual();
                }
                const activeHandle2 = this.handleVisibility.getActiveHandle();
                if (activeHandle2 && !activeHandle2.isConnected) {
                    this.handleVisibility.setActiveVisibleHandle(null);
                }
            }

            createHandleElement(getBlockInfo: () => BlockInfo | null): HTMLElement {
                const handle = createDragHandleElement({
                    onDragStart: (e, el) => {
                        this.semanticRefreshScheduler.ensureSemanticReadyForInteraction();
                        const resolveCurrentBlock = () => this.resolveInteractionBlockInfo({
                            handle,
                            clientX: e.clientX,
                            clientY: e.clientY,
                            fallback: getBlockInfo,
                        });
                        const sourceBlock = resolveCurrentBlock();
                        if (sourceBlock) {
                            this.handleVisibility.enterGrabVisualState(
                                sourceBlock.startLine + 1,
                                sourceBlock.endLine + 1,
                                el
                            );
                        } else {
                            this.handleVisibility.setActiveVisibleHandle(el);
                        }
                        const started = startDragFromHandle(e, this.view, () => resolveCurrentBlock(), el);
                        if (!started) {
                            this.handleVisibility.setActiveVisibleHandle(null);
                            finishDragSession(this.view);
                            this.flushDragPerfSession('drag_start_failed');
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
                        this.ensureDragPerfSession();
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
                        this.handleVisibility.clearGrabbedLineNumbers();
                        this.handleVisibility.setActiveVisibleHandle(null);
                        finishDragSession(this.view);
                        this.flushDragPerfSession('drag_end');
                        this.refreshDecorationsAndEmbeds();
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
                    this.semanticRefreshScheduler.ensureSemanticReadyForInteraction();
                    const resolveCurrentBlock = () => this.resolveInteractionBlockInfo({
                        handle,
                        clientX: e.clientX,
                        clientY: e.clientY,
                        fallback: getBlockInfo,
                    });
                    const shouldPrimePointerVisual = !(
                        e.pointerType === 'mouse'
                        && !_plugin.settings.enableMultiLineSelection
                    );
                    if (shouldPrimePointerVisual) {
                        const blockInfo = resolveCurrentBlock();
                        if (blockInfo) {
                            this.handleVisibility.enterGrabVisualState(
                                blockInfo.startLine + 1,
                                blockInfo.endLine + 1,
                                handle
                            );
                        } else {
                            this.handleVisibility.setActiveVisibleHandle(handle);
                        }
                    }
                    this.dragEventHandler.startPointerDragFromHandle(handle, e, () => resolveCurrentBlock());
                });
                return handle;
            }

            performDropAtPoint(sourceBlock: BlockInfo, clientX: number, clientY: number, pointerType: string | null): void {
                this.ensureDragPerfSession();
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
                        listIntent: buildListIntent({
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
                    listIntent: buildListIntent({
                        listContextLineNumber: validation.listContextLineNumber,
                        listIndentDelta: validation.listIndentDelta,
                        listTargetIndentWidth: validation.listTargetIndentWidth,
                    }),
                    rejectReason: null,
                    pointerType,
                });
            }

            destroy(): void {
                this.lineMapPrewarmer.clear();
                this.semanticRefreshScheduler.destroy();
                document.removeEventListener('pointermove', this.onDocumentPointerMove);
                window.removeEventListener('dnd:settings-updated', this.onSettingsUpdated);
                this.handleVisibility.clearGrabbedLineNumbers();
                this.handleVisibility.setActiveVisibleHandle(null);
                finishDragSession(this.view);
                this.flushDragPerfSession('destroy');
                this.dragEventHandler.destroy();
                this.lineHandleManager.destroy();
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
                if (document.body.classList.contains(MOBILE_GESTURE_LOCK_CLASS)) {
                    return;
                }
                if (document.body.classList.contains(DRAGGING_BODY_CLASS)) {
                    this.handleVisibility.setActiveVisibleHandle(null, { preserveHoveredLineNumber: true });
                    return;
                }
                if (this.dragEventHandler.isGestureActive()) {
                    this.handleVisibility.setActiveVisibleHandle(this.handleVisibility.getActiveHandle(), { preserveHoveredLineNumber: true });
                    return;
                }
                if (this.semanticRefreshScheduler.isPending && this.handleVisibility.isPointerInHandleInteractionZone(e.clientX, e.clientY)) {
                    this.semanticRefreshScheduler.ensureSemanticReadyForInteraction();
                }

                const directHandle = this.handleVisibility.resolveVisibleHandleFromTarget(e.target);
                if (directHandle) {
                    this.handleVisibility.setActiveVisibleHandle(directHandle);
                    return;
                }

                // When line numbers are visible, keep the original behavior:
                // only show the hovered handle itself.
                if (hasVisibleLineNumberGutter(this.view)) {
                    this.handleVisibility.setActiveVisibleHandle(null);
                    return;
                }

                // Without line numbers, hovering anywhere on the current line's right area
                // should reveal the left handle for that line.
                const handle = this.handleVisibility.resolveVisibleHandleFromPointerWhenLineNumbersHidden(e.clientX, e.clientY);
                this.handleVisibility.setActiveVisibleHandle(handle);
            }

            private emitDragLifecycle(event: DragLifecycleEvent): void {
                this.lifecycleEmitter.emit(event);
            }

            private ensureDragPerfSession(): void {
                this.semanticRefreshScheduler.ensureSemanticReadyForInteraction();
                this.dragPerfManager.ensure();
            }

            private flushDragPerfSession(reason: string): void {
                this.dragPerfManager.flush(reason);
            }


            private syncGutterClass(): void {
                const hasGutter = hasVisibleLineNumberGutter(this.view);
                this.view.dom.classList.toggle('dnd-no-gutter', !hasGutter);
            }

            private refreshDecorationsAndEmbeds(): void {
                this.syncGutterClass();
                this.semanticRefreshScheduler.clearPendingSemanticRefresh();
                this.lineHandleManager.scheduleScan({ urgent: true });
                this.embedHandleManager.scheduleScan({ urgent: true });
            }

            private handleSettingsUpdated(): void {
                this.refreshDecorationsAndEmbeds();
                this.dragEventHandler.refreshSelectionVisual();
            }

            private resolveInteractionBlockInfo(params: {
                handle?: HTMLElement | null;
                clientX: number;
                clientY: number;
                fallback?: () => BlockInfo | null;
                allowRefreshRetry?: boolean;
            }): BlockInfo | null {
                const allowRefreshRetry = params.allowRefreshRetry !== false;
                const resolveOnce = (): BlockInfo | null => {
                    if (params.handle) {
                        let fromHandle: BlockInfo | null = null;
                        try {
                            fromHandle = this.services.dragSource.getBlockInfoForHandle(params.handle);
                        } catch {
                            fromHandle = null;
                        }
                        if (fromHandle) {
                            this.syncHandleBlockAttributes(params.handle, fromHandle);
                            return fromHandle;
                        }
                    }

                    if (Number.isFinite(params.clientX) && Number.isFinite(params.clientY)) {
                        let fromPoint: BlockInfo | null = null;
                        try {
                            fromPoint = this.services.dragSource.getDraggableBlockAtPoint(params.clientX, params.clientY);
                        } catch {
                            fromPoint = null;
                        }
                        if (fromPoint) {
                            this.syncHandleBlockAttributes(params.handle ?? null, fromPoint);
                            return fromPoint;
                        }
                    }

                    const fromFallback = params.fallback?.() ?? null;
                    if (fromFallback) {
                        this.syncHandleBlockAttributes(params.handle ?? null, fromFallback);
                    }
                    return fromFallback;
                };

                const first = resolveOnce();
                if (first || !allowRefreshRetry) return first;

                // Refresh decorations and retry - use coordinates since handle may be stale
                this.refreshDecorationsAndEmbeds();

                if (Number.isFinite(params.clientX) && Number.isFinite(params.clientY)) {
                    try {
                        const fromPoint = this.services.dragSource.getDraggableBlockAtPoint(params.clientX, params.clientY);
                        if (fromPoint) {
                            this.syncHandleBlockAttributes(params.handle ?? null, fromPoint);
                            return fromPoint;
                        }
                    } catch {
                        // fall through
                    }
                }

                return params.fallback?.() ?? null;
            }

            private syncHandleBlockAttributes(handle: HTMLElement | null, blockInfo: BlockInfo): void {
                if (!handle || !handle.isConnected) return;
                handle.setAttribute('data-block-start', String(blockInfo.startLine));
                handle.setAttribute('data-block-end', String(blockInfo.endLine));
            }
        }
        // No decorations config - LineHandleManager uses independent DOM elements
    );
}

/**
 * 创建拖拽手柄编辑器扩展
 */
export function dragHandleExtension(plugin: DragNDropPlugin): Extension {
    return [createDragHandleViewPlugin(plugin)];
}
