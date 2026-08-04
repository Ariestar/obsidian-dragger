import { resolve } from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const require = createRequire(import.meta.url);

export default defineConfig({
    resolve: {
        alias: {
            obsidian: resolve(__dirname, 'src/__mocks__/obsidian.ts'),
            // The dev-time link to the sibling md-dragger checkout resolves its
            // CodeMirror peers from md-dragger's own node_modules. Alias them
            // back to this project's instances so instanceof checks stay valid.
            '@codemirror/state': require.resolve('@codemirror/state'),
            '@codemirror/view': require.resolve('@codemirror/view'),
        },
    },
    test: {
        include: ['src/**/*.spec.ts'],
        globals: false,
        environment: 'node',
        setupFiles: ['src/test-setup.ts'],
    },
});
