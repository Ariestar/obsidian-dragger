// Smoke check for the built Obsidian plugin bundle.
// Verifies the artifacts the plugin loader needs are present after `npm run build`.
// Respects OBSIDIAN_PLUGIN_DIR (including the local .env file), matching esbuild.config.mjs.
import fs from 'node:fs';

function loadLocalEnv() {
    if (!fs.existsSync('.env')) return;
    const lines = fs.readFileSync('.env', 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) continue;
        const key = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed
            .slice(separatorIndex + 1)
            .trim()
            .replace(/^['"]|['"]$/g, '');
        if (!key || process.env[key] !== undefined) continue;
        process.env[key] = value;
    }
}

loadLocalEnv();

const pluginDir = process.env.OBSIDIAN_PLUGIN_DIR || 'dist';
const required = ['main.js', 'manifest.json', 'styles.css'].map((file) => `${pluginDir}/${file}`);
const missing = required.filter((file) => !fs.existsSync(file));

if (missing.length > 0) {
    console.error(`Smoke check failed: missing ${missing.join(', ')} (pluginDir: ${pluginDir})`);
    process.exit(1);
}

console.log(`Smoke check passed: plugin bundle present in ${pluginDir}`);
