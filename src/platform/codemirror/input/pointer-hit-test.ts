import { EditorView } from '@codemirror/view';
import type { BlockInfo } from '../../../domain/block/block-types';
import type { BlockCommand } from '../../../domain/command/block-command';
import type { BlockSelection } from '../../../domain/selection/block-selection';
import { buildRangeSelectionBoundaryFromBlock, type RangeSelectionBoundary } from '../../../domain/selection/range-selection';
import type { DragDropSnapshot, DropResolution } from '../../../drag/pipeline/pipeline-drop';
import { isHTMLElement } from '../../dom/dom-utils';

export type PointerDropCommitResolution = DropResolution;

export interface PointerHitTestClient {
    containsPoint: (clientX: number, clientY: number) => boolean;
    resolveDropSnapshotAtPoint: (
        clientX: number,
        clientY: number,
        source: BlockSelection,
        pointerType: string | null
    ) => DragDropSnapshot;
    showDropPreview: (source: BlockSelection, drop: DragDropSnapshot, pointerType: string | null) => void;
    hideDropPreview: () => void;
    buildBlockCommandAtPoint: (
        source: BlockSelection,
        clientX: number,
        clientY: number,
        pointerType: string | null
    ) => PointerDropCommitResolution;
    applyBlockCommand: (command: BlockCommand) => void;
}

const clients = new Set<PointerHitTestClient>();
let activeClient: PointerHitTestClient | null = null;

function resolveClientAtPoint(clientX: number, clientY: number): PointerHitTestClient | null {
    for (const client of clients) {
        if (client.containsPoint(clientX, clientY)) return client;
    }
    return null;
}

function setActiveClient(nextClient: PointerHitTestClient | null): void {
    if (activeClient && activeClient !== nextClient) {
        activeClient.hideDropPreview();
    }
    activeClient = nextClient;
}

export function registerPointerHitTestClient(client: PointerHitTestClient): () => void {
    clients.add(client);
    return () => {
        clients.delete(client);
        if (activeClient === client) {
            client.hideDropPreview();
            activeClient = null;
        }
    };
}

export function showPointerDropPreview(
    fallbackClient: PointerHitTestClient,
    source: BlockSelection,
    drop: DragDropSnapshot,
    pointerType: string | null
): void {
    const targetClient = activeClient ?? fallbackClient;
    targetClient.showDropPreview(source, drop, pointerType);
}

export function resolvePointerDropSnapshotAtPoint(
    fallbackClient: PointerHitTestClient,
    clientX: number,
    clientY: number,
    source: BlockSelection,
    pointerType: string | null
): DragDropSnapshot {
    const targetClient = resolveClientAtPoint(clientX, clientY) ?? fallbackClient;
    setActiveClient(targetClient);
    return targetClient.resolveDropSnapshotAtPoint(clientX, clientY, source, pointerType);
}

export function buildPointerBlockCommandAtPoint(
    fallbackClient: PointerHitTestClient,
    source: BlockSelection,
    clientX: number,
    clientY: number,
    pointerType: string | null
): PointerDropCommitResolution {
    const targetClient = resolveClientAtPoint(clientX, clientY) ?? activeClient ?? fallbackClient;
    setActiveClient(targetClient);
    return targetClient.buildBlockCommandAtPoint(source, clientX, clientY, pointerType);
}

export function applyPointerBlockCommand(
    fallbackClient: PointerHitTestClient,
    command: BlockCommand
): void {
    const targetClient = activeClient ?? fallbackClient;
    targetClient.applyBlockCommand(command);
}

export function hidePointerDropPreviews(): void {
    for (const client of clients) {
        client.hideDropPreview();
    }
    activeClient = null;
}

export function resetPointerHitTestForTests(): void {
    clients.clear();
    activeClient = null;
}

export type PointerInputKind = 'down' | 'move' | 'up' | 'cancel' | 'lost_capture';
export type KeyboardInputKind = 'keydown';
export type FocusInputKind = 'focusin' | 'blur';
export type VisibilityInputKind = 'visibilitychange';

export type PointerInput = {
    kind: PointerInputKind;
    target: HTMLElement | null;
    button: number;
    buttons: number;
    pointerId: number;
    clientX: number;
    clientY: number;
    pointerType: string | null;
    shiftKey: boolean;
};

export type KeyboardInput = {
    kind: KeyboardInputKind;
    key: string;
    target: EventTarget | null;
};

export type FocusInput = {
    kind: FocusInputKind;
    target: EventTarget | null;
};

export type VisibilityInput = {
    kind: VisibilityInputKind;
    visibilityState: DocumentVisibilityState;
};

export type InteractionInput = PointerInput | KeyboardInput | FocusInput | VisibilityInput;

export function readPointerInput(kind: PointerInputKind, event: PointerEvent): PointerInput {
    return {
        kind,
        target: isHTMLElement(event.target) ? event.target : null,
        button: event.button,
        buttons: event.buttons,
        pointerId: event.pointerId,
        clientX: event.clientX,
        clientY: event.clientY,
        pointerType: event.pointerType || null,
        shiftKey: event.shiftKey,
    };
}

export function readKeyboardInput(kind: KeyboardInputKind, event: KeyboardEvent): KeyboardInput {
    return {
        kind,
        key: event.key,
        target: event.target,
    };
}

export function readFocusInput(kind: FocusInputKind, event: FocusEvent | Event): FocusInput {
    return {
        kind,
        target: event.target,
    };
}

export function readVisibilityInput(event: Event): VisibilityInput {
    void event;
    return {
        kind: 'visibilitychange',
        visibilityState: activeDocument.visibilityState,
    };
}

export function shouldStartMobilePressDrag(e: PointerEvent): boolean {
    return e.pointerType === 'touch'
        && e.button === 0;
}

export function autoScrollNearViewportEdge(
    scroller: HTMLElement,
    clientY: number,
    edgeZone = 60,
    maxSpeed = 12,
): boolean {
    const rect = scroller.getBoundingClientRect();
    let delta = 0;
    if (clientY < rect.top + edgeZone) {
        const depth = (rect.top + edgeZone) - clientY;
        delta = -maxSpeed * Math.min(1, depth / edgeZone);
    } else if (clientY > rect.bottom - edgeZone) {
        const depth = clientY - (rect.bottom - edgeZone);
        delta = maxSpeed * Math.min(1, depth / edgeZone);
    }
    if (delta === 0) return false;
    const previousScrollTop = scroller.scrollTop;
    scroller.scrollTop += delta;
    return scroller.scrollTop !== previousScrollTop;
}

export function autoScrollEditorNearViewportEdge(
    view: EditorView,
    clientY: number,
    edgeZone?: number,
    maxSpeed?: number,
): boolean {
    const scroller = view.scrollDOM
        ?? view.dom.querySelector<HTMLElement>('.cm-scroller')
        ?? null;
    if (!scroller) return false;
    return autoScrollNearViewportEdge(scroller, clientY, edgeZone, maxSpeed);
}

function safeGetBlockInfoAtPoint(
    getBlockInfoAtPoint: (clientX: number, clientY: number) => BlockInfo | null,
    clientX: number,
    clientY: number
): BlockInfo | null {
    try {
        return getBlockInfoAtPoint(clientX, clientY);
    } catch {
        return null;
    }
}

export function resolveRangeBoundaryAtPoint(
    view: EditorView,
    clientX: number,
    clientY: number,
    getBlockInfoAtPoint: (clientX: number, clientY: number) => BlockInfo | null
): RangeSelectionBoundary | null {
    const doc = view.state.doc;
    if (doc.lines <= 0) return null;
    const block = safeGetBlockInfoAtPoint(getBlockInfoAtPoint, clientX, clientY);
    if (!block) return null;
    return buildRangeSelectionBoundaryFromBlock(doc, block);
}
