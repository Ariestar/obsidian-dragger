// @vitest-environment jsdom

import { describe, expect, it, vi } from 'vitest';
import type { ViewUpdate } from '@codemirror/view';
import { applyViewUpdate, type ViewUpdateFlowDeps } from './editor-update';

function createDeps(): ViewUpdateFlowDeps {
    return {
        refreshDecorationsAndEmbeds: vi.fn(),
        handleVisibility: {
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
    it('does not own grab-visual refresh (driver projects from runtime)', () => {
        const deps = createDeps();
        applyViewUpdate(createUpdate({ selectionSet: true }), deps);
        expect(deps.refreshDecorationsAndEmbeds).not.toHaveBeenCalled();
        expect(deps.reResolveActiveHandle).not.toHaveBeenCalled();
    });

    it('rebinds a disconnected active handle after viewport change', () => {
        const disconnected = { isConnected: false } as HTMLElement;
        const deps = createDeps();
        (deps.handleVisibility.getActiveHandle as ReturnType<typeof vi.fn>).mockReturnValue(disconnected);

        applyViewUpdate(createUpdate({ viewportChanged: true }), deps);

        expect(deps.refreshDecorationsAndEmbeds).toHaveBeenCalledTimes(1);
        expect(deps.handleVisibility.setActiveVisibleHandle).toHaveBeenCalledWith(null);
        expect(deps.reResolveActiveHandle).toHaveBeenCalledTimes(1);
    });
});
