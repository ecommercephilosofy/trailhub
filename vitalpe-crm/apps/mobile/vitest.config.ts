import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// `.href` keeps this working under both lib.dom and @types/node: the two
// declare incompatible URL types, and fileURLToPath also accepts the string.
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url).href);

/**
 * The root vitest config deliberately EXCLUDES apps/mobile, so this package
 * carries its own.
 *
 * Only `src/core/**` is tested here, and by design nothing under `src/core`
 * imports React, React Native or any `expo-*` module: it is plain TypeScript.
 * That is what lets the whole of the app's decision-making — which regions to
 * monitor, whether an arrival deserves a notification, what a notification is
 * allowed to carry, how the offline queue retries — run in Node with no
 * simulator, no device and no native build.
 */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/core/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/.expo/**', 'ios/**', 'android/**'],
    testTimeout: 20_000,
  },
  resolve: {
    alias: {
      '@vitalpe/domain': r('../../packages/domain/src/index.ts'),
      '@vitalpe/types': r('../../packages/types/src/index.ts'),
      '@vitalpe/validation': r('../../packages/validation/src/index.ts'),
      '@': r('./src'),
    },
  },
  // `tsconfig.json` extends `expo/tsconfig.base`, which only exists once the
  // native dependencies are installed. Feeding esbuild an explicit tsconfig
  // keeps `pnpm --filter @vitalpe/mobile test` runnable in a bare checkout —
  // the whole point of keeping src/core free of native imports.
  esbuild: {
    tsconfigRaw: {
      compilerOptions: {
        target: 'es2022',
        useDefineForClassFields: true,
        verbatimModuleSyntax: false,
      },
    },
  },
});
