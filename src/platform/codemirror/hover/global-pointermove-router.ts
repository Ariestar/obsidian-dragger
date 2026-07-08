import { EditorView } from '@codemirror/view';

export interface GlobalPointerMoveClient {
    view: EditorView;
    onPointerMove: (event: PointerEvent) => void;
    clearPointerHover: () => void;
}

const clients = new Set<GlobalPointerMoveClient>();
const clientsByRoot = new Map<HTMLElement, GlobalPointerMoveClient>();

let activeClient: GlobalPointerMoveClient | null = null;
let isListening = false;

function containsPoint(view: EditorView, clientX: number, clientY: number): boolean {
    const rect = view.dom.getBoundingClientRect();
    return clientX >= rect.left
        && clientX <= rect.right
        && clientY >= rect.top
        && clientY <= rect.bottom;
}

function resolveClientFromTarget(target: EventTarget | null): GlobalPointerMoveClient | null {
    if (!(target instanceof Node)) return null;

    let current: Node | null = target;
    while (current) {
        if (current.instanceOf(HTMLElement)) {
            const client = clientsByRoot.get(current);
            if (client) return client;
        }
        current = current.parentNode;
    }

    return null;
}

function resolveClientFromPoint(clientX: number, clientY: number): GlobalPointerMoveClient | null {
    for (const client of clients) {
        if (containsPoint(client.view, clientX, clientY)) {
            return client;
        }
    }
    return null;
}

function resolveClient(event: PointerEvent): GlobalPointerMoveClient | null {
    return resolveClientFromTarget(event.target) ?? resolveClientFromPoint(event.clientX, event.clientY);
}

function handleDocumentPointerMove(event: PointerEvent): void {
    const nextClient = resolveClient(event);

    if (activeClient && activeClient !== nextClient) {
        activeClient.clearPointerHover();
    }

    if (!nextClient) {
        activeClient = null;
        return;
    }

    activeClient = nextClient;
    nextClient.onPointerMove(event);
}

function ensureListening(): void {
    if (isListening) return;
    activeDocument.addEventListener('pointermove', handleDocumentPointerMove, { passive: true });
    isListening = true;
}

function stopListeningIfIdle(): void {
    if (!isListening || clients.size > 0) return;
    activeDocument.removeEventListener('pointermove', handleDocumentPointerMove);
    isListening = false;
}

export function registerGlobalPointerMoveClient(client: GlobalPointerMoveClient): void {
    const root = client.view.dom;
    clients.add(client);
    clientsByRoot.set(root, client);
    ensureListening();
}

export function unregisterGlobalPointerMoveClient(client: GlobalPointerMoveClient): void {
    clients.delete(client);
    clientsByRoot.delete(client.view.dom);
    if (activeClient === client) {
        client.clearPointerHover();
        activeClient = null;
    }
    stopListeningIfIdle();
}

export function resetGlobalPointerMoveRouterForTests(): void {
    activeClient = null;
    clients.clear();
    clientsByRoot.clear();
    if (isListening) {
        activeDocument.removeEventListener('pointermove', handleDocumentPointerMove);
        isListening = false;
    }
}
