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
