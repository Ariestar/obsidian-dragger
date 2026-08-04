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

    // jsdom has no Obsidian's window-level element factories (createDiv and
    // friends); adapter code uses them since the eslint-plugin-obsidianmd
    // 0.4.1 prefer-create-el rules.
    if (typeof window.createDiv !== 'function') {
        window.createDiv = (o?: Record<string, unknown> | string, callback?: (el: HTMLDivElement) => void) => {
            const el = window.document.createElement('div');
            callback?.(el);
            return el;
        };
        window.createSpan = (o?: Record<string, unknown> | string, callback?: (el: HTMLSpanElement) => void) => {
            const el = window.document.createElement('span');
            callback?.(el);
            return el;
        };
        window.createFragment = (callback?: (el: DocumentFragment) => void) => {
            const el = window.document.createDocumentFragment();
            callback?.(el);
            return el;
        };
    }

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

// jsdom cannot resolve CSS custom properties; Obsidian defines the list
// indent tokens (--indent-unit × --indent-size) in its stylesheet. Stand in
// with the Obsidian defaults so geometry reads work in tests — same class of
// polyfill as Range/elementFromPoint above.
if (typeof window !== 'undefined' && typeof window.getComputedStyle === 'function') {
    // bind() must capture the original before the replacement below, or the
    // polyfill would call itself (getComputedStyle resolves at call time).
    const originalGetComputedStyle = window.getComputedStyle.bind(window) as (el: Element) => CSSStyleDeclaration;
    window.getComputedStyle = (el: Element) => {
        const style = originalGetComputedStyle(el);
        // Capture the original getPropertyValue before replacing it, or the
        // wrapper would call itself (method lookup is dynamic).
        const getPropertyValue = style.getPropertyValue.bind(style) as (prop: string) => string;
        style.getPropertyValue = (prop: string): string => {
            const value = getPropertyValue(prop);
            if (value) return value;
            if (prop === '--indent-unit') return '0.5625em';
            if (prop === '--indent-size') return '4';
            return value;
        };
        // jsdom ships no UA stylesheet, so computed font-size is empty; a
        // browser always resolves it to the editor's inherited font size.
        if (!style.fontSize) {
            Object.defineProperty(style, 'fontSize', { configurable: true, value: '16px' });
        }
        return style;
    };
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
