import { EditorView } from '@codemirror/view';
import { prewarmFenceScan } from '../../../domain/markdown/fence-scanner';
import { SemanticRefreshScheduler } from './semantic-refresh-scheduler';
import {
    GlobalPointerMoveClient,
    registerGlobalPointerMoveClient,
    unregisterGlobalPointerMoveClient,
} from './global-pointermove-router';

export interface ViewLifecycleStartDeps {
    view: EditorView;
    dragController: ViewLifecycleDragController;
    pointerMoveClient: GlobalPointerMoveClient;
    onSettingsUpdated: () => void;
}

export interface ViewLifecycleDestroyDeps {
    semanticRefreshScheduler: SemanticRefreshScheduler;
    pointerMoveClient: GlobalPointerMoveClient;
    onSettingsUpdated: () => void;
    dragController: ViewLifecycleDragController;
}

export interface ViewLifecycleDragController {
    attach(): void;
    destroy(): void;
}

export function startViewLifecycle(deps: ViewLifecycleStartDeps): void {
    deps.dragController.attach();
    registerGlobalPointerMoveClient(deps.pointerMoveClient);
    window.addEventListener('dnd:settings-updated', deps.onSettingsUpdated);
    scheduleFenceScanWarmup(deps.view);
}

export function destroyViewLifecycle(deps: ViewLifecycleDestroyDeps): void {
    deps.semanticRefreshScheduler.destroy();
    unregisterGlobalPointerMoveClient(deps.pointerMoveClient);
    window.removeEventListener('dnd:settings-updated', deps.onSettingsUpdated);
    deps.dragController.destroy();
}

function scheduleFenceScanWarmup(view: EditorView): void {
    const warmupFenceScan = () => prewarmFenceScan(view.state.doc);
    const requestIdle = window.requestIdleCallback as
        | ((cb: () => void, options?: { timeout?: number }) => number)
        | undefined;
    if (typeof requestIdle === 'function') {
        requestIdle(warmupFenceScan, { timeout: 1000 });
    } else {
        window.setTimeout(warmupFenceScan, 100);
    }
}
