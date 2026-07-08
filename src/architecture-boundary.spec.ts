import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Boundary guard for the plugin after it was slimmed down to a pure
// md-dragger consumer. The domain/pipeline/runtime engine now lives in the
// external package (guarded by md-dragger's own architecture spec); here we
// only guard the seams that are the plugin's responsibility:
//   1. platform/plugin reach the engine ONLY through md-dragger's public
//      entry points, never a deep dist/internal path.
//   2. platform/codemirror stays grouped by adapter responsibility.

const srcRoot = join(process.cwd(), 'src');

type SourceFile = { rel: string; text: string };

function collectTsFiles(dir: string, includeSpecs = false): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) {
            files.push(...collectTsFiles(path, includeSpecs));
            continue;
        }
        if (!entry.endsWith('.ts')) continue;
        if (!includeSpecs && entry.endsWith('.spec.ts')) continue;
        files.push(path);
    }
    return files;
}

function readProductionFiles(): SourceFile[] {
    return collectTsFiles(srcRoot).map((path) => ({
        rel: relative(process.cwd(), path).replace(/\\/g, '/'),
        text: readFileSync(path, 'utf8'),
    }));
}

function extractSpecifiers(text: string): string[] {
    const specifiers = new Set<string>();
    for (const match of text.matchAll(/\bfrom\s+['"]([^'"]+)['"]/g)) specifiers.add(match[1]);
    for (const match of text.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm)) specifiers.add(match[1]);
    return Array.from(specifiers);
}

const ALLOWED_MD_DRAGGER_ENTRIES = new Set([
    'md-dragger',
    'md-dragger/domain',
    'md-dragger/domain/perf',
    'md-dragger/runtime',
    'md-dragger/adapter/codemirror',
]);

describe('plugin architecture boundaries', () => {
    it('imports md-dragger only through its public entry points', () => {
        const offenders = readProductionFiles().flatMap((file) =>
            extractSpecifiers(file.text)
                .filter((spec) => spec === 'md-dragger' || spec.startsWith('md-dragger/'))
                .filter((spec) => !ALLOWED_MD_DRAGGER_ENTRIES.has(spec))
                .map((spec) => `${file.rel} -> ${spec}`)
        );
        expect(offenders.sort()).toEqual([]);
    });

    it('never reaches into the package dist or src internals', () => {
        const offenders = readProductionFiles()
            .filter((file) => /from ['"]md-dragger\/(?:dist|src)\//.test(file.text))
            .map((file) => file.rel);
        expect(offenders.sort()).toEqual([]);
    });

    it('keeps CodeMirror grouped by adapter responsibility', () => {
        const codemirrorRoot = join(srcRoot, 'platform', 'codemirror');
        const dirs = readdirSync(codemirrorRoot)
            .filter((entry) => statSync(join(codemirrorRoot, entry)).isDirectory())
            .sort();
        expect(dirs).toEqual([
            'dom',
            'handle',
            'hover',
            'perf',
            'runtime',
            'selection',
            'transaction',
        ]);
        const looseRootFiles = readProductionFiles()
            .filter((file) => /^src\/platform\/codemirror\/[^/]+\.ts$/.test(file.rel))
            .map((file) => file.rel);
        expect(looseRootFiles).toEqual([]);
    });
});
