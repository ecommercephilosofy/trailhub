import { defineConfig } from '@playwright/test';

/**
 * E2E against the local dev server and its PGlite database.
 *
 * Serial, single worker, on purpose: the flows mutate shared state (tasks,
 * visits, classifications) and the local database has exactly one writer — the
 * dev server. Parallel workers would interleave mutations and produce flaky
 * assertions about counts.
 *
 * The suite assumes the imported dataset is present (pnpm import:local -- --fresh).
 * Tests pick their subjects dynamically (first pending task, a company by
 * name) rather than hardcoding ids, so re-runs against a mutated database
 * still pass.
 */
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 15_000 },
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3004',
    trace: 'retain-on-failure',
    locale: 'ca-ES',
    timezoneId: 'Europe/Madrid',
  },
  webServer: {
    command: 'pnpm dev',
    url: 'http://localhost:3004/entrar',
    reuseExistingServer: true,
    timeout: 300_000,
  },
});
