// @vitest-environment jsdom

import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it } from 'vitest';
import { createHandleGutterExtension } from './handle-gutter-extension';
import { placeHandleGutterForConfiguredSide } from './gutter';
import {
    CODEMIRROR_GUTTER_ELEMENT_SELECTOR,
    DRAG_HANDLE_CLASS,
    HANDLE_GUTTER_CLASS,
} from '../../../shared/dom-selectors';

const mountedViews: EditorView[] = [];

afterEach(() => {
    while (mountedViews.length > 0) {
        mountedViews.pop()?.destroy();
    }
    document.body.innerHTML = '';
});

describe('createHandleGutterExtension', () => {
    it('renders drag handles as CodeMirror gutter marker DOM', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);

        const view = new EditorView({
            state: EditorState.create({
                doc: 'alpha\nbeta',
                extensions: [createHandleGutterExtension()],
            }),
            parent: host,
        });
        mountedViews.push(view);

        const gutter = view.dom.querySelector<HTMLElement>(`.${HANDLE_GUTTER_CLASS}`);
        expect(gutter).not.toBeNull();

        const gutterElements = Array.from(gutter!.querySelectorAll<HTMLElement>(CODEMIRROR_GUTTER_ELEMENT_SELECTOR));
        expect(gutterElements.length).toBeGreaterThan(0);
        expect(gutterElements.every((el) => el.querySelector(`.${DRAG_HANDLE_CLASS}`) !== null)).toBe(true);
    });

    it('moves the handle gutter into the content container when configured on the right', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);

        const view = new EditorView({
            state: EditorState.create({
                doc: 'alpha\nbeta',
                extensions: [createHandleGutterExtension()],
            }),
            parent: host,
        });
        mountedViews.push(view);

        placeHandleGutterForConfiguredSide(view, 'right');

        const gutter = view.dom.querySelector<HTMLElement>(`.${HANDLE_GUTTER_CLASS}`);
        expect(gutter).not.toBeNull();
        expect(gutter?.parentElement).toBe(view.contentDOM.parentElement);
        expect(gutter?.previousSibling).toBe(view.contentDOM);
    });

    it('moves the handle gutter before the content when configured on the left', () => {
        const host = document.createElement('div');
        document.body.appendChild(host);

        const view = new EditorView({
            state: EditorState.create({
                doc: 'alpha\nbeta',
                extensions: [createHandleGutterExtension()],
            }),
            parent: host,
        });
        mountedViews.push(view);

        placeHandleGutterForConfiguredSide(view, 'left');

        const gutter = view.dom.querySelector<HTMLElement>(`.${HANDLE_GUTTER_CLASS}`);
        expect(gutter).not.toBeNull();
        expect(gutter?.parentElement).toBe(view.contentDOM.parentElement);
        expect(gutter?.nextSibling).toBe(view.contentDOM);
    });
});
