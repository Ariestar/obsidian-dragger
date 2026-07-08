import { Extension } from '@codemirror/state';
import { ViewPlugin } from '@codemirror/view';
import DragNDropPlugin from '../../../plugin/main';
import { createCodeMirrorDragDriverPluginClass } from './drag-driver';
import { createHandleGutterExtension } from '../handle/handle-gutter-extension';

function createDragHandleViewPlugin(plugin: DragNDropPlugin) {
    return ViewPlugin.fromClass(
        createCodeMirrorDragDriverPluginClass(plugin)
    );
}

/**
 * 创建拖拽手柄编辑器扩展
 */
export function dragHandleExtension(plugin: DragNDropPlugin): Extension {
    return [
        createHandleGutterExtension(),
        createDragHandleViewPlugin(plugin),
    ];
}


