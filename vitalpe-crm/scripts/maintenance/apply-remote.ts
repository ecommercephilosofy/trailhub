/**
 * `pnpm db:push` — applies every migration, then the seed, to the database in
 * DATABASE_URL, and verifies the result.
 *
 * Used instead of `supabase db push` so the operator does not need the Supabase
 * CLI logged in: the connection string in `.env.local` is enough. Each
 * migration runs in its own transaction and is recorded in
 * `public.schema_migrations`, so re-running only applies what is missing.
 */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../load-env';

loadEnv();

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const SEED = path.join(ROOT, 'supabase', 'seed.sql');

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('\n✗ DATABASE_URL no està definida. Revisa .env.local.\n');
  process.exit(1);
}

/** Never let the connection string reach a log line. */
const scrub = (text: string) => text.split(url).join('[DATABASE_URL]');

const { default: postgres } = await import('postgres');
const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 30, idle_timeout: 20 });

try {
  console.log(`\nDestí: ${new URL(url).host}\n`);

  await sql`
    create table if not exists public.schema_migrations (
      version    text primary key,
      applied_at timestamptz not null default now()
    )
  `;
  // Infrastructure, not data: RLS on and no policy, so it stays consistent with
  // the "every public table has RLS" rule the local harness asserts.
  await sql`alter table public.schema_migrations enable row level security`;

  const applied = new Set(
    (await sql<{ version: string }[]>`select version from public.schema_migrations`).map(
      (r) => r.version,
    ),
  );

  const files = (await readdir(MIGRATIONS)).filter((f) => f.endsWith('.sql')).sort();
  console.log('── Migracions ──');

  for (const file of files) {
    if (applied.has(file)) {
      console.log(`  · ${file} (ja aplicada)`);
      continue;
    }
    const text = await readFile(path.join(MIGRATIONS, file), 'utf8');
    try {
      // One transaction per migration: a failure leaves nothing half-applied.
      await sql.begin(async (tx) => {
        await tx.unsafe(text);
        await tx`insert into public.schema_migrations (version) values (${file})`;
      });
      console.log(`  ✓ ${file}`);
    } catch (error) {
      console.error(`\n✗ Ha fallat ${file}:\n  ${scrub((error as Error).message)}\n`);
      process.exit(1);
    }
  }

  console.log('\n── Catàleg de productes (seed) ──');
  try {
    await sql.unsafe(await readFile(SEED, 'utf8'));
    console.log('  ✓ aplicat');
  } catch (error) {
    console.error(`  ✗ ${scrub((error as Error).message)}`);
    process.exit(1);
  }

  console.log('\n── Verificació ──');
  const [counts] = await sql<
    { taules: number; sense_rls: number; politiques: number; funcions: number; productes: number }[]
  >`
    select
      (select count(*) from information_schema.tables
        where table_schema = 'public' and table_type = 'BASE TABLE')::int as taules,
      (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)::int as sense_rls,
      (select count(*) from pg_policies where schemaname = 'public')::int as politiques,
      (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'app')::int as funcions,
      (select count(*) from public.products)::int as productes
  `;

  console.log(`  Taules: ${counts?.taules ?? 0}`);
  console.log(`  Polítiques RLS: ${counts?.politiques ?? 0}`);
  console.log(`  Funcions de domini: ${counts?.funcions ?? 0}`);
  console.log(`  Productes al catàleg: ${counts?.productes ?? 0}`);

  if ((counts?.sense_rls ?? 1) > 0) {
    const rows = await sql<{ relname: string }[]>`
      select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
       where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
    `;
    console.error(`\n✗ Taules SENSE seguretat de fila: ${rows.map((r) => r.relname).join(', ')}\n`);
    process.exit(1);
  }

  console.log('\n✓ Totes les taules tenen seguretat de fila activada.');
  console.log('  Següent pas: pnpm import:run\n');
} finally {
  await sql.end({ timeout: 10 });
}
