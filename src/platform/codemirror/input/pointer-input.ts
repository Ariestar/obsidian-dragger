import { isHTMLElement } from '../dom/dom-utils';

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
