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

export {};
