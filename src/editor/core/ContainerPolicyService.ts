import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../types';
import { getLineMap, LineMap } from './line-map';
import {
    resolveDropRuleContextAtInsertion,
    type DropRuleContext,
} from './container-policies';

export class ContainerPolicyService {
    constructor(private readonly view: EditorView) { }

    resolveDropRuleAtInsertion(
        sourceBlock: BlockInfo,
        targetLineNumber: number,
        options?: { lineMap?: LineMap }
    ): DropRuleContext {
        const lineMap = options?.lineMap ?? getLineMap(this.view.state);
        return resolveDropRuleContextAtInsertion(
            this.view.state,
            sourceBlock,
            targetLineNumber,
            undefined,
            { lineMap }
        );
    }

    shouldPreventDropIntoDifferentContainer(
        sourceBlock: BlockInfo,
        targetLineNumber: number
    ): boolean {
        return !this.resolveDropRuleAtInsertion(sourceBlock, targetLineNumber).decision.allowDrop;
    }
}
