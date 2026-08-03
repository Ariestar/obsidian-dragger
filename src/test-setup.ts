import { vi } from 'vitest';

vi.mock('obsidian', () => ({
    Platform: {
        isMobile: false,
        isMobileApp: false,
        isPhone: false,
        isTablet: false,
        isDesktop: true,
        isDesktopApp: true,
    },
}));

if (typeof window !== 'undefined') {
    Object.defineProperty(window, 'activeWindow', {
        configurable: true,
        get: () => window,
    });

    Object.defineProperty(window, 'activeDocument', {
        configurable: true,
        get: () => window.document,
    });

    type InstanceOfConstructor = {
        prototype: object;
    };

    if (typeof window.Node.prototype.instanceOf !== 'function') {
        Object.defineProperty(window.Node.prototype, 'instanceOf', {
            configurable: true,
            value: function instanceOf(this: Node, type: InstanceOfConstructor): boolean {
                return Boolean(Object.prototype.isPrototypeOf.call(type.prototype, this));
            },
        });
    }

    if (typeof window.UIEvent.prototype.instanceOf !== 'function') {
        Object.defineProperty(window.UIEvent.prototype, 'instanceOf', {
            configurable: true,
            value: function instanceOf(this: UIEvent, type: InstanceOfConstructor): boolean {
                return Boolean(Object.prototype.isPrototypeOf.call(type.prototype, this));
            },
        });
    }
}

// Polyfill Obsidian's setCssStyles for jsdom test environment
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.setCssStyles) {
    HTMLElement.prototype.setCssStyles = function (this: HTMLElement, styles: Partial<CSSStyleDeclaration>) {
        Object.assign(this.style, styles);
    };
}

// Polyfill Obsidian's setCssProps for jsdom test environment
if (typeof HTMLElement !== 'undefined' && !HTMLElement.prototype.setCssProps) {
    HTMLElement.prototype.setCssProps = function (this: HTMLElement, props: Record<string, string>) {
        Object.entries(props).forEach(([key, value]) => {
            this.style.setProperty(key, value);
        });
    };
}

// jsdom does not implement PointerEvent; the adapter code uses it both for
// event construction and `instanceof` checks, so provide a MouseEvent-based
// stand-in in DOM test environments (node-only tests have no MouseEvent).
if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined' && typeof MouseEvent !== 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
        readonly pointerId: number;
        readonly pointerType: string;
        constructor(type: string, init: PointerEventInit = {}) {
            super(type, { ...init, bubbles: init.bubbles ?? true, cancelable: init.cancelable ?? true });
            this.pointerId = init.pointerId ?? 0;
            this.pointerType = init.pointerType ?? 'mouse';
        }
    }
    Object.defineProperty(window, 'PointerEvent', { configurable: true, value: PointerEventPolyfill });
}

// jsdom does not implement elementFromPoint; the auto-scroll module calls it.
if (
    typeof window !== 'undefined' &&
    typeof window.document !== 'undefined' &&
    typeof activeDocument.elementFromPoint !== 'function'
) {
    activeDocument.elementFromPoint = () => null;
}

// CodeMirror measures via Range geometry, which jsdom leaves unimplemented.
if (typeof Range !== 'undefined' && typeof Range.prototype.getClientRects !== 'function') {
    Range.prototype.getClientRects = function (): DOMRectList {
        return [] as unknown as DOMRectList;
    };
}
if (typeof Range !== 'undefined' && typeof Range.prototype.getBoundingClientRect !== 'function') {
    Range.prototype.getBoundingClientRect = function (): DOMRect {
        return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) };
    };
}

export {};
