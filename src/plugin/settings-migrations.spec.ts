import { describe, it, expect } from 'vitest';
import { migrateSettings } from './settings-migrations';
import { DEFAULT_SETTINGS } from './settings-types';
import { DEFAULT_BLOCK_MENU_ORDERS } from './block-menu-items';

describe('migrateSettings', () => {
    it('returns full defaults for empty/absent data', () => {
        expect(migrateSettings(null)).toEqual({ ...DEFAULT_SETTINGS, schemaVersion: 12 });
        expect(migrateSettings(undefined)).toEqual({ ...DEFAULT_SETTINGS, schemaVersion: 12 });
        expect(migrateSettings({})).toEqual({ ...DEFAULT_SETTINGS, schemaVersion: 12 });
    });

    it('preserves user values and backfills new fields from defaults', () => {
        const result = migrateSettings({ handleSize: 32, handleVisibility: 'always' });
        expect(result.handleSize).toBe(32);
        expect(result.handleVisibility).toBe('always');
        expect(result.schemaVersion).toBe(12);
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

    it('migrates legacy selectionVisualStyle "none" with the highlight off', () => {
        const result = migrateSettings({ selectionVisualStyle: 'none' });
        expect(result.selectionVisualStyle).toBe('outline');
        expect(result.enableBlockSelectionHighlight).toBe(false);
    });

    it('does not override the explicit highlight toggle when migrating "none"', () => {
        const result = migrateSettings({
            selectionVisualStyle: 'none',
            enableBlockSelectionHighlight: true,
        });
        expect(result.selectionVisualStyle).toBe('outline');
        expect(result.enableBlockSelectionHighlight).toBe(true);
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
        expect(result.schemaVersion).toBe(12);
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
        expect(result.schemaVersion).toBe(12);
    });

    it('preserves custom desktop range-select long-press values during default migration', () => {
        const result = migrateSettings({
            schemaVersion: 2,
            mouseRangeSelectLongPressMs: 420,
        });

        expect(result.mouseRangeSelectLongPressMs).toBe(420);
        expect(result.schemaVersion).toBe(12);
    });

    it('migrates previous 500ms multi-select default to the longer current default', () => {
        const result = migrateSettings({
            schemaVersion: 5,
            mouseRangeSelectLongPressMs: 500,
        });
        expect(result.mouseRangeSelectLongPressMs).toBe(DEFAULT_SETTINGS.mouseRangeSelectLongPressMs);
        expect(result.schemaVersion).toBe(12);
    });

    it('does not re-run v0 migrations when already at current version', () => {
        // legacy field present but version already current: left untouched, not migrated
        const result = migrateSettings({ schemaVersion: 12, alwaysShowHandles: true });
        expect(result.handleVisibility).toBe(DEFAULT_SETTINGS.handleVisibility);
        expect(result.schemaVersion).toBe(12);
    });

    it('migrates legacy settings without customBlockStyles to have default styles', () => {
        const result = migrateSettings({ schemaVersion: 7, handleSize: 20 });
        expect(result.customBlockStyles).toEqual(DEFAULT_SETTINGS.customBlockStyles);
        expect(result.schemaVersion).toBe(12);
    });

    it('preserves existing customBlockStyles when already present', () => {
        const custom = [{ id: 'my-style', label: 'My Style', icon: 'star', template: '::: ${content}' }];
        const result = migrateSettings({ schemaVersion: 7, customBlockStyles: custom });
        expect(result.customBlockStyles).toEqual(custom);
        expect(result.schemaVersion).toBe(12);
    });

    it('starts with no custom styles', () => {
        expect(migrateSettings(null).customBlockStyles).toEqual([]);
    });

    it('initializes menu order during migration without changing custom styles', () => {
        const custom = [{ id: 'my-style', label: 'My Style', icon: 'star', template: '${content}' }];
        const result = migrateSettings({ schemaVersion: 9, customBlockStyles: custom });
        expect(result.blockMenuOrders.root).toEqual(DEFAULT_BLOCK_MENU_ORDERS.root);
        expect(result.customBlockStyles).toEqual(custom);
        expect(result.schemaVersion).toBe(12);
    });

    it('preserves saved menu order and does not share mutable defaults across loads', () => {
        const reversed = [...DEFAULT_BLOCK_MENU_ORDERS.root].reverse();
        expect(migrateSettings({ schemaVersion: 11, blockMenuOrder: reversed }).blockMenuOrders.root).toEqual(reversed);
        const first = migrateSettings(null);
        first.blockMenuOrders.root.reverse();
        first.customBlockStyles.push({ id: 'a', label: 'A', icon: 'box', template: '${content}' });
        expect(migrateSettings(null).blockMenuOrders.root).toEqual(DEFAULT_BLOCK_MENU_ORDERS.root);
        expect(migrateSettings(null).customBlockStyles).toEqual([]);
    });

    it('removes fixed actions from legacy order while preserving the block type order', () => {
        const types = [...DEFAULT_BLOCK_MENU_ORDERS.root].reverse();
        const result = migrateSettings({
            schemaVersion: 10,
            blockMenuOrder: ['delete', 'copy', 'separator', ...types, 'cut'],
        });
        expect(result.blockMenuOrders.root).toEqual(types);
        expect(result.schemaVersion).toBe(12);
    });

    it.each([
        null,
        [...DEFAULT_BLOCK_MENU_ORDERS.root.slice(1)],
        [...DEFAULT_BLOCK_MENU_ORDERS.root.slice(1), 'heading'],
        [...DEFAULT_BLOCK_MENU_ORDERS.root.slice(1), 'unknown'],
    ])('rejects invalid menu order rather than silently replacing it (%j)', (blockMenuOrder) => {
        expect(() => migrateSettings({ schemaVersion: 11, blockMenuOrder })).toThrow(
            'Dragger: root menu order must contain each item exactly once',
        );
    });

    it('removes unchanged seeded Callouts and preserves custom styles and edits', () => {
        const seeded = [
            { type: 'note', label: 'Note', icon: 'pencil' },
            { type: 'tip', label: 'Tip', icon: 'lightbulb' },
            { type: 'warning', label: 'Warning', icon: 'alert-triangle' },
        ].map(({ type, label, icon }) => ({
            id: `callout-${type}`,
            label,
            icon,
            category: 'callout',
            template: `> [!${type}]\n\${content}`,
            linePrefix: '> ',
        }));
        const edited = [
            { ...seeded[0], label: 'My Note' },
            { ...seeded[1], icon: 'star' },
            { ...seeded[2], template: '> [!danger]\n${content}' },
            { ...seeded[0], linePrefix: '>> ' },
            { ...seeded[1], variables: { title: 'Tip' } },
            { ...seeded[2], id: 'my-callout' },
        ];
        const custom = { id: 'custom', label: 'My style', icon: 'box', template: '`${content}`' };
        for (const style of edited) {
            const result = migrateSettings({
                schemaVersion: 8,
                customBlockStyles: [seeded[2], style, custom, seeded[0], seeded[1]],
            });
            expect(result.customBlockStyles).toEqual([style, custom]);
            expect(result.blockMenuOrders.custom).toEqual([style.id, custom.id]);
            expect(result.schemaVersion).toBe(12);
            expect(migrateSettings(result)).toEqual(result);
        }
    });

    it('preserves root and custom order when upgrading to nested menu orders', () => {
        const styles = [
            { id: 'b', label: 'B', icon: 'box', template: '${content}' },
            { id: 'a', label: 'A', icon: 'box', template: '${content}' },
        ];
        const root = [...DEFAULT_BLOCK_MENU_ORDERS.root].reverse();
        const result = migrateSettings({ schemaVersion: 11, blockMenuOrder: root, customBlockStyles: styles });
        expect(result.blockMenuOrders).toEqual({ ...DEFAULT_BLOCK_MENU_ORDERS, root, custom: ['b', 'a'] });
        expect(result).not.toHaveProperty('blockMenuOrder');
        expect(migrateSettings(result)).toEqual(result);
    });

    it.each(['heading', 'list', 'callout', 'custom'] as const)(
        'rejects a corrupt %s order instead of substituting defaults',
        (listId) => {
            const settings = migrateSettings(null);
            settings.blockMenuOrders[listId] = ['unknown'];
            expect(() => migrateSettings(settings)).toThrow(
                `Dragger: ${listId} menu order must contain each item exactly once`,
            );
        },
    );

    it('rejects custom order that is inconsistent with the style registry', () => {
        const settings = migrateSettings({
            customBlockStyles: [{ id: 'a', label: 'A', icon: 'box', template: '${content}' }],
        });
        settings.blockMenuOrders.custom = [];
        expect(() => migrateSettings(settings)).toThrow(
            'Dragger: custom menu order must contain each item exactly once',
        );
    });

    it('rejects duplicate style IDs', () => {
        const style = { id: 'a', label: 'A', icon: 'box', template: '${content}' };
        expect(() => migrateSettings({ customBlockStyles: [style, style] })).toThrow(
            'Dragger: custom block style IDs must be unique',
        );
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
        expect(result.schemaVersion).toBe(12);
    });
});
