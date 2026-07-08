// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { ViewUpdate } from '@codemirror/view';
import { applyViewUpdate, type ViewUpdateFlowDeps } from './editor-update';

function createDeps(): ViewUpdateFlowDeps {
    return {
        refreshDecorationsAndEmbeds: vi.fn(),
        handleVisibility: {
            refreshGrabVisualState: vi.fn(),
            getActiveHandle: vi.fn(() => null),
            setActiveVisibleHandle: vi.fn(),
        } as unknown as ViewUpdateFlowDeps['handleVisibility'],
        semanticRefreshScheduler: {
            markSemanticRefreshPending: vi.fn(),
        } as unknown as ViewUpdateFlowDeps['semanticRefreshScheduler'],
        reResolveActiveHandle: vi.fn(),
    };
}

function createUpdate(overrides: Partial<ViewUpdate>): ViewUpdate {
    return {
        viewportChanged: false,
        docChanged: false,
        geometryChanged: false,
        selectionSet: false,
        ...overrides,
    } as ViewUpdate;
}

describe('applyViewUpdate', () => {
    it('refreshes grab visuals after editor selection changes', () => {
        const deps = createDeps();

        applyViewUpdate(createUpdate({ selectionSet: true }), deps);

        expect(deps.handleVisibility.refreshGrabVisualState).toHaveBeenCalledTimes(1);
        expect(deps.refreshDecorationsAndEmbeds).not.toHaveBeenCalled();
    });
});
