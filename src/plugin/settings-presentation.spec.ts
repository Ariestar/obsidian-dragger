// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type DragNDropSettings } from './settings-types';
import { SettingsPresenter, settingsPresentation } from './settings-presentation';

const desktop = { isMobile: false, mobileDragModeEnabled: false };
const present = (settings: Partial<DragNDropSettings>) =>
    settingsPresentation({ ...DEFAULT_SETTINGS, ...settings }, desktop);

let frames: HTMLIFrameElement[] = [];
afterEach(() => {
    for (const frame of frames) frame.remove();
    frames = [];
});

/** A document hosting an editor elsewhere, like a canvas card's iframe. */
function frameDocument(): Document {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    frames.push(frame);
    return frame.contentDocument as Document;
}

function bodyState(doc: Document) {
    return {
        classes: [...doc.body.classList].filter((name) => name.startsWith('d-')),
        icon: doc.body.getAttribute('data-d-handle-icon'),
        size: doc.body.style.getPropertyValue('--d-handle-size'),
    };
}

describe('SettingsPresenter', () => {
    it('presents the settings in every document it is given', () => {
        const presenter = new SettingsPresenter();
        presenter.update(present({ handleVisibility: 'always', handleIcon: 'square' }));
        const frame = frameDocument();

        presenter.presentIn(document);
        presenter.presentIn(frame);

        for (const doc of [document, frame]) {
            expect(bodyState(doc)).toEqual({ classes: ['d-handles-always'], icon: 'square', size: '20px' });
        }
        presenter.clear();
    });

    it('updates every presented document when the settings change', () => {
        const presenter = new SettingsPresenter();
        presenter.update(present({ handleVisibility: 'always' }));
        const frame = frameDocument();
        presenter.presentIn(document);
        presenter.presentIn(frame);

        presenter.update(present({ handleVisibility: 'hidden', handleIcon: 'grip-lines', handleSize: 30 }));

        for (const doc of [document, frame]) {
            expect(bodyState(doc)).toEqual({ classes: ['d-handles-hidden'], icon: 'grip-lines', size: '30px' });
        }
        presenter.clear();
    });

    it('presents nothing in a document handed to it after it was cleared', () => {
        const presenter = new SettingsPresenter();
        presenter.update(present({ handleVisibility: 'always' }));
        presenter.clear();

        presenter.presentIn(frameDocument());

        expect(bodyState(frames[0].contentDocument as Document)).toEqual({ classes: [], icon: null, size: '' });
    });

    it('removes every class, attribute, and CSS variable it set when cleared', () => {
        const presenter = new SettingsPresenter();
        presenter.update(
            present({ handleVisibility: 'always', indicatorColorMode: 'custom', indicatorColor: '#ff0000' }),
        );
        const frame = frameDocument();
        presenter.presentIn(document);
        presenter.presentIn(frame);

        presenter.clear();

        for (const doc of [document, frame]) {
            expect([...doc.body.classList].filter((name) => name.startsWith('d-'))).toEqual([]);
            expect([...doc.body.attributes].map((a) => a.name).filter((name) => name.startsWith('data-d-'))).toEqual(
                [],
            );
            expect([...doc.body.style].filter((name) => name.startsWith('--d-'))).toEqual([]);
        }
    });
});

describe('settingsPresentation', () => {
    const presented = (settings: Partial<DragNDropSettings>, variable: string) => {
        const presenter = new SettingsPresenter();
        presenter.update(present(settings));
        presenter.presentIn(document);
        const value = document.body.style.getPropertyValue(variable);
        presenter.clear();
        return value;
    };

    it('leaves the drop indicator colour unset in theme mode', () => {
        expect(presented({ indicatorColorMode: 'theme' }, '--d-drop-indicator-color')).toBe('');
        expect(presented({ indicatorColorMode: 'custom', indicatorColor: '#123456' }, '--d-drop-indicator-color')).toBe(
            '#123456',
        );
    });

    it('mirrors the handle offset for a right-side gutter', () => {
        expect(presented({ handleHorizontalOffsetPx: -8 }, '--d-handle-horizontal-offset-px')).toBe('-8px');
        expect(
            presented(
                { handleHorizontalOffsetPx: -8, handleGutterPosition: 'right' },
                '--d-handle-horizontal-offset-px',
            ),
        ).toBe('8px');
    });
});
