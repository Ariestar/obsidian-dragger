import { EditorView, ViewUpdate } from '@codemirror/view';
import DragNDropPlugin from '../../../plugin/main';
import {
    MOBILE_GESTURE_LOCK_CLASS,
    DRAGGING_BODY_CLASS,
    DRAG_HANDLE_CLASS,
} from '../../../shared/dom-selectors';
import { DropIndicatorManager } from '../preview/drop-indicator';
import { getVisibleHandleForBlockStart } from '../preview/handle-renderer';
import { HandleVisibilityController } from '../preview/handle-visibility-controller';
import { DraggerRuntime, type DragPreview, type DraggerPressInput } from '../../../drag/runtime';
import { buildIdleLifecycleEvent } from '../../../drag/pipeline/pipeline-output';
import { SemanticRefreshScheduler } from './semantic-refresh-scheduler';
import { DragPerfSessionManager } from './drag-perf-session-manager';
import { createEditorContext, EditorContext } from './editor-context';

import type { DragLifecycleEvent } from '../../../drag/pipeline/pipeline-output';
import { DND_DRAG_SOURCE_HIGHLIGHT_ATTR, DND_DRAG_SOURCE_STYLE_ATTR } from '../../../shared/dom-attrs';

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
import { createPointerInputSource, nativePointerEvent } from '../input/pointer-input-source';

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
                input: createPointerInputSource(this.view),
                doc: {
                    getDoc: () => this.view.state.doc,
                    applyChanges: (changes) => this.view.dispatch({ changes }),
                },
                locate: {
                    sourceLineFromInput: (input) => this.sourceLineFromInput(input),
                    targetLineFromPoint: (point) => this.context.selection.getLineNumberAtVerticalPosition(
                        point.y,
                        this.view.contentDOM.getBoundingClientRect()
                    ),
                },
                preview: (preview) => this.handleRuntimePreview(preview),
                config: () => ({
                    tabSize: this.context.tabSize,
                    longPressMs: plugin.isMobilePlatform()
                        ? plugin.settings.mobileDragLongPressMs
                        : plugin.settings.mouseRangeSelectLongPressMs,
                    dragStartMoveThresholdPx: plugin.isMobilePlatform() ? 8 : 4,
                    dragCancelMoveThresholdPx: plugin.isMobilePlatform() ? 12 : Number.POSITIVE_INFINITY,
                }),
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
                dragController: this.dragController,
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

        private sourceLineFromInput(input: DraggerPressInput): number | null {
            const event = nativePointerEvent(input.native);
            const target = event?.target instanceof HTMLElement ? event.target : null;
            const handle = target?.closest<HTMLElement>(`.${DRAG_HANDLE_CLASS}`);
            if (!handle) return null;
            const blockStart = Number(handle.getAttribute('data-block-start'));
            return Number.isInteger(blockStart) ? blockStart + 1 : null;
        }

        private handleRuntimePreview(preview: DragPreview | null): void {
            if (!preview || !preview.allowed || preview.targetLineNumber === null) {
                this.dropIndicator.hide();
                return;
            }
            const indicatorY = this.context.getInsertionAnchorY(preview.targetLineNumber);
            if (indicatorY === null) {
                this.dropIndicator.hide();
                return;
            }
            this.dropIndicator.scheduleRender({
                target: {
                    targetLineNumber: preview.targetLineNumber,
                    placement: 'before',
                },
                preview: {
                    indicatorY,
                    lineRect: this.context.getLineRect(preview.targetLineNumber),
                },
            }, preview.source, null);
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
            this.dragController.refreshSelectionVisual();
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
