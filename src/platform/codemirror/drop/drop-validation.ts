import type { DropTarget } from '../../../domain/command/drop-target';
import type { DropDecision } from '../../../domain/decision/drop-decision';

export interface DropPreview {
    indicatorY: number;
    lineRect?: { left: number; width: number };
    highlightRect?: { top: number; left: number; width: number; height: number };
}

export type DropResolution = {
    target: DropTarget;
    preview: DropPreview;
};

export type DropAllowedResult = {
    allowed: true;
    resolution: DropResolution;
};

export type DropRejectedResult = {
    allowed: false;
    reason?: import('../../../domain/decision/drop-decision').DropRejectReason;
    resolution?: never;
};

export type DropValidationResult = DropAllowedResult | DropRejectedResult;

/**
 * Strips preview geometry from the platform validation result, leaving the
 * domain decision the drag runtime actually consumes.
 */
export function toDropDecision(validation: DropValidationResult): DropDecision {
    return validation.allowed
        ? { allowed: true, target: validation.resolution.target }
        : { allowed: false, reason: validation.reason ?? 'no_target' };
}
