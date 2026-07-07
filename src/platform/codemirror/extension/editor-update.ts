import { ViewUpdate } from '@codemirror/view';
import { HandleVisibilityController } from '../preview/handle-visibility-controller';
import { SemanticRefreshScheduler } from './semantic-refresh-scheduler';

export interface ViewUpdateFlowDeps {
    refreshDecorationsAndEmbeds: () => void;
    dragController: ViewUpdateDragController;
    handleVisibility: HandleVisibilityController;
    semanticRefreshScheduler: SemanticRefreshScheduler;
    reResolveActiveHandle: () => void;
}

export interface ViewUpdateDragController {
    refreshSelectionVisual(): void;
}

export function applyViewUpdate(update: ViewUpdate, deps: ViewUpdateFlowDeps): void {
    if (update.viewportChanged) {
        deps.refreshDecorationsAndEmbeds();
        deps.dragController.refreshSelectionVisual();
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
        deps.dragController.refreshSelectionVisual();
        deps.handleVisibility.refreshGrabVisualState();
    }
    const activeHandle = deps.handleVisibility.getActiveHandle();
    if (activeHandle && !activeHandle.isConnected) {
        deps.handleVisibility.setActiveVisibleHandle(null);
        deps.reResolveActiveHandle();
    }
}

