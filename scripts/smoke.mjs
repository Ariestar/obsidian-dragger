// Smoke check for the built Obsidian plugin bundle.
// Verifies the artifacts the plugin loader needs are present after `npm run build`.
// Respects OBSIDIAN_PLUGIN_DIR (including the local .env file), matching esbuild.config.mjs.
import fs from 'node:fs';
import { loadLocalEnv } from './lib/env.mjs';

loadLocalEnv();

const pluginDir = process.env.OBSIDIAN_PLUGIN_DIR || 'dist';
const required = ['main.js', 'manifest.json', 'styles.css'].map((file) => `${pluginDir}/${file}`);
const missing = required.filter((file) => !fs.existsSync(file));

if (missing.length > 0) {
    console.error(`Smoke check failed: missing ${missing.join(', ')} (pluginDir: ${pluginDir})`);
    process.exit(1);
}

console.log(`Smoke check passed: plugin bundle present in ${pluginDir}`);
