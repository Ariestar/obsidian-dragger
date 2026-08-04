// Dev-only helper: point node_modules/md-dragger at the sibling checkout so
// local edits to md-dragger are picked up without publishing. Runs on
// postinstall; no-op in CI where the sibling directory is absent.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sibling = path.resolve(repoRoot, '..', 'md-dragger');
const link = path.join(repoRoot, 'node_modules', 'md-dragger');

if (!fs.existsSync(sibling)) {
    console.log('[link-md] sibling md-dragger not found, keeping registry dependency');
    process.exit(0);
}

fs.rmSync(link, { recursive: true, force: true });
fs.symlinkSync(sibling, link, 'junction');
console.log(`[link-md] node_modules/md-dragger -> ${sibling}`);
