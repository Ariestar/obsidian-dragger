import type { Extension } from '@codemirror/state';
import {
    dragHandleExtension as buildObsidianDragger,
    type ObsidianDraggerHost,
} from '../obsidian-dragger';

/** Editor extension entry: md-dragger adapter + Obsidian paint/shell. */
export function dragHandleExtension(plugin: ObsidianDraggerHost): Extension {
    return buildObsidianDragger(plugin);
}
