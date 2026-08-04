import tseslint from 'typescript-eslint';
import obsidianmd from 'eslint-plugin-obsidianmd';

export default tseslint.config(
    ...obsidianmd.configs.recommended,
    {
        ignores: [
            'node_modules/**',
            'dist/**',
            'build/**',
            '.obsidian/**',
            '.github/**',
            '*.js',
            '*.cjs',
            '*.mjs',
            '*.md',
        ],
    },
    {
        files: ['src/**/*.ts'],
        languageOptions: {
            parser: tseslint.parser,
            parserOptions: {
                project: './tsconfig.json',
                tsconfigRootDir: import.meta.dirname,
                ecmaVersion: 'latest',
                sourceType: 'module',
            },
        },
        plugins: {
            '@typescript-eslint': tseslint.plugin,
        },
        rules: {
            '@typescript-eslint/no-explicit-any': 'error',
            '@typescript-eslint/no-unnecessary-type-assertion': 'error',
            '@typescript-eslint/unbound-method': 'error',
            '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
            'no-console': ['error', { allow: ['warn', 'error', 'debug'] }],
            // The settings tab is built imperatively; migrating it to the
            // declarative getSettingDefinitions API is a separate work item.
            'obsidianmd/settings-tab/prefer-setting-definitions': 'off',
        },
    },
    {
        // test-setup polyfills Obsidian's element factories themselves, so the
        // prefer-create-el rewrite cannot apply there.
        files: ['src/test-setup.ts'],
        rules: {
            'obsidianmd/prefer-create-el': 'off',
        },
    },
    {
        files: ['src/core/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: ['**/features/**', '**/platform/**'],
                },
            ],
        },
    },
    {
        files: ['src/platform/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: ['**/features/**', '**/core/**'],
                },
            ],
        },
    },
    {
        files: ['src/plugin/**/*.ts'],
        rules: {
            'no-restricted-imports': [
                'error',
                {
                    patterns: ['**/core/**'],
                },
            ],
            '@typescript-eslint/no-deprecated': 'off',
        },
    },
);
