// @vitest-environment jsdom
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    registerDragTarget,
    resetDragTargetRegistryForTests,
    resolveDragTargetAtPoint,
    resolveDragTargetByDoc,
    type DragTargetEntry,
} from './drag-target-registry';

function makeEntry(docText: string, rect: DOMRect): DragTargetEntry {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    const view = new EditorView({
        state: EditorState.create({ doc: docText }),
        parent,
    });
    // Fake geometry for point hit-testing in jsdom.
    vi.spyOn(view.dom, 'getBoundingClientRect').mockReturnValue(rect);
    return {
        view,
        context: {} as DragTargetEntry['context'],
        dropIndicator: { hide: vi.fn() } as unknown as DragTargetEntry['dropIndicator'],
    };
}

afterEach(() => {
    resetDragTargetRegistryForTests();
    document.body.replaceChildren();
});

describe('drag-target-registry', () => {
    it('resolves a registered editor by Doc identity (cross-file commit routing)', () => {
        const source = makeEntry('source\n', new DOMRect(0, 0, 100, 100));
        const target = makeEntry('target\n', new DOMRect(200, 0, 100, 100));
        registerDragTarget(source);
        registerDragTarget(target);

        expect(resolveDragTargetByDoc(source.view.state.doc)?.view).toBe(source.view);
        expect(resolveDragTargetByDoc(target.view.state.doc)?.view).toBe(target.view);
        expect(resolveDragTargetByDoc(EditorState.create({ doc: 'other' }).doc)).toBeNull();
    });

    it('resolves the editor under a screen point by rect containment', () => {
        const left = makeEntry('left\n', new DOMRect(0, 0, 100, 200));
        const right = makeEntry('right\n', new DOMRect(200, 0, 100, 200));
        registerDragTarget(left);
        registerDragTarget(right);

        expect(resolveDragTargetAtPoint(50, 50)?.view).toBe(left.view);
        expect(resolveDragTargetAtPoint(250, 50)?.view).toBe(right.view);
        expect(resolveDragTargetAtPoint(150, 50)).toBeNull();
    });
});
