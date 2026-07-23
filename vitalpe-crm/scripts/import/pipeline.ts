/**
 * The import pipeline.
 *
 * Order matters. Companies are resolved from the most trustworthy source first
 * (the master list), then enriched by the public directories, then the sales
 * ledger attaches purchases. Nothing is ever overwritten by a lower-trust
 * source, no ambiguous pair is merged, and every stored value keeps a pointer
 * back to the file/sheet/row/column it came from.
 *
 *   staging -> normalisation -> resolution -> dedupe queue -> apply -> report
 */
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { SqlRunner } from './db.js';
import { one, scalar } from './db.js';
import { readWorkbook, type SheetData } from './xlsx.js';
import {
  SOURCES,
  NON_CUSTOMER_ACCOUNTS,
  findHeader,
  isBagInBox,
  type SheetSpec,
  type SourceSpec,
} from './sources.js';
import * as N from './normalize.js';
import {
  buildCatalogueIndex,
  matchProduct,
  parseProduct,
  type CatalogueEntry,
  type MatchResult,
} from './products.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
export const SOURCE_DIR = path.join(ROOT, 'data', 'sources');
const PARSED_DIR = path.join(SOURCE_DIR, 'parsed');

export interface ImportContext {
  db: SqlRunner;
  workspaceId: string;
  importId: string;
  ownerId: string | null;
  /** Companies resolved so far, keyed by normalised name. */
  resolved: Map<string, string>;
  stats: Stats;
  provenanceBuffer: ProvenanceRow[];
}

export interface Stats {
  files: number;
  sheets: number;
  rowsRead: number;
  rowsImported: number;
  rowsIgnored: number;
  rowsRejected: number;
  rowsExcluded: number;
  rowsDuplicate: number;
  clientsCreated: number;
  clientsUpdated: number;
  aliasesCreated: number;
  contactsCreated: number;
  locationsCreated: number;
  opportunitiesCreated: number;
  deliveriesCreated: number;
  activitiesCreated: number;
  tasksCreated: number;
  verificationsCreated: number;
  duplicateCandidates: number;
  bagInBoxExcluded: number;
  unmappedValues: number;
  productsUnmapped: Set<string>;
  campaignsUnmapped: Set<string>;
}

interface ProvenanceRow {
  entity: string;
  entityId: string;
  field: string;
  original: string | null;
  normalized: string | null;
  rowId: string | null;
  file: string;
  sheet: string;
  row: number;
  column: string | null;
  rule: string;
}

export function emptyStats(): Stats {
  return {
    files: 0, sheets: 0, rowsRead: 0, rowsImported: 0, rowsIgnored: 0,
    rowsRejected: 0, rowsExcluded: 0, rowsDuplicate: 0,
    clientsCreated: 0, clientsUpdated: 0, aliasesCreated: 0, contactsCreated: 0,
    locationsCreated: 0, opportunitiesCreated: 0, deliveriesCreated: 0,
    activitiesCreated: 0, tasksCreated: 0, verificationsCreated: 0,
    duplicateCandidates: 0, bagInBoxExcluded: 0, unmappedValues: 0,
    productsUnmapped: new Set(), campaignsUnmapped: new Set(),
  };
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function get(row: Record<string, string | null>, headers: string[], names: string[] | undefined): string | null {
  const header = findHeader(headers, names);
  return header ? (row[header] ?? null) : null;
}

function headerName(headers: string[], names: string[] | undefined): string | null {
  return findHeader(headers, names);
}

async function recordUnmapped(
  ctx: ImportContext,
  kind: string,
  raw: string,
): Promise<void> {
  await ctx.db.query(
    `insert into public.unmapped_values (workspace_id, import_id, kind, raw_value)
     values ($1, $2, $3, $4)
     on conflict (workspace_id, kind, raw_value)
     do update set occurrences = public.unmapped_values.occurrences + 1`,
    [ctx.workspaceId, ctx.importId, kind, raw],
  );
  ctx.stats.unmappedValues += 1;
}

function prov(
  ctx: ImportContext,
  entry: Omit<ProvenanceRow, 'entity' | 'entityId'> & { entity: string; entityId: string },
): void {
  if (entry.original === null && entry.normalized === null) return;
  ctx.provenanceBuffer.push(entry);
}

export async function flushProvenance(ctx: ImportContext): Promise<void> {
  const buffer = ctx.provenanceBuffer;
  if (buffer.length === 0) return;
  const CHUNK = 200;
  for (let i = 0; i < buffer.length; i += CHUNK) {
    const chunk = buffer.slice(i, i + CHUNK);
    const values: unknown[] = [];
    const tuples = chunk.map((p, idx) => {
      const base = idx * 12;
      values.push(
        ctx.workspaceId, p.entity, p.entityId, p.field, p.original, p.normalized,
        ctx.importId, p.rowId, p.file, p.sheet, p.row, p.column,
      );
      return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10}, $${base + 11}, $${base + 12})`;
    });
    await ctx.db.query(
      `insert into public.field_provenance
         (workspace_id, entity, entity_id, field, original_value, normalized_value,
          import_id, import_row_id, source_file, source_sheet, source_row, source_column)
       values ${tuples.join(', ')}`,
      values,
    );
  }
  // rule_applied is set in a second pass to keep the tuple list readable.
  ctx.provenanceBuffer = [];
}

// ---------------------------------------------------------------------------
// Company resolution
// ---------------------------------------------------------------------------

export interface ResolveInput {
  name: string;
  email?: string | null;
  phone?: string | null;
  website?: string | null;
  taxId?: string | null;
  municipality?: string | null;
  province?: string | null;
  importRowId?: string | null;
}

export interface ResolveResult {
  clientId: string;
  created: boolean;
  /** A doubtful near-match was found and queued for human review. */
  queuedDuplicate: boolean;
}

/**
 * Finds the canonical company for a source row, or creates it.
 *
 * Deterministic identity (tax id, corporate e-mail + name, phone + name) links
 * to the existing row. A merely *similar* name creates a new company AND a
 * review-queue entry — never a silent merge.
 */
export async function resolveClient(ctx: ImportContext, input: ResolveInput): Promise<ResolveResult> {
  const nameNorm = await scalar<string>(ctx.db, 'select app.normalize_company($1)', [input.name]);
  if (!nameNorm) {
    throw new Error(`Nom d'empresa buit després de normalitzar: «${input.name}»`);
  }

  const cached = ctx.resolved.get(nameNorm);
  if (cached) return { clientId: cached, created: false, queuedDuplicate: false };

  // 1. Exact canonical name, or a known alias of another company.
  const exact = await one<{ id: string }>(
    ctx.db,
    `select c.id from public.clients c
      where c.workspace_id = $1 and c.deleted_at is null and c.name_norm = $2
      union all
     select a.client_id from public.client_aliases a
      join public.clients c2 on c2.id = a.client_id and c2.deleted_at is null
      where a.workspace_id = $1 and a.alias_norm = $2
      limit 1`,
    [ctx.workspaceId, nameNorm],
  );
  if (exact) {
    ctx.resolved.set(nameNorm, exact.id);
    return { clientId: exact.id, created: false, queuedDuplicate: false };
  }

  // 2. Deterministic identity signals.
  const deterministic = await one<{ id: string; signal: string }>(
    ctx.db,
    `with candidate as (
       select $2::text as email, $3::text as phone, $4::text as tax
     )
     select c.id,
            case
              when c.tax_id_norm is not null and c.tax_id_norm = app.normalize_text(cd.tax) then 'tax_id'
              when ct.email is not null and ct.email = app.normalize_email(cd.email)
                   and not app.is_generic_email_domain(app.domain_of_email(cd.email)) then 'email_corporatiu'
              else 'telefon'
            end as signal
       from public.clients c
       cross join candidate cd
       left join public.contacts ct on ct.client_id = c.id and ct.deleted_at is null
      where c.workspace_id = $1
        and c.deleted_at is null
        and (
          (cd.tax is not null and c.tax_id_norm = app.normalize_text(cd.tax))
          or (cd.email is not null
              and not app.is_generic_email_domain(app.domain_of_email(cd.email))
              and ct.email = app.normalize_email(cd.email))
          or (cd.phone is not null and ct.phone = app.normalize_phone(cd.phone))
        )
      limit 1`,
    [ctx.workspaceId, input.email ?? null, input.phone ?? null, input.taxId ?? null],
  );

  // A deterministic signal only auto-links when the names are also compatible;
  // one shared switchboard number must not merge two different wineries.
  if (deterministic) {
    const compatible = await scalar<boolean>(
      ctx.db,
      `select (c.name_norm = $2) or similarity(c.name_norm, $2) > 0.55
         from public.clients c where c.id = $1`,
      [deterministic.id, nameNorm],
    );
    if (compatible) {
      await addAlias(ctx, deterministic.id, input.name, `identitat: ${deterministic.signal}`);
      ctx.resolved.set(nameNorm, deterministic.id);
      return { clientId: deterministic.id, created: false, queuedDuplicate: false };
    }
  }

  // 3. Fuzzy near-matches -> new company + review queue.
  const near = await ctx.db.query<{ id: string; name: string; score: number }>(
    `select c.id, c.name, similarity(c.name_norm, $2)::float as score
       from public.clients c
      where c.workspace_id = $1 and c.deleted_at is null
        and c.name_norm % $2
      order by score desc
      limit 3`,
    [ctx.workspaceId, nameNorm],
  );

  const clientId = await createClient(ctx, input);
  let queued = false;
  for (const candidate of near) {
    if (candidate.score < 0.45) continue;
    await ctx.db.query(
      `insert into public.duplicate_candidates
         (workspace_id, import_id, left_client_id, right_client_id, candidate_name,
          import_row_id, score, signals, is_deterministic, decision)
       values ($1, $2, $3, $4, $5, $6, $7, $8, false, 'PENDENT')`,
      [
        ctx.workspaceId, ctx.importId, candidate.id, clientId, input.name,
        input.importRowId ?? null, Math.min(0.999, candidate.score),
        JSON.stringify({
          nom_similar: true,
          score: candidate.score,
          existent: candidate.name,
          nou: input.name,
          mateixa_poblacio: false,
        }),
      ],
    );
    ctx.stats.duplicateCandidates += 1;
    queued = true;
  }

  ctx.resolved.set(nameNorm, clientId);
  return { clientId, created: true, queuedDuplicate: queued };
}

async function createClient(ctx: ImportContext, input: ResolveInput): Promise<string> {
  const row = await one<{ id: string }>(
    ctx.db,
    `insert into public.clients (workspace_id, name, municipality, province, website, tax_id, owner_id)
     values ($1, $2, $3, $4, $5, $6, $7)
     returning id`,
    [
      ctx.workspaceId, input.name, input.municipality ?? null, input.province ?? null,
      input.website ?? null, input.taxId ?? null, ctx.ownerId,
    ],
  );
  if (!row) throw new Error(`No s'ha pogut crear l'empresa «${input.name}»`);
  ctx.stats.clientsCreated += 1;
  return row.id;
}

export async function addAlias(
  ctx: ImportContext,
  clientId: string,
  alias: string,
  source: string,
): Promise<void> {
  const res = await ctx.db.query(
    `insert into public.client_aliases (workspace_id, client_id, alias, source)
     values ($1, $2, $3, $4)
     on conflict (client_id, alias_norm) do nothing
     returning id`,
    [ctx.workspaceId, clientId, alias, source],
  );
  if (res.length > 0) ctx.stats.aliasesCreated += 1;
}

/**
 * Fills a client column only when it is still empty. A lower-trust source can
 * add information but can never overwrite what a better source already stored.
 */
async function fillIfEmpty(
  ctx: ImportContext,
  clientId: string,
  column: string,
  value: unknown,
): Promise<boolean> {
  if (value === null || value === undefined || value === '') return false;
  const updated = await ctx.db.query(
    `update public.clients set ${column} = $2
      where id = $1 and (${column} is null ${typeof value === 'string' ? `or btrim(${column}::text) = ''` : ''})
      returning id`,
    [clientId, value],
  );
  if (updated.length > 0) {
    ctx.stats.clientsUpdated += 1;
    return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Contacts / locations
// ---------------------------------------------------------------------------

async function upsertContact(
  ctx: ImportContext,
  clientId: string,
  data: {
    firstName?: string | null; lastName?: string | null; role?: string | null;
    phone?: string | null; email?: string | null; type: 'GENERAL' | 'DIRECTE';
    primary: boolean; source: string; notes?: string | null;
  },
): Promise<string | null> {
  const hasIdentity = [data.firstName, data.lastName, data.email, data.phone].some(
    (v) => v !== null && v !== undefined && String(v).trim() !== '',
  );
  if (!hasIdentity) return null;

  const existing = await one<{ id: string }>(
    ctx.db,
    `select id from public.contacts
      where client_id = $1 and deleted_at is null
        and (
          ($2::text is not null and email = app.normalize_email($2))
          or ($3::text is not null and phone = app.normalize_phone($3))
          or ($4::text is not null and app.normalize_text(coalesce(first_name,'') || ' ' || coalesce(last_name,'')) = app.normalize_text($4))
        )
      limit 1`,
    [clientId, data.email ?? null, data.phone ?? null,
     `${data.firstName ?? ''} ${data.lastName ?? ''}`.trim() || null],
  );
  if (existing) {
    // Enrich without clobbering.
    await ctx.db.query(
      `update public.contacts
          set phone_original = coalesce(phone_original, $2),
              email_original = coalesce(email_original, $3),
              role_title = coalesce(role_title, $4),
              first_name = coalesce(first_name, $5),
              last_name = coalesce(last_name, $6)
        where id = $1`,
      [existing.id, data.phone ?? null, data.email ?? null, data.role ?? null,
       data.firstName ?? null, data.lastName ?? null],
    );
    return existing.id;
  }

  // Only one primary contact may be active at a time.
  let primary = data.primary;
  if (primary) {
    const alreadyPrimary = await scalar<string>(
      ctx.db,
      `select id from public.contacts
        where client_id = $1 and is_primary and is_active and deleted_at is null limit 1`,
      [clientId],
    );
    if (alreadyPrimary) primary = false;
  }

  const row = await one<{ id: string }>(
    ctx.db,
    `insert into public.contacts
       (workspace_id, client_id, first_name, last_name, role_title,
        phone_original, email_original, contact_type, is_primary, notes, source)
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     returning id`,
    [
      ctx.workspaceId, clientId, data.firstName ?? null, data.lastName ?? null, data.role ?? null,
      data.phone ?? null, data.email ?? null, data.type, primary, data.notes ?? null, data.source,
    ],
  );
  if (row) ctx.stats.contactsCreated += 1;
  return row?.id ?? null;
}

async function upsertLocation(
  ctx: ImportContext,
  clientId: string,
  data: {
    street?: string | null; postalCode?: string | null; municipality?: string | null;
    province?: string | null; country?: string | null; source: string;
  },
): Promise<string | null> {
  const meaningful = [data.street, data.postalCode, data.municipality].some(
    (v) => v !== null && v !== undefined && String(v).trim() !== '',
  );
  if (!meaningful) return null;

  const existing = await one<{ id: string }>(
    ctx.db,
    `select id from public.client_locations
      where client_id = $1 and deleted_at is null
        and coalesce(app.normalize_text(street), '') = coalesce(app.normalize_text($2), '')
        and coalesce(app.normalize_text(municipality), '') = coalesce(app.normalize_text($3), '')
      limit 1`,
    [clientId, data.street ?? null, data.municipality ?? null],
  );
  if (existing) return existing.id;

  const isFirst = (await scalar<string>(
    ctx.db,
    `select id from public.client_locations where client_id = $1 and deleted_at is null limit 1`,
    [clientId],
  )) === null;

  const formatted = [data.street, data.postalCode, data.municipality, data.province]
    .filter((p) => p && String(p).trim() !== '')
    .join(', ');

  const row = await one<{ id: string }>(
    ctx.db,
    `insert into public.client_locations
       (workspace_id, client_id, name, location_type, street, postal_code, municipality,
        province, country, formatted_address, is_primary, notes)
     values ($1,$2,'SEU','SEU',$3,$4,$5,$6,coalesce($7,'ES'),$8,$9,$10)
     returning id`,
    [
      ctx.workspaceId, clientId, data.street ?? null, data.postalCode ?? null,
      data.municipality ?? null, data.province ?? null, data.country ?? null,
      formatted || null, isFirst,
      // Coordinates are never invented: the location starts un-geocoded.
      'PENDENT DE GEOLOCALITZAR',
    ],
  );
  if (row) ctx.stats.locationsCreated += 1;
  return row?.id ?? null;
}

// ---------------------------------------------------------------------------
// Catalogue lookups
// ---------------------------------------------------------------------------

const productCache = new Map<string, MatchResult>();
let catalogueIndex: Map<string, CatalogueEntry> | null = null;

async function catalogue(ctx: ImportContext): Promise<Map<string, CatalogueEntry>> {
  if (catalogueIndex) return catalogueIndex;
  const products = await ctx.db.query<{ id: string; name: string }>(
    `select id, name from public.products where deleted_at is null order by sort_order`,
  );
  const { index, unparsed } = buildCatalogueIndex(products);
  if (unparsed.length > 0) {
    // A catalogue entry the parser cannot read is a bug in the parser, not in
    // the data: fail loudly rather than silently matching fewer products.
    throw new Error(`Productes del catàleg no interpretables: ${unparsed.join(' | ')}`);
  }
  catalogueIndex = index;
  return index;
}

/**
 * Catalogue product for a raw delivery-note string.
 * Exact alias first (curated overrides), then the facet parser.
 */
export async function findProduct(ctx: ImportContext, raw: string): Promise<MatchResult> {
  const key = raw.toLowerCase().trim();
  const cached = productCache.get(key);
  if (cached) return cached;

  const alias = await one<{ id: string; name: string }>(
    ctx.db,
    `select p.id, p.name from public.products p
      where p.deleted_at is null and p.name_norm = app.normalize_text($1)
      union all
     select p2.id, p2.name from public.product_aliases pa
      join public.products p2 on p2.id = pa.product_id
      where pa.alias_norm = app.normalize_text($1)
      limit 1`,
    [raw],
  );

  const result: MatchResult = alias
    ? { productId: alias.id, productName: alias.name, facets: parseProduct(raw), reason: 'àlies exacte' }
    : matchProduct(raw, await catalogue(ctx));

  productCache.set(key, result);
  return result;
}

const campaignCache = new Map<string, string>();

export async function findOrCreateCampaign(ctx: ImportContext, name: string): Promise<string> {
  const cached = campaignCache.get(name);
  if (cached) return cached;
  const existing = await one<{ id: string }>(
    ctx.db,
    `select id from public.campaigns where name_norm = app.normalize_text($1)`,
    [name],
  );
  if (existing) {
    campaignCache.set(name, existing.id);
    return existing.id;
  }
  const [start, end] = name.split('-').map(Number);
  const created = await one<{ id: string }>(
    ctx.db,
    `insert into public.campaigns (name, year_start, year_end, status)
     values ($1, $2, $3, 'TANCADA') returning id`,
    [name, start, end],
  );
  if (!created) throw new Error(`No s'ha pogut crear la campanya ${name}`);
  campaignCache.set(name, created.id);
  return created.id;
}

export { get, headerName, prov, recordUnmapped, fillIfEmpty, upsertContact, upsertLocation };
export type { SheetData, SheetSpec, SourceSpec };
export { SOURCES, NON_CUSTOMER_ACCOUNTS, isBagInBox, N, PARSED_DIR, readWorkbook, readFile };
