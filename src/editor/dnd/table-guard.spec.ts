// @vitest-environment jsdom

import type { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
    isElementInsideRenderedTableCell,
    isPointInsideRenderedTableCell,
    isPosInsideRenderedTableCell,
} from './table-guard';

const originalElementFromPoint = document.elementFromPoint;

function createTableDom() {
    const root = document.createElement('div');
    const tableWidget = document.createElement('div');
    tableWidget.className = 'cm-table-widget';

    const cell = document.createElement('td');
    const tableLine = document.createElement('div');
    tableLine.className = 'cm-line';
    tableLine.textContent = 'table cell';

    cell.appendChild(tableLine);
    tableWidget.appendChild(cell);
    root.appendChild(tableWidget);
    document.body.appendChild(root);

    return { root, tableWidget, cell, tableLine };
}

function createViewStub(root: HTMLElement, overrides?: Partial<EditorView>): EditorView {
    const fallbackDomNode = root;
    const viewStub = {
        dom: root,
        state: { doc: { length: 10 } },
        domAtPos: () => ({ node: fallbackDomNode }),
        coordsAtPos: () => ({ left: 10, top: 10, right: 50, bottom: 20 }),
        ...overrides,
    };

    return viewStub as unknown as EditorView;
}

function mockElementFromPoint(el: Element | null): void {
    Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        writable: true,
        value: vi.fn(() => el),
    });
}

afterEach(() => {
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    Object.defineProperty(document, 'elementFromPoint', {
        configurable: true,
        writable: true,
        value: originalElementFromPoint,
    });
});

describe('table-guard', () => {
    it('detects element inside rendered table cell', () => {
        const { root, tableLine } = createTableDom();
        const view = createViewStub(root);

        expect(isElementInsideRenderedTableCell(view, tableLine)).toBe(true);
    });

    it('does not treat normal editor line as rendered table cell', () => {
        const root = document.createElement('div');
        const regularLine = document.createElement('div');
        regularLine.className = 'cm-line';
        root.appendChild(regularLine);
        document.body.appendChild(root);
        const view = createViewStub(root);

        expect(isElementInsideRenderedTableCell(view, regularLine)).toBe(false);
    });

    it('uses elementFromPoint for point hit-testing', () => {
        const { root, tableLine } = createTableDom();
        const view = createViewStub(root);
        mockElementFromPoint(tableLine);

        expect(isPointInsideRenderedTableCell(view, 12, 12)).toBe(true);
    });

    it('falls back to coordinate probing when domAtPos fails', () => {
        const { root, tableLine } = createTableDom();
        const view = createViewStub(root, {
            domAtPos: () => {
                throw new Error('dom mapping failed');
            },
            coordsAtPos: () => ({ left: 10, top: 10, right: 20, bottom: 20 }),
        });
        mockElementFromPoint(tableLine);

        expect(isPosInsideRenderedTableCell(view, 5)).toBe(true);
    });
});
