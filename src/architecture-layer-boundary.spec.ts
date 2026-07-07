import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcRoot = join(process.cwd(), 'src');

type SourceFile = { rel: string; text: string };
type ImportEdge = { rel: string; specifier: string; resolved: string | null };

function collectTsFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
            files.push(...collectTsFiles(path));
            continue;
        }
        if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.test-helpers.ts') && entry !== 'test-setup.ts') {
            files.push(path);
        }
    }
    return files;
}

function collectAllTsFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
            files.push(...collectAllTsFiles(path));
            continue;
        }
        if (entry.endsWith('.ts')) {
            files.push(path);
        }
    }
    return files;
}

function readProductionFiles(): SourceFile[] {
    return collectTsFiles(srcRoot).map((path) => ({
        rel: relative(process.cwd(), path).replace(/\\/g, '/'),
        text: readFileSync(path, 'utf8'),
    }));
}

function readAllSourceFiles(): SourceFile[] {
    return collectAllTsFiles(srcRoot).map((path) => ({
        rel: relative(process.cwd(), path).replace(/\\/g, '/'),
        text: readFileSync(path, 'utf8'),
    }));
}

function extractImportSpecifiers(text: string): string[] {
    const specifiers = new Set<string>();
    const fromRe = /\bfrom\s+['"]([^'"]+)['"]/g;
    const sideEffectRe = /^\s*import\s+['"]([^'"]+)['"]/gm;
    for (const match of text.matchAll(fromRe)) specifiers.add(match[1]);
    for (const match of text.matchAll(sideEffectRe)) specifiers.add(match[1]);
    return Array.from(specifiers);
}

function resolveImport(rel: string, specifier: string): string | null {
    if (!specifier.startsWith('.')) return null;
    const resolved = join(dirname(rel), specifier).replace(/\\/g, '/');
    return resolved.replace(/\/index$/, '').replace(/\.ts$/, '');
}

function collectImportEdges(): ImportEdge[] {
    return readProductionFiles().flatMap((file) => (
        extractImportSpecifiers(file.text).map((specifier) => ({
            rel: file.rel,
            specifier,
            resolved: resolveImport(file.rel, specifier),
        }))
    ));
}

function edgeKey(edge: ImportEdge): string {
    return `${edge.rel} -> ${edge.specifier}`;
}

function sortedUnique(values: string[]): string[] {
    return Array.from(new Set(values)).sort();
}

function isLayerImport(edge: ImportEdge, layer: 'domain' | 'drag' | 'platform' | 'plugin' | 'runtime'): boolean {
    return edge.resolved?.startsWith(`src/${layer}/`) ?? false;
}

const allowedPlatformPluginEdges = new Set([
    // Obsidian composition is still split between plugin/main and the per-EditorView CodeMirror extension.
    'src/platform/codemirror/extension/drag-driver.ts -> ../../../plugin/main',
    'src/platform/codemirror/extension/drag-driver.ts -> ../../../plugin/settings',
    'src/platform/codemirror/extension/drag-driver.ts -> ../../../plugin/block-type-menu',
    'src/platform/codemirror/extension/editor-extension.ts -> ../../../plugin/main',
    'src/platform/obsidian/external-file-drop-controller.ts -> ../../plugin/main',
    // Platform detection module — shared foundation, imported by both layers.
    'src/platform/codemirror/preview/range-selection-visual-manager.ts -> ../../../plugin/platform',
    'src/platform/codemirror/selection/selection-grip-hit.ts -> ../../../plugin/platform',
]);

describe('final architecture boundaries', () => {
    it('keeps domain as a pure markdown engine', () => {
        const offenders = collectImportEdges()
            .filter((edge) => edge.rel.startsWith('src/domain/'))
            .filter((edge) => (
                edge.specifier === 'obsidian'
                || edge.specifier.startsWith('@codemirror/')
                || isLayerImport(edge, 'drag')
                || isLayerImport(edge, 'platform')
                || isLayerImport(edge, 'runtime')
                || isLayerImport(edge, 'plugin')
            ))
            .map(edgeKey);
        expect(sortedUnique(offenders)).toEqual([]);
    });

    it('keeps domain tests on domain contracts instead of host editor fixtures', () => {
        const offenders = readAllSourceFiles()
            .filter((file) => file.rel.startsWith('src/domain/') && file.rel.endsWith('.spec.ts'))
            .filter((file) => /from ['"](?:@codemirror\/|obsidian)/.test(file.text))
            .map((file) => file.rel);
        expect(sortedUnique(offenders)).toEqual([]);
    });

    it('keeps drag headless and platform independent', () => {
        const importOffenders = collectImportEdges()
            .filter((edge) => edge.rel.startsWith('src/drag/'))
            .filter((edge) => (
                edge.specifier === 'obsidian'
                || edge.specifier.startsWith('@codemirror/')
                || isLayerImport(edge, 'platform')
                || isLayerImport(edge, 'runtime')
                || isLayerImport(edge, 'plugin')
            ))
            .map(edgeKey);
        const hostTypeOffenders = readProductionFiles()
            .filter((file) => file.rel.startsWith('src/drag/'))
            .filter((file) => /\b(?:EditorView|HTMLElement|PointerEvent|MouseEvent|KeyboardEvent|FocusEvent|TouchEvent|DOMRect|clientX|clientY)\b|\b(?:document|window)\.|view\.dispatch|\bdispatch\s*\(/.test(file.text))
            .map((file) => file.rel);
        expect(sortedUnique([...importOffenders, ...hostTypeOffenders])).toEqual([]);
    });

    it('does not keep legacy business/runtime/shared buckets', () => {
        const forbiddenPaths = readProductionFiles()
            .map((file) => file.rel)
            .filter((rel) => (
                rel.startsWith('src/runtime/')
                || rel.startsWith('src/shared/types/')
                || rel.startsWith('src/shared/utils/')
                || rel.startsWith('src/drag/cleanup/')
                || rel.startsWith('src/drag/move/')
                || rel.startsWith('src/drag/input/')
                || rel.startsWith('src/drag/preview/')
                || rel.startsWith('src/drag/source/')
            ));
        expect(sortedUnique(forbiddenPaths)).toEqual([]);
    });

    it('keeps shared limited to constants and DOM attribute/selectors', () => {
        const sharedFiles = readProductionFiles()
            .filter((file) => file.rel.startsWith('src/shared/'))
            .map((file) => file.rel)
            .sort();
        expect(sharedFiles).toEqual([
            'src/shared/constants.ts',
            'src/shared/dom-attrs.ts',
            'src/shared/dom-selectors.ts',
        ]);
    });

    it('keeps platform drop preview and resolution contracts out of domain', () => {
        const offenders = readProductionFiles()
            .filter((file) => file.rel.startsWith('src/domain/'))
            .filter((file) => /\b(?:DropPlan|DropPreview|DropResolution|DropValidationResult|indicatorY|highlightRect|lineRect)\b/.test(file.text))
            .map((file) => file.rel);
        expect(sortedUnique(offenders)).toEqual([]);
    });

    it('keeps CodeMirror grouped by adapter responsibility', () => {
        const codemirrorRoot = join(srcRoot, 'platform/codemirror');
        const dirs = readdirSync(codemirrorRoot)
            .filter((entry) => statSync(join(srcRoot, 'platform/codemirror', entry)).isDirectory())
            .sort();
        const rootProductionFiles = readProductionFiles()
            .filter((file) => /^src\/platform\/codemirror\/[^/]+\.ts$/.test(file.rel))
            .map((file) => file.rel);
        expect(dirs).toEqual([
            'extension',
            'input',
            'preview',
            'selection',
            'transaction',
        ]);
        expect(rootProductionFiles).toEqual([]);
    });

    it('prevents new platform-to-plugin coupling outside current Obsidian composition seams', () => {
        const offenders = collectImportEdges()
            .filter((edge) => edge.rel.startsWith('src/platform/'))
            .filter((edge) => isLayerImport(edge, 'plugin'))
            .map(edgeKey)
            .filter((key) => !allowedPlatformPluginEdges.has(key));
        expect(sortedUnique(offenders)).toEqual([]);
    });

    it('removes legacy source model names from production code', () => {
        const offenders = readProductionFiles()
            .filter((file) => /\b(?:DragSource|DragSourceRange|createDragSource|primaryBlock|SourceSegment|SourcePayload|sourcePayload|captureSourcePayload)\b/.test(file.text))
            .map((file) => file.rel);
        expect(sortedUnique(offenders)).toEqual([]);
    });

    it('removes legacy platform mover names from production code', () => {
        const offenders = readProductionFiles()
            .filter((file) => /\b(?:FileBlockMover|FileBlockMoveResult|moveBlockToFile|fileBlockMover)\b|file-block-mover/.test(file.text))
            .map((file) => file.rel);
        expect(sortedUnique(offenders)).toEqual([]);
    });
});
