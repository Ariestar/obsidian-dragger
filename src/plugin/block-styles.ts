import type { BlockTemplate } from 'md-dragger/domain';

export type BlockStyleCategory = 'heading' | 'list' | 'basic' | 'callout' | 'custom';

export type BlockStyleDefinition = BlockTemplate & {
    id: string;
    label: string;
    icon: string;
    category?: BlockStyleCategory;
};
