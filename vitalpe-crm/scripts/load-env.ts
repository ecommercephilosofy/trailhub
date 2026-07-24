/**
 * Loads `.env.local` (then `.env`) from the repo root into `process.env`.
 *
 * This exists so that credentials never have to travel through a chat, a shell
 * history or a command line. The operator writes them into a git-ignored file
 * once; every script reads them from there.
 *
 * Values already present in the environment win, so
 * `DATABASE_URL=… pnpm import:run` still overrides the file for a one-off run.
 *
 * Node ≥20.12 ships `process.loadEnvFile`, so there is no dependency here.
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));

/** In precedence order: the first file that defines a key wins. */
const CANDIDATES = ['.env.local', '.env'];

export function loadEnv(): { loaded: string[]; missing: string[] } {
  const loaded: string[] = [];
  const missing: string[] = [];

  for (const name of CANDIDATES) {
    const file = path.join(ROOT, name);
    if (!existsSync(file)) {
      missing.push(name);
      continue;
    }
    const before = new Set(Object.keys(process.env));
    try {
      process.loadEnvFile(file);
    } catch (error) {
      throw new Error(`No s'ha pogut llegir ${name}: ${(error as Error).message}`, { cause: error });
    }
    // `loadEnvFile` overwrites, so restore anything that was already set
    // explicitly on the command line — an inline value must beat the file.
    for (const key of before) {
      const original = ORIGINAL.get(key);
      if (original !== undefined) process.env[key] = original;
    }
    loaded.push(name);
  }

  return { loaded, missing };
}

/** Snapshot taken at import time, before any file can overwrite it. */
const ORIGINAL = new Map(Object.entries(process.env) as [string, string][]);

/**
 * Reports which credentials are visible, WITHOUT printing any value.
 * Used by the scripts to tell the operator what is configured.
 */
export function describeEnv(): string[] {
  const interesting = [
    'DATABASE_URL',
    'NEXT_PUBLIC_SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'APP_ENCRYPTION_KEY',
    'GOOGLE_CLIENT_ID',
    'ANTHROPIC_API_KEY',
    'OPENAI_API_KEY',
  ];
  return interesting.map((key) => {
    const value = process.env[key];
    if (!value) return `  ✗ ${key} — no definida`;
    return `  ✓ ${key} — definida (${value.length} caràcters)`;
  });
}
