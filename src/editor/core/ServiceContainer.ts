import { EditorView } from '@codemirror/view';
import { LineParsingService } from './LineParsingService';
import { GeometryCalculator } from './GeometryCalculator';
import { ContainerPolicyService } from './ContainerPolicyService';
import { TextMutationPolicy } from './TextMutationPolicy';
import { DragSourceResolver } from './DragSourceResolver';
import { DropTargetCalculatorDeps } from '../handlers/DropTargetCalculator';
import { BlockMoverDeps } from '../movers/BlockMover';
import { clampNumber, clampTargetLineNumber } from '../utils/coordinate-utils';
import { getPreviousNonEmptyLineNumber } from './container-policies';

/**
 * Groups the stateless/low-state core services that many subsystems depend on.
 * Created once per ViewPlugin lifetime and threaded through as a single object.
 */
export class ServiceContainer {
    readonly lineParsing: LineParsingService;
    readonly geometry: GeometryCalculator;
    readonly containerPolicy: ContainerPolicyService;
    readonly textMutation: TextMutationPolicy;
    readonly dragSource: DragSourceResolver;

    constructor(readonly view: EditorView) {
        this.dragSource = new DragSourceResolver(view);
        this.lineParsing = new LineParsingService(view);
        this.geometry = new GeometryCalculator(view, this.lineParsing);
        this.containerPolicy = new ContainerPolicyService(view);
        this.textMutation = new TextMutationPolicy(this.lineParsing);
    }

    buildDropTargetCalculatorDeps(
        hooks?: Pick<DropTargetCalculatorDeps, 'onDragTargetEvaluated' | 'recordPerfDuration' | 'incrementPerfCounter'>
    ): DropTargetCalculatorDeps {
        return {
            parseLineWithQuote: (line) => this.textMutation.parseLineWithQuote(line),
            getAdjustedTargetLocation: (ln, opts) => this.geometry.getAdjustedTargetLocation(ln, opts),
            clampTargetLineNumber,
            getPreviousNonEmptyLineNumber: (doc, ln) => getPreviousNonEmptyLineNumber(doc, ln),
            resolveDropRuleAtInsertion: (src, ln, opts) => this.containerPolicy.resolveDropRuleAtInsertion(src, ln, opts),
            getListContext: (doc, ln) => this.textMutation.getListContext(doc, ln),
            getIndentUnitWidth: (sample) => this.textMutation.getIndentUnitWidth(sample),
            getBlockInfoForEmbed: (el) => this.dragSource.getBlockInfoForEmbed(el),
            getIndentUnitWidthForDoc: (doc) => this.textMutation.getIndentUnitWidthForDoc(doc),
            getLineRect: (ln, fc) => this.geometry.getLineRect(ln, fc),
            getInsertionAnchorY: (ln, fc) => this.geometry.getInsertionAnchorY(ln, fc),
            getLineIndentPosByWidth: (ln, w) => this.geometry.getLineIndentPosByWidth(ln, w),
            getBlockRect: (s, e, fc) => this.geometry.getBlockRect(s, e, fc),
            clampNumber,
            ...hooks,
        };
    }

    buildBlockMoverDeps(): Omit<BlockMoverDeps, 'view'> {
        return {
            clampTargetLineNumber,
            getAdjustedTargetLocation: (ln, opts) => this.geometry.getAdjustedTargetLocation(ln, opts),
            resolveDropRuleAtInsertion: (src, ln, opts) => this.containerPolicy.resolveDropRuleAtInsertion(src, ln, opts),
            parseLineWithQuote: (line) => this.textMutation.parseLineWithQuote(line),
            getListContext: (doc, ln) => this.textMutation.getListContext(doc, ln),
            getIndentUnitWidth: (sample) => this.textMutation.getIndentUnitWidth(sample),
            buildInsertText: (doc, src, ln, content, lcln, lid, ltw) =>
                this.textMutation.buildInsertText(doc, src, ln, content, lcln, lid, ltw),
        };
    }
}
