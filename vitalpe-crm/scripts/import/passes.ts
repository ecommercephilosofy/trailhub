/**
 * The individual import passes, in execution order.
 * Each pass reads only from staging (`import_rows`) and writes canonical rows,
 * marking every staged row with the outcome that lets the reconciliation
 * identity hold:
 *
 *   rows read = imported + ignored + rejected + excluded
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { one, scalar } from './db.js';
import { readWorkbook, type RawRow, type SheetData } from './xlsx.js';
import { findHeader, isBagInBox, NON_CUSTOMER_ACCOUNTS, type SheetSpec, type SourceSpec } from './sources.js';
import * as N from './normalize.js';
import { isByProduct } from './products.js';
import {
  type ImportContext,
  addAlias,
  fillIfEmpty,
  findOrCreateCampaign,
  findProduct,
  recordUnmapped,
  resolveClient,
  upsertContact,
  upsertLocation,
  SOURCE_DIR,
} from './pipeline.js';

interface StagedRow extends RawRow {
  id: string;
}

interface StagedSheet {
  sheetId: string;
  spec: SheetSpec;
  data: SheetData;
  rows: StagedRow[];
}

function col(row: Record<string, string | null>, headers: string[], names?: string[]): string | null {
  const h = findHeader(headers, names);
  return h ? N.clean(row[h] ?? null) : null;
}

async function markRow(
  ctx: ImportContext,
  rowId: string,
  outcome: 'IMPORTADA' | 'IGNORADA' | 'REBUTJADA' | 'EXCLOSA' | 'DUPLICADA',
  reason: string | null,
  entities: Record<string, unknown> = {},
): Promise<void> {
  await ctx.db.query(
    `update public.import_rows
        set outcome = $2, outcome_reason = $3, entities_created = $4
      where id = $1`,
    [rowId, outcome, reason, JSON.stringify(entities)],
  );
  switch (outcome) {
    case 'IMPORTADA': ctx.stats.rowsImported += 1; break;
    case 'IGNORADA': ctx.stats.rowsIgnored += 1; break;
    case 'REBUTJADA': ctx.stats.rowsRejected += 1; break;
    case 'EXCLOSA': ctx.stats.rowsExcluded += 1; break;
    case 'DUPLICADA': ctx.stats.rowsDuplicate += 1; break;
  }
}

// ---------------------------------------------------------------------------
// Staging
// ---------------------------------------------------------------------------

export async function stageWorkbook(
  ctx: ImportContext,
  source: SourceSpec,
): Promise<StagedSheet[]> {
  const filePath = path.join(SOURCE_DIR, source.file);
  const workbook = await readWorkbook(filePath);

  const file = await one<{ id: string }>(
    ctx.db,
    `insert into public.import_files (import_id, filename, byte_size, sha256, mime_type, stored_path)
     values ($1,$2,$3,$4,$5,$6) returning id`,
    [ctx.importId, workbook.filename, workbook.byteSize, workbook.sha256,
     'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
     path.relative(path.join(SOURCE_DIR, '..', '..'), filePath)],
  );
  if (!file) throw new Error(`No s'ha registrat el fitxer ${source.file}`);
  ctx.stats.files += 1;

  const staged: StagedSheet[] = [];
  for (const spec of source.sheets) {
    const data = workbook.sheets.find((s) => s.sheetName === spec.sheet);
    if (!data) continue;

    // A sheet re-read with a forced header row when the spec says so.
    const effective = spec.headerRow && spec.headerRow !== data.headerRow
      ? (await readWorkbook(filePath, { headerRow: spec.headerRow })).sheets.find((s) => s.sheetName === spec.sheet)!
      : data;

    const usable = effective.rows.filter((r) => !r.isEmpty);
    const sheet = await one<{ id: string }>(
      ctx.db,
      `insert into public.import_sheets
         (import_file_id, sheet_name, header_row, rows_total, rows_read, entity_hint, is_excluded, exclusion_reason)
       values ($1,$2,$3,$4,$5,$6,$7,$8) returning id`,
      [file.id, spec.sheet, effective.headerRow, effective.totalRows, usable.length,
       spec.kind, spec.kind === 'REFERENCE', spec.skipReason ?? null],
    );
    if (!sheet) continue;
    ctx.stats.sheets += 1;

    const rows: StagedRow[] = [];
    const CHUNK = 150;
    for (let i = 0; i < usable.length; i += CHUNK) {
      const chunk = usable.slice(i, i + CHUNK);
      const values: unknown[] = [];
      const tuples = chunk.map((r, idx) => {
        const base = idx * 4;
        values.push(ctx.importId, sheet.id, r.rowNumber, JSON.stringify(r.values));
        return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
      });
      const inserted = await ctx.db.query<{ id: string; row_number: number }>(
        `insert into public.import_rows (import_id, import_sheet_id, row_number, raw)
         values ${tuples.join(', ')}
         returning id, row_number`,
        values,
      );
      for (const r of inserted) {
        const original = chunk.find((c) => c.rowNumber === Number(r.row_number));
        if (original) rows.push({ ...original, id: r.id });
      }
    }
    ctx.stats.rowsRead += rows.length;

    if (spec.kind === 'REFERENCE') {
      for (const r of rows) await markRow(ctx, r.id, 'IGNORADA', spec.skipReason ?? 'full de referència');
    }

    staged.push({ sheetId: sheet.id, spec, data: effective, rows });
  }
  return staged;
}

// ---------------------------------------------------------------------------
// Pass 1 — companies
// ---------------------------------------------------------------------------

export async function importClientSheet(
  ctx: ImportContext,
  source: SourceSpec,
  staged: StagedSheet,
): Promise<void> {
  const { spec, data, rows } = staged;
  const H = data.headers;
  const cols = spec.columns ?? {};
  const sheetIsBottlers = spec.sheet === 'CRM CLIENTS EMBOTELLADORS';

  for (const row of rows) {
    const v = row.values;
    const name = col(v, H, cols.name);
    if (!name) {
      await markRow(ctx, row.id, 'REBUTJADA', 'fila sense nom d\'empresa');
      continue;
    }

    const emails = N.splitEmails(col(v, H, cols.email));
    const phones = N.splitPhones(col(v, H, cols.phone));
    const municipality = col(v, H, cols.municipality);
    const postalCode = N.normalizePostalCode(col(v, H, cols.postalCode));
    const provinceRaw = col(v, H, cols.province);
    const provinceFromCp = N.provinceFromPostalCode(postalCode);
    const province = provinceRaw ?? provinceFromCp.value;
    const website = col(v, H, cols.website);

    const resolved = await resolveClient(ctx, {
      name,
      email: emails[0] ?? null,
      phone: phones[0] ?? null,
      website,
      municipality,
      province,
      importRowId: row.id,
    });
    const clientId = resolved.clientId;
    await addAlias(ctx, clientId, name, `${source.file} / ${spec.sheet}`);

    // ---- company columns (never overwrite a better source) ----------------
    await fillIfEmpty(ctx, clientId, 'municipality', municipality);
    await fillIfEmpty(ctx, clientId, 'province', province);
    await fillIfEmpty(ctx, clientId, 'comarca', col(v, H, cols.zone));
    await fillIfEmpty(ctx, clientId, 'website', website);
    await fillIfEmpty(ctx, clientId, 'external_account_code', col(v, H, cols.accountCode));

    const doFlags = N.parseDoFlags(
      col(v, H, cols.publicDo),
      col(v, H, cols.sources),
      col(v, H, cols.group),
      spec.sheet.includes('Catalunya') && !spec.sheet.includes('Cava') ? 'DO Catalunya' : null,
      spec.sheet.includes('Cava') ? 'DO Cava' : null,
      spec.sheet.includes('Penedes') ? 'DO Penedès' : null,
    );
    await ctx.db.query(
      `update public.clients
          set do_cava = do_cava or $2, do_penedes = do_penedes or $3,
              do_catalunya = do_catalunya or $4, do_altres = do_altres or $5
        where id = $1`,
      [clientId, doFlags.do_cava, doFlags.do_penedes, doFlags.do_catalunya, doFlags.do_altres],
    );

    const bottlerFlag = N.parseYesNo(col(v, H, cols.bottlerFlag));
    const type = N.inferClientType(name, sheetIsBottlers ? 'EMBOTELLADOR' : null, bottlerFlag);
    if (type.value) await fillIfEmpty(ctx, clientId, 'client_type_code', type.value);

    // ---- notes: every free-text column is preserved verbatim --------------
    const noteParts: string[] = [];
    for (const key of ['notes', 'pendingData', 'listStatus', 'publicCheckNote', 'contactResultJune', 'boughtLastCampaign'] as const) {
      const value = col(v, H, cols[key]);
      const header = findHeader(H, cols[key]);
      if (value && header) noteParts.push(`${header.toUpperCase()}: ${value}`);
    }
    if (noteParts.length > 0) {
      await ctx.db.query(
        `update public.clients
            set general_notes = case
              when general_notes is null or btrim(general_notes) = '' then $2
              when position($2 in general_notes) > 0 then general_notes
              else general_notes || E'\n' || $2 end
          where id = $1`,
        [clientId, `[${source.file} · ${spec.sheet}] ` + noteParts.join(' | ')],
      );
    }

    // ---- contacts ---------------------------------------------------------
    const contactName = col(v, H, cols.contactName) ?? col(v, H, cols.buyerContact);
    const person = N.splitPersonName(contactName);
    if (contactName) {
      await upsertContact(ctx, clientId, {
        firstName: person.firstName, lastName: person.lastName,
        phone: phones[0] ?? null, email: emails[0] ?? null,
        type: 'DIRECTE', primary: true, source: `${source.file} / ${spec.sheet}`,
      });
    }
    // Generic switchboard / info@ addresses become GENERAL contacts, so a
    // secondary e-mail in the same cell is never lost.
    for (let i = contactName ? 1 : 0; i < Math.max(emails.length, phones.length); i += 1) {
      await upsertContact(ctx, clientId, {
        firstName: null, lastName: null,
        phone: phones[i] ?? (i === 0 ? phones[0] ?? null : null),
        email: emails[i] ?? null,
        type: 'GENERAL', primary: !contactName && i === 0,
        source: `${source.file} / ${spec.sheet}`,
      });
    }
    if (!contactName && emails.length === 0 && phones.length === 1) {
      await upsertContact(ctx, clientId, {
        firstName: null, lastName: null, phone: phones[0] ?? null, email: null,
        type: 'GENERAL', primary: true, source: `${source.file} / ${spec.sheet}`,
      });
    }

    // ---- location ---------------------------------------------------------
    const street = [col(v, H, cols.street), col(v, H, cols.street2)].filter(Boolean).join(' ');
    await upsertLocation(ctx, clientId, {
      street: street || null, postalCode, municipality, province,
      country: 'ES', source: `${source.file} / ${spec.sheet}`,
    });

    // ---- public verification ---------------------------------------------
    const publicSource = col(v, H, cols.publicSource);
    const publicDate = N.parseDate(col(v, H, cols.publicCheckDate));
    if (publicSource && publicDate.value) {
      const exists = await scalar<string>(
        ctx.db,
        `select id from public.client_verifications
          where client_id = $1 and source = $2 and verified_at::date = $3::date limit 1`,
        [clientId, publicSource, publicDate.value],
      );
      if (!exists) {
        await ctx.db.query(
          `insert into public.client_verifications
             (workspace_id, client_id, status, verified_at, source, note)
           values ($1,$2,'PENDENT DE VERIFICAR',$3,$4,$5)`,
          [ctx.workspaceId, clientId, publicDate.value, publicSource,
           col(v, H, cols.publicCheckNote)],
        );
        ctx.stats.verificationsCreated += 1;
      }
    }

    // ---- history and next action (only where the source carries a date) ---
    const lastContact = N.parseDate(col(v, H, cols.lastContact));
    const state = col(v, H, cols.listStatus);
    const callResult = col(v, H, cols.callResult);
    if (lastContact.value) {
      const type2 = N.activityTypeForState(state);
      if (type2.value) {
        const result = N.parseResult(callResult);
        if (result.unmapped) await recordUnmapped(ctx, 'RESULTAT', result.unmapped.raw);
        const notes = [
          state ? `ESTAT ORIGEN: ${state}` : null,
          callResult ? `RESULTAT ORIGEN: ${callResult}` : null,
        ].filter(Boolean).join(' | ');
        const dup = await scalar<string>(
          ctx.db,
          `select id from public.activities
            where client_id = $1 and occurred_on = $2::date and coalesce(notes,'') = $3 limit 1`,
          [clientId, lastContact.value, notes],
        );
        if (!dup) {
          await ctx.db.query(
            `insert into public.activities
               (workspace_id, client_id, occurred_on, activity_type, result, notes, origin)
             values ($1,$2,$3::date,$4,$5,$6,'IMPORTACIO')`,
            [ctx.workspaceId, clientId, lastContact.value, type2.value,
             result.value ?? 'NO DETERMINAT', notes || 'Import sense detall addicional'],
          );
          ctx.stats.activitiesCreated += 1;
        }
      }
    }

    const action = N.parseAction(col(v, H, cols.nextAction));
    if (action.value) {
      if (action.unmapped) await recordUnmapped(ctx, 'ACCIO', action.unmapped.raw);
      const rawDate = col(v, H, cols.nextActionDate);
      const due = N.parseDate(rawDate);
      const priority = N.parsePriority(col(v, H, cols.initialPriority));
      const taskNotes = [
        rawDate && !due.value ? `DATA ORIGEN NO INTERPRETABLE: ${rawDate}` : null,
        callResult ? `RESULTAT ORIGEN: ${callResult}` : null,
      ].filter(Boolean).join(' | ') || null;

      const dupTask = await scalar<string>(
        ctx.db,
        `select id from public.tasks
          where client_id = $1 and action = $2 and status = 'PENDENT'
            and coalesce(due_at::date::text,'') = coalesce($3::text,'') limit 1`,
        [clientId, action.value.action, due.value],
      );
      if (!dupTask) {
        await ctx.db.query(
          `insert into public.tasks
             (workspace_id, kind, action, other_action, client_id, title, due_at, priority, assigned_to, created_by, notes)
           values ($1,'TASCA',$2,$3,$4,$5,
                   case when $6::text is null then null else ($6::date + time '09:00') at time zone 'Europe/Madrid' end,
                   $7,$8,$8,$9)`,
          [
            ctx.workspaceId, action.value.action, action.value.other ?? null, clientId,
            `${action.value.other ?? action.value.action} — ${name.toUpperCase()}`,
            due.value, priority.value ?? 'MITJANA', ctx.ownerId, taskNotes,
          ],
        );
        ctx.stats.tasksCreated += 1;
      }
    }

    await markRow(ctx, row.id, 'IMPORTADA',
      resolved.created ? 'empresa creada' : 'empresa existent enriquida',
      { client_id: clientId, created: resolved.created, duplicate_queued: resolved.queuedDuplicate });
  }
}

// ---------------------------------------------------------------------------
// Pass 2 — public directory (enrichment only)
// ---------------------------------------------------------------------------

export async function importPublicDirectory(
  ctx: ImportContext,
  source: SourceSpec,
  staged: StagedSheet,
): Promise<void> {
  const { spec, data, rows } = staged;
  const H = data.headers;
  const cols = spec.columns ?? {};

  for (const row of rows) {
    const v = row.values;
    const name = col(v, H, cols.name);
    if (!name) {
      await markRow(ctx, row.id, 'REBUTJADA', 'fila sense nom');
      continue;
    }
    const emails = N.splitEmails(col(v, H, cols.email));
    const phones = N.splitPhones(col(v, H, cols.phone));
    const postalCode = N.normalizePostalCode(col(v, H, cols.postalCode));
    const municipality = col(v, H, cols.municipality);
    const province = N.provinceFromPostalCode(postalCode).value;

    const resolved = await resolveClient(ctx, {
      name, email: emails[0] ?? null, phone: phones[0] ?? null,
      website: col(v, H, cols.website), municipality, province, importRowId: row.id,
    });
    await addAlias(ctx, resolved.clientId, name, `${source.file} / ${spec.sheet}`);
    await fillIfEmpty(ctx, resolved.clientId, 'municipality', municipality);
    await fillIfEmpty(ctx, resolved.clientId, 'province', province);
    await fillIfEmpty(ctx, resolved.clientId, 'website', col(v, H, cols.website));
    await ctx.db.query(`update public.clients set do_penedes = true where id = $1`, [resolved.clientId]);

    for (const email of emails) {
      await upsertContact(ctx, resolved.clientId, {
        firstName: null, lastName: null, email, phone: phones[0] ?? null,
        type: 'GENERAL', primary: false, source: `${source.file} / ${spec.sheet}`,
      });
    }
    await upsertLocation(ctx, resolved.clientId, {
      street: [col(v, H, cols.street), col(v, H, cols.street2)].filter(Boolean).join(' ') || null,
      postalCode, municipality, province, country: 'ES',
      source: `${source.file} / ${spec.sheet}`,
    });

    await markRow(ctx, row.id, 'IMPORTADA',
      resolved.created ? 'empresa creada des de directori públic' : 'dades públiques afegides',
      { client_id: resolved.clientId, created: resolved.created });
  }
}

// ---------------------------------------------------------------------------
// Pass 3 — export outreach list
// ---------------------------------------------------------------------------

export async function importExportContacts(
  ctx: ImportContext,
  source: SourceSpec,
  staged: StagedSheet,
): Promise<void> {
  const { spec, data, rows } = staged;
  const H = data.headers;
  const cols = spec.columns ?? {};

  for (const row of rows) {
    const v = row.values;
    const name = col(v, H, cols.name);
    if (!name) {
      await markRow(ctx, row.id, 'REBUTJADA', 'fila sense nom');
      continue;
    }
    const rawContact = col(v, H, cols.email);
    const emails = N.splitEmails(rawContact);
    const location = N.parseLocation(col(v, H, cols.location));
    const kind = col(v, H, cols.companyKind);

    const resolved = await resolveClient(ctx, {
      name, email: emails[0] ?? null, municipality: location.municipality,
      importRowId: row.id,
    });
    await addAlias(ctx, resolved.clientId, name, `${source.file} / ${spec.sheet}`);
    if (location.country) await fillIfEmpty(ctx, resolved.clientId, 'country', location.country);
    await fillIfEmpty(ctx, resolved.clientId, 'municipality', location.municipality);
    // The sheet's "Tipo" is a market descriptor ("Grupo espumosos"), not one of
    // the four company types, so it is stored as the ALTRES explanation.
    if (kind) {
      await ctx.db.query(
        `update public.clients
            set client_type_code = coalesce(client_type_code, 'ALTRES'),
                other_client_type = coalesce(other_client_type, $2)
          where id = $1`,
        [resolved.clientId, kind.toUpperCase()],
      );
      await recordUnmapped(ctx, 'TIPUS EMPRESA', kind);
    }

    for (const email of emails) {
      await upsertContact(ctx, resolved.clientId, {
        firstName: null, lastName: null, email, type: 'GENERAL',
        primary: emails.indexOf(email) === 0, source: `${source.file} / ${spec.sheet}`,
      });
    }

    const emailSent = N.parseYesNo(col(v, H, cols.emailSent));
    const interest = col(v, H, cols.interest);
    const notes = col(v, H, cols.notes);

    // No date exists anywhere in this sheet, so "e-mail sent" is recorded as a
    // company fact with provenance — never as a dated activity.
    const noteParts = [
      rawContact && emails.length === 0 ? `VIA DE CONTACTE: ${rawContact}` : null,
      emailSent === true ? 'E-MAIL ENVIAT (data no registrada a l\'origen)' : null,
      interest ? `INTERÈS ORIGEN: ${interest}` : null,
      notes ? `NOTES ORIGEN: ${notes}` : null,
    ].filter(Boolean);
    if (noteParts.length > 0) {
      await ctx.db.query(
        `update public.clients
            set general_notes = case
              when general_notes is null or btrim(general_notes) = '' then $2
              else general_notes || E'\n' || $2 end
          where id = $1`,
        [resolved.clientId, `[${source.file}] ` + noteParts.join(' | ')],
      );
    }

    const action = N.parseAction(col(v, H, cols.nextAction));
    if (action.value) {
      if (action.unmapped) await recordUnmapped(ctx, 'ACCIO', action.unmapped.raw);
      const exists = await scalar<string>(
        ctx.db,
        `select id from public.tasks where client_id = $1 and action = $2 and due_at is null and status = 'PENDENT' limit 1`,
        [resolved.clientId, action.value.action],
      );
      if (!exists) {
        // Undated on purpose: it belongs on the company card, not on a day.
        await ctx.db.query(
          `insert into public.tasks
             (workspace_id, kind, action, other_action, client_id, title, due_at, priority, assigned_to, created_by, notes)
           values ($1,'TASCA',$2,$3,$4,$5,null,$6,$7,$7,$8)`,
          [ctx.workspaceId, action.value.action, action.value.other ?? null, resolved.clientId,
           `${action.value.other ?? action.value.action} — ${name.toUpperCase()}`,
           interest?.toUpperCase() === 'SI' ? 'ALTA' : 'MITJANA', ctx.ownerId,
           'Origen: llistat d\'exportació, sense data a l\'origen'],
        );
        ctx.stats.tasksCreated += 1;
      }
    }

    await markRow(ctx, row.id, 'IMPORTADA', 'empresa d\'exportació',
      { client_id: resolved.clientId, created: resolved.created });
  }
}

// ---------------------------------------------------------------------------
// Pass 4 — sales ledger -> opportunities
// ---------------------------------------------------------------------------

export async function importSalesSheet(
  ctx: ImportContext,
  source: SourceSpec,
  staged: StagedSheet,
): Promise<void> {
  const { spec, data, rows } = staged;
  const H = data.headers;
  const cols = spec.columns ?? {};

  for (const row of rows) {
    const v = row.values;
    const clientName = col(v, H, cols.client);
    const productRaw = col(v, H, cols.product);

    if (!clientName || !productRaw) {
      await markRow(ctx, row.id, 'REBUTJADA', 'fila sense client o producte');
      continue;
    }

    // Bag in Box belongs to a future module: parked, never deleted.
    if (isBagInBox(productRaw)) {
      await ctx.db.query(
        `insert into public.excluded_records (workspace_id, import_id, import_row_id, module, reason, raw)
         values ($1,$2,$3,'BAG_IN_BOX',$4,$5)`,
        [ctx.workspaceId, ctx.importId, row.id,
         'Producte Bag in Box: fora del mòdul de vi a granel', JSON.stringify(v)],
      );
      ctx.stats.bagInBoxExcluded += 1;
      await markRow(ctx, row.id, 'EXCLOSA', 'Bag in Box');
      continue;
    }

    // BRISA and MARES are winery by-products, explicitly kept out of the
    // product catalogue. Parked like Bag in Box so the sale is not lost.
    if (isByProduct(productRaw)) {
      await ctx.db.query(
        `insert into public.excluded_records (workspace_id, import_id, import_row_id, module, reason, raw)
         values ($1,$2,$3,'SUBPRODUCTE',$4,$5)`,
        [ctx.workspaceId, ctx.importId, row.id,
         `Subproducte «${productRaw}»: exclòs del catàleg de vi a granel per especificació`,
         JSON.stringify(v)],
      );
      await markRow(ctx, row.id, 'EXCLOSA', `subproducte ${productRaw}`);
      continue;
    }

    const guideDate = N.parseDate(col(v, H, cols.guideDate));
    if (!guideDate.value) {
      await markRow(ctx, row.id, 'REBUTJADA', `data de guia no interpretable: ${col(v, H, cols.guideDate) ?? '(buida)'}`);
      continue;
    }

    const match = await findProduct(ctx, productRaw);
    if (!match.productId) {
      ctx.stats.productsUnmapped.add(productRaw);
      await recordUnmapped(ctx, 'PRODUCTE', productRaw);
      // A purchase without a catalogue product cannot become an opportunity
      // (the grain requires a product), so instead of attaching it to an
      // invented product the whole row is parked with its reason. Nothing is
      // lost: adding the product or an alias and re-importing replays it.
      await ctx.db.query(
        `insert into public.excluded_records (workspace_id, import_id, import_row_id, module, reason, raw)
         values ($1,$2,$3,'PRODUCTE_NO_CATALOGAT',$4,$5)`,
        [ctx.workspaceId, ctx.importId, row.id,
         `${match.reason} — original: «${productRaw}»`, JSON.stringify(v)],
      );
      await markRow(ctx, row.id, 'EXCLOSA', `producte no catalogat: ${productRaw}`);
      continue;
    }
    const productId = match.productId;

    const resolved = await resolveClient(ctx, { name: clientName, importRowId: row.id });
    await addAlias(ctx, resolved.clientId, clientName, `${source.file} / ${spec.sheet}`);

    const campaignName = N.campaignForDate(guideDate.value);
    const campaignId = await findOrCreateCampaign(ctx, campaignName);
    const liters = N.parseLiters(col(v, H, cols.liters));

    // --- real purchase --------------------------------------------------
    const purchase = await one<{ id: string }>(
      ctx.db,
      `insert into public.opportunities
         (workspace_id, client_id, product_id, campaign_id, data_type, volume_liters, status, source, owner_id)
       values ($1,$2,$3,$4,'COMPRA REAL',$5,'GUANYADA',$6,$7)
       on conflict (client_id, product_id, campaign_id, data_type) where deleted_at is null
       do update set volume_liters = coalesce(public.opportunities.volume_liters, 0) + coalesce(excluded.volume_liters, 0)
       returning id`,
      [ctx.workspaceId, resolved.clientId, productId, campaignId, liters.value,
       `${source.file} / ${spec.sheet}`, ctx.ownerId],
    );
    if (!purchase) {
      await markRow(ctx, row.id, 'REBUTJADA', 'no s\'ha pogut registrar la compra');
      continue;
    }
    ctx.stats.opportunitiesCreated += 1;

    const guideNumber = col(v, H, cols.guideNumber)?.replace(/\.0$/, '') ?? null;
    const delivery = await ctx.db.query(
      `insert into public.opportunity_deliveries
         (workspace_id, opportunity_id, guide_number, guide_date, volume_liters, raw_product, source)
       values ($1,$2,$3,$4::date,$5,$6,$7)
       on conflict (opportunity_id, guide_number, raw_product, volume_liters) do nothing
       returning id`,
      [ctx.workspaceId, purchase.id, guideNumber, guideDate.value, liters.value,
       productRaw, `${source.file} / ${spec.sheet}`],
    );
    if (delivery.length > 0) ctx.stats.deliveriesCreated += 1;

    // --- next-campaign forecast ------------------------------------------
    const forecastRaw = col(v, H, cols.forecast);
    if (forecastRaw) {
      const forecastLiters = N.parseLiters(forecastRaw);
      const upper = forecastRaw.toUpperCase();
      let dataType: string | null = null;
      let forecastNext: string | null = null;
      let notes: string | null = null;

      if (forecastLiters.value !== null) {
        // A number in "PREVISIÓ 2026" is a confirmed forecast for next campaign.
        dataType = 'PREVISIO CONFIRMADA';
        forecastNext = 'REPETIR COMANDA';
      } else if (upper.includes('NO TENEN') || upper === 'PENDENT') {
        forecastNext = 'NO DETERMINAT';
        notes = `PREVISIÓ ORIGEN: ${forecastRaw}`;
      } else {
        forecastNext = 'ALTRES';
        notes = `PREVISIÓ ORIGEN: ${forecastRaw}`;
        await recordUnmapped(ctx, 'ALTRES', forecastRaw);
      }

      const nextCampaign = await findOrCreateCampaign(
        ctx,
        `${Number(campaignName.split('-')[1])}-${Number(campaignName.split('-')[1]) + 1}`,
      );
      if (dataType) {
        const created = await ctx.db.query(
          `insert into public.opportunities
             (workspace_id, client_id, product_id, campaign_id, data_type, volume_liters,
              forecast_next, status, notes, source, owner_id)
           values ($1,$2,$3,$4,'PREVISIO CONFIRMADA',$5,$6,'OBERTA',$7,$8,$9)
           on conflict (client_id, product_id, campaign_id, data_type) where deleted_at is null
           do nothing
           returning id`,
          [ctx.workspaceId, resolved.clientId, productId, nextCampaign, forecastLiters.value,
           forecastNext, notes, `${source.file} / ${spec.sheet}`, ctx.ownerId],
        );
        if (created.length > 0) ctx.stats.opportunitiesCreated += 1;
      } else {
        // No volume: record the intent on the purchase row rather than
        // inventing a forecast opportunity with a made-up quantity.
        await ctx.db.query(
          `update public.opportunities
              set forecast_next = $2::app.forecast_next,
                  notes = case when $3::text is null then notes
                               else coalesce(notes || ' | ', '') || $3 end
            where id = $1`,
          [purchase.id, forecastNext, notes],
        );
      }
    }

    await markRow(ctx, row.id, 'IMPORTADA', 'compra registrada',
      { client_id: resolved.clientId, opportunity_id: purchase.id });
  }
}

// ---------------------------------------------------------------------------
// Pass 5 — priority ordering (notes only, never a classification)
// ---------------------------------------------------------------------------

export async function importPriorityOrder(
  ctx: ImportContext,
  source: SourceSpec,
  staged: StagedSheet,
): Promise<void> {
  const { spec, data, rows } = staged;
  const H = data.headers;
  const cols = spec.columns ?? {};
  let rank = 0;

  for (const row of rows) {
    const name = col(row.values, H, cols.name);
    if (!name) {
      await markRow(ctx, row.id, 'REBUTJADA', 'fila buida');
      continue;
    }
    rank += 1;
    const nameNorm = await scalar<string>(ctx.db, 'select app.normalize_company($1)', [name]);
    const match = await one<{ id: string }>(
      ctx.db,
      `select c.id from public.clients c
        where c.workspace_id = $1 and c.deleted_at is null and c.name_norm = $2
        union all
       select a.client_id from public.client_aliases a
        where a.workspace_id = $1 and a.alias_norm = $2
        limit 1`,
      [ctx.workspaceId, nameNorm],
    );
    if (!match) {
      // A ranking entry alone is not evidence a company exists in our terms.
      await markRow(ctx, row.id, 'IGNORADA', 'ordre de potencial sense empresa coincident');
      continue;
    }
    await ctx.db.query(
      `update public.clients
          set general_notes = case
            when general_notes is null or btrim(general_notes) = '' then $2
            else general_notes || E'\n' || $2 end
        where id = $1 and (general_notes is null or position('ORDRE DE POTENCIAL' in general_notes) = 0)`,
      [match.id, `[${source.file}] ORDRE DE POTENCIAL (valoració manual): ${rank}`],
    );
    await markRow(ctx, row.id, 'IMPORTADA', `ordre de potencial ${rank}`, { client_id: match.id });
  }
}

// ---------------------------------------------------------------------------
// Pass 6 — accounting ledger and the certified-cava register (parsed PDFs)
// ---------------------------------------------------------------------------

export async function importLedgerJson(ctx: ImportContext): Promise<{ matched: number; unmatched: string[] }> {
  const file = path.join(SOURCE_DIR, 'parsed', 'clients_actius_accounts.json');
  const parsed = JSON.parse(await readFile(file, 'utf8')) as {
    sha256: string;
    accounts: {
      account_code: string; company_name: string;
      first_movement_date: string | null; last_movement_date: string | null;
      movement_count: number;
    }[];
  };

  const importFile = await one<{ id: string }>(
    ctx.db,
    `insert into public.import_files (import_id, filename, byte_size, sha256, mime_type, stored_path)
     values ($1,$2,$3,$4,'application/pdf',$5) returning id`,
    [ctx.importId, 'CLIENTS_ACTIUS.pdf', 0, parsed.sha256, 'data/sources/CLIENTS_ACTIUS.pdf'],
  );
  const sheet = await one<{ id: string }>(
    ctx.db,
    `insert into public.import_sheets (import_file_id, sheet_name, header_row, rows_total, rows_read, entity_hint)
     values ($1,'accounts',null,$2,$2,'LEDGER') returning id`,
    [importFile?.id, parsed.accounts.length],
  );
  ctx.stats.files += 1;
  ctx.stats.sheets += 1;

  let matched = 0;
  const unmatched: string[] = [];
  let rowNumber = 0;

  for (const account of parsed.accounts) {
    rowNumber += 1;
    ctx.stats.rowsRead += 1;
    const staged = await one<{ id: string }>(
      ctx.db,
      `insert into public.import_rows (import_id, import_sheet_id, row_number, raw)
       values ($1,$2,$3,$4) returning id`,
      [ctx.importId, sheet?.id, rowNumber, JSON.stringify(account)],
    );
    const rowId = staged?.id ?? '';

    if (NON_CUSTOMER_ACCOUNTS.has(account.account_code)) {
      await markRow(ctx, rowId, 'IGNORADA', 'compte intern, no és un client');
      continue;
    }

    const nameNorm = await scalar<string>(ctx.db, 'select app.normalize_company($1)', [account.company_name]);
    const hit = await one<{ id: string }>(
      ctx.db,
      `select c.id from public.clients c
        where c.workspace_id = $1 and c.deleted_at is null
          and (c.name_norm = $2 or c.external_account_code = $3)
        union all
       select a.client_id from public.client_aliases a
        where a.workspace_id = $1 and a.alias_norm = $2
        limit 1`,
      [ctx.workspaceId, nameNorm, account.account_code],
    );

    if (!hit) {
      // The ledger name is often truncated at the column width, so a miss here
      // is expected and is reported rather than turned into a new company.
      unmatched.push(`${account.account_code} · ${account.company_name}`);
      await markRow(ctx, rowId, 'IGNORADA', 'nom comptable sense empresa coincident (nom truncat a l\'origen)');
      continue;
    }

    matched += 1;
    await fillIfEmpty(ctx, hit.id, 'external_account_code', account.account_code);
    await addAlias(ctx, hit.id, account.company_name, 'CLIENTS_ACTIUS.pdf (comptabilitat)');

    // Movement in the accounting period is objective evidence the company is
    // trading. It updates the verification history, never the classification.
    if (account.last_movement_date) {
      const exists = await scalar<string>(
        ctx.db,
        `select id from public.client_verifications
          where client_id = $1 and source = 'CLIENTS_ACTIUS.pdf' limit 1`,
        [hit.id],
      );
      if (!exists) {
        await ctx.db.query(
          `insert into public.client_verifications
             (workspace_id, client_id, status, verified_at, source, note)
           values ($1,$2,'ACTIVA',$3::date,'CLIENTS_ACTIUS.pdf',$4)`,
          [ctx.workspaceId, hit.id, account.last_movement_date,
           `Compte ${account.account_code} amb moviment comptable fins ${account.last_movement_date} (${account.movement_count} apunts en el període).`],
        );
        ctx.stats.verificationsCreated += 1;
        await ctx.db.query(
          `update public.clients
              set verification_status = 'ACTIVA', last_verified_at = $2::date,
                  verification_source = 'CLIENTS_ACTIUS.pdf'
            where id = $1`,
          [hit.id, account.last_movement_date],
        );
      }
    }
    await markRow(ctx, rowId, 'IMPORTADA', 'compte comptable vinculat', { client_id: hit.id });
  }

  return { matched, unmatched };
}

export async function importCavaRegister(ctx: ImportContext): Promise<{ matched: number }> {
  const file = path.join(SOURCE_DIR, 'parsed', 'bodegues_cava_certificades.json');
  const parsed = JSON.parse(await readFile(file, 'utf8')) as {
    sha256: string;
    companies: { name: string; municipality: string | null; province: string | null }[];
  };

  const importFile = await one<{ id: string }>(
    ctx.db,
    `insert into public.import_files (import_id, filename, byte_size, sha256, mime_type, stored_path)
     values ($1,$2,0,$3,'application/pdf',$4) returning id`,
    [ctx.importId, 'Listado_de_Bodegas_Elaboradoras_de_Cava_Certificadas.pdf', parsed.sha256,
     'data/sources/Listado_de_Bodegas_Elaboradoras_de_Cava_Certificadas.pdf'],
  );
  const sheet = await one<{ id: string }>(
    ctx.db,
    `insert into public.import_sheets (import_file_id, sheet_name, header_row, rows_total, rows_read, entity_hint)
     values ($1,'companies',null,$2,$2,'PUBLIC_DIRECTORY') returning id`,
    [importFile?.id, parsed.companies.length],
  );
  ctx.stats.files += 1;
  ctx.stats.sheets += 1;

  let matched = 0;
  let rowNumber = 0;
  for (const company of parsed.companies) {
    rowNumber += 1;
    ctx.stats.rowsRead += 1;
    const staged = await one<{ id: string }>(
      ctx.db,
      `insert into public.import_rows (import_id, import_sheet_id, row_number, raw)
       values ($1,$2,$3,$4) returning id`,
      [ctx.importId, sheet?.id, rowNumber, JSON.stringify(company)],
    );
    const rowId = staged?.id ?? '';

    const nameNorm = await scalar<string>(ctx.db, 'select app.normalize_company($1)', [company.name]);
    const hit = await one<{ id: string }>(
      ctx.db,
      `select c.id from public.clients c
        where c.workspace_id = $1 and c.deleted_at is null and c.name_norm = $2
        union all
       select a.client_id from public.client_aliases a
        where a.workspace_id = $1 and a.alias_norm = $2
        limit 1`,
      [ctx.workspaceId, nameNorm],
    );
    if (!hit) {
      // Being on a public register is not, by itself, a commercial fact.
      // Unmatched entries are reported, not turned into companies.
      await markRow(ctx, rowId, 'IGNORADA', 'celler certificat sense empresa coincident al CRM');
      continue;
    }
    matched += 1;
    await ctx.db.query(`update public.clients set do_cava = true where id = $1`, [hit.id]);
    await addAlias(ctx, hit.id, company.name, 'Registre oficial de cellers de cava');
    if (company.municipality) await fillIfEmpty(ctx, hit.id, 'municipality', company.municipality);
    await markRow(ctx, rowId, 'IMPORTADA', 'DO CAVA confirmada per registre oficial', { client_id: hit.id });
  }
  return { matched };
}

export type { StagedSheet };
