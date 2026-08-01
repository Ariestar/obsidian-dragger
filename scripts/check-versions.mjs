// Version sync check for Obsidian plugin releases.
// Ensures package.json, manifest.json and versions.json agree on the current version.
import fs from 'node:fs';

const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const manifest = JSON.parse(fs.readFileSync('manifest.json', 'utf8'));
const versions = JSON.parse(fs.readFileSync('versions.json', 'utf8'));

const errors = [];
if (pkg.version !== manifest.version) {
    errors.push(`package.json version ${pkg.version} != manifest.json version ${manifest.version}`);
}
if (!(pkg.version in versions)) {
    errors.push(`versions.json missing entry for version ${pkg.version}`);
}
if (Object.keys(versions).length === 0) {
    errors.push('versions.json is empty');
}

if (errors.length > 0) {
    console.error(`Version sync check failed:\n${errors.join('\n')}`);
    process.exit(1);
}

console.log(`Version sync check passed: ${pkg.version} (package.json / manifest.json / versions.json)`);
