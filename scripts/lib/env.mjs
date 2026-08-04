import fs from 'node:fs';

/** Load `.env` into `process.env` without overriding existing values. */
export function loadLocalEnv() {
    if (!fs.existsSync('.env')) return;
    const lines = fs.readFileSync('.env', 'utf8').split(/\r?\n/);
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const separatorIndex = trimmed.indexOf('=');
        if (separatorIndex === -1) continue;
        const key = trimmed.slice(0, separatorIndex).trim();
        const value = trimmed.slice(separatorIndex + 1).trim().replace(/^['"]|['"]$/g, '');
        if (!key || process.env[key] !== undefined) continue;
        process.env[key] = value;
    }
}
