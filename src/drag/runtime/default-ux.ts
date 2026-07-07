import type { DraggerDisposable, DraggerRuntimeController } from './dragger-runtime-types';

export function defaultDraggerRuntimeUx(): { mount(runtime: DraggerRuntimeController): DraggerDisposable } {
    return {
        mount(runtime) {
            const disposables: DraggerDisposable[] = [];
            const input = runtime.input;
            disposables.push(input.onPress((event) => runtime.handlePress(event)));
            disposables.push(input.onMove((event) => runtime.handleMove(event)));
            disposables.push(input.onRelease((event) => runtime.handleRelease(event)));
            if (input.onCancel) {
                disposables.push(input.onCancel((event) => {
                    runtime.handleCancel(event.pointer, event.releaseCapture);
                }));
            }
            if (input.onEscape) {
                disposables.push(input.onEscape(() => runtime.clearSelectionOrCancel()));
            }
            return () => {
                while (disposables.length > 0) {
                    disposables.pop()?.();
                }
            };
        },
    };
}
