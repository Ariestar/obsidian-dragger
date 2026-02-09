import { EditorView } from '@codemirror/view';
import { ListDropTargetInfo } from './ListDropTargetCalculator';

type MarkerBounds = { markerStartX: number; contentStartX: number } | null;

type MarkerBoundsSessionCache = {
    state: unknown;
    scrollLeft: number;
    scrollTop: number;
    byLine: Map<number, MarkerBounds>;
};

type ListTargetSessionCacheEntry = {
    state: unknown;
    scrollLeft: number;
    scrollTop: number;
    byKey: Map<string, ListDropTargetInfo>;
};

const LIST_TARGET_X_BUCKET_PX_MIN = 4;

export class ListTargetSessionCache {
    private markerBoundsCache: MarkerBoundsSessionCache | null = null;
    private listTargetCache: ListTargetSessionCacheEntry | null = null;

    constructor(private readonly view: EditorView) {}

    getCachedMarkerBounds(lineNumber: number): MarkerBounds | undefined {
        const currentState = this.view.state;
        const scroll = this.getScrollSignature();
        const cache = this.markerBoundsCache;
        if (
            !cache
            || cache.state !== currentState
            || cache.scrollLeft !== scroll.scrollLeft
            || cache.scrollTop !== scroll.scrollTop
        ) {
            this.markerBoundsCache = {
                state: currentState,
                scrollLeft: scroll.scrollLeft,
                scrollTop: scroll.scrollTop,
                byLine: new Map<number, MarkerBounds>(),
            };
            return undefined;
        }
        return cache.byLine.get(lineNumber);
    }

    setCachedMarkerBounds(lineNumber: number, value: MarkerBounds): void {
        const currentState = this.view.state;
        const scroll = this.getScrollSignature();
        if (
            !this.markerBoundsCache
            || this.markerBoundsCache.state !== currentState
            || this.markerBoundsCache.scrollLeft !== scroll.scrollLeft
            || this.markerBoundsCache.scrollTop !== scroll.scrollTop
        ) {
            this.markerBoundsCache = {
                state: currentState,
                scrollLeft: scroll.scrollLeft,
                scrollTop: scroll.scrollTop,
                byLine: new Map<number, MarkerBounds>(),
            };
        }
        this.markerBoundsCache.byLine.set(lineNumber, value);
    }

    getCachedListTarget(key: string): ListDropTargetInfo | null {
        const currentState = this.view.state;
        const scroll = this.getScrollSignature();
        const cache = this.listTargetCache;
        if (
            !cache
            || cache.state !== currentState
            || cache.scrollLeft !== scroll.scrollLeft
            || cache.scrollTop !== scroll.scrollTop
        ) {
            this.listTargetCache = {
                state: currentState,
                scrollLeft: scroll.scrollLeft,
                scrollTop: scroll.scrollTop,
                byKey: new Map<string, ListDropTargetInfo>(),
            };
            return null;
        }
        return cache.byKey.get(key) ?? null;
    }

    setCachedListTarget(key: string, result: ListDropTargetInfo): void {
        const currentState = this.view.state;
        const scroll = this.getScrollSignature();
        if (
            !this.listTargetCache
            || this.listTargetCache.state !== currentState
            || this.listTargetCache.scrollLeft !== scroll.scrollLeft
            || this.listTargetCache.scrollTop !== scroll.scrollTop
        ) {
            this.listTargetCache = {
                state: currentState,
                scrollLeft: scroll.scrollLeft,
                scrollTop: scroll.scrollTop,
                byKey: new Map<string, ListDropTargetInfo>(),
            };
        }
        if (this.listTargetCache.byKey.size > 512) {
            this.listTargetCache.byKey.clear();
        }
        this.listTargetCache.byKey.set(key, result);
    }

    buildListTargetCacheKey(params: {
        targetLineNumber: number;
        lineNumber: number;
        forcedLineNumber: number | null;
        childIntentOnLine: boolean;
        dragSource: { type: string | number; startLine: number; endLine: number; from: number; to: number };
        clientX: number;
    }): string {
        const bucketSize = Math.max(
            LIST_TARGET_X_BUCKET_PX_MIN,
            Math.round((this.view.defaultCharacterWidth || 7) / 2)
        );
        const clientXBucket = Math.round(params.clientX / bucketSize);
        return [
            params.targetLineNumber,
            params.lineNumber,
            params.forcedLineNumber ?? 'n',
            params.childIntentOnLine ? '1' : '0',
            clientXBucket,
            params.dragSource.type,
            params.dragSource.startLine,
            params.dragSource.endLine,
            params.dragSource.from,
            params.dragSource.to,
        ].join('|');
    }

    private getScrollSignature(): { scrollLeft: number; scrollTop: number } {
        const scrollDOM = (this.view as unknown as { scrollDOM?: HTMLElement }).scrollDOM;
        if (!scrollDOM) return { scrollLeft: 0, scrollTop: 0 };
        return {
            scrollLeft: Math.round(scrollDOM.scrollLeft || 0),
            scrollTop: Math.round(scrollDOM.scrollTop || 0),
        };
    }
}
