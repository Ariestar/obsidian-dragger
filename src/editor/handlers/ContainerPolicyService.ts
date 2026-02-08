import { EditorView } from '@codemirror/view';
import { detectBlock } from '../block-detector';
import { BlockInfo } from '../../types';
import {
    resolveDropRuleContextAtInsertion,
    type DropRuleContext,
} from '../core/container-policies';

export class ContainerPolicyService {
    constructor(private readonly view: EditorView) { }

    resolveDropRuleAtInsertion(
        sourceBlock: BlockInfo,
        targetLineNumber: number
    ): DropRuleContext {
        return resolveDropRuleContextAtInsertion(this.view.state, sourceBlock, targetLineNumber, detectBlock as any);
    }

    shouldPreventDropIntoDifferentContainer(
        sourceBlock: BlockInfo,
        targetLineNumber: number
    ): boolean {
        return !this.resolveDropRuleAtInsertion(sourceBlock, targetLineNumber).decision.allowDrop;
    }
}
