import { DEFAULT_SETTINGS, NUMERIC_SETTING_RANGES } from './settings-types';
import type { DragNDropSettings, NumericSettingKey } from './settings-types';

/**
 * Settings migration system.
 *
 * `data.json` is the single source of truth for user settings. On load we run
 * any pending migrations exactly once, after which the settings object is
 * guaranteed to match the current schema. No code downstream of this module
 * should re-validate or normalize settings values — the UI constrains writes
 * to valid values, and these migrations bring legacy data up to date.
 *
 * To add a migration: bump CURRENT_SCHEMA_VERSION and append one transform to
 * MIGRATIONS. Each transform takes raw data at version `index` and returns it
 * at version `index + 1`.
 */

const SCHEMA_VERSION_KEY = 'schemaVersion';
const CURRENT_SCHEMA_VERSION = 7;

type RawSettings = Record<string, unknown>;

const MIGRATIONS: Array<(data: RawSettings) => RawSettings> = [
    // v0 -> v1: consolidate legacy field shapes from versions before the
    // migration system existed.
    (data) => {
        const next = { ...data };

        // `alwaysShowHandles` (boolean) became `handleVisibility` (enum).
        if ('alwaysShowHandles' in next && !('handleVisibility' in next)) {
            next.handleVisibility = next.alwaysShowHandles ? 'always' : 'hover';
        }
        delete next.alwaysShowHandles;

        // `selectionVisualStyle: 'none'` was split into an 'outline' style with
        // both highlight toggles off.
        if (next.selectionVisualStyle === 'none') {
            next.selectionVisualStyle = 'outline';
            if (!('enableBlockSelectionHighlight' in next)) {
                next.enableBlockSelectionHighlight = false;
            }
            if (!('enableListDropHighlight' in next)) {
                next.enableListDropHighlight = false;
            }
        }

        // `requireMobileDragMode` was removed entirely.
        delete next.requireMobileDragMode;

        return next;
    },
    // v1 -> v2: retune auto-scroll defaults. Existing installs persisted a
    // complete data.json on load, so legacy default values need an explicit
    // migration; custom values are left untouched.
    (data) => {
        const next = { ...data };
        if (next.autoScrollEdgeZonePx === 88) {
            next.autoScrollEdgeZonePx = DEFAULT_SETTINGS.autoScrollEdgeZonePx;
        }
        if (next.autoScrollMaxSpeedPx === 22) {
            next.autoScrollMaxSpeedPx = DEFAULT_SETTINGS.autoScrollMaxSpeedPx;
        }
        return next;
    },
    // v2 -> v3: reduce accidental desktop multi-select entry during normal
    // handle drag. Existing installs persisted the old default value, so only
    // migrate that value and preserve custom timings.
    (data) => {
        const next = { ...data };
        if (next.mouseRangeSelectLongPressMs === 260) {
            next.mouseRangeSelectLongPressMs = 500;
        }
        return next;
    },
    // v3 -> v4: remove the old cross-file drag toggle and its implementation.
    (data) => {
        const next = { ...data };
        delete next.enableCrossFileDrag;
        return next;
    },
    // v4 -> v5: drop unused multiLineSelectionLongPressMs. Multi-select timing
    // is mouseRangeSelectLongPressMs; mobile drag arm is mobileDragLongPressMs.
    (data) => {
        const next = { ...data };
        delete next.multiLineSelectionLongPressMs;
        return next;
    },
    // v5 -> v6: lengthen default multi-select hold so it is harder to enter by
    // accident after the mobile drag-arm threshold. Preserve custom values.
    (data) => {
        const next = { ...data };
        if (next.mouseRangeSelectLongPressMs === 500) {
            next.mouseRangeSelectLongPressMs = DEFAULT_SETTINGS.mouseRangeSelectLongPressMs;
        }
        return next;
    },
    // v6 -> v7: the single-value mobile drag mode toggle location collapsed to
    // a boolean. A persisted array is kept (any 'view-action' entry means on);
    // the legacy key is dropped in favour of mobileDragModeToggleEnabled. If
    // the legacy key is absent the default applies.
    (data) => {
        const next = { ...data };
        if ('mobileDragModeToggleLocations' in next) {
            const raw = next.mobileDragModeToggleLocations;
            next.mobileDragModeToggleEnabled = Array.isArray(raw) ? raw.includes('view-action') : Boolean(raw);
            delete next.mobileDragModeToggleLocations;
        }
        return next;
    },
];

function isRecord(value: unknown): value is RawSettings {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Clamp every numeric setting to its valid range, rounding to a whole number.
 * Non-numeric or non-finite values fall back to the default. Applied after
 * migrations so any out-of-range persisted value (e.g. a hand-edited
 * data.json) is brought back into bounds before the settings are trusted.
 */
function clampNumericSettings(settings: DragNDropSettings): void {
    for (const key of Object.keys(NUMERIC_SETTING_RANGES) as NumericSettingKey[]) {
        const { min, max } = NUMERIC_SETTING_RANGES[key];
        const raw = settings[key];
        settings[key] = Number.isFinite(raw) ? Math.round(Math.min(max, Math.max(min, raw))) : DEFAULT_SETTINGS[key];
    }
}

/**
 * Migrate raw persisted data into a complete, current-schema settings object.
 * Pass the result of `loadData()`; missing fields are filled from defaults.
 */
export function migrateSettings(saved: unknown): DragNDropSettings {
    const raw: RawSettings = isRecord(saved) ? { ...saved } : {};

    const storedVersion = raw[SCHEMA_VERSION_KEY];
    const fromVersion = typeof storedVersion === 'number' ? storedVersion : 0;

    let data = raw;
    for (let v = fromVersion; v < CURRENT_SCHEMA_VERSION; v++) {
        data = MIGRATIONS[v](data);
    }

    const merged: DragNDropSettings = {
        ...DEFAULT_SETTINGS,
        ...data,
        [SCHEMA_VERSION_KEY]: CURRENT_SCHEMA_VERSION,
    };
    clampNumericSettings(merged);
    return merged;
}
