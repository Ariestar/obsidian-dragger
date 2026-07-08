type InstanceOfCapable = {
    instanceOf<T>(type: { new (): T }): boolean;
};

function hasInstanceOf(value: unknown): value is InstanceOfCapable {
    return typeof value === 'object'
        && value !== null
        && typeof (value as { instanceOf?: unknown }).instanceOf === 'function';
}

export function isHTMLElement(value: unknown): value is HTMLElement {
    return hasInstanceOf(value) && value.instanceOf(HTMLElement);
}

export function closestOrNull<T extends Element>(node: Element | null, selector: string): T | null {
    if (!node) return null;
    return node.closest<T>(selector);
}

export function toElement(node: EventTarget | null): Element | null {
    return hasInstanceOf(node) && node.instanceOf(Element) ? node as Element : null;
}
