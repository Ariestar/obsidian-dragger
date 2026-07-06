import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const srcRoot = join(process.cwd(), 'src');
const dragRoot = join(srcRoot, 'drag');

function collectTsFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        const stat = statSync(path);
        if (stat.isDirectory()) {
            files.push(...collectTsFiles(path));
            continue;
        }
        if (entry.endsWith('.ts') && !entry.endsWith('.spec.ts') && !entry.endsWith('.test-helpers.ts')) {
            files.push(path);
        }
    }
    return files;
}

function readDragProductionFiles(): Array<{ rel: string; text: string }> {
    return collectTsFiles(dragRoot).map((path) => ({
        rel: relative(process.cwd(), path).replace(/\\/g, '/'),
        text: readFileSync(path, 'utf8'),
    }));
}

describe('headless drag architecture boundaries', () => {
    it('keeps drag as headless interaction use-case folders', () => {
        const topLevelDirs = readdirSync(dragRoot)
            .filter((entry) => statSync(join(dragRoot, entry)).isDirectory())
            .sort();
        expect(topLevelDirs).toEqual([
            'controller',
            'pipeline',
            'selection',
        ]);
    });

    it('does not import host/platform/plugin APIs from drag production code', () => {
        const offenders = readDragProductionFiles()
            .filter((file) => /from ['"](?:@codemirror\/|obsidian|\.\.\/\.\.\/platform\/|\.\.\/platform\/|\.\.\/\.\.\/plugin\/|\.\.\/plugin\/)/.test(file.text))
            .map((file) => file.rel);
        expect(offenders).toEqual([]);
    });

    it('does not keep host DOM/event types in drag production code', () => {
        const forbidden = /\b(?:EditorView|HTMLElement|PointerEvent|MouseEvent|KeyboardEvent|FocusEvent|TouchEvent|DOMRect|clientX|clientY)\b|\b(?:document|window)\.|view\.dispatch|\bdispatch\s*\(|addEventListener|removeEventListener|querySelector|classList|getBoundingClientRect/;
        const offenders = readDragProductionFiles()
            .filter((file) => forbidden.test(file.text))
            .map((file) => file.rel);
        expect(offenders).toEqual([]);
    });

    it('keeps platform resolution and command execution contracts out of drag', () => {
        const forbidden = /\b(?:DropPreview|DropValidationResult|MoveBlockCommand|BlockTransaction|applyMoveCommand|applyBlockTransaction|renderDropPreviewAtPoint|performDropAtPoint)\b/;
        const offenders = readDragProductionFiles()
            .filter((file) => forbidden.test(file.text))
            .map((file) => file.rel);
        expect(offenders).toEqual([]);
    });

    it('does not keep old UI/source/move folders under drag', () => {
        const forbidden = [
            'cleanup',
            'drop',
            'effects',
            'input',
            'intent',
            'lifecycle',
            'mode',
            'preview',
            'source',
            'move',
            'state',
        ];
        const existing = forbidden.filter((dir) => {
            try {
                return statSync(join(dragRoot, dir)).isDirectory();
            } catch {
                return false;
            }
        });
        expect(existing).toEqual([]);
    });
});
