/**
 * `pnpm import:run` — end-to-end import of the real commercial sources.
 *
 *   DATABASE_URL unset  -> local PGlite, persisted under .data/crm
 *   DATABASE_URL set    -> the target Postgres/Supabase instance
 *
 * Flags:
 *   --fresh        recreate the local database from scratch first
 *   --owner=<mail> assign the imported companies to this profile
 *   --dry-run      run everything inside a transaction and roll it back
 */
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadEnv } from '../load-env.js';
import { openDatabase, one, scalar, type SqlRunner } from './db.js';

// Before anything reads process.env: credentials live in .env.local, never on
// the command line and never in a chat.
loadEnv();
import { SOURCES } from './sources.js';
import { emptyStats, flushProvenance, type ImportContext } from './pipeline.js';
import {
  importCavaRegister,
  importClientSheet,
  importExportContacts,
  importLedgerJson,
  importPriorityOrder,
  importPublicDirectory,
  importSalesSheet,
  stageWorkbook,
} from './passes.js';
import {
  ensureDocsDir,
  writeColumnMapping,
  writeImportReport,
  writeNormalizationDecisions,
  writeSourceInventory,
} from './report.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const DATA_DIR = path.join(ROOT, '.data', 'crm');

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const option = (name: string) =>
  args.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=') ?? null;

const OWNER_EMAIL = option('owner') ?? 'carlos.escobar@vitalpe.local';
const DRY_RUN = flag('dry-run');

/**
 * Local-only convenience: creates the three role users so the imported data has
 * a real owner and the RLS suite has subjects. On a hosted Supabase these come
 * from the invitation flow instead (see scripts/maintenance/seed-users.ts).
 */
async function ensureLocalUsers(db: SqlRunner, workspaceId: string): Promise<void> {
  if (db.kind !== 'pglite') return;
  const people: { email: string; first: string; last: string; role: string }[] = [
    { email: 'admin@vitalpe.local', first: 'Admin', last: 'Vitalpe', role: 'ADMIN' },
    { email: 'gerencia@vitalpe.local', first: 'Gerència', last: 'Vitalpe', role: 'GERENT' },
    { email: OWNER_EMAIL, first: 'Carlos', last: 'Escobar', role: 'COMERCIAL' },
  ];
  for (const p of people) {
    const user = await one<{ id: string }>(
      db,
      `insert into auth.users (email, raw_user_meta_data)
       values ($1, jsonb_build_object('first_name', $2::text, 'last_name', $3::text))
       on conflict (email) do update set email = excluded.email
       returning id`,
      [p.email, p.first, p.last],
    );
    if (!user) continue;
    await db.query(
      `insert into public.workspace_memberships (workspace_id, user_id, role, status, activated_at)
       values ($1, $2, $3::app.user_role, 'ACTIU', now())
       on conflict (workspace_id, user_id) do update set role = excluded.role`,
      [workspaceId, user.id, p.role],
    );
  }
}

async function main(): Promise<void> {
  if (!process.env.DATABASE_URL) {
    if (flag('fresh')) await rm(DATA_DIR, { recursive: true, force: true });
    await mkdir(DATA_DIR, { recursive: true });
  }

  const db = await openDatabase(
    process.env.DATABASE_URL ? {} : { dataDir: DATA_DIR },
  );
  console.log(`Base de dades: ${db.kind}${DRY_RUN ? ' (dry-run)' : ''}`);

  const workspaceId = await scalar<string>(db, `select id from public.workspaces where slug = 'vitalpe'`);
  if (!workspaceId) throw new Error('No existeix l\'espai de treball VITALPE. Executa el seed primer.');

  await ensureLocalUsers(db, workspaceId);
  const ownerId = await scalar<string>(db, `select id from public.profiles where email = $1`, [OWNER_EMAIL]);
  if (!ownerId) {
    console.warn(`⚠  No hi ha cap perfil amb el correu ${OWNER_EMAIL}. Les empreses s'importaran sense responsable.`);
  }

  if (DRY_RUN) await db.begin();

  const importRow = await one<{ id: string }>(
    db,
    `insert into public.imports (workspace_id, label, status, created_by, notes)
     values ($1, $2, 'BORRADOR', $3, $4) returning id`,
    [workspaceId, `Importació inicial ${new Date().toISOString().slice(0, 10)}`, ownerId,
     'Càrrega completa de les fonts comercials lliurades al projecte.'],
  );
  if (!importRow) throw new Error('No s\'ha pogut crear la importació');

  const ctx: ImportContext = {
    db, workspaceId, importId: importRow.id, ownerId,
    resolved: new Map(), stats: emptyStats(), provenanceBuffer: [],
  };

  // -- 1. staging ----------------------------------------------------------
  console.log('\n── Fase 1: staging de fitxers ──');
  const staged = new Map<string, Awaited<ReturnType<typeof stageWorkbook>>>();
  for (const source of SOURCES) {
    if (source.file.endsWith('.pdf')) continue; // handled from parsed JSON
    const sheets = await stageWorkbook(ctx, source);
    staged.set(source.file, sheets);
    console.log(`  ${source.file}: ${sheets.length} fulls, ${sheets.reduce((a, s) => a + s.rows.length, 0)} files`);
  }
  await db.query(`update public.imports set status = 'INSPECCIONAT' where id = $1`, [ctx.importId]);

  // -- 2. companies, most trustworthy source first -------------------------
  console.log('\n── Fase 2: empreses ──');
  for (const source of [...SOURCES].sort((a, b) => a.trust - b.trust)) {
    const sheets = staged.get(source.file);
    if (!sheets) continue;
    for (const sheet of sheets) {
      if (sheet.spec.kind !== 'CLIENTS') continue;
      await importClientSheet(ctx, source, sheet);
      console.log(`  ${source.file} · ${sheet.spec.sheet}: ${sheet.rows.length} files`);
    }
  }

  // -- 3. public directories (enrichment) ----------------------------------
  console.log('\n── Fase 3: directoris públics ──');
  for (const source of SOURCES) {
    const sheets = staged.get(source.file);
    if (!sheets) continue;
    for (const sheet of sheets) {
      if (sheet.spec.kind !== 'PUBLIC_DIRECTORY') continue;
      await importPublicDirectory(ctx, source, sheet);
      console.log(`  ${source.file} · ${sheet.spec.sheet}: ${sheet.rows.length} files`);
    }
  }

  // -- 4. export outreach --------------------------------------------------
  console.log('\n── Fase 4: llistat d\'exportació ──');
  for (const source of SOURCES) {
    const sheets = staged.get(source.file);
    if (!sheets) continue;
    for (const sheet of sheets) {
      if (sheet.spec.kind !== 'CONTACTS_EXPORT') continue;
      await importExportContacts(ctx, source, sheet);
      console.log(`  ${source.file} · ${sheet.spec.sheet}: ${sheet.rows.length} files`);
    }
  }

  // -- 5. sales ledger -----------------------------------------------------
  console.log('\n── Fase 5: albarans i oportunitats ──');
  for (const source of SOURCES) {
    const sheets = staged.get(source.file);
    if (!sheets) continue;
    for (const sheet of sheets) {
      if (sheet.spec.kind !== 'SALES') continue;
      await importSalesSheet(ctx, source, sheet);
      console.log(`  ${source.file} · ${sheet.spec.sheet}: ${sheet.rows.length} files`);
    }
  }

  // -- 6. parsed PDFs ------------------------------------------------------
  console.log('\n── Fase 6: fonts en PDF ──');
  const ledger = await importLedgerJson(ctx);
  console.log(`  Extracte comptable: ${ledger.matched} comptes vinculats, ${ledger.unmatched.length} sense coincidència`);
  const cava = await importCavaRegister(ctx);
  console.log(`  Registre de cava: ${cava.matched} cellers vinculats`);

  // -- 7. priority ordering ------------------------------------------------
  console.log('\n── Fase 7: ordre de potencial ──');
  for (const source of SOURCES) {
    const sheets = staged.get(source.file);
    if (!sheets) continue;
    for (const sheet of sheets) {
      if (sheet.spec.kind !== 'PRIORITY_ORDER') continue;
      await importPriorityOrder(ctx, source, sheet);
    }
  }

  await flushProvenance(ctx);

  // -- 8. recompute proposals ---------------------------------------------
  console.log('\n── Fase 8: classificació proposada ──');
  await db.query(
    `select app.refresh_proposed_classification(id)
       from public.clients where workspace_id = $1 and deleted_at is null`,
    [workspaceId],
  );

  await db.query(
    `update public.imports
        set status = 'APLICAT', finished_at = now(), stats = $2
      where id = $1`,
    [ctx.importId, JSON.stringify({
      ...ctx.stats,
      productsUnmapped: [...ctx.stats.productsUnmapped],
      campaignsUnmapped: [...ctx.stats.campaignsUnmapped],
    })],
  );

  // -- 9. documentation ----------------------------------------------------
  const date = new Date().toISOString().slice(0, 10);
  const dir = await ensureDocsDir(date);
  await writeSourceInventory(db, ctx.importId, dir);
  await writeColumnMapping(dir);
  await writeNormalizationDecisions(dir);
  await writeImportReport(db, ctx.importId, workspaceId, ctx.stats, dir, {
    ledgerMatched: ledger.matched,
    ledgerUnmatched: ledger.unmatched,
    cavaMatched: cava.matched,
  });

  const summary = await one<Record<string, string>>(
    db,
    `select
       (select count(*) from public.clients where workspace_id = $1 and deleted_at is null)::text as empreses,
       (select count(*) from public.contacts where workspace_id = $1 and deleted_at is null)::text as contactes,
       (select count(*) from public.opportunities where workspace_id = $1 and deleted_at is null)::text as oportunitats,
       (select count(*) from public.activities where workspace_id = $1 and deleted_at is null)::text as activitats,
       (select count(*) from public.tasks where workspace_id = $1 and deleted_at is null)::text as tasques,
       (select count(*) from public.duplicate_candidates where workspace_id = $1)::text as duplicats,
       (select count(*) from public.excluded_records where workspace_id = $1 and module = 'BAG_IN_BOX')::text as bib,
       (select count(*) from public.excluded_records where workspace_id = $1 and module = 'SUBPRODUCTE')::text as subproductes,
       (select count(*) from public.excluded_records where workspace_id = $1 and module = 'PRODUCTE_NO_CATALOGAT')::text as sense_catalog`,
    [workspaceId],
  );

  console.log('\n══ Resum ══');
  console.log(`  Files llegides:   ${ctx.stats.rowsRead}`);
  console.log(`    importades:     ${ctx.stats.rowsImported}`);
  console.log(`    ignorades:      ${ctx.stats.rowsIgnored}`);
  console.log(`    rebutjades:     ${ctx.stats.rowsRejected}`);
  console.log(`    excloses (BIB): ${ctx.stats.rowsExcluded}`);
  console.log(`  Empreses:         ${summary?.empreses}`);
  console.log(`  Contactes:        ${summary?.contactes}`);
  console.log(`  Oportunitats:     ${summary?.oportunitats}`);
  console.log(`  Activitats:       ${summary?.activitats}`);
  console.log(`  Tasques:          ${summary?.tasques}`);
  console.log(`  Duplicats a revisar: ${summary?.duplicats}`);
  console.log(`  Exclosos — Bag in Box: ${summary?.bib}, subproductes (BRISA/MARES): ${summary?.subproductes}, producte fora de catàleg: ${summary?.sense_catalog}`);
  console.log(`\n  Informes: docs/imports/${date}/`);

  if (DRY_RUN) {
    await db.rollback();
    console.log('\n  dry-run: s\'ha desfet tota la transacció.');
  }
  await db.close();
}

main().catch((error: unknown) => {
  console.error('\n✗ Importació fallida:', error);
  process.exit(1);
});
