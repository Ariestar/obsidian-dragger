import { EditorView, ViewUpdate } from '@codemirror/view';
import DragNDropPlugin from '../../../plugin/main';
import {
    MOBILE_GESTURE_LOCK_CLASS,
    DRAGGING_BODY_CLASS,
} from '../../../shared/dom-selectors';
import { DropIndicatorManager } from './drop-indicator';
import { getVisibleHandleForBlockStart } from '../handle/handle-renderer';
import { HandleVisibilityController } from '../hover/handle-visibility-controller';
import { DraggerRuntime } from 'md-dragger/runtime';
import type { Change, Point } from 'md-dragger/runtime';
import { openBlockTypeMenu } from '../../../plugin/block-type-menu';
import { DRAG_HANDLE_CLASS } from '../../../shared/dom-selectors';
import { SemanticRefreshScheduler } from '../perf/semantic-refresh-scheduler';
import { DragPerfSessionManager } from '../perf/drag-perf-session-manager';
import { createEditorContext, EditorContext } from './editor-context';
import { codeMirrorDocument } from './editor-document';
import { codeMirrorLocate } from './editor-locate';
import { registerDragTarget, resolveDragTargetAtPoint, type DragTargetEntry } from './drag-target-registry';
import { renderDropPreview, type DropPreviewInput } from './editor-preview';
import { codeMirrorRuntimeConfig, codeMirrorGestureConfig } from './runtime-config';
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

export function createCodeMirrorDragDriverPluginClass(plugin: DragNDropPlugin) {
    return class {
        private readonly view: EditorView;
        private readonly context: EditorContext;
        private readonly dropIndicator: DropIndicatorManager;
        private readonly dragController: DraggerRuntime;
        private readonly handleVisibility: HandleVisibilityController;
        private readonly dragPerfSessionManager: DragPerfSessionManager;
        private readonly semanticRefreshScheduler: SemanticRefreshScheduler;
        private readonly onDocumentPointerMove = (e: PointerEvent) => this.handleDocumentPointerMove(e);
        private readonly onSettingsUpdated = () => this.handleSettingsUpdated();
        private readonly onEnterMobileSelectionMode = (e: Event) => this.handleEnterMobileSelectionMode(e);
        private readonly onPointerDown = (e: PointerEvent) => {
            this.lastPressOnHandle = (e.target instanceof HTMLElement)
                ? e.target.closest(`.${DRAG_HANDLE_CLASS}`) !== null
                : false;
            this.lastPressEvent = this.lastPressOnHandle ? e : null;
        };
        private readonly pointerMoveClient: GlobalPointerMoveClient;
        private cachedHandleGutterSide: 'left' | 'right';
        private lastPressOnHandle = false;
        private lastPressEvent: PointerEvent | null = null;
        // The editor under the live drag pointer (this view or another), refreshed
        // on every resolveDropTarget. Drives cross-file indicator rendering and the
        // target-side commit dispatch.
        private currentTargetEntry: DragTargetEntry | null = null;
        private lastIndicatorEntry: DragTargetEntry | null = null;
        private readonly unregisterDragTarget: () => void;
        private readonly resolveTargetView = (point: Point): EditorView | null => {
            const entry = resolveDragTargetAtPoint(point.x, point.y);
            this.currentTargetEntry = entry;
            return entry?.view ?? null;
        };

        constructor(view: EditorView) {
            this.view = view;
            this.cachedHandleGutterSide = this.resolveConfiguredHandleGutterSide();
            this.syncViewDomState();
            this.view.dom.addEventListener('pointerdown', this.onPointerDown, true);
            this.view.dom.addEventListener('dnd:enter-mobile-selection-mode', this.onEnterMobileSelectionMode);
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
            this.unregisterDragTarget = registerDragTarget({
                view: this.view,
                context: this.context,
                dropIndicator: this.dropIndicator,
            });
            this.dragController = new DraggerRuntime({
                input: pointerInput(this.view),
                document: codeMirrorDocument(this.view),
                locate: codeMirrorLocate(this.view, this.context, this.resolveTargetView),
                commit: {
                    // Route each edit to the view that owns its doc — source view
                    // for an in-file drop, target view for a cross-file drop.
                    apply: (edits) => {
                        for (const edit of edits) {
                            const view = edit.doc === this.view.state.doc
                                ? this.view
                                : (this.currentTargetEntry?.view ?? this.view);
                            applyBlockTransaction(view, edit);
                        }
                    },
                },
                onChange: (output) => this.handleChange(output),
                config: codeMirrorRuntimeConfig(plugin, this.context),
                gestureConfig: () => codeMirrorGestureConfig(plugin),
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
            this.view.dom.removeEventListener('pointerdown', this.onPointerDown, true);
            this.view.dom.removeEventListener('dnd:enter-mobile-selection-mode', this.onEnterMobileSelectionMode);
            this.hideDragIndicator();
            this.clearDragSourceVisual();
            this.unregisterDragTarget();
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
        }

        private flushDragPerfSession(reason: string): void {
            this.dragPerfSessionManager.flush(reason);
        }

        // Projects platform visuals from the runtime's output stream, and
        // recognizes handle tap (a platform ux concern — the runtime only
        // broadcasts a cancel; whether that cancel is a "tap on the handle
        // that should open the block-type menu" is the plugin's decision,
        // using its own press-origin tracking).
        private handleChange(output: Change): void {
            for (const item of output.outputs) {
                switch (item.type) {
                    case 'drag_over':
                        this.renderDropPreviewOnTarget({
                            source: item.selection,
                            target: item.drop.target,
                            allowed: item.drop.rejectReason == null,
                        });
                        // Highlight the multi-block drag source every frame.
                        this.applyDragSourceVisual(item.selection);
                        break;
                    case 'selection_changed':
                        // Range-select drawing in progress: preview the (multi-block)
                        // selection as the grab highlight so the user sees what they
                        // are sweeping. null = selection cleared → drop the highlight.
                        if (item.selection) {
                            this.applyDragSourceVisual(item.selection);
                        } else {
                            this.clearDragSourceVisual();
                        }
                        break;
                    case 'dropped':
                        this.hideDragIndicator();
                        this.clearDragSourceVisual();
                        plugin.notifyDragDrop();
                        break;
                    case 'cancelled':
                        this.hideDragIndicator();
                        this.clearDragSourceVisual();
                        if (item.reason === 'press_cancelled' && this.lastPressOnHandle) {
                            const startLine = item.selection?.anchorBlock?.startLine;
                            if (typeof startLine === 'number') {
                                openBlockTypeMenu(this.view, this.lastPressEvent, startLine + 1);
                            }
                            this.lastPressEvent = null;
                        }
                        break;
                    case 'terminal':
                        this.hideDragIndicator();
                        this.clearDragSourceVisual();
                        break;
                }
            }
        }

        // Paint the drag-source / selection highlight over every range of the
        // selection (multi-block aware) and lock the body for the drag gesture.
        private applyDragSourceVisual(selection: { ranges: Array<{ startLine: number; endLine: number }> }): void {
            const ranges = selection.ranges.map((range) => ({
                startLineNumber: range.startLine + 1,
                endLineNumber: range.endLine + 1,
            }));
            this.handleVisibility.enterGrabVisualState(ranges, this.handleVisibility.getActiveHandle());
            activeDocument.body.classList.add(DRAGGING_BODY_CLASS);
        }

        private clearDragSourceVisual(): void {
            this.handleVisibility.clearGrabbedLineNumbers();
            activeDocument.body.classList.remove(DRAGGING_BODY_CLASS);
        }

        // Renders the drop indicator on whichever editor the pointer is over —
        // the source view for an in-file drag, or the target view for a
        // cross-file drag. Switches (and hides the previous) as the pointer
        // crosses between editors.
        private renderDropPreviewOnTarget(preview: DropPreviewInput): void {
            const entry = this.currentTargetEntry;
            if (this.lastIndicatorEntry !== entry) {
                this.lastIndicatorEntry?.dropIndicator.hide();
                this.lastIndicatorEntry = entry;
            }
            if (!entry) return;
            renderDropPreview(entry.context, entry.dropIndicator, preview);
        }

        private hideDragIndicator(): void {
            this.lastIndicatorEntry?.dropIndicator.hide();
            this.lastIndicatorEntry = null;
            this.currentTargetEntry = null;
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

        // Mobile toolbar "select multiple blocks" command: enter range-select
        // anchored on the current cursor line, no long-press. The command
        // dispatches the event on the editor dom and reads back `handled`.
        private handleEnterMobileSelectionMode(event: Event): void {
            const detail = (event as CustomEvent<{ handled: boolean }>).detail;
            const lineNumber = this.view.state.doc.lineAt(this.view.state.selection.main.head).number;
            this.dragController.enterRangeSelectionMode(lineNumber);
            if (detail) detail.handled = true;
        }

        private createHoverPointerSnapshot(clientX: number, clientY: number): HoverPointerSnapshot {
            return createHoverPointerSnapshot(this.view, clientX, clientY, this.cachedHandleGutterSide);
        }

        private resolveConfiguredHandleGutterSide(): 'left' | 'right' {
            return plugin.settings.handleGutterPosition === 'right' ? 'right' : 'left';
        }
    };
}
