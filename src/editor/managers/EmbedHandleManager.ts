import { EditorView } from '@codemirror/view';
import { BlockInfo } from '../../types';
import { EMBED_BLOCK_SELECTOR } from '../core/selectors';
import { getHandleColumnLeftPx, getHandleLeftPxForLine, getHandleTopPxForLine } from '../core/handle-position';

type EmbedHandleEntry = {
    handle: HTMLElement;
};

const HANDLE_SIZE_PX = 16;

export interface EmbedHandleManagerDeps {
    createHandleElement: (getBlockInfo: () => BlockInfo | null) => HTMLElement;
    resolveBlockInfoForEmbed: (embedEl: HTMLElement) => BlockInfo | null;
    shouldRenderEmbedHandles?: () => boolean;
}

export class EmbedHandleManager {
    private readonly embedHandles = new Map<HTMLElement, EmbedHandleEntry>();
    private observer: MutationObserver | null = null;
    private pendingScan = false;
    private readonly onScrollOrResize = () => this.updateHandlePositions();

    constructor(
        private readonly view: EditorView,
        private readonly deps: EmbedHandleManagerDeps
    ) { }

    private shouldRenderEmbedHandles(): boolean {
        if (!this.deps.shouldRenderEmbedHandles) return true;
        return this.deps.shouldRenderEmbedHandles();
    }

    start(): void {
        if (!this.observer) {
            this.observer = new MutationObserver(() => this.scheduleScan());
            this.observer.observe(this.view.dom, {
                childList: true,
                subtree: true,
                attributes: false,
            });
        }

        this.view.scrollDOM.addEventListener('scroll', this.onScrollOrResize, { passive: true });
        window.addEventListener('resize', this.onScrollOrResize);

        this.rescan();
    }

    scheduleScan(): void {
        if (this.pendingScan) return;
        this.pendingScan = true;
        requestAnimationFrame(() => {
            this.pendingScan = false;
            this.rescan();
        });
    }

    rescan(): void {
        if (!this.shouldRenderEmbedHandles()) {
            for (const [embedEl, entry] of this.embedHandles.entries()) {
                this.cleanupHandle(embedEl, entry);
            }
            this.embedHandles.clear();
            return;
        }

        const embeds = this.view.dom.querySelectorAll(EMBED_BLOCK_SELECTOR);
        const handled = new Set<HTMLElement>();

        embeds.forEach((embed) => {
            const rawEl = embed as HTMLElement;
            const embedEl = (rawEl.closest('.cm-embed-block') as HTMLElement | null) ?? rawEl;
            if (handled.has(embedEl)) return;
            handled.add(embedEl);

            const getBlockInfo = () => this.deps.resolveBlockInfoForEmbed(embedEl);
            const block = getBlockInfo();
            if (!block) return;

            let entry = this.embedHandles.get(embedEl);
            if (!entry) {
                const handle = this.deps.createHandleElement(getBlockInfo);
                handle.classList.add('dnd-embed-handle');
                handle.style.position = 'fixed';
                document.body.appendChild(handle);

                entry = { handle };
                this.embedHandles.set(embedEl, entry);
            }

            entry.handle.setAttribute('data-block-start', String(block.startLine));
            entry.handle.setAttribute('data-block-end', String(block.endLine));
            this.positionHandle(embedEl, entry.handle);
        });

        for (const [embedEl, entry] of this.embedHandles.entries()) {
            if (!handled.has(embedEl) || !document.body.contains(embedEl)) {
                this.cleanupHandle(embedEl, entry);
                this.embedHandles.delete(embedEl);
            }
        }
    }

    updateHandlePositions(): void {
        if (!this.shouldRenderEmbedHandles()) return;
        for (const [embedEl, entry] of this.embedHandles.entries()) {
            if (!document.body.contains(embedEl)) continue;
            this.positionHandle(embedEl, entry.handle);
        }
    }

    destroy(): void {
        this.pendingScan = false;
        if (this.observer) {
            this.observer.disconnect();
            this.observer = null;
        }
        this.view.scrollDOM.removeEventListener('scroll', this.onScrollOrResize);
        window.removeEventListener('resize', this.onScrollOrResize);

        for (const [embedEl, entry] of this.embedHandles.entries()) {
            this.cleanupHandle(embedEl, entry);
        }
        this.embedHandles.clear();
    }

    private cleanupHandle(_embedEl: HTMLElement, entry: EmbedHandleEntry): void {
        entry.handle.remove();
    }

    isManagedHandle(handle: HTMLElement): boolean {
        for (const entry of this.embedHandles.values()) {
            if (entry.handle === handle) return true;
        }
        return false;
    }

    private positionHandle(embedEl: HTMLElement, handle: HTMLElement): void {
        if (!this.isEmbedVisible(embedEl)) {
            handle.classList.remove('is-visible');
            handle.style.display = 'none';
            return;
        }

        handle.style.display = '';
        const lineNumber = this.resolveHandleLineNumber(handle);
        const left = lineNumber
            ? (getHandleLeftPxForLine(this.view, lineNumber) ?? getHandleColumnLeftPx(this.view))
            : getHandleColumnLeftPx(this.view);
        const top = lineNumber
            ? (getHandleTopPxForLine(this.view, lineNumber) ?? this.getEmbedFallbackTop(embedEl))
            : this.getEmbedFallbackTop(embedEl);
        handle.style.left = `${left}px`;
        handle.style.top = `${top}px`;
    }

    private resolveHandleLineNumber(handle: HTMLElement): number | null {
        const startAttr = handle.getAttribute('data-block-start');
        if (startAttr === null) return null;
        const lineNumber = Number(startAttr) + 1;
        if (!Number.isInteger(lineNumber) || lineNumber < 1 || lineNumber > this.view.state.doc.lines) {
            return null;
        }
        return lineNumber;
    }

    private getEmbedFallbackTop(embedEl: HTMLElement): number {
        const embedRect = embedEl.getBoundingClientRect();
        const lineCenterOffset = Math.max(0, (this.view.defaultLineHeight || 20) / 2 - HANDLE_SIZE_PX / 2);
        return Math.round(embedRect.top + lineCenterOffset);
    }

    private isEmbedVisible(embedEl: HTMLElement): boolean {
        if (!embedEl.isConnected) return false;
        const style = getComputedStyle(embedEl);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return false;
        }
        const rect = embedEl.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return false;
        if (rect.bottom < 0 || rect.top > window.innerHeight) return false;
        if (rect.right < 0 || rect.left > window.innerWidth) return false;
        return true;
    }
}
