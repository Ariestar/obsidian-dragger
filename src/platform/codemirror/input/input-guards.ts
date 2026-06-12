import { EditorView } from '@codemirror/view';
import { MOBILE_GESTURE_LOCK_CLASS } from '../../../shared/dom-selectors';
import { DND_MOBILE_GESTURE_LOCK_COUNT_ATTR } from '../../../shared/dom-attrs';
import { isHTMLElement } from '../../dom/dom-utils';
import { MobileInputHitTest } from './mobile-input-hit-test';

export type InputGuardMode =
    | { type: 'idle' }
    | {
        type: 'mobile_drag';
        phase: 'passive' | 'gesture';
        submode?: 'selection';
    };

export const INPUT_GUARD_IDLE: InputGuardMode = { type: 'idle' };
export const INPUT_GUARD_MOBILE_DRAG_GESTURE: InputGuardMode = { type: 'mobile_drag', phase: 'gesture' };
export const INPUT_GUARD_MOBILE_SELECTION_PASSIVE: InputGuardMode = {
    type: 'mobile_drag',
    phase: 'passive',
    submode: 'selection',
};
export const INPUT_GUARD_MOBILE_SELECTION_GESTURE: InputGuardMode = {
    type: 'mobile_drag',
    phase: 'gesture',
    submode: 'selection',
};

function resolveDragInteractionCapabilities(mode: InputGuardMode): { suppressTextInput: boolean; suppressScroll: boolean } {
    if (mode.type === 'idle') {
        return {
            suppressTextInput: false,
            suppressScroll: false,
        };
    }
    return {
        suppressTextInput: true,
        suppressScroll: mode.phase === 'gesture',
    };
}

export class InputGuardController {
    private textInputSuppressed = false;
    private scrollSuppressed = false;
    private focusGuardAttached = false;
    private readonly onDocumentFocusIn: (e: FocusEvent) => void;
    private readonly mobileInputHitTest: MobileInputHitTest;
    private savedContentEditable: string | null = null;

    constructor(
        private readonly view: EditorView,
        onFocusIn: (e: FocusEvent) => void
    ) {
        this.onDocumentFocusIn = onFocusIn;
        this.mobileInputHitTest = new MobileInputHitTest(view);
    }

    isWithinContentTolerance(clientX: number): boolean {
        return this.mobileInputHitTest.isWithinContentTolerance(clientX);
    }

    isWithinEditorTolerance(clientX: number): boolean {
        return this.mobileInputHitTest.isWithinEditorTolerance(clientX);
    }

    isWithinMobileTextLineOrEmbedArea(target: HTMLElement | null, clientX: number, clientY: number): boolean {
        return this.mobileInputHitTest.isWithinMobileTextLineOrEmbedArea(target, clientX, clientY);
    }

    isMostlyVerticalScrollGesture(dx: number, dy: number): boolean {
        return this.mobileInputHitTest.isMostlyVerticalScrollGesture(dx, dy);
    }

    applyInputGuardMode(mode: InputGuardMode, keyboardTarget?: EventTarget | null): void {
        const capabilities = resolveDragInteractionCapabilities(mode);
        this.setTextInputSuppressed(capabilities.suppressTextInput, keyboardTarget);
        this.setScrollSuppressed(capabilities.suppressScroll);
    }

    clearInputGuardMode(): void {
        this.applyInputGuardMode(INPUT_GUARD_IDLE);
    }

    private setScrollSuppressed(shouldSuppress: boolean): void {
        if (shouldSuppress === this.scrollSuppressed) return;

        const body = activeDocument.body;
        if (shouldSuppress) {
            const current = Number(body.getAttribute(DND_MOBILE_GESTURE_LOCK_COUNT_ATTR) || '0');
            const next = current + 1;
            body.setAttribute(DND_MOBILE_GESTURE_LOCK_COUNT_ATTR, String(next));
            body.classList.add(MOBILE_GESTURE_LOCK_CLASS);
            this.view.dom.classList.add(MOBILE_GESTURE_LOCK_CLASS);
        } else {
            const current = Number(body.getAttribute(DND_MOBILE_GESTURE_LOCK_COUNT_ATTR) || '0');
            const next = Math.max(0, current - 1);
            if (next === 0) {
                body.removeAttribute(DND_MOBILE_GESTURE_LOCK_COUNT_ATTR);
                body.classList.remove(MOBILE_GESTURE_LOCK_CLASS);
            } else {
                body.setAttribute(DND_MOBILE_GESTURE_LOCK_COUNT_ATTR, String(next));
            }
            this.view.dom.classList.remove(MOBILE_GESTURE_LOCK_CLASS);
        }
        this.scrollSuppressed = shouldSuppress;
    }

    private setTextInputSuppressed(shouldSuppress: boolean, keyboardTarget?: EventTarget | null): void {
        if (shouldSuppress === this.textInputSuppressed) {
            if (shouldSuppress) {
                this.suppressMobileKeyboard(keyboardTarget);
            }
            return;
        }

        if (shouldSuppress) {
            this.savedContentEditable = this.view.contentDOM.getAttribute('contenteditable');
            this.view.contentDOM.setAttribute('contenteditable', 'false');
            this.attachFocusGuard();
            this.suppressMobileKeyboard(keyboardTarget);
        } else {
            if (this.savedContentEditable === null) {
                this.view.contentDOM.removeAttribute('contenteditable');
            } else {
                this.view.contentDOM.setAttribute('contenteditable', this.savedContentEditable);
            }
            this.savedContentEditable = null;
            this.detachFocusGuard();
        }
        this.textInputSuppressed = shouldSuppress;
    }

    suppressMobileKeyboard(target?: EventTarget | null): void {
        const rawActive = isHTMLElement(target) ? target : activeDocument.activeElement;
        const active = isHTMLElement(rawActive) ? rawActive : null;
        if (!active) return;
        if (!this.shouldSuppressFocusTarget(active)) return;

        if (typeof active.blur === 'function') {
            active.blur();
        }
        if (typeof window.getSelection === 'function') {
            try {
                window.getSelection()?.removeAllRanges();
            } catch {
                // ignore selection clear failures on limited environments
            }
        }
    }

    shouldSuppressFocusTarget(target: HTMLElement): boolean {
        const isInputControl = target.instanceOf(HTMLInputElement)
            || target.instanceOf(HTMLTextAreaElement)
            || target.isContentEditable;
        const isEditorContent = target.classList.contains('cm-content')
            || !!target.closest('.cm-content');
        return isInputControl || isEditorContent;
    }

    private attachFocusGuard(): void {
        if (this.focusGuardAttached) return;
        activeDocument.addEventListener('focusin', this.onDocumentFocusIn, true);
        this.focusGuardAttached = true;
    }

    private detachFocusGuard(): void {
        if (!this.focusGuardAttached) return;
        activeDocument.removeEventListener('focusin', this.onDocumentFocusIn, true);
        this.focusGuardAttached = false;
    }

    triggerMobileHapticFeedback(): void {
        const nav = navigator as Navigator & { vibrate?: (pattern: number | number[]) => boolean };
        if (typeof nav.vibrate !== 'function') return;
        try {
            nav.vibrate(10);
        } catch {
            // ignore unsupported vibration errors
        }
    }

}

