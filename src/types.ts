/**
 * 块类型枚举
 */
export enum BlockType {
    Paragraph = 'paragraph',
    Heading = 'heading',
    ListItem = 'list-item',
    CodeBlock = 'code-block',
    Blockquote = 'blockquote',
    Table = 'table',
    MathBlock = 'math-block',
    Callout = 'callout',
    HorizontalRule = 'hr',
    Unknown = 'unknown',
}

/**
 * 块信息接口
 */
export interface BlockInfo {
    /** 块类型 */
    type: BlockType;
    /** 起始行号（0-indexed） */
    startLine: number;
    /** 结束行号（0-indexed，包含） */
    endLine: number;
    /** 起始位置（文档偏移） */
    from: number;
    /** 结束位置（文档偏移） */
    to: number;
    /** 缩进级别 */
    indentLevel: number;
    /** 块内容 */
    content: string;
}

/**
 * 拖拽状态
 */
export interface DragState {
    /** 是否正在拖拽 */
    isDragging: boolean;
    /** 被拖拽的块信息 */
    draggedBlock: BlockInfo | null;
    /** 目标放置位置（行号） */
    dropTargetLine: number | null;
    /** 放置位置（before/after） */
    dropPosition: 'before' | 'after' | null;
}

export type DragLifecycleState =
    | 'idle'
    | 'press_pending'
    | 'drag_active'
    | 'drop_commit'
    | 'cancelled';

export interface DragListIntent {
    listContextLineNumber?: number;
    listIndentDelta?: number;
    listTargetIndentWidth?: number;
}

export interface DragLifecycleEvent {
    state: DragLifecycleState;
    sourceBlock: BlockInfo | null;
    targetLine: number | null;
    listIntent: DragListIntent | null;
    rejectReason: string | null;
    pointerType: string | null;
}

export type DragLifecycleListener = (event: DragLifecycleEvent) => void;
