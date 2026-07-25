/**
 * Imports the operational workbook Carlos maintains by hand.
 *
 *   pnpm llista:sync -- "/ruta/CRM VITALPE GRANEL V2 · OPERATIU.xlsx"
 *   pnpm llista:sync -- "<fitxer>" --apply          (local)
 *   pnpm llista:sync -- "<fitxer>" --remote --apply (producció)
 *
 * The workbook is the commercial's own cleaned list: 347 companies, down from
 * the 801 the first import produced. Three rules shape what happens here.
 *
 * 1. **Nothing is deleted.** 507 CRM companies fall outside the cleaned list
 *    and 29 of them have real purchases — 2.6 million litres, Pinord alone
 *    615.000 L. Several are the same company under a different spelling. So a
 *    company that is not in the list gets `in_working_list = false` and keeps
 *    every row of its history. "Cleaned the list" is a statement about what is
 *    being worked this season, not about who ever bought anything.
 *
 * 2. **Matching is deterministic or it is a question.** A company matches by
 *    normalised name, by alias, by its `VIT-GR-nnnn` id, or by either half of
 *    the "RAÓ SOCIAL - MARCA" convention the workbook uses. Anything else
 *    creates a new company AND queues a duplicate candidate when something
 *    similar already exists — a human decides, exactly as the dedupe screen was
 *    built for. No silent merges.
 *
 * 3. **The workbook wins on commercial fields, the CRM wins on history.**
 *    State, priority, contact details, product of interest and next action come
 *    from the sheet. Purchases, activities and audit rows are never touched.
 */
import { loadEnv } from '../load-env';

loadEnv();

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readWorkbook, type RawRow } from './xlsx';
import { openDatabase, one, type SqlRunner } from './db';
import { normalizeCompany } from '@vitalpe/domain';

const argv = process.argv.slice(2).filter((a) => a !== '--');
const file = argv.find((a) => !a.startsWith('--'));
const apply = argv.includes('--apply');
const remote = argv.includes('--remote');

if (!file) {
  console.error('\nÚs: pnpm llista:sync -- "<fitxer.xlsx>" [--remote] [--apply]\n');
  process.exit(1);
}

/** Same guard as the main importer: a remote write has to be asked for. */
function assertTarget(): boolean {
  const url = process.env.DATABASE_URL;
  if (!url) return false;
  const isLocal = /localhost|127\.0\.0\.1|\[::1\]/i.test(url);
  if (isLocal) return false;
  if (!remote) {
    console.error(
      '\n✗ DATABASE_URL apunta a una base remota i no has escrit --remote.' +
        '\n  Afegeix --remote si vols escriure a producció.\n',
    );
    process.exit(1);
  }
  return true;
}

const value = (row: RawRow, key: string): string | null => {
  const raw = row.values[key];
  if (raw === null || raw === undefined) return null;
  const trimmed = String(raw).trim();
  return trimmed.length === 0 || trimmed === '-' ? null : trimmed;
};

/**
 * `normalizeCompany` returns null for anything that normalises to nothing —
 * it mirrors SQL, where `regexp_replace(NULL, …)` is NULL. A null key would
 * silently collide in the lookup map, so it is never used as one.
 */
function key(name: string | null | undefined): string | null {
  const normalised = normalizeCompany(name);
  return normalised === null || normalised.length === 0 ? null : normalised;
}

/** "RAÓ SOCIAL - MARCA" and "A / B" both name the same company. */
function identities(name: string): string[] {
  const out = [name];
  for (const sep of [' - ', ' / ', ' – ']) {
    if (name.includes(sep)) {
      for (const part of name.split(sep)) {
        const t = part.trim();
        if (t.length > 3) out.push(t);
      }
    }
  }
  return out;
}

/**
 * The sheet's ESTAT COMERCIAL, mapped to the CRM's classification enum.
 * `POTENCIAL NO QUALIFICAT` has no CRM equivalent and deliberately maps to
 * nothing: an unqualified lead is precisely a company nobody has classified
 * yet, and writing a confirmed classification for it would be inventing a
 * human decision.
 */
const CLASSIFICATION: Record<string, string | null> = {
  ACTIU: 'ACTIU SEGUR',
  'POTENCIAL INTERESSAT': 'POTENCIAL INTERESSAT',
  'POTENCIAL NO QUALIFICAT': null,
};

/**
 * The workbook's verbs, mapped to `app.commercial_action`. Anything unknown
 * becomes ALTRES with the original wording kept in `other_action`, rather than
 * being bent into the nearest enum value.
 */
const ACTION: Record<string, string> = {
  VISITAR: 'VISITA',
  VISITA: 'VISITA',
  TRUCAR: 'TRUCAR',
  'ENVIAR CORREU': 'ENVIAR CORREU',
  'ENVIAR PREUS': 'ENVIAR PREUS',
  'ENVIAR OFERTA': 'ENVIAR OFERTA',
  'ENVIAR MOSTRES': 'MOSTRES',
  MOSTRES: 'MOSTRES',
  'VERIFICAR EMPRESA': 'VERIFICAR EMPRESA',
};

const PRIORITY: Record<string, string> = {
  'MOLT ALTA': 'ALTA',
  ALTA: 'ALTA',
  MITJANA: 'MITJANA',
  BAIXA: 'BAIXA',
};

interface Report {
  read: number;
  matched: number;
  created: number;
  updated: number;
  duplicatesQueued: number;
  droppedFromList: number;
  tasks: number;
  forecasts: number;
}

interface ContactFields {
  contact: string | null;
  role: string | null;
  phone: string | null;
  email: string | null;
}

/**
 * Phone and e-mail live on `contacts`, not on the company — so the workbook's
 * single contact column becomes the primary contact. Existing values are never
 * overwritten with null: a blank cell means "not stated here", not "delete it".
 */
async function upsertContact(
  db: SqlRunner,
  workspaceId: string,
  clientId: string,
  fields: ContactFields,
): Promise<void> {
  if (!fields.phone && !fields.email && !fields.contact) return;
  const [first = null, ...rest] = (fields.contact ?? '').split(/\s+/).filter(Boolean);
  const existing = await one<{ id: string }>(
    db,
    `select id from public.contacts
      where client_id = $1 and deleted_at is null
      order by is_primary desc, created_at limit 1`,
    [clientId],
  );
  if (existing) {
    await db.query(
      `update public.contacts set
         phone_original = coalesce($2, phone_original),
         email_original = coalesce($3, email_original),
         role_title = coalesce($4, role_title),
         updated_at = now()
       where id = $1`,
      [existing.id, fields.phone, fields.email, fields.role],
    );
    return;
  }
  await db.query(
    `insert into public.contacts
       (workspace_id, client_id, first_name, last_name, role_title,
        phone_original, email_original, is_primary, source)
     values ($1,$2,$3,$4,$5,$6,$7,true,'LLISTA OPERATIVA')`,
    [workspaceId, clientId, first, rest.join(' ') || null, fields.role,
     fields.phone, fields.email],
  );
}

async function main(): Promise<void> {
  const isRemote = assertTarget();
  // Local runs work on the persisted copy in .data/crm, not a fresh in-memory
  // database — otherwise the dry run reports 347 "new" companies against an
  // empty schema and tells you nothing about the real merge.
  const dataDir = path.join(fileURLToPath(new URL('../../', import.meta.url)), '.data', 'crm');
  const db = await openDatabase(isRemote ? {} : { local: true, dataDir });
  console.log(`Base de dades: ${db.kind}${isRemote ? ' REMOTA' : ' local'}${apply ? '' : ' (simulació)'}`);

  const workspaceId = await one<{ id: string }>(db, `select id from public.workspaces where slug = 'vitalpe'`);
  if (!workspaceId) throw new Error('No hi ha espai de treball VITALPE.');
  const ws = workspaceId.id;

  const owner = await one<{ id: string }>(
    db,
    `select p.id from public.profiles p
       join public.workspace_memberships m on m.user_id = p.id and m.workspace_id = $1 and m.status = 'ACTIU'
      where m.role = 'ADMIN' order by m.created_at limit 1`,
    [ws],
  );

  const wb = await readWorkbook(file!);
  const clientSheet = wb.sheets.find((s) => s.sheetName === 'CLIENTS');
  if (!clientSheet) throw new Error('El fitxer no té cap full CLIENTS.');

  const rows = clientSheet.rows.filter((r) => (r.values['EMPRESA'] ?? '').trim().length > 0);
  const report: Report = {
    read: rows.length, matched: 0, created: 0, updated: 0,
    duplicatesQueued: 0, droppedFromList: 0, tasks: 0, forecasts: 0,
  };

  // --- index the CRM once -------------------------------------------------
  const existing = await db.query<{ id: string; norm: string; ref: string | null }>(
    `select id, name_norm as norm, external_ref as ref from public.clients
      where workspace_id = $1 and deleted_at is null`,
    [ws],
  );
  const aliases = await db.query<{ client_id: string; norm: string }>(
    `select client_id, alias_norm as norm from public.client_aliases where workspace_id = $1`,
    [ws],
  );
  const byNorm = new Map<string, string>();
  const byRef = new Map<string, string>();
  for (const row of existing) {
    byNorm.set(row.norm, row.id);
    if (row.ref) byRef.set(row.ref, row.id);
  }
  for (const a of aliases) if (!byNorm.has(a.norm)) byNorm.set(a.norm, a.client_id);

  const inList = new Set<string>();

  for (const row of rows) {
    const name = value(row, 'EMPRESA')!;
    const ref = value(row, 'ID');

    // Identity: the workbook id first (survives a rename), then the names.
    let clientId = (ref ? byRef.get(ref) : undefined) ?? undefined;
    if (!clientId) {
      for (const candidate of identities(name)) {
        const k = key(candidate);
        const hit = k === null ? undefined : byNorm.get(k);
        if (hit) { clientId = hit; break; }
      }
    }

    const classification = CLASSIFICATION[value(row, 'ESTAT COMERCIAL') ?? ''] ?? null;
    const fields = {
      municipality: value(row, 'MUNICIPI'),
      province: value(row, 'PROVÍNCIA'),
      website: value(row, 'WEB'),
      phone: value(row, 'TELÈFON'),
      email: value(row, 'CORREU'),
      notes: value(row, 'OBSERVACIONS'),
      product: value(row, "PRODUCTE D'INTERÈS"),
      priority: PRIORITY[value(row, 'PRIORITAT') ?? ''] ?? null,
      contact: value(row, 'CONTACTE'),
      role: value(row, 'CÀRREC'),
      scope: value(row, 'DO / ÀMBIT'),
    };

    if (clientId) {
      report.matched += 1;
      if (apply) {
        await db.query(
          `update public.clients set
             external_ref = coalesce($2, external_ref),
             in_working_list = true,
             municipality = coalesce($3, municipality),
             province = coalesce($4, province),
             website = coalesce($5, website),
             proposed_classification = coalesce($6::app.classification, proposed_classification),
             updated_at = now()
           where id = $1`,
          [clientId, ref, fields.municipality, fields.province, fields.website, classification],
        );
        await upsertContact(db, ws, clientId, fields);
        // Alias every spelling ever seen, so the next import matches directly.
        for (const candidate of identities(name)) {
          await db.query(
            `insert into public.client_aliases (workspace_id, client_id, alias, source)
             values ($1,$2,$3,'LLISTA OPERATIVA')
             on conflict do nothing`,
            [ws, clientId, candidate],
          );
        }
        report.updated += 1;
      }
      inList.add(clientId);
      continue;
    }

    // --- new company ------------------------------------------------------
    // Before creating, look for something similar. If there is, the row is
    // still created (it is on the commercial's authoritative list) but a
    // duplicate candidate is queued so a person can merge it reversibly.
    const near = await one<{ id: string; name: string; score: number }>(
      db,
      `select id, name, similarity(name_norm, app.normalize_company($2)) as score
         from public.clients
        where workspace_id = $1 and deleted_at is null
        order by score desc limit 1`,
      [ws, name],
    );

    if (!apply) {
      report.created += 1;
      if (near && Number(near.score) >= 0.45) report.duplicatesQueued += 1;
      continue;
    }

    const created = await one<{ id: string }>(
      db,
      `insert into public.clients
         (workspace_id, name, external_ref, municipality, province, website,
          proposed_classification, owner_id, in_working_list)
       values ($1,$2,$3,$4,$5,$6,$7::app.classification,$8,true)
       returning id`,
      [ws, name, ref, fields.municipality, fields.province, fields.website,
       classification, owner?.id ?? null],
    );
    if (!created) continue;
    await upsertContact(db, ws, created.id, fields);
    report.created += 1;
    inList.add(created.id);
    const createdKey = key(name);
    if (createdKey !== null) byNorm.set(createdKey, created.id);

    if (near && Number(near.score) >= 0.45) {
      await db.query(
        `insert into public.duplicate_candidates
           (workspace_id, left_client_id, right_client_id, candidate_name, score,
            signals, is_deterministic, decision)
         values ($1,$2,$3,$4,$5,$6::jsonb,false,'PENDENT')`,
        [ws, created.id, near.id, name, Number(near.score).toFixed(3),
         JSON.stringify({
           origen: 'LLISTA OPERATIVA',
           nota: `La llista porta «${name}»; al CRM ja hi havia «${near.name}». No s'ha fusionat res.`,
         })],
      );
      report.duplicatesQueued += 1;
    }
  }

  // --- companies outside the cleaned list --------------------------------
  if (apply) {
    const ids = [...inList];
    const dropped = await db.query<{ id: string }>(
      `update public.clients set in_working_list = false, updated_at = now()
        where workspace_id = $1 and deleted_at is null
          and not (id = any($2::uuid[]))
          and in_working_list
        returning id`,
      [ws, ids],
    );
    report.droppedFromList = dropped.length;

    await db.query(
      `update public.clients set in_working_list = true, updated_at = now()
        where workspace_id = $1 and deleted_at is null and id = any($2::uuid[]) and not in_working_list`,
      [ws, ids],
    );
  } else {
    const [count] = await db.query<{ n: string }>(
      `select count(*)::text as n from public.clients
        where workspace_id = $1 and deleted_at is null and in_working_list`,
      [ws],
    );
    report.droppedFromList = Math.max(0, Number(count?.n ?? '0') - inList.size);
  }

  // --- tasks -------------------------------------------------------------
  const taskSheet = wb.sheets.find((s) => s.sheetName === 'TASQUES');
  if (taskSheet && apply) {
    for (const row of taskSheet.rows) {
      const company = value(row, 'EMPRESA');
      const action = value(row, 'ACCIÓ');
      const state = value(row, 'ESTAT');
      if (!company || !action || state !== 'PENDENT') continue;
      const target = identities(company)
        .map((c) => { const k = key(c); return k === null ? undefined : byNorm.get(k); })
        .find(Boolean);
      if (!target) continue;

      const due = value(row, 'DATA');
      const priority = PRIORITY[value(row, 'PRIORITAT') ?? ''] ?? 'MITJANA';
      const objective = value(row, 'OBJECTIU / NOTA');
      const ext = value(row, 'ID TASCA');

      // Idempotent on the workbook's own task id: re-running does not pile up.
      const already = await one<{ id: string }>(
        db,
        `select id from public.tasks
          where workspace_id = $1 and client_id = $2 and deleted_at is null
            and notes is not null and notes like $3 limit 1`,
        [ws, target, `%[${ext ?? '—'}]%`],
      );
      if (already) continue;

      const mapped = ACTION[action.toUpperCase()] ?? 'ALTRES';
      await db.query(
        `insert into public.tasks
           (workspace_id, kind, action, other_action, client_id, title, due_at, priority,
            assigned_to, created_by, notes)
         values ($1,'TASCA',$2::app.commercial_action,$3,$4,$5,
                 case when $6::text is null then null
                      else (($6::date) + time '09:00') at time zone 'Europe/Madrid' end,
                 $7::app.task_priority,$8,$8,$9)`,
        [ws, mapped, mapped === 'ALTRES' ? action : null, target, objective ?? action,
         due, priority, owner?.id ?? null,
         `${objective ?? ''}${ext ? ` [${ext}]` : ''}`.trim()],
      );
      report.tasks += 1;
    }
  }

  // --- summary -----------------------------------------------------------
  console.log('\n══ Sincronització de la llista operativa ══');
  console.log(`  Files llegides          : ${report.read}`);
  console.log(`  Ja existien al CRM      : ${report.matched}`);
  console.log(`  Actualitzades           : ${report.updated}`);
  console.log(`  Creades de nou          : ${report.created}`);
  console.log(`  Duplicats a revisar     : ${report.duplicatesQueued}`);
  console.log(`  Fora de la llista activa: ${report.droppedFromList}  (NO esborrades: conserven historial)`);
  console.log(`  Tasques importades      : ${report.tasks}`);
  if (!apply) {
    console.log('\n  Simulació. Cap canvi escrit. Afegeix --apply per aplicar-ho.\n');
  } else {
    console.log('\n✓ Aplicat.\n');
  }

  await db.close?.();
}

main().catch((error) => {
  console.error('\n✗', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
