/**
 * `pnpm import:abandon -- <import-id> "motiu" [--apply]`
 *
 * Closes an import run that was interrupted before it finished.
 *
 * An import that dies mid-flight leaves its `imports` row in a working state
 * (BORRADOR/INSPECCIONAT/MAPEJAT/NORMALITZAT) and its staged `import_rows`
 * sitting at PENDENT. Nothing is wrong with the commercial data — the importer
 * matches deterministically and re-running the same sources rewrites the same
 * values — but the run stays open forever: the reconciliation screen shows a
 * phantom import and the production audit rightly reports staged rows that
 * nobody will ever apply.
 *
 * This does not delete the run. It marks it DESFET with a reason and marks the
 * unapplied rows IGNORADA, so what happened is still on the record. Rows that
 * were already IMPORTADA keep that outcome: they describe work that really was
 * done, and rewriting them would be a lie about provenance.
 *
 * Refuses to touch an APLICAT import. Undoing an applied import is a different
 * operation with different consequences, and it is not this script's job.
 */
import { loadEnv } from '../load-env';

loadEnv();

const argv = process.argv.slice(2).filter((a) => a !== '--');
const importId = argv.find((a) => /^[0-9a-f-]{36}$/i.test(a));
const reason = argv.find((a) => !a.startsWith('--') && a !== importId);
const apply = argv.includes('--apply');

if (!importId || !reason) {
  console.error('\nÚs: pnpm import:abandon -- <import-id> "motiu" [--apply]\n');
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error('\n✗ Falta DATABASE_URL a .env.local\n');
  process.exit(1);
}

const { default: postgres } = await import('postgres');
const sql = postgres(databaseUrl, { max: 1, prepare: false });

try {
  const [run] = await sql<{ status: string; started_at: Date; finished_at: Date | null }[]>`
    select status::text as status, started_at, finished_at
      from public.imports where id = ${importId}`;

  if (!run) {
    console.error(`\n✗ No hi ha cap importació amb l’identificador ${importId}.\n`);
    process.exit(1);
  }
  if (run.status === 'APLICAT') {
    console.error(
      `\n✗ Aquesta importació està APLICAT. Desfer-la és una altra operació,` +
        `\n  amb altres conseqüències, i no la fa aquest script.\n`,
    );
    process.exit(1);
  }

  const outcomes = await sql<{ outcome: string; n: string }[]>`
    select outcome, count(*)::text as n
      from public.import_rows where import_id = ${importId}
     group by outcome order by count(*) desc`;

  console.log(`\n── Importació ${importId} ──`);
  console.log(`  Estat        : ${run.status}`);
  console.log(`  Començada    : ${run.started_at.toISOString()}`);
  console.log(`  Acabada      : ${run.finished_at?.toISOString() ?? 'mai'}`);
  for (const row of outcomes) console.log(`  ${row.outcome.padEnd(12)} : ${row.n}`);

  const pending = Number(outcomes.find((o) => o.outcome === 'PENDENT')?.n ?? '0');

  if (!apply) {
    console.log('\n  Simulació. Cap canvi escrit.');
    console.log(`  Per aplicar-ho: pnpm import:abandon -- ${importId} "${reason}" --apply\n`);
    await sql.end();
    process.exit(0);
  }

  await sql.begin(async (tx) => {
    await tx`
      update public.import_rows
         set outcome = 'IGNORADA', outcome_reason = ${reason}
       where import_id = ${importId} and outcome = 'PENDENT'`;
    await tx`
      update public.imports
         set status = 'DESFET', finished_at = coalesce(finished_at, now()),
             -- Cast explicit: concat_ws() accepts anything, so the driver has
             -- nothing to infer the parameter type from.
             notes = concat_ws(' · ', nullif(notes, ''), ${`ABANDONADA: ${reason}`}::text)
       where id = ${importId}`;
  });

  console.log(`\n✓ Importació marcada DESFET. ${pending} files pendents marcades IGNORADA.`);
  console.log('  El motiu queda escrit a la importació; res no s’ha esborrat.\n');
} catch (error) {
  console.error(`\n✗ ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
} finally {
  await sql.end();
}
