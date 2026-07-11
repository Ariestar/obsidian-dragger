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
import type { PipelineResult, Point } from 'md-dragger/runtime';
import { openBlockTypeMenu } from '../../../plugin/block-type-menu';
import { SemanticRefreshScheduler } from '../perf/semantic-refresh-scheduler';
import { DragPerfSessionManager } from '../perf/drag-perf-session-manager';
import { createEditorContext, EditorContext } from './editor-context';
import { codeMirrorDocument } from './editor-document';
import { codeMirrorLocate } from './editor-locate';
import { registerDragTarget, resolveDragTargetAtPoint, resolveDragTargetByDoc, type DragTargetEntry } from './drag-target-registry';
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

type SelectionVisual = {
    ranges: Array<{ startLine: number; endLine: number }>;
};

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
            // Snapshot press geometry for block-type menu open.
            this.lastPressEvent = e;
            if (plugin.isMobilePlatform() && plugin.isMobileDragModeEnabled()) {
                // Claim the press for block gestures: no caret, no iOS callout.
                // Runtime still receives the event (no stopPropagation).
                e.preventDefault();
            }
        };
        // CSS touch-action only affects *new* touches. For the active press that
        // entered holding/ready/drag, scroll must be cancelled via non-passive
        // touchmove preventDefault while the runtime phase is locked.
        private readonly onTouchMoveWhileGestureLocked = (e: TouchEvent) => {
            e.preventDefault();
        };
        private readonly onContextMenuWhileDragMode = (e: Event) => {
            if (!plugin.isMobilePlatform() || !plugin.isMobileDragModeEnabled()) return;
            e.preventDefault();
        };
        private readonly pointerMoveClient: GlobalPointerMoveClient;
        private cachedHandleGutterSide: 'left' | 'right';
        private lastPressEvent: PointerEvent | null = null;
        private gestureScrollLocked = false;
        // Editor under the live drag pointer — source or another file.
        private currentTargetEntry: DragTargetEntry | null = null;
        private lastIndicatorEntry: DragTargetEntry | null = null;
        private readonly unregisterDragTarget: () => void;
        private visualRefreshScheduled = false;
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
            this.view.dom.addEventListener('contextmenu', this.onContextMenuWhileDragMode, true);
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
            });
            this.unregisterDragTarget = registerDragTarget({
                view: this.view,
                context: this.context,
                dropIndicator: this.dropIndicator,
            });
            this.dragController = new DraggerRuntime({
                input: pointerInput(this.view),
                document: codeMirrorDocument(this.view),
                locate: codeMirrorLocate(this.view, this.context, this.resolveTargetView, plugin),
                commit: {
                    apply: (edits) => {
                        // Route each edit by Doc identity. Do NOT use
                        // currentTargetEntry here: handlePipelineResult runs
                        // on the dropped output *before* apply and clears it.
                        for (const edit of edits) {
                            const owner = edit.doc === this.view.state.doc
                                ? this.view
                                : (resolveDragTargetByDoc(edit.doc)?.view ?? this.view);
                            applyBlockTransaction(owner, edit);
                        }
                    },
                },
                // Full pipeline result (previous/current/outputs/event). Grab
                // visuals re-project from runtime.state; only output-specific
                // side effects (drop indicator, tap menu) live here.
                onChange: (result) => this.handlePipelineResult(result),
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
                    const h = this.handleVisibility.getActiveHandle();
                    if (!h) return;
                    const rect = h.getBoundingClientRect();
                    this.reResolveActiveHandle(rect.left + rect.width / 2, rect.top + rect.height / 2);
                },
            });
            // Gutter/line nodes may rebuild after this plugin's update callback.
            // One deferred projection from runtime is enough — no second path.
            if (update.docChanged || update.geometryChanged || update.selectionSet || update.viewportChanged) {
                this.scheduleProjectRuntimeVisual();
            }
        }

        destroy(): void {
            this.view.dom.removeEventListener('pointerdown', this.onPointerDown, true);
            this.view.dom.removeEventListener('contextmenu', this.onContextMenuWhileDragMode, true);
            this.view.dom.removeEventListener('dnd:enter-mobile-selection-mode', this.onEnterMobileSelectionMode);
            this.setGestureScrollLock(false);
            this.hideDragIndicator();
            this.clearGrabVisual();
            this.unregisterDragTarget();
            destroyViewLifecycle({
                semanticRefreshScheduler: this.semanticRefreshScheduler,
                pointerMoveClient: this.pointerMoveClient,
                onSettingsUpdated: this.onSettingsUpdated,
                dragController: this.dragController,
            });
            this.handleVisibility.clearGrabbedLineNumbers();
            this.handleVisibility.setActiveVisibleHandle(null);
            this.dragPerfSessionManager.flush('destroy');
            clearEditorRootClasses(this.view);
            this.view.dom.removeAttribute(DND_DRAG_SOURCE_STYLE_ATTR);
            this.view.dom.removeAttribute(DND_DRAG_SOURCE_HIGHLIGHT_ATTR);
            this.dropIndicator.destroy();
        }

        // Platform side-effects that are *not* grab visuals: drop indicator and
        // handle-tap menu. Grab/selection paint always goes through
        // projectRuntimeVisual so DOM classes never diverge from runtime state.
        private handlePipelineResult(result: PipelineResult): void {
            for (const item of result.outputs) {
                switch (item.type) {
                    case 'drag_over':
                        this.renderDropPreviewOnTarget({
                            source: item.selection,
                            target: item.drop.target,
                            allowed: item.drop.rejectReason == null,
                        });
                        break;
                    case 'dropped':
                        this.hideDragIndicator();
                        plugin.notifyDragDrop();
                        break;
                    case 'cancelled':
                        this.hideDragIndicator();
                        if (item.reason === 'press_cancelled') {
                            // press_cancelled is emitted *inside* the release
                            // handler. Opening here (after release has already
                            // run) avoids the old race where a capture-phase
                            // pointerup flush ran before pending was set, so
                            // the menu only appeared on the *next* pointerup
                            // (e.g. when the user scrolled again).
                            this.openBlockMenuFromPress(item.selection?.anchorBlock?.startLine);
                        }
                        break;
                    case 'terminal':
                        this.hideDragIndicator();
                        break;
                }
            }
            this.projectRuntimeVisual();
        }

        private openBlockMenuFromPress(startLine: number | undefined): void {
            const press = this.lastPressEvent;
            this.lastPressEvent = null;
            if (typeof startLine !== 'number') return;

            // Anchor beside the line — never under the finger — so residual
            // synthetic click (if any) cannot hit the menu as outside-dismiss.
            // rAF: open after the current release event stack unwinds; no
            // artificial delay, no click-swallow.
            const pos = this.menuAnchorForLine(startLine + 1, press?.clientX ?? 0, press?.clientY ?? 0);
            const line = startLine + 1;
            requestAnimationFrame(() => {
                openBlockTypeMenu(
                    this.view,
                    { clientX: pos.x, clientY: pos.y } as PointerEvent,
                    line,
                );
            });
        }

        // Menu beside the line (content left), not under the finger.
        private menuAnchorForLine(lineNumber: number, fallbackX: number, fallbackY: number): { x: number; y: number } {
            try {
                const line = this.view.state.doc.line(lineNumber);
                const coords = this.view.coordsAtPos(line.from);
                if (coords) {
                    const content = this.view.contentDOM.getBoundingClientRect();
                    return {
                        x: Math.max(8, content.left + 8),
                        y: coords.bottom + 4,
                    };
                }
            } catch {
                // fall through
            }
            return { x: fallbackX, y: fallbackY };
        }

        private scheduleProjectRuntimeVisual(): void {
            if (this.visualRefreshScheduled) return;
            this.visualRefreshScheduled = true;
            queueMicrotask(() => {
                this.visualRefreshScheduled = false;
                this.projectRuntimeVisual();
            });
        }

        // Single projection path: runtime state → grab highlight + scroll lock.
        // Layer rule: runtime owns selection; this method only paints DOM.
        // Scroll lock is independent of grab paint — holding/ready have no
        // painted selection but MUST still lock scroll for the active press.
        private projectRuntimeVisual(): void {
            const state = this.dragController.state;
            const dragging = this.dragController.isGestureActive() || state.type === 'dragging';
            this.setGestureScrollLock(
                dragging
                || state.type === 'selecting'
                || state.type === 'holding'
                || state.type === 'ready_to_drag',
            );

            const selection = this.runtimeSelection();
            if (!selection || selection.ranges.length === 0) {
                this.clearGrabVisual();
                return;
            }

            const ranges = selection.ranges.map((range) => ({
                startLineNumber: range.startLine + 1,
                endLineNumber: range.endLine + 1,
            }));
            this.handleVisibility.enterGrabVisualState(ranges, null);
            activeDocument.body.classList.toggle(DRAGGING_BODY_CLASS, dragging);
        }

        private setGestureScrollLock(locked: boolean): void {
            if (this.gestureScrollLocked === locked) return;
            this.gestureScrollLocked = locked;
            activeDocument.body.classList.toggle(MOBILE_GESTURE_LOCK_CLASS, locked);
            if (locked) {
                activeDocument.addEventListener(
                    'touchmove',
                    this.onTouchMoveWhileGestureLocked,
                    { capture: true, passive: false },
                );
            } else {
                activeDocument.removeEventListener(
                    'touchmove',
                    this.onTouchMoveWhileGestureLocked,
                    true,
                );
            }
        }

        // Paint only — never touches scroll lock. Lock is owned exclusively by
        // setGestureScrollLock via projectRuntimeVisual / destroy.
        private clearGrabVisual(): void {
            this.handleVisibility.clearGrabbedLineNumbers();
            activeDocument.body.classList.remove(DRAGGING_BODY_CLASS);
        }

        private runtimeSelection(): SelectionVisual | null {
            const state = this.dragController.state;
            // Only committed multi-select and an active drag paint grab visuals.
            if (state.type === 'selecting') return state.selection.selection;
            if (state.type === 'dragging') return state.drag.selection;
            return null;
        }

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
            if (activeDocument.body.classList.contains(MOBILE_GESTURE_LOCK_CLASS)) return;
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
            this.handleVisibility.setActiveVisibleHandle(
                this.handleVisibility.resolveVisibleHandleFromPointer(hoverSnapshot)
            );
        }

        private reResolveActiveHandle(lastX?: number, lastY?: number): void {
            if (lastX === undefined || lastY === undefined) return;
            this.handleVisibility.setActiveVisibleHandle(
                this.handleVisibility.resolveVisibleHandleFromPointer(
                    this.createHoverPointerSnapshot(lastX, lastY)
                )
            );
        }

        private syncViewDomState(): void {
            ensureEditorRootClasses(this.view);
            placeHandleGutterForConfiguredSide(this.view, this.resolveConfiguredHandleGutterSide());
            syncBlockSelectionStyleAttr(this.view, plugin.settings.selectionVisualStyle);
            syncBlockSelectionHighlightAttr(this.view, plugin.settings.enableBlockSelectionHighlight !== false);
        }

        private refreshDecorationsAndEmbeds(): void {
            this.syncViewDomState();
            this.semanticRefreshScheduler.clearPendingSemanticRefresh();
        }

        private handleSettingsUpdated(): void {
            this.cachedHandleGutterSide = this.resolveConfiguredHandleGutterSide();
            this.syncViewDomState();
            this.dragController.handleMobileDragAvailabilityChanged(plugin.isMobileDragModeEnabled());
            this.refreshDecorationsAndEmbeds();
            this.projectRuntimeVisual();
        }

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
