type DragHandleDomOptions = {
    onDragStart: (e: DragEvent, handle: HTMLElement) => void;
    onDragEnd?: (e: DragEvent, handle: HTMLElement) => void;
    className?: string;
};

export function createDragHandleElement(options: DragHandleDomOptions): HTMLElement {
    const handle = document.createElement('div');
    handle.className = options.className ?? 'dnd-drag-handle';
    handle.setAttribute('draggable', 'true');
    handle.innerHTML = '<span class="dnd-handle-core" aria-hidden="true"></span>';
    handle.addEventListener('dragstart', (e) => options.onDragStart(e, handle));
    if (options.onDragEnd) {
        handle.addEventListener('dragend', (e) => options.onDragEnd?.(e, handle));
    }
    return handle;
}
