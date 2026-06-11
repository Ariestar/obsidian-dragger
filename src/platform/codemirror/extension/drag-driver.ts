import { EditorView, ViewUpdate } from '@codemirror/view';
import DragNDropPlugin from '../../../plugin/main';
import {
    MOBILE_GESTURE_LOCK_CLASS,
    DRAGGING_BODY_CLASS,
} from '../../../shared/dom-selectors';
import {
    beginDragSession,
    finishDragSession,
    getActiveBlockSelection,
    getActiveBlockSelectionView,
} from './active-drag-registry';
import { isPosInsideRenderedTableCell } from '../../dom/table-guard';
import { applyMoveCommand, type MoveCommandApplierDeps } from '../transaction/move-command-applier';
import { DropTargetResolver, type DropTargetResolverDeps } from '../drop/drop-target-resolver';
import type { DropValidationResult } from '../drop/codemirror-drop-snapshot';
import { DropIndicatorManager } from '../preview/drop-indicator';
import { getVisibleHandleForBlockStart } from '../preview/handle-renderer';
import { HandleVisibilityController } from '../preview/handle-visibility-controller';
import { PipelineAdapter, type PipelineOutputExecutor } from '../input/pipeline-adapter';
import { buildIdleLifecycleEvent } from '../../../drag/pipeline/pipeline-output';
import { SemanticRefreshScheduler } from './semantic-refresh-scheduler';
import { DragPerfSessionManager } from './drag-perf-session-manager';
import { createEditorContext, EditorContext } from './editor-context';

import type { BlockSelection } from '../../../domain/selection/block-selection';
import type { DragDocumentRelation, DragSelectionScope } from '../drop/codemirror-drop-snapshot';
import type { DragLifecycleEvent } from '../../../drag/pipeline/pipeline-output';
import { DND_DRAG_SOURCE_HIGHLIGHT_ATTR, DND_DRAG_SOURCE_STYLE_ATTR } from '../../../shared/dom-attrs';
import { normalizeBlockSelectionVisualStyle } from '../../../plugin/settings';
import { resolveEditorDocumentKey } from '../../obsidian/editor-document-key';
import { createBlockFoldStateManager } from '../../obsidian/block-fold-state';
import {
    clearEditorRootClasses,
    ensureEditorRootClasses,
    syncBlockSelectionHighlightAttr,
    syncBlockSelectionStyleAttr,
} from './editor-dom-sync';
import { applyViewUpdate } from './editor-update';
import { destroyViewLifecycle, startViewLifecycle } from './editor-lifecycle';
import { placeHandleGutterForConfiguredSide } from './gutter';
import { GlobalPointerMoveClient } from './global-pointermove-router';
import { createHoverPointerSnapshot, HoverPointerSnapshot } from './hover-pointer-snapshot';
import {
    hidePointerDropPreviews,
    applyPointerBlockCommand,
    buildPointerBlockCommandAtPoint,
    PointerHitTestClient,
    registerPointerHitTestClient,
    showPointerDropPreview,
    resolvePointerDropSnapshotAtPoint,
} from '../input/pointer-hit-test';
import { openBlockTypeMenu } from '../../../plugin/block-type-menu';
import { buildMoveCommandDecision } from '../command/move-command-decision';
import type { BlockCommand } from '../../../domain/command/block-command';
import type { DragDropSnapshot } from '../../../drag/pipeline/pipeline-drop';
import type { DragCancelReason } from '../../../drag/pipeline/pipeline-event';

type CodeMirrorDragDropSnapshot = DragDropSnapshot<DropValidationResult>;

class DragLifecycleEmitter {
    private lastSignature: string | null = null;

    constructor(private readonly sink: (event: DragLifecycleEvent) => void) {}

    emit(event: DragLifecycleEvent): void {
        const signature = JSON.stringify({
            type: event.type,
            phase: event.phase,
            sourceStart: event.source?.anchorBlock.startLine ?? null,
            sourceEnd: event.source?.anchorBlock.endLine ?? null,
            sourceRanges: event.source?.ranges ?? null,
            targetLine: event.targetLine,
            listIntent: event.listIntent,
            rejectReason: event.rejectReason,
            pointerType: event.pointerType,
            pressReady: event.type === 'drag_press_pending' && event.pressReady === true,
        });
        if (signature === this.lastSignature) return;
        this.lastSignature = signature;
        this.sink(event);
    }
}

export function createCodeMirrorDragDriverPluginClass(plugin: DragNDropPlugin) {
    return class {
        private readonly view: EditorView;
        private readonly context: EditorContext;
        private readonly dropIndicator: DropIndicatorManager;
        private readonly dropTargetResolver: DropTargetResolver;
        private readonly moveCommandDeps: MoveCommandApplierDeps;
        private readonly pipelineAdapter: PipelineAdapter;
        private readonly handleVisibility: HandleVisibilityController;
        private readonly lifecycleEmitter = new DragLifecycleEmitter(
            (event) => plugin.emitDragLifecycleEvent(event)
        );
        private readonly dragPerfSessionManager: DragPerfSessionManager;
        private readonly semanticRefreshScheduler: SemanticRefreshScheduler;
        private readonly onDocumentPointerMove = (e: PointerEvent) => this.handleDocumentPointerMove(e);
        private readonly onSettingsUpdated = () => this.handleSettingsUpdated();
        private readonly pointerMoveClient: GlobalPointerMoveClient;
        private readonly pointerHitTestClient: PointerHitTestClient;
        private readonly unregisterPointerHitTestClient: () => void;
        private cachedHandleGutterSide: 'left' | 'right';

        constructor(view: EditorView) {
            this.view = view;
            this.cachedHandleGutterSide = this.resolveConfiguredHandleGutterSide();
            this.syncViewDomState();
            this.context = createEditorContext(this.view);
            this.handleVisibility = new HandleVisibilityController(this.view, {
                getBlockInfoForHandle: (handle) => this.context.selection.getBlockInfoForHandle(handle),
                getLineNumberAtVerticalPosition: (clientY, contentRect) => this.context.selection.getLineNumberAtVerticalPosition(clientY, contentRect),
                getDraggableBlockAtVerticalPosition: (clientY, contentRect) => this.context.selection.getDraggableBlockAtVerticalPosition(clientY, contentRect),
                getVisibleHandleForBlockStart: (blockStart) => getVisibleHandleForBlockStart(this.view, blockStart),
            });
            this.dragPerfSessionManager = new DragPerfSessionManager(this.view);
            const dropTargetResolverDeps: DropTargetResolverDeps = {
                tabSize: this.context.tabSize,
                parseLineWithQuote: this.context.parseLineWithQuote,
                getAdjustedTargetLocation: this.context.getAdjustedTargetLocation,
                resolveDropRuleAtInsertion: this.context.resolveDropRuleAtInsertion,
                getListContext: this.context.getListContext,
                getIndentUnitWidth: this.context.getIndentUnitWidth,
                getBlockInfoForEmbed: this.context.getBlockInfoForEmbed,
                getIndentUnitWidthForDoc: this.context.getIndentUnitWidthForDoc,
                getLineRect: this.context.getLineRect,
                getInsertionAnchorY: this.context.getInsertionAnchorY,
                getLineIndentPosByWidth: this.context.getLineIndentPosByWidth,
                getBlockRect: this.context.getBlockRect,
                recordPerfDuration: (key, durationMs) => {
                    this.dragPerfSessionManager.recordDuration(key, durationMs);
                },
                incrementPerfCounter: (key, delta = 1) => {
                    this.dragPerfSessionManager.incrementCounter(key, delta);
                },
            };
            this.dropTargetResolver = new DropTargetResolver(this.view, dropTargetResolverDeps);
            this.dropIndicator = new DropIndicatorManager(view, {
                    isDropHighlightEnabled: () => plugin.settings.enableListDropHighlight !== false,
                    onFrameMetrics: (metrics) => {
                        this.dragPerfSessionManager.incrementCounter('drop_indicator_frames');
                        if (metrics.skipped) {
                            this.dragPerfSessionManager.incrementCounter('drop_indicator_skipped_frames');
                        }
                        if (metrics.reused) {
                            this.dragPerfSessionManager.incrementCounter('drop_indicator_reused_frames');
                        }
                    },
                }
            );
            this.moveCommandDeps = {
                view: this.context.view,
                tabSize: this.context.tabSize,
                resolveDropRuleAtInsertion: this.context.resolveDropRuleAtInsertion,
                parseLineWithQuote: this.context.parseLineWithQuote,
                getListContext: this.context.getListContext,
                getIndentUnitWidth: this.context.getIndentUnitWidth,
                buildInsertText: this.context.buildInsertText,
                blockFoldState: createBlockFoldStateManager({
                    app: plugin.app,
                    parseLineWithQuote: this.context.parseLineWithQuote,
                }),
            };
            this.pointerHitTestClient = {
                containsPoint: (clientX, clientY) => this.containsPoint(clientX, clientY),
                resolveDropSnapshotAtPoint: (clientX, clientY, selection, pointerType) =>
                    this.resolveDropSnapshotAtPoint(selection, clientX, clientY, pointerType),
                showDropPreview: (selection, drop, pointerType) =>
                    this.showDropPreview(selection, drop, pointerType),
                hideDropPreview: () => this.dropIndicator.hide(),
                buildBlockCommandAtPoint: (source, clientX, clientY, pointerType) =>
                    this.buildBlockCommandAtPoint(source, clientX, clientY, pointerType),
                applyBlockCommand: (command) => this.applyBlockCommand(command),
            };
            this.unregisterPointerHitTestClient = registerPointerHitTestClient(this.pointerHitTestClient);
            const pipelineOutputExecutor: PipelineOutputExecutor = {
                showDropPreview: (selection, drop, pointerType) =>
                    showPointerDropPreview(
                        this.pointerHitTestClient,
                        selection,
                        drop,
                        pointerType ?? null
                    ),
                hideDropPreview: () => hidePointerDropPreviews(),
                applyCommand: (command) =>
                    applyPointerBlockCommand(this.pointerHitTestClient, command),
                emitLifecycle: (event) => {
                    this.handleSourceVisualByLifecycle(event);
                    this.emitDragLifecycle(event);
                },
            };
            this.pipelineAdapter = new PipelineAdapter(this.view, {
                resolveBlockSelection: (request) => this.context.selection.resolveSelection(request),
                getVisibleHandleForBlockStart: (blockStart) =>
                    getVisibleHandleForBlockStart(this.view, blockStart),
                isBlockInsideRenderedTableCell: (blockInfo) =>
                    isPosInsideRenderedTableCell(this.view, blockInfo.from, { skipLayoutRead: true }),
                isMultiLineSelectionEnabled: () => plugin.settings.enableMultiLineSelection,
                getMultiLineSelectionLongPressMs: () => plugin.settings.multiLineSelectionLongPressMs,
                isMobileDragModeEnabled: () => plugin.isMobileDragModeEnabled(),
                isMobileTextLongPressDragEnabled: () => plugin.settings.enableMobileTextLongPressDrag,
                beginPointerDragSession: (source) => {
                    this.ensureDragPerfSession();
                    beginDragSession(source, this.view);
                },
                finishDragSession: () => {
                    this.handleVisibility.clearGrabbedLineNumbers();
                    this.handleVisibility.setActiveVisibleHandle(null);
                    finishDragSession(this.view);
                    hidePointerDropPreviews();
                    this.flushDragPerfSession('finish_drag_session');
                    this.refreshDecorationsAndEmbeds();
                },
                resolveDropSnapshotAtPoint: (clientX, clientY, selection, pointerType) =>
                    resolvePointerDropSnapshotAtPoint(
                        this.pointerHitTestClient,
                        clientX,
                        clientY,
                        selection,
                        pointerType ?? null
                    ),
                buildBlockCommandAtPoint: (source, clientX, clientY, pointerType) =>
                    buildPointerBlockCommandAtPoint(
                        this.pointerHitTestClient,
                        source,
                        clientX,
                        clientY,
                        pointerType ?? null
                    ),
                pipelineOutputExecutor,
                openBlockTypeMenu: (blockInfo, event) => {
                    const anchor = Math.max(0, Math.min(this.view.state.doc.length, blockInfo.from));
                    this.view.dispatch({ selection: { anchor }, scrollIntoView: false });
                    openBlockTypeMenu(this.view, event);
                },
            });

            this.semanticRefreshScheduler = new SemanticRefreshScheduler(this.view, {
                performRefresh: () => this.refreshDecorationsAndEmbeds(),
            });
            this.pointerMoveClient = {
                view: this.view,
                onPointerMove: this.onDocumentPointerMove,
                clearPointerHover: () => this.handleVisibility.setActiveVisibleHandle(null),
            };

            startViewLifecycle({
                view: this.view,
                pipelineAdapter: this.pipelineAdapter,
                pointerMoveClient: this.pointerMoveClient,
                onSettingsUpdated: this.onSettingsUpdated,
            });

            this.syncViewDomState();
        }

        update(update: ViewUpdate) {
            this.syncViewDomState();
            applyViewUpdate(update, {
                refreshDecorationsAndEmbeds: () => this.refreshDecorationsAndEmbeds(),
                pipelineAdapter: this.pipelineAdapter,
                handleVisibility: this.handleVisibility,
                semanticRefreshScheduler: this.semanticRefreshScheduler,
                reResolveActiveHandle: () => {
                   // This is technically hard to satisfy without the pointer tracker,
                   // we can safely mock it or grab the center of current active handle.
                   const h = this.handleVisibility.getActiveHandle();
                   if (h) {
                        const rect = h.getBoundingClientRect();
                        this.reResolveActiveHandle(rect.left + rect.width / 2, rect.top + rect.height / 2);
                   }
                },
            });
        }

        destroy(): void {
            destroyViewLifecycle({
                semanticRefreshScheduler: this.semanticRefreshScheduler,
                pointerMoveClient: this.pointerMoveClient,
                onSettingsUpdated: this.onSettingsUpdated,
                pipelineAdapter: this.pipelineAdapter,
            });
            this.handleVisibility.clearGrabbedLineNumbers();
            this.handleVisibility.setActiveVisibleHandle(null);
            this.unregisterPointerHitTestClient();
            finishDragSession(this.view);
            this.flushDragPerfSession('destroy');
            clearEditorRootClasses(this.view);
            this.view.dom.removeAttribute(DND_DRAG_SOURCE_STYLE_ATTR);
            this.view.dom.removeAttribute(DND_DRAG_SOURCE_HIGHLIGHT_ATTR);
            this.dropIndicator.destroy();
            this.emitDragLifecycle(buildIdleLifecycleEvent());
        }

        private ensureDragPerfSession(): void {
            this.semanticRefreshScheduler.ensureSemanticReadyForInteraction();
            this.dragPerfSessionManager.ensure();
        }

        private flushDragPerfSession(reason: string): void {
            this.dragPerfSessionManager.flush(reason);
        }

        private emitDragLifecycle(event: DragLifecycleEvent): void {
            this.lifecycleEmitter.emit(event);
        }

        private resolveDropSnapshotAtPoint(source: BlockSelection, clientX: number, clientY: number, pointerType: string | null): CodeMirrorDragDropSnapshot {
            const sourceView = getActiveBlockSelectionView();
            const sourceScope: DragSelectionScope = sourceView && sourceView !== this.view
                ? 'cross_editor'
                : 'same_editor';
            const validation = this.dropTargetResolver.resolveValidatedDropTarget({
                clientX,
                clientY,
                selection: source,
                pointerType,
                sourceScope,
            });
            return {
                target: validation.allowed ? validation.resolution.target : null,
                rejectReason: validation.allowed ? null : (validation.reason ?? 'no_target'),
                previewData: validation,
            };
        }

        private buildBlockCommandAtPoint(source: BlockSelection, clientX: number, clientY: number, pointerType: string | null): {
            type: 'command';
            drop: CodeMirrorDragDropSnapshot;
            command: BlockCommand;
        } | {
            type: 'cancel';
            drop: CodeMirrorDragDropSnapshot;
            reason: DragCancelReason;
        } {
            this.ensureDragPerfSession();
            const sourceView = getActiveBlockSelectionView();
            const sourceScope: DragSelectionScope = sourceView && sourceView !== this.view
                ? 'cross_editor'
                : 'same_editor';
            const sourceDocumentRelation = this.resolveDragDocumentRelation(sourceView);
            const validation = this.dropTargetResolver.resolveValidatedDropTarget({
                clientX,
                clientY,
                selection: source,
                pointerType,
                sourceScope,
            });
            const decision = buildMoveCommandDecision({
                selection: source,
                validation,
                sourceScope,
                sourceDocumentRelation,
                crossFileDragEnabled: plugin.settings.enableCrossFileDrag === true,
            });
            const drop: CodeMirrorDragDropSnapshot = {
                target: decision.type === 'commit'
                    ? decision.command.target
                    : (validation.allowed ? validation.resolution.target : null),
                rejectReason: decision.type === 'cancel' ? decision.rejectReason : null,
                previewData: validation,
            };
            if (decision.type === 'cancel') {
                return { type: 'cancel', drop, reason: decision.rejectReason };
            }

            return { type: 'command', drop, command: decision.command };
        }

        private applyBlockCommand(command: BlockCommand): void {
            if (command.type !== 'move') return;
            const sourceView = getActiveBlockSelectionView();
            const sourceScope: DragSelectionScope = sourceView && sourceView !== this.view
                ? 'cross_editor'
                : 'same_editor';
            const sourceDocumentRelation = this.resolveDragDocumentRelation(sourceView);
            applyMoveCommand(this.moveCommandDeps, {
                command,
                sourceView: sourceScope === 'cross_editor' && sourceView ? sourceView : undefined,
                sourceDocumentRelation,
            });
        }

        private showDropPreview(selection: BlockSelection, drop: DragDropSnapshot, pointerType: string | null): void {
            const validation = drop.previewData as DropValidationResult | undefined;
            if (!validation) {
                this.dropIndicator.hide();
                return;
            }
            this.dropIndicator.scheduleRender(validation, selection, pointerType);
        }

        private resolveDragDocumentRelation(sourceView: EditorView | null): DragDocumentRelation {
            if (!sourceView || sourceView === this.view) {
                return 'same_document';
            }
            const sourceDocumentKey = resolveEditorDocumentKey(plugin.app, sourceView);
            const targetDocumentKey = resolveEditorDocumentKey(plugin.app, this.view);
            if (!sourceDocumentKey || !targetDocumentKey) {
                return 'different_document';
            }
            return sourceDocumentKey === targetDocumentKey
                ? 'same_document'
                : 'different_document';
        }

        private handleDocumentPointerMove(e: PointerEvent): void {
            if (activeDocument.body.classList.contains(MOBILE_GESTURE_LOCK_CLASS)) {
                return;
            }
            if (activeDocument.body.classList.contains(DRAGGING_BODY_CLASS)) {
                this.handleVisibility.setActiveVisibleHandle(null);
                return;
            }
            if (this.pipelineAdapter.isGestureActive()) {
                this.handleVisibility.setActiveVisibleHandle(this.handleVisibility.getActiveHandle());
                return;
            }
            const hoverSnapshot = this.createHoverPointerSnapshot(e.clientX, e.clientY);
            if (this.semanticRefreshScheduler.isPending && hoverSnapshot.withinHoverActivationZone) {
                this.semanticRefreshScheduler.ensureSemanticReadyForInteraction();
            }

            const directHandle = this.handleVisibility.resolveVisibleHandleFromTarget(e.target);
            if (directHandle) {
                this.handleVisibility.setActiveVisibleHandle(directHandle);
                return;
            }

            const handle = this.handleVisibility.resolveVisibleHandleFromPointer(hoverSnapshot);
            this.handleVisibility.setActiveVisibleHandle(handle);
        }

        private reResolveActiveHandle(lastX?: number, lastY?: number): void {
            if (lastX === undefined || lastY === undefined) return;
            const handle = this.handleVisibility.resolveVisibleHandleFromPointer(
                this.createHoverPointerSnapshot(lastX, lastY)
            );
            this.handleVisibility.setActiveVisibleHandle(handle);
        }

        private syncViewDomState(): void {
            ensureEditorRootClasses(this.view);
            placeHandleGutterForConfiguredSide(this.view, this.resolveConfiguredHandleGutterSide());
            syncBlockSelectionStyleAttr(this.view, normalizeBlockSelectionVisualStyle(plugin.settings.selectionVisualStyle));
            syncBlockSelectionHighlightAttr(this.view, this.isBlockSelectionHighlightEnabled());
        }

        private isBlockSelectionHighlightEnabled(): boolean {
            return plugin.settings.enableBlockSelectionHighlight !== false;
        }

        private refreshDecorationsAndEmbeds(): void {
            this.syncViewDomState();
            this.semanticRefreshScheduler.clearPendingSemanticRefresh();
        }

        private handleSettingsUpdated(): void {
            this.cachedHandleGutterSide = this.resolveConfiguredHandleGutterSide();
            this.syncViewDomState();
            this.pipelineAdapter.handleMobileDragAvailabilityChanged(
                plugin.isMobileDragModeEnabled()
            );
            this.refreshDecorationsAndEmbeds();
            this.pipelineAdapter.refreshSelectionVisual();
            this.handleVisibility.refreshGrabVisualState();
        }

        private createHoverPointerSnapshot(clientX: number, clientY: number): HoverPointerSnapshot {
            return createHoverPointerSnapshot(this.view, clientX, clientY, this.cachedHandleGutterSide);
        }

        private containsPoint(clientX: number, clientY: number): boolean {
            const rect = this.view.dom.getBoundingClientRect();
            return clientX >= rect.left
                && clientX <= rect.right
                && clientY >= rect.top
                && clientY <= rect.bottom;
        }

        private resolveConfiguredHandleGutterSide(): 'left' | 'right' {
            return plugin.settings.handleGutterPosition === 'right' ? 'right' : 'left';
        }

        private handleSourceVisualByLifecycle(event: DragLifecycleEvent): void {
            if (event.type === 'drag_press_pending') {
                if (event.pressReady && event.source && this.isBlockSelectionHighlightEnabled()) {
                    this.handleVisibility.enterGrabVisualState(event.source.ranges.map((range) => ({
                        startLineNumber: range.startLine + 1,
                        endLineNumber: range.endLine + 1,
                    })), null);
                } else {
                    // Pressing should not show drag-source highlight before long-press is ready.
                    this.handleVisibility.clearGrabbedLineNumbers();
                }
                return;
            }
            if (event.type === 'drag_started') {
                if (event.source && this.isBlockSelectionHighlightEnabled()) {
                    this.handleVisibility.enterGrabVisualState(event.source.ranges.map((range) => ({
                        startLineNumber: range.startLine + 1,
                        endLineNumber: range.endLine + 1,
                    })), null);
                } else if (!this.isBlockSelectionHighlightEnabled()) {
                    this.handleVisibility.clearGrabbedLineNumbers();
                }
                return;
            }
            if (event.type === 'drag_cancelled' || event.type === 'drag_idle') {
                if (getActiveBlockSelection(this.view)) return;
                this.handleVisibility.clearGrabbedLineNumbers();
                return;
            }
            if (event.type === 'drag_drop_commit') {
                this.handleVisibility.clearGrabbedLineNumbers();
            }
        }

        private resolveDragSelectionScope(): DragSelectionScope {
            const sourceView = getActiveBlockSelectionView();
            if (!sourceView || sourceView === this.view) {
                return 'same_editor';
            }
            return 'cross_editor';
        }
    };
}
