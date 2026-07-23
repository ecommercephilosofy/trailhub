import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  test: {
    environment: 'node',
    include: [
      'packages/**/*.test.ts',
      'scripts/**/*.test.ts',
      'supabase/tests/**/*.test.ts',
      'tests/**/*.test.ts',
    ],
    exclude: ['**/node_modules/**', '**/.next/**', 'apps/mobile/**'],
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      '@vitalpe/domain': r('./packages/domain/src/index.ts'),
      '@vitalpe/types': r('./packages/types/src/index.ts'),
      '@vitalpe/validation': r('./packages/validation/src/index.ts'),
      '@vitalpe/config': r('./packages/config/src/index.ts'),
    },
  },
});
