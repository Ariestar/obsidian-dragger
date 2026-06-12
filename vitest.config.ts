import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    resolve: {
        alias: {
            obsidian: resolve(__dirname, 'src/__mocks__/obsidian.ts'),
        },
    },
    test: {
        include: ['src/**/*.spec.ts'],
        globals: false,
        environment: 'node',
        setupFiles: ['src/test-setup.ts'],
    },
});
