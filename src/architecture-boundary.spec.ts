import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// Boundary guard: plugin is a pure md-dragger consumer.
//   1. Only public md-dragger entry points.
//   2. No package dist/src deep imports.

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
    'md-dragger/runtime',
    'md-dragger/runtime/modules',
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

    it('hosts mdDragger from a single codemirror entry module', () => {
        const files = readProductionFiles()
            .filter((file) => file.rel.startsWith('src/platform/codemirror/'))
            .map((file) => file.rel)
            .sort();
        expect(files).toEqual([
            'src/platform/codemirror/obsidian-dragger.ts',
        ]);
    });
});
