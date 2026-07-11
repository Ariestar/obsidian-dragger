import { ViewUpdate } from '@codemirror/view';
import { HandleVisibilityController } from '../hover/handle-visibility-controller';
import { SemanticRefreshScheduler } from '../perf/semantic-refresh-scheduler';

export interface ViewUpdateFlowDeps {
    refreshDecorationsAndEmbeds: () => void;
    handleVisibility: HandleVisibilityController;
    semanticRefreshScheduler: SemanticRefreshScheduler;
    reResolveActiveHandle: () => void;
}

// View-update housekeeping that is *not* grab-visual projection.
// Selection/drag paint is owned solely by drag-driver.projectRuntimeVisual —
// this file only keeps decorations/hover handles coherent with CM updates.
export function applyViewUpdate(update: ViewUpdate, deps: ViewUpdateFlowDeps): void {
    if (update.viewportChanged) {
        deps.refreshDecorationsAndEmbeds();
        rebindActiveHandle(deps);
        return;
    }

    if (update.docChanged) {
        deps.semanticRefreshScheduler.markSemanticRefreshPending();
    } else if (update.geometryChanged) {
        deps.refreshDecorationsAndEmbeds();
    }

    rebindActiveHandle(deps);
}

function rebindActiveHandle(deps: ViewUpdateFlowDeps): void {
    const activeHandle = deps.handleVisibility.getActiveHandle();
    if (activeHandle && !activeHandle.isConnected) {
        deps.handleVisibility.setActiveVisibleHandle(null);
        deps.reResolveActiveHandle();
    }
}
