import { BlockType } from '../../../types';
import {
    resolveInsertionRule,
    RulePosition,
    RuleTargetContainerType,
} from '../insertion-rule-matrix';

export function shouldSeparateBlock(type: BlockType, adjacentLineText: string | null): boolean {
    if (!adjacentLineText) return false;
    if (adjacentLineText.trim().length === 0) return false;

    const trimmed = adjacentLineText.trimStart();
    if (trimmed.startsWith('|')) {
        // Keep quote/callout flows compact, but separate normal/table blocks from table rows.
        if (type === BlockType.Blockquote || type === BlockType.Callout) return false;
        return trimmed.startsWith('|');
    }

    return false;
}

function isBlockquoteLikeLine(line: string | null): boolean {
    if (!line) return false;
    return /^(> ?)+/.test(line.trimStart());
}

function isCalloutLine(line: string | null): boolean {
    if (!line) return false;
    return /^(\s*> ?)+\s*\[!/.test(line.trimStart());
}

function isListItemLine(line: string | null): boolean {
    if (!line) return false;
    return /^\s*(?:[-*+]\s(?:\[[ xX]\]\s+)?|\d+[.)]\s+)/.test(line);
}

function getContainerTypeFromAdjacentLine(line: string | null): RuleTargetContainerType {
    if (!line) return null;
    if (isBlockquoteLikeLine(line)) {
        return isCalloutLine(line) ? BlockType.Callout : BlockType.Blockquote;
    }
    if (isListItemLine(line)) {
        return BlockType.ListItem;
    }
    return null;
}

function inferInsertionContext(
    prevText: string | null,
    nextText: string | null
): { targetContainerType: RuleTargetContainerType; position: RulePosition } {
    const prevType = getContainerTypeFromAdjacentLine(prevText);
    const nextType = getContainerTypeFromAdjacentLine(nextText);
    if (prevType && nextType && prevType === nextType) {
        return { targetContainerType: prevType, position: 'inside' };
    }
    if (prevType && !nextType) {
        return { targetContainerType: prevType, position: 'after' };
    }
    if (!prevType && nextType) {
        return { targetContainerType: nextType, position: 'before' };
    }
    if (prevType && nextType && prevType !== nextType) {
        return { targetContainerType: null, position: 'boundary' };
    }
    return { targetContainerType: null, position: 'outside' };
}

function getFirstNonEmptyLine(content: string): string | null {
    const lines = content.split('\n');
    for (const line of lines) {
        if (line.trim().length === 0) continue;
        return line;
    }
    return null;
}

export function getBoundarySpacing(params: {
    sourceBlockType: BlockType;
    sourceContent: string;
    prevText: string | null;
    nextText: string | null;
}): {
    needsLeadingBlank: boolean;
    needsTrailingBlank: boolean;
    resetQuoteDepth: boolean;
} {
    const { sourceBlockType, sourceContent, prevText, nextText } = params;
    const firstNonEmptySourceLine = getFirstNonEmptyLine(sourceContent);
    const effectiveSourceType = (sourceBlockType === BlockType.Paragraph && isCalloutLine(firstNonEmptySourceLine))
        ? BlockType.Callout
        : (sourceBlockType === BlockType.Paragraph && isBlockquoteLikeLine(firstNonEmptySourceLine))
            ? BlockType.Blockquote
            : sourceBlockType;
    const context = inferInsertionContext(prevText, nextText);
    const matrixDecision = resolveInsertionRule({
        sourceType: effectiveSourceType,
        targetContainerType: context.targetContainerType,
        position: context.position,
    });

    return {
        needsLeadingBlank: matrixDecision.leadingBlank,
        needsTrailingBlank: matrixDecision.trailingBlank || shouldSeparateBlock(sourceBlockType, nextText),
        resetQuoteDepth: matrixDecision.resetQuoteDepth,
    };
}
