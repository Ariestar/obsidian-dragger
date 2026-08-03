import { describe, it, expect } from 'vitest';
import { migrateSettings } from './settings-migrations';
import { DEFAULT_SETTINGS } from './settings-types';

describe('migrateSettings', () => {
    it('returns full defaults for empty/absent data', () => {
        expect(migrateSettings(null)).toEqual({ ...DEFAULT_SETTINGS, schemaVersion: 7 });
        expect(migrateSettings(undefined)).toEqual({ ...DEFAULT_SETTINGS, schemaVersion: 7 });
        expect(migrateSettings({})).toEqual({ ...DEFAULT_SETTINGS, schemaVersion: 7 });
    });

    it('preserves user values and backfills new fields from defaults', () => {
        const result = migrateSettings({ handleSize: 32, handleVisibility: 'always' });
        expect(result.handleSize).toBe(32);
        expect(result.handleVisibility).toBe('always');
        expect(result.schemaVersion).toBe(7);
    });

    it('migrates legacy alwaysShowHandles -> handleVisibility', () => {
        expect(migrateSettings({ alwaysShowHandles: true }).handleVisibility).toBe('always');
        expect(migrateSettings({ alwaysShowHandles: false }).handleVisibility).toBe('hover');
        // explicit handleVisibility wins over legacy field
        expect(migrateSettings({ alwaysShowHandles: true, handleVisibility: 'hidden' }).handleVisibility).toBe(
            'hidden',
        );
        // legacy field is dropped after migration
        expect('alwaysShowHandles' in migrateSettings({ alwaysShowHandles: true })).toBe(false);
    });

    it('migrates legacy selectionVisualStyle "none" with highlights off', () => {
        const result = migrateSettings({ selectionVisualStyle: 'none' });
        expect(result.selectionVisualStyle).toBe('outline');
        expect(result.enableBlockSelectionHighlight).toBe(false);
        expect(result.enableListDropHighlight).toBe(false);
    });

    it('does not override explicit highlight toggles when migrating "none"', () => {
        const result = migrateSettings({
            selectionVisualStyle: 'none',
            enableBlockSelectionHighlight: true,
            enableListDropHighlight: true,
        });
        expect(result.selectionVisualStyle).toBe('outline');
        expect(result.enableBlockSelectionHighlight).toBe(true);
        expect(result.enableListDropHighlight).toBe(true);
    });

    it('drops removed requireMobileDragMode field', () => {
        expect('requireMobileDragMode' in migrateSettings({ requireMobileDragMode: true })).toBe(false);
    });

    it('migrates legacy auto-scroll defaults to the current defaults', () => {
        const result = migrateSettings({
            schemaVersion: 1,
            autoScrollEdgeZonePx: 88,
            autoScrollMaxSpeedPx: 22,
        });

        expect(result.autoScrollEdgeZonePx).toBe(DEFAULT_SETTINGS.autoScrollEdgeZonePx);
        expect(result.autoScrollMaxSpeedPx).toBe(DEFAULT_SETTINGS.autoScrollMaxSpeedPx);
        expect(result.schemaVersion).toBe(7);
    });

    it('preserves custom auto-scroll values during default migration', () => {
        const result = migrateSettings({
            schemaVersion: 1,
            autoScrollEdgeZonePx: 120,
            autoScrollMaxSpeedPx: 8,
        });

        expect(result.autoScrollEdgeZonePx).toBe(120);
        expect(result.autoScrollMaxSpeedPx).toBe(8);
    });

    it('clamps out-of-range numeric values into their valid range', () => {
        expect(migrateSettings({ handleSize: 9999 }).handleSize).toBe(40);
        expect(migrateSettings({ handleSize: 1 }).handleSize).toBe(10);
        expect(migrateSettings({ handleHorizontalOffsetPx: -500 }).handleHorizontalOffsetPx).toBe(-80);
        expect(migrateSettings({ autoScrollMaxSpeedPx: 1000 }).autoScrollMaxSpeedPx).toBe(60);
    });

    it('rounds fractional numeric values', () => {
        expect(migrateSettings({ handleSize: 20.7 }).handleSize).toBe(21);
    });

    it('falls back to default for non-finite/non-numeric values', () => {
        expect(migrateSettings({ handleSize: 'big' }).handleSize).toBe(DEFAULT_SETTINGS.handleSize);
        expect(migrateSettings({ handleSize: NaN }).handleSize).toBe(DEFAULT_SETTINGS.handleSize);
        expect(migrateSettings({ autoScrollEdgeZonePx: null }).autoScrollEdgeZonePx).toBe(
            DEFAULT_SETTINGS.autoScrollEdgeZonePx,
        );
    });

    it('leaves in-range numeric values untouched', () => {
        expect(migrateSettings({ handleSize: 24 }).handleSize).toBe(24);
    });

    it('migrates legacy desktop range-select long-press default through intermediate 500 to current', () => {
        const result = migrateSettings({
            schemaVersion: 2,
            mouseRangeSelectLongPressMs: 260,
        });

        expect(result.mouseRangeSelectLongPressMs).toBe(DEFAULT_SETTINGS.mouseRangeSelectLongPressMs);
        expect(result.schemaVersion).toBe(7);
    });

    it('preserves custom desktop range-select long-press values during default migration', () => {
        const result = migrateSettings({
            schemaVersion: 2,
            mouseRangeSelectLongPressMs: 420,
        });

        expect(result.mouseRangeSelectLongPressMs).toBe(420);
        expect(result.schemaVersion).toBe(7);
    });

    it('migrates previous 500ms multi-select default to the longer current default', () => {
        const result = migrateSettings({
            schemaVersion: 5,
            mouseRangeSelectLongPressMs: 500,
        });
        expect(result.mouseRangeSelectLongPressMs).toBe(DEFAULT_SETTINGS.mouseRangeSelectLongPressMs);
        expect(result.schemaVersion).toBe(7);
    });

    it('does not re-run v0 migrations when already at current version', () => {
        // legacy field present but version already current: left untouched, not migrated
        const result = migrateSettings({ schemaVersion: 7, alwaysShowHandles: true });
        expect(result.handleVisibility).toBe(DEFAULT_SETTINGS.handleVisibility);
        expect(result.schemaVersion).toBe(7);
    });

    it('collapses legacy mobileDragModeToggleLocations array into a boolean', () => {
        const withToggle = migrateSettings({ schemaVersion: 6, mobileDragModeToggleLocations: ['view-action'] });
        expect(withToggle.mobileDragModeToggleEnabled).toBe(true);
        expect('mobileDragModeToggleLocations' in withToggle).toBe(false);

        const withoutToggle = migrateSettings({ schemaVersion: 6, mobileDragModeToggleLocations: [] });
        expect(withoutToggle.mobileDragModeToggleEnabled).toBe(false);

        // legacy key absent at an old version: default applies
        expect(migrateSettings({ schemaVersion: 6 }).mobileDragModeToggleEnabled).toBe(
            DEFAULT_SETTINGS.mobileDragModeToggleEnabled,
        );
    });

    it('drops removed cross-file drag setting', () => {
        const result = migrateSettings({ schemaVersion: 3, enableCrossFileDrag: true });
        expect('enableCrossFileDrag' in result).toBe(false);
        expect(result.schemaVersion).toBe(7);
    });
});
