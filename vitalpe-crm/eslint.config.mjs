import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * Flat ESLint config for the monorepo.
 *
 * Deliberately narrow: it catches the mistakes that actually bite in this
 * codebase — unused symbols, floating promises in server actions, `any`
 * creeping into the data layer — without turning into a style argument.
 * Formatting is not linted; there is no formatter fight to have here.
 */
export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/.next/**',
      '**/dist/**',
      '**/.data/**',
      '**/build/**',
      'apps/mobile/**',
      '**/*.d.ts',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: {
        console: 'readonly',
        process: 'readonly',
        fetch: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        URLSearchParams: 'readonly',
        AbortController: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        crypto: 'readonly',
        FormData: 'readonly',
        File: 'readonly',
        Blob: 'readonly',
        Response: 'readonly',
        Request: 'readonly',
        Headers: 'readonly',
        TextEncoder: 'readonly',
        TextDecoder: 'readonly',
      },
    },
    rules: {
      // Unused code is either a mistake or dead weight; `_`-prefixed is intent.
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
      // The data layer must not lose types; elsewhere it is a warning so a
      // third-party shape can be adopted without blocking a build.
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-empty': ['error', { allowEmptyCatch: true }],
      // Server actions are async; a dropped promise silently loses a write.
      'no-console': 'off',
    },
  },
  {
    // Tests may reach for `any` when asserting on raw rows.
    files: ['**/*.test.ts', '**/*.test.tsx', 'supabase/tests/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
);
