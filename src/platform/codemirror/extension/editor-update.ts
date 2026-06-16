import { ViewUpdate } from '@codemirror/view';
import { PipelineAdapter } from '../input/pipeline-adapter';
import { HandleVisibilityController } from '../preview/handle-visibility-controller';
import { SemanticRefreshScheduler } from './semantic-refresh-scheduler';

export interface ViewUpdateFlowDeps {
    refreshDecorationsAndEmbeds: () => void;
    pipelineAdapter: PipelineAdapter;
    handleVisibility: HandleVisibilityController;
    semanticRefreshScheduler: SemanticRefreshScheduler;
    reResolveActiveHandle: () => void;
}

export function applyViewUpdate(update: ViewUpdate, deps: ViewUpdateFlowDeps): void {
    if (update.viewportChanged) {
        deps.refreshDecorationsAndEmbeds();
        deps.pipelineAdapter.refreshSelectionVisual();
        deps.handleVisibility.refreshGrabVisualState();
        const activeHandle = deps.handleVisibility.getActiveHandle();
        if (activeHandle && !activeHandle.isConnected) {
            deps.handleVisibility.setActiveVisibleHandle(null);
            deps.reResolveActiveHandle();
        }
        return;
    }

    if (update.docChanged) {
        deps.semanticRefreshScheduler.markSemanticRefreshPending();
    } else if (update.geometryChanged) {
        deps.refreshDecorationsAndEmbeds();
    }

    if (update.docChanged || update.geometryChanged || update.selectionSet) {
        deps.pipelineAdapter.refreshSelectionVisual();
        deps.handleVisibility.refreshGrabVisualState();
    }
    const activeHandle = deps.handleVisibility.getActiveHandle();
    if (activeHandle && !activeHandle.isConnected) {
        deps.handleVisibility.setActiveVisibleHandle(null);
        deps.reResolveActiveHandle();
    }
}

