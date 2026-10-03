import { BlockType, type ConvertTo } from 'md-dragger/domain';
import { t, type I18nStrings } from './i18n';
import type { BlockStyleDefinition } from './block-styles';
import type { DragNDropSettings } from './settings-types';

const HEADING_LEVELS = [1, 2, 3, 4, 5, 6] as const;
type BuiltinOption = { id: string; target: ConvertTo; icon: string; labelKey: keyof I18nStrings; level?: number };
const BUILTIN_OPTIONS: Record<'heading' | 'list' | 'callout', BuiltinOption[]> = {
    heading: HEADING_LEVELS.map((level) => ({
        id: `heading-${level}`,
        target: { type: BlockType.Heading, level },
        icon: `heading-${level}`,
        labelKey: 'blockMenuHeading',
        level,
    })),
    list: [
        {
            id: 'list-unordered',
            target: { type: BlockType.ListItem, markerType: 'unordered' },
            labelKey: 'blockMenuBulletList',
            icon: 'list',
        },
        {
            id: 'list-ordered',
            target: { type: BlockType.ListItem, markerType: 'ordered' },
            labelKey: 'blockMenuNumberedList',
            icon: 'list-ordered',
        },
        {
            id: 'list-task',
            target: { type: BlockType.ListItem, markerType: 'task' },
            labelKey: 'blockMenuTaskList',
            icon: 'list-checks',
        },
    ],
    callout: [
        {
            id: 'callout-note',
            target: { template: '> [!note]\n${content}', linePrefix: '> ' },
            labelKey: 'blockMenuCalloutNote',
            icon: 'pencil',
        },
        {
            id: 'callout-tip',
            target: { template: '> [!tip]\n${content}', linePrefix: '> ' },
            labelKey: 'blockMenuCalloutTip',
            icon: 'lightbulb',
        },
        {
            id: 'callout-warning',
            target: { template: '> [!warning]\n${content}', linePrefix: '> ' },
            labelKey: 'blockMenuCalloutWarning',
            icon: 'alert-triangle',
        },
    ],
};
export const DEFAULT_BLOCK_MENU_ORDERS = {
    root: ['paragraph', 'heading', 'list', 'quote', 'callout', 'code-block', 'math-block', 'custom'],
    heading: BUILTIN_OPTIONS.heading.map((option) => option.id),
    list: BUILTIN_OPTIONS.list.map((option) => option.id),
    callout: BUILTIN_OPTIONS.callout.map((option) => option.id),
    custom: [],
} as const;

export type BlockMenuItemId = (typeof DEFAULT_BLOCK_MENU_ORDERS.root)[number];
export type BlockMenuListId = keyof typeof DEFAULT_BLOCK_MENU_ORDERS;
export type BlockMenuOrders = { root: BlockMenuItemId[] } & Record<Exclude<BlockMenuListId, 'root'>, string[]>;
export type BlockMenuSettings = Pick<DragNDropSettings, 'blockMenuOrders' | 'customBlockStyles'>;
export type BlockTypeConversionOption = {
    id: string;
    target: ConvertTo;
    label: string;
    icon: string;
    style?: BlockStyleDefinition;
};
export type BlockMenuGroup = {
    id: Exclude<BlockMenuListId, 'root'>;
    label: string;
    icon: string;
    options: BlockTypeConversionOption[];
};
export type BlockMenuEntry = BlockTypeConversionOption | BlockMenuGroup;

/** Shared definitions and persisted order for settings, desktop and mobile menus. */
export function getBlockMenuEntries(settings: BlockMenuSettings): BlockMenuEntry[] {
    const i = t();
    const builtinOptions = (group: keyof typeof BUILTIN_OPTIONS): BlockTypeConversionOption[] =>
        BUILTIN_OPTIONS[group].map((option) => ({
            id: option.id,
            target: option.target,
            icon: option.icon,
            label: option.level === undefined ? i[option.labelKey] : `${i[option.labelKey]} ${option.level}`,
        }));
    const items: Record<BlockMenuItemId, BlockMenuEntry> = {
        paragraph: {
            id: 'paragraph',
            target: { type: BlockType.Paragraph },
            label: i.blockMenuParagraph,
            icon: 'pilcrow',
        },
        heading: { id: 'heading', label: i.blockMenuHeading, icon: 'heading', options: builtinOptions('heading') },
        list: { id: 'list', label: i.blockMenuList, icon: 'list', options: builtinOptions('list') },
        quote: { id: 'quote', target: { type: BlockType.Blockquote }, label: i.blockMenuQuote, icon: 'quote' },
        callout: {
            id: 'callout',
            label: i.blockMenuCallout,
            icon: 'message-square',
            options: builtinOptions('callout'),
        },
        'code-block': {
            id: 'code-block',
            target: { type: BlockType.CodeBlock },
            label: i.blockMenuCodeBlock,
            icon: 'code',
        },
        'math-block': {
            id: 'math-block',
            target: { type: BlockType.MathBlock },
            label: i.blockMenuMathBlock,
            icon: 'sigma',
        },
        custom: {
            id: 'custom',
            label: i.blockMenuCustom,
            icon: 'sparkles',
            options: settings.customBlockStyles.map((style) => ({
                id: style.id,
                target: style,
                label: style.label,
                icon: style.icon,
                style,
            })),
        },
    };
    for (const entry of Object.values(items)) {
        if ('options' in entry) {
            const options = new Map(entry.options.map((option) => [option.id, option]));
            entry.options = settings.blockMenuOrders[entry.id].map((id) => {
                const option = options.get(id);
                if (!option) throw new Error(`Dragger: unknown ${entry.id} menu item "${id}"`);
                return option;
            });
        }
    }
    return settings.blockMenuOrders.root.map((id) => items[id]);
}
