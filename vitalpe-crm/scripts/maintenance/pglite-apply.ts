/**
 * `pnpm db:local` — applies every migration plus the seed to a throwaway
 * in-memory Postgres and prints what was created. Fast smoke test that the SQL
 * is valid before it ever reaches a real Supabase project.
 */
import { createDatabase, listMigrations } from './pglite.js';

const db = await createDatabase({ seed: true });

const migrations = await listMigrations();
console.log(`Applied ${migrations.length} migrations:`);
for (const m of migrations) console.log(`  · ${m}`);

const tables = await db.query<{ table_name: string }>(
  `select table_name from information_schema.tables
   where table_schema = 'public' and table_type = 'BASE TABLE' order by table_name`,
);
const views = await db.query<{ table_name: string }>(
  `select table_name from information_schema.views
   where table_schema = 'public' order by table_name`,
);
const rls = await db.query<{ relname: string }>(
  `select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and c.relkind = 'r' and c.relrowsecurity order by 1`,
);
const policies = await db.query<{ count: string }>(
  `select count(*)::text as count from pg_policies where schemaname = 'public'`,
);
const fns = await db.query<{ count: string }>(
  `select count(*)::text as count from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'app'`,
);
const products = await db.query<{ count: string }>(
  `select count(*)::text as count from public.products`,
);
const campaigns = await db.query<{ count: string }>(
  `select count(*)::text as count from public.campaigns`,
);
const noRls = tables.rows
  .map((t) => t.table_name)
  .filter((t) => !rls.rows.some((r) => r.relname === t));

console.log(`\nTables: ${tables.rows.length}`);
console.log(`Views: ${views.rows.length}  (${views.rows.map((v) => v.table_name).join(', ')})`);
console.log(`Tables with RLS enabled: ${rls.rows.length}`);
console.log(`RLS policies: ${policies.rows[0]?.count}`);
console.log(`app.* functions: ${fns.rows[0]?.count}`);
console.log(`Seeded products: ${products.rows[0]?.count}, campaigns: ${campaigns.rows[0]?.count}`);

if (noRls.length > 0) {
  console.error(`\n✗ Tables WITHOUT row level security: ${noRls.join(', ')}`);
  process.exit(1);
}
console.log('\n✓ Every public table has row level security enabled.');
await db.close();
