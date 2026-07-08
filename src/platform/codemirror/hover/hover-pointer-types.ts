export type HoverContentRect = Pick<DOMRect | DOMRectReadOnly, 'left' | 'right' | 'top' | 'bottom'>;

export interface HoverPointerSnapshot {
    clientX: number;
    clientY: number;
    contentRect: HoverContentRect;
    gutterSide: 'left' | 'right';
    withinContent: boolean;
    withinHandleInteractionZone: boolean;
    withinHoverActivationZone: boolean;
}
