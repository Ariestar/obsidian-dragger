import { EditorView, ViewUpdate } from '@codemirror/view';
import DragNDropPlugin from '../../../plugin/main';
import {
    MOBILE_GESTURE_LOCK_CLASS,
    DRAGGING_BODY_CLASS,
} from '../../../shared/dom-selectors';
import { DropIndicatorManager } from './drop-indicator';
import { getVisibleHandleForBlockStart } from '../handle/handle-renderer';
import { HandleVisibilityController } from '../hover/handle-visibility-controller';
import { DraggerRuntime, buildIdleLifecycleEvent } from 'md-dragger/runtime';
import type { DragLifecycleEvent, Transition } from 'md-dragger/runtime';
import { SemanticRefreshScheduler } from '../perf/semantic-refresh-scheduler';
import { DragPerfSessionManager } from '../perf/drag-perf-session-manager';
import { createEditorContext, EditorContext } from './editor-context';
import { codeMirrorDocument } from './editor-document';
import { codeMirrorLocate } from './editor-locate';
import { renderDropPreview } from './editor-preview';
import { codeMirrorRuntimeConfig } from './runtime-config';
import { applyBlockTransaction } from '../transaction/transaction-applier';
import { DND_DRAG_SOURCE_HIGHLIGHT_ATTR, DND_DRAG_SOURCE_STYLE_ATTR } from '../../../shared/dom-attrs';

import {
    clearEditorRootClasses,
    ensureEditorRootClasses,
    syncBlockSelectionHighlightAttr,
    syncBlockSelectionStyleAttr,
} from './editor-dom-sync';
import { applyViewUpdate } from './editor-update';
import { destroyViewLifecycle, startViewLifecycle } from './editor-lifecycle';
import { placeHandleGutterForConfiguredSide } from '../handle/gutter';
import { GlobalPointerMoveClient } from '../hover/global-pointermove-router';
import { createHoverPointerSnapshot, HoverPointerSnapshot } from '../hover/hover-pointer-snapshot';
import { pointerInput } from 'md-dragger/adapter/codemirror';

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
        private readonly dragController: DraggerRuntime;
        private readonly handleVisibility: HandleVisibilityController;
        private readonly lifecycleEmitter = new DragLifecycleEmitter(
            (event) => plugin.emitDragLifecycleEvent(event)
        );
        private readonly dragPerfSessionManager: DragPerfSessionManager;
        private readonly semanticRefreshScheduler: SemanticRefreshScheduler;
        private readonly onDocumentPointerMove = (e: PointerEvent) => this.handleDocumentPointerMove(e);
        private readonly onSettingsUpdated = () => this.handleSettingsUpdated();
        private readonly pointerMoveClient: GlobalPointerMoveClient;
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
            this.dragController = new DraggerRuntime({
                input: pointerInput(this.view),
                document: codeMirrorDocument(this.view),
                locate: codeMirrorLocate(this.view, this.context),
                commit: {
                    apply: (commit) => applyBlockTransaction(this.view, commit),
                },
                output: {
                    onResult: (transition) => this.handleTransition(transition),
                },
                config: codeMirrorRuntimeConfig(plugin, this.context),
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
                dragController: this.dragController,
                pointerMoveClient: this.pointerMoveClient,
                onSettingsUpdated: this.onSettingsUpdated,
            });

            this.syncViewDomState();
        }

        update(update: ViewUpdate) {
            this.syncViewDomState();
            applyViewUpdate(update, {
                refreshDecorationsAndEmbeds: () => this.refreshDecorationsAndEmbeds(),
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
                dragController: this.dragController,
            });
            this.handleVisibility.clearGrabbedLineNumbers();
            this.handleVisibility.setActiveVisibleHandle(null);
            this.flushDragPerfSession('destroy');
            clearEditorRootClasses(this.view);
            this.view.dom.removeAttribute(DND_DRAG_SOURCE_STYLE_ATTR);
            this.view.dom.removeAttribute(DND_DRAG_SOURCE_HIGHLIGHT_ATTR);
            this.dropIndicator.destroy();
            this.emitDragLifecycle(buildIdleLifecycleEvent());
        }

        private flushDragPerfSession(reason: string): void {
            this.dragPerfSessionManager.flush(reason);
        }

        private emitDragLifecycle(event: DragLifecycleEvent): void {
            this.lifecycleEmitter.emit(event);
        }

        // Projects platform visuals + lifecycle from the runtime's single
        // output stream. The headless runtime is a pure broadcaster now; the
        // drop indicator and lifecycle emitter are derived here from
        // transition.outputs (this is where the previously-dropped lifecycle
        // events finally reach the plugin).
        private handleTransition(transition: Transition): void {
            for (const output of transition.outputs) {
                switch (output.type) {
                    case 'drag_over':
                        renderDropPreview(this.context, this.dropIndicator, {
                            source: output.selection,
                            target: output.drop.target,
                            allowed: output.drop.rejectReason == null,
                        });
                        break;
                    case 'dropped':
                    case 'cancelled':
                    case 'terminal':
                        this.dropIndicator.hide();
                        break;
                    case 'lifecycle':
                        this.emitDragLifecycle(output.event);
                        break;
                }
            }
        }

        private handleDocumentPointerMove(e: PointerEvent): void {
            if (activeDocument.body.classList.contains(MOBILE_GESTURE_LOCK_CLASS)) {
                return;
            }
            if (activeDocument.body.classList.contains(DRAGGING_BODY_CLASS)) {
                this.handleVisibility.setActiveVisibleHandle(null);
                return;
            }
            if (this.dragController.isGestureActive()) {
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
            syncBlockSelectionStyleAttr(this.view, plugin.settings.selectionVisualStyle);
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
            this.dragController.handleMobileDragAvailabilityChanged(
                plugin.isMobileDragModeEnabled()
            );
            this.refreshDecorationsAndEmbeds();
            this.handleVisibility.refreshGrabVisualState();
        }

        private createHoverPointerSnapshot(clientX: number, clientY: number): HoverPointerSnapshot {
            return createHoverPointerSnapshot(this.view, clientX, clientY, this.cachedHandleGutterSide);
        }

        private resolveConfiguredHandleGutterSide(): 'left' | 'right' {
            return plugin.settings.handleGutterPosition === 'right' ? 'right' : 'left';
        }
    };
}
