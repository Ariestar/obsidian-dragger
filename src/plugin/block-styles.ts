import type { BlockTemplate } from 'md-dragger/domain';

export type BlockStyleCategory = 'heading' | 'list' | 'basic' | 'callout' | 'custom';

export type BlockStyleDefinition = BlockTemplate & {
    id: string;
    label: string;
    icon: string;
    category?: BlockStyleCategory;
};

export const BUILTIN_BLOCK_STYLES: BlockStyleDefinition[] = [
    { id: 'paragraph', label: 'Paragraph', icon: 'pilcrow', category: 'basic', template: '${content}' },
    { id: 'h1', label: 'Heading 1', icon: 'heading-1', category: 'heading', template: '# ${content}' },
    { id: 'h2', label: 'Heading 2', icon: 'heading-2', category: 'heading', template: '## ${content}' },
    { id: 'h3', label: 'Heading 3', icon: 'heading-3', category: 'heading', template: '### ${content}' },
    { id: 'h4', label: 'Heading 4', icon: 'heading-4', category: 'heading', template: '#### ${content}' },
    { id: 'h5', label: 'Heading 5', icon: 'heading-5', category: 'heading', template: '##### ${content}' },
    { id: 'h6', label: 'Heading 6', icon: 'heading-6', category: 'heading', template: '###### ${content}' },
    {
        id: 'list-unordered',
        label: 'Bullet list',
        icon: 'list',
        category: 'list',
        template: '${content}',
        linePrefix: '- ',
    },
    {
        id: 'list-ordered',
        label: 'Numbered list',
        icon: 'list-ordered',
        category: 'list',
        template: '${content}',
        linePrefix: '${ordinal}. ',
    },
    {
        id: 'list-task',
        label: 'Task list',
        icon: 'list-checks',
        category: 'list',
        template: '${content}',
        linePrefix: '- [ ] ',
    },
    { id: 'blockquote', label: 'Quote', icon: 'quote', category: 'basic', template: '${content}', linePrefix: '> ' },
    { id: 'code-block', label: 'Code block', icon: 'code', category: 'basic', template: '```\n${content}\n```' },
    { id: 'math-block', label: 'Math block', icon: 'sigma', category: 'basic', template: '$$\n${content}\n$$' },
];

export const DEFAULT_CUSTOM_BLOCK_STYLES: BlockStyleDefinition[] = [
    {
        id: 'callout-note',
        label: 'Note',
        icon: 'pencil',
        category: 'callout',
        template: '> [!note]\n${content}',
        linePrefix: '> ',
    },
    {
        id: 'callout-tip',
        label: 'Tip',
        icon: 'lightbulb',
        category: 'callout',
        template: '> [!tip]\n${content}',
        linePrefix: '> ',
    },
    {
        id: 'callout-warning',
        label: 'Warning',
        icon: 'alert-triangle',
        category: 'callout',
        template: '> [!warning]\n${content}',
        linePrefix: '> ',
    },
];
