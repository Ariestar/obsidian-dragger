import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'styles.css'), 'utf8');

describe('drag target and selected-handle styles', () => {
    it('keeps selected handles as grips instead of checkmarks', () => {
        const selectedRules = css.slice(css.indexOf('.md-dragger-handle.is-selected'), css.indexOf('/* 手柄图标样式'));

        expect(selectedRules).not.toContain('rotate(45deg)');
        expect(selectedRules).not.toContain("content: ''");
        expect(selectedRules).toContain('var(--interactive-accent)');
    });

    it('styles valid external note targets with the accent color', () => {
        expect(css).toContain('.obsidian-dragger-external-target');
        expect(css).toMatch(/\.obsidian-dragger-external-target\s*\{[^}]*var\(--interactive-accent\)/);
    });
});
