/**
 * Removes anything the critical-features harness might have left behind.
 *
 * `test-critical-features.ts` runs against a throwaway in-memory PGlite, so in
 * normal use there is nothing to clean — the database evaporates with the
 * process. This script exists for the case where the harness is deliberately
 * pointed at a persisted database (local `.data/crm` or, with `--remote`, the
 * hosted one): it deletes every row tagged `BODEGA TEST E2E-CRITICAL-AUDIT…`
 * and its dependents, and reports what it found.
 *
 * Dry run by default. Writes only with `--apply`. Refuses the hosted database
 * unless `--remote` is passed, so it can never sweep production by accident.
 * The append-only audit_log is never touched — its whole point is that nothing
 * deletes from it.
 *
 *   pnpm test:critical:cleanup            # dry-run against local .data/crm
 *   pnpm test:critical:cleanup -- --apply
 *   pnpm test:critical:cleanup -- --remote --apply
 */
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from './load-env';

loadEnv();

const argv = process.argv.slice(2).filter((a) => a !== '--');
const apply = argv.includes('--apply');
const remote = argv.includes('--remote');
const TAG = 'BODEGA TEST E2E-CRITICAL-AUDIT%';
const ROOT = fileURLToPath(new URL('../', import.meta.url));

interface Runner {
  query<T>(sql: string, params?: unknown[]): Promise<{ rows: T[] }>;
  close(): Promise<void>;
  label: string;
}

async function openTarget(): Promise<Runner> {
  const url = process.env.DATABASE_URL;
  const isRemote = Boolean(url) && !/localhost|127\.0\.0\.1|\[::1\]/i.test(url ?? '');

  if (isRemote && !remote) {
    console.error(
      '\n✗ DATABASE_URL apunta a una base remota. Per netejar-hi cal --remote explícit.\n',
    );
    process.exit(1);
  }
  if (remote && url) {
    const { default: postgres } = await import('postgres');
    const sql = postgres(url, { max: 1, prepare: false });
    return {
      query: async <T>(q: string, p: unknown[] = []) => ({ rows: (await sql.unsafe(q, p as never[])) as T[] }),
      close: async () => { await sql.end(); },
      label: 'REMOTA',
    };
  }
  const dataDir = path.join(ROOT, '.data', 'crm');
  if (!existsSync(dataDir)) {
    console.error(`\n✗ No hi ha base local a ${dataDir}. Executa pnpm import:local -- --fresh primer.\n`);
    process.exit(1);
  }
  const { createDatabase } = await import('./maintenance/pglite');
  const db = await createDatabase({ dataDir });
  return {
    query: <T>(q: string, p: unknown[] = []) => db.query<T>(q, p) as Promise<{ rows: T[] }>,
    close: async () => { await db.close?.(); },
    label: 'local (.data/crm)',
  };
}

async function main(): Promise<void> {
  const target = await openTarget();
  try {
    const { rows: found } = await target.query<{ id: string; name: string }>(
      `select id, name from public.clients where name like $1`,
      [TAG],
    );
    console.log(`\n── Neteja de proves crítiques · base ${target.label} ──`);
    console.log(`  Clients TEST trobats: ${found.length}`);
    for (const c of found) console.log(`    · ${c.name}`);

    if (found.length === 0) {
      console.log('\n✓ Res per netejar.\n');
      return;
    }
    if (!apply) {
      console.log('\n  Simulació. Cap canvi escrit. Afegeix --apply per esborrar.\n');
      return;
    }

    const ids = found.map((c) => c.id);
    // Hard-delete only the test scaffolding, in dependency order. audit_log is
    // append-only and intentionally left intact.
    for (const table of [
      'voice_interpretation_proposals',
      'voice_notes',
      'tasks',
      'visits',
      'activities',
      'opportunities',
      'client_locations',
      'client_aliases',
      'contacts',
      'clients',
    ]) {
      const col = table === 'clients' ? 'id' : 'client_id';
      const scope =
        table === 'voice_interpretation_proposals'
          ? `where voice_note_id in (select id from public.voice_notes where client_id = any($1))`
          : `where ${col} = any($1)`;
      const { rows } = await target.query<{ n: string }>(
        `with d as (delete from public.${table} ${scope} returning 1) select count(*)::text as n from d`,
        [ids],
      );
      if (Number(rows[0]?.n ?? '0') > 0) console.log(`    ${table}: ${rows[0]!.n} esborrats`);
    }
    console.log('\n✓ Neteja completada.\n');
  } finally {
    await target.close();
  }
}

main().catch((error) => {
  console.error('\n✗', error);
  process.exitCode = 1;
});
