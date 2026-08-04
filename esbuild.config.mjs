import esbuild from 'esbuild';
import process from 'process';
import { builtinModules } from 'node:module';
import fs from 'fs';
import { loadLocalEnv } from './scripts/lib/env.mjs';

const prod = process.argv[2] === 'production';

loadLocalEnv();

const pluginDir = process.env.OBSIDIAN_PLUGIN_DIR || 'dist';

fs.mkdirSync(pluginDir, { recursive: true });

// 复制 styles.css 到插件目录
function copyStyles() {
    fs.copyFileSync('styles.css', `${pluginDir}/styles.css`);
    console.log('✓ styles.css copied to plugin directory');
}

function copyManifest() {
    fs.copyFileSync('manifest.json', `${pluginDir}/manifest.json`);
    console.log('✓ manifest.json copied to plugin directory');
}

const context = await esbuild.context({
    entryPoints: ['src/plugin/main.ts'],
    bundle: true,
    external: [
        'obsidian',
        'electron',
        '@codemirror/autocomplete',
        '@codemirror/collab',
        '@codemirror/commands',
        '@codemirror/language',
        '@codemirror/lint',
        '@codemirror/search',
        '@codemirror/state',
        '@codemirror/view',
        '@lezer/common',
        '@lezer/highlight',
        '@lezer/lr',
        ...builtinModules,
    ],
    format: 'cjs',
    target: 'es2018',
    logLevel: 'info',
    sourcemap: prod ? false : 'inline',
    treeShaking: true,
    outfile: `${pluginDir}/main.js`,
});

if (prod) {
    await context.rebuild();
    copyStyles();
    copyManifest();
    process.exit(0);
} else {
    copyStyles();
    copyManifest();
    await context.watch();
}
