/**
 * Local Postgres harness.
 *
 * Supabase's local stack needs Docker. Where Docker is unavailable (and in CI,
 * where it is slow) we run the real migrations against PGlite — Postgres 17
 * compiled to WASM — with a small shim that stands in for the parts of Supabase
 * the schema depends on: the `auth` schema, `auth.users`, `auth.uid()` and the
 * `anon` / `authenticated` / `service_role` roles.
 *
 * This is what makes `pnpm test` able to prove RLS behaviour without a network
 * or a container. See DECISIONS.md → "Local database".
 */
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
export const SEED_FILE = path.join(ROOT, 'supabase', 'seed.sql');

/**
 * Recreates just enough of the Supabase platform for our migrations to apply.
 * Deliberately minimal: if a migration needs something not listed here, that is
 * a signal the schema is coupling to the platform in a new way.
 */
const SUPABASE_SHIM = /* sql */ `
  create schema if not exists auth;
  create schema if not exists extensions;
  create schema if not exists storage;

  do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role nologin bypassrls; exception when duplicate_object then null; end $$;

  create table if not exists auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );

  -- In Supabase auth.uid() reads the verified JWT. Here it reads a GUC that the
  -- test harness sets, which gives the same semantics for RLS evaluation.
  create or replace function auth.uid() returns uuid
    language sql stable as $fn$
      select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
    $fn$;

  create or replace function auth.role() returns text
    language sql stable as $fn$
      select coalesce(nullif(current_setting('request.jwt.claim.role', true), ''), 'anon')
    $fn$;

  grant usage on schema public to anon, authenticated, service_role;
  -- Supabase grants the API roles usage on auth so auth.uid() is callable from
  -- SECURITY INVOKER functions. Without it, every domain function fails as a
  -- normal user and the RLS suite would test nothing.
  grant usage on schema auth to anon, authenticated, service_role;
  grant select on auth.users to service_role;
  alter default privileges in schema public
    grant all on tables to anon, authenticated, service_role;
  alter default privileges in schema public
    grant all on sequences to anon, authenticated, service_role;
  alter default privileges in schema public
    grant all on functions to anon, authenticated, service_role;
`;

export async function listMigrations(): Promise<string[]> {
  const files = await readdir(MIGRATIONS_DIR);
  return files.filter((f) => f.endsWith('.sql')).sort();
}

export interface CreateDbOptions {
  /** Apply supabase/seed.sql (master catalogue) after the migrations. */
  seed?: boolean;
  /** Where to persist. Omit for an in-memory database. */
  dataDir?: string;
}

export async function createDatabase(options: CreateDbOptions = {}): Promise<PGlite> {
  const db = options.dataDir
    ? new PGlite(options.dataDir, { extensions: { pg_trgm } })
    : new PGlite({ extensions: { pg_trgm } });
  await db.exec(SUPABASE_SHIM);

  for (const file of await listMigrations()) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), 'utf8');
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`Migration failed: ${file}\n${(error as Error).message}`);
    }
  }

  // Table privileges come from the default privileges set before the
  // migrations ran, exactly as on Supabase. They are deliberately NOT
  // re-granted here: a blanket GRANT after the fact would undo the
  // column-level REVOKEs that keep OAuth tokens unreadable by the API roles.
  await db.exec(`
    grant usage, select on all sequences in schema public to anon, authenticated;
    grant usage on schema app to anon, authenticated;
  `);

  if (options.seed) {
    const seed = await readFile(SEED_FILE, 'utf8');
    await db.exec(seed);
  }
  return db;
}

/**
 * Runs `fn` as a specific end user with a specific Postgres role, exactly as
 * PostgREST would: RLS on, auth.uid() populated. Used by the RLS test suite.
 *
 * The transaction is not optional: `SET LOCAL` and `set_config(..., true)` are
 * transaction-scoped, so running them outside one silently does nothing — and a
 * test suite that "passes" because the role never changed proves nothing.
 */
export async function asUser<T>(
  db: PGlite,
  userId: string | null,
  fn: () => Promise<T>,
  role: 'authenticated' | 'anon' = 'authenticated',
): Promise<T> {
  await db.exec('begin;');
  try {
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId ?? '']);
    await db.query(`select set_config('request.jwt.claim.role', $1, true)`, [role]);
    await db.exec(`set local role ${role};`);
    const result = await fn();
    await db.exec('commit;');
    return result;
  } catch (error) {
    await db.exec('rollback;').catch(() => undefined);
    throw error;
  }
}

/** service_role: bypasses RLS. Server-side only, never shipped to a client. */
export async function asService<T>(db: PGlite, fn: () => Promise<T>): Promise<T> {
  await db.exec('begin;');
  try {
    await db.exec('reset role;');
    await db.query(`select set_config('request.jwt.claim.sub', '', true)`);
    const result = await fn();
    await db.exec('commit;');
    return result;
  } catch (error) {
    await db.exec('rollback;').catch(() => undefined);
    throw error;
  }
}
