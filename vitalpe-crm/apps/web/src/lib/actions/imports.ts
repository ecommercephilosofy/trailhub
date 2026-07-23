'use server';

import path from 'node:path';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { query, requireSession, type Session } from '@/lib/auth';
import { backendKind, friendlyError } from '@/lib/db';
import { elevated, field, ONLY_ADMIN, type ActionResult } from '@/components/admin/service';
import type { SqlRunner } from '../../../../../scripts/import/db';
import { readWorkbook } from '../../../../../scripts/import/xlsx';
import { SOURCES, findHeader, type SheetKind, type SheetSpec, type SourceSpec }
  from '../../../../../scripts/import/sources';
import { SOURCE_DIR, emptyStats, flushProvenance, type ImportContext }
  from '../../../../../scripts/import/pipeline';
import {
  importClientSheet,
  importExportContacts,
  importPriorityOrder,
  importPublicDirectory,
  importSalesSheet,
  stageWorkbook,
} from '../../../../../scripts/import/passes';

/**
 * The reusable importer, driven from the browser.
 *
 * This does not reimplement the import: it is the same `scripts/import`
 * pipeline that produced the current database, called with a `SourceSpec` that
 * the mapping screen builds instead of one hardcoded in `sources.ts`. The
 * column mapping the user picks *is* a `SheetSpec.columns`, which is why the
 * passes run unmodified.
 *
 * Every statement runs through the service role (the staging tables have no
 * write policy for `authenticated`) inside one transaction, so SIMULACIÓ is
 * simply the same run ended with a rollback — see `DryRun` below.
 */

const UPLOAD_DIRNAME = 'uploads';
const TOKEN_RE = /^[a-f0-9]{16}-[A-Za-z0-9._ +()-]+\.(xlsx|xlsm|xls)$/;
const MAX_BYTES = 900_000; // Server Actions accept 1 MB of body by default.

/** The workspace root, two levels above apps/web. */
function repoRoot(): string {
  return path.resolve(process.cwd(), '../..');
}

function uploadDir(): string {
  return path.join(repoRoot(), 'data', UPLOAD_DIRNAME);
}

/**
 * `stageWorkbook` resolves its path as `join(SOURCE_DIR, spec.file)`, and
 * SOURCE_DIR is derived from `import.meta.url` — which moves once the module is
 * bundled. Expressing the upload as a path *relative to whatever SOURCE_DIR is
 * at runtime* makes the join exact wherever the code ends up living.
 */
function specFileFor(absolutePath: string): string {
  return path.relative(SOURCE_DIR, absolutePath);
}

function resolveToken(token: string): string | null {
  if (!TOKEN_RE.test(token)) return null;
  const full = path.join(uploadDir(), token);
  return path.dirname(full) === uploadDir() ? full : null;
}

function resolveSourceName(name: string): string | null {
  if (!/^[A-Za-z0-9._ +()-]+\.(xlsx|xlsm|xls)$/.test(name)) return null;
  const full = path.join(SOURCE_DIR, name);
  return path.dirname(full) === SOURCE_DIR ? full : null;
}

// ---------------------------------------------------------------------------
// Inspection
// ---------------------------------------------------------------------------

export interface SheetInspection {
  name: string;
  headerRow: number | null;
  headers: string[];
  rowsTotal: number;
  rowsUsable: number;
  preview: (string | null)[][];
  /** Best guess of what the sheet holds, from the headers it carries. */
  suggestedKind: SheetKind;
  /** Auto-mapping proposal: CRM field -> detected header. */
  suggestedColumns: Record<string, string>;
}

export interface Inspection {
  token: string;
  filename: string;
  byteSize: number;
  sha256: string;
  sheets: SheetInspection[];
  /** A previous, still-applied import of the very same bytes. */
  previous: { id: string; label: string; finished_at: string | null } | null;
}

/**
 * Field catalogue per sheet kind, derived from the source registry so the
 * screen offers exactly the fields the passes actually read.
 */
function fieldsForKind(kind: SheetKind): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const source of SOURCES) {
    for (const sheet of source.sheets) {
      if (sheet.kind !== kind || !sheet.columns) continue;
      for (const [fieldName, headers] of Object.entries(sheet.columns)) {
        const seen = merged[fieldName] ?? [];
        merged[fieldName] = [...new Set([...seen, ...headers])];
      }
    }
  }
  return merged;
}

const REQUIRED_FIELDS: Record<SheetKind, string[]> = {
  CLIENTS: ['name'],
  SALES: ['client', 'product'],
  CONTACTS_EXPORT: ['name'],
  PUBLIC_DIRECTORY: ['name'],
  PRIORITY_ORDER: ['name'],
  REFERENCE: [],
  LEDGER: [],
};

export interface KindDescriptor {
  kind: SheetKind;
  label: string;
  description: string;
  fields: { name: string; headers: string[]; required: boolean }[];
}

const KIND_LABELS: Record<SheetKind, { label: string; description: string }> = {
  CLIENTS: {
    label: 'EMPRESES',
    description: 'Una empresa per fila. Crea o enriqueix la fitxa, els contactes, la ubicació i les tasques amb data.',
  },
  SALES: {
    label: 'ALBARANS I VENDES',
    description: 'Una línia d’albarà per fila. Genera compres reals, previsions i albarans; Bag in Box i subproductes queden exclosos.',
  },
  CONTACTS_EXPORT: {
    label: 'LLISTAT D’EXPORTACIÓ',
    description: 'Contactes internacionals sense data. Mai crea historial datat.',
  },
  PUBLIC_DIRECTORY: {
    label: 'DIRECTORI PÚBLIC',
    description: 'Només enriqueix: omple buits i registra la verificació pública. Crea empresa només si no hi ha coincidència.',
  },
  PRIORITY_ORDER: {
    label: 'ORDRE DE POTENCIAL',
    description: 'Només ordre. Es desa com a nota i no toca mai la classificació.',
  },
  REFERENCE: {
    label: 'REFERÈNCIA (NO IMPORTAR)',
    description: 'Full de llistes o resums. Les seves files es marquen IGNORADES i queden comptabilitzades.',
  },
  LEDGER: { label: 'EXTRACTE COMPTABLE', description: 'No disponible des del navegador.' },
};

export async function describeKinds(): Promise<KindDescriptor[]> {
  const kinds: SheetKind[] = [
    'CLIENTS',
    'SALES',
    'CONTACTS_EXPORT',
    'PUBLIC_DIRECTORY',
    'PRIORITY_ORDER',
    'REFERENCE',
  ];
  return kinds.map((kind) => {
    const fields = fieldsForKind(kind);
    return {
      kind,
      label: KIND_LABELS[kind].label,
      description: KIND_LABELS[kind].description,
      fields: Object.entries(fields).map(([name, headers]) => ({
        name,
        headers,
        required: REQUIRED_FIELDS[kind].includes(name),
      })),
    };
  });
}

function guessKind(headers: string[]): SheetKind {
  const lower = headers.map((h) => h.toLowerCase());
  if (lower.some((h) => h.includes('guia')) || lower.includes('litres')) return 'SALES';
  if (lower.includes('e-mail enviado')) return 'CONTACTS_EXPORT';
  if (headers.length <= 2) return 'PRIORITY_ORDER';
  if (lower.some((h) => ['empresa', 'celler', 'client', 'celler / marca'].includes(h))) return 'CLIENTS';
  return 'REFERENCE';
}

function suggestColumns(kind: SheetKind, headers: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [fieldName, candidates] of Object.entries(fieldsForKind(kind))) {
    const hit = findHeader(headers, candidates);
    if (hit) out[fieldName] = hit;
  }
  return out;
}

async function inspectPath(
  token: string,
  absolutePath: string,
  forced?: { sheet: string; headerRow: number },
): Promise<Inspection> {
  const workbook = await readWorkbook(
    absolutePath,
    forced ? { headerRow: forced.headerRow } : {},
  );
  const info = await stat(absolutePath);
  const sha256 = createHash('sha256').update(await readFile(absolutePath)).digest('hex');

  return {
    token,
    filename: workbook.filename,
    byteSize: info.size,
    sha256,
    previous: null,
    sheets: workbook.sheets.map((s) => {
      const usable = s.rows.filter((r) => !r.isEmpty);
      const kind = guessKind(s.headers);
      return {
        name: s.sheetName,
        headerRow: s.headerRow,
        headers: s.headers,
        rowsTotal: s.totalRows,
        rowsUsable: usable.length,
        preview: usable.slice(0, 8).map((r) => s.headers.map((h) => r.values[h] ?? null)),
        suggestedKind: kind,
        suggestedColumns: suggestColumns(kind, s.headers),
      };
    }),
  };
}

async function attachPrevious(inspection: Inspection, session: Session): Promise<Inspection> {
  const previous = await query(session, (q) =>
    q.one<{ id: string; label: string; finished_at: string | null }>(
      `select i.id, i.label, i.finished_at
         from public.import_files f
         join public.imports i on i.id = f.import_id
        where f.sha256 = $1 and i.workspace_id = $2 and i.undone_at is null and i.status = 'APLICAT'
        order by i.finished_at desc nulls last limit 1`,
      [inspection.sha256, session.workspaceId],
    ),
  );
  return { ...inspection, previous };
}

export async function listSourceFiles(): Promise<ActionResult<string[]>> {
  const session = await requireSession();
  if (session.role !== 'ADMIN') return { ok: false, error: 'Només un ADMIN pot importar.' };
  try {
    const entries = await readdir(SOURCE_DIR).catch(() => []);
    return { ok: true, data: entries.filter((f) => /\.(xlsx|xlsm|xls)$/i.test(f)).sort() };
  } catch {
    return { ok: true, data: [] };
  }
}

/** Inspects a file that already lives in `data/sources/`, without re-uploading. */
export async function inspectSourceFile(formData: FormData): Promise<ActionResult<Inspection>> {
  const session = await requireSession();
  if (session.role !== 'ADMIN') return { ok: false, error: 'Només un ADMIN pot importar.' };
  const name = field(formData, 'name') ?? '';
  const full = resolveSourceName(name);
  if (!full) return { ok: false, error: 'Fitxer no vàlid.' };
  try {
    const inspection = await inspectPath(`::font::${name}`, full);
    return { ok: true, data: await attachPrevious(inspection, session) };
  } catch (error) {
    return { ok: false, error: `No s’ha pogut llegir el fitxer: ${(error as Error).message}` };
  }
}

export async function uploadImportFile(formData: FormData): Promise<ActionResult<Inspection>> {
  const session = await requireSession();
  if (session.role !== 'ADMIN') return { ok: false, error: 'Només un ADMIN pot importar.' };

  const file = formData.get('file');
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: 'Cal adjuntar un fitxer.' };
  if (!/\.(xlsx|xlsm|xls)$/i.test(file.name)) {
    return { ok: false, error: 'Només s’accepten fulls de càlcul .xlsx, .xlsm o .xls.' };
  }
  if (file.size > MAX_BYTES) {
    return {
      ok: false,
      error: `El fitxer fa ${Math.round(file.size / 1024)} kB i el límit de pujada és ${Math.round(MAX_BYTES / 1024)} kB. Deixa’l a data/sources/ i tria’l a la llista de fitxers ja presents.`,
    };
  }

  try {
    const bytes = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash('sha256').update(bytes).digest('hex');
    const safeName = file.name.replace(/[^A-Za-z0-9._ +()-]/g, '_');
    const token = `${sha256.slice(0, 16)}-${safeName}`;
    const full = resolveToken(token);
    if (!full) return { ok: false, error: 'Nom de fitxer no admès.' };
    await mkdir(uploadDir(), { recursive: true });
    await writeFile(full, bytes);

    const inspection = await inspectPath(token, full);
    return { ok: true, data: await attachPrevious(inspection, session) };
  } catch (error) {
    return { ok: false, error: `No s’ha pogut llegir el full de càlcul: ${(error as Error).message}` };
  }
}

/** Re-reads one sheet with a header row chosen by hand. */
export async function inspectSheet(formData: FormData): Promise<ActionResult<SheetInspection>> {
  const session = await requireSession();
  if (session.role !== 'ADMIN') return { ok: false, error: 'Només un ADMIN pot importar.' };
  const token = field(formData, 'token') ?? '';
  const sheet = field(formData, 'sheet') ?? '';
  const headerRow = Number(field(formData, 'headerRow') ?? '0');
  const full = token.startsWith('::font::')
    ? resolveSourceName(token.slice('::font::'.length))
    : resolveToken(token);
  if (!full) return { ok: false, error: 'Fitxer no vàlid.' };
  if (!Number.isInteger(headerRow) || headerRow < 1 || headerRow > 200) {
    return { ok: false, error: 'La fila de capçalera ha de ser un número entre 1 i 200.' };
  }
  try {
    const inspection = await inspectPath(token, full, { sheet, headerRow });
    const found = inspection.sheets.find((s) => s.name === sheet);
    if (!found) return { ok: false, error: 'Aquest full ja no existeix al fitxer.' };
    return { ok: true, data: found };
  } catch (error) {
    return { ok: false, error: `No s’ha pogut rellegir el full: ${(error as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Mapping templates
// ---------------------------------------------------------------------------

export async function saveMappingTemplate(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (session.role !== 'ADMIN') return { ok: false, error: 'Només un ADMIN pot desar plantilles.' };
  const name = field(formData, 'name');
  const sheetPattern = field(formData, 'sheetPattern');
  const mapping = field(formData, 'mapping');
  if (!name || !mapping) return { ok: false, error: 'Cal un nom i un mapatge.' };
  try {
    JSON.parse(mapping);
  } catch {
    return { ok: false, error: 'El mapatge no és un JSON vàlid.' };
  }
  try {
    await query(session, (q) =>
      q.run(
        `insert into public.import_mappings (workspace_id, name, sheet_pattern, mapping, created_by)
         values ($1, $2, $3, $4::jsonb, $5)
         on conflict (workspace_id, name)
         do update set sheet_pattern = excluded.sheet_pattern, mapping = excluded.mapping, updated_at = now()`,
        [session.workspaceId, name, sheetPattern, mapping, session.userId],
      ),
    );
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath('/administracio/importacions');
  return { ok: true };
}

export async function deleteMappingTemplate(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (session.role !== 'ADMIN') return { ok: false, error: 'Només un ADMIN pot esborrar plantilles.' };
  const id = field(formData, 'id');
  if (!id) return { ok: false, error: 'Falta la plantilla.' };
  try {
    await query(session, (q) =>
      q.run(`delete from public.import_mappings where id = $1 and workspace_id = $2`, [
        id,
        session.workspaceId,
      ]),
    );
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath('/administracio/importacions');
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export interface PlannedSheet {
  sheet: string;
  headerRow: number | null;
  kind: SheetKind;
  columns: Record<string, string>;
}

export interface RunOutcome {
  simulated: boolean;
  importId: string | null;
  label: string;
  stats: Record<string, number>;
  reconciled: boolean;
  duplicates: { id: string; candidate_name: string | null; score: string; existing: string | null }[];
  excluded: { module: string; n: string }[];
  unmapped: { kind: string; raw_value: string; occurrences: number }[];
  rejected: { sheet: string; row_number: number; reason: string | null }[];
}

/** Thrown to roll the transaction back once a simulation has collected its numbers. */
class DryRun extends Error {
  constructor(readonly outcome: RunOutcome) {
    super('SIMULACIO');
  }
}

export async function runImport(formData: FormData): Promise<ActionResult<RunOutcome>> {
  const session = await requireSession();
  if (session.role !== 'ADMIN') return { ok: false, error: 'Només un ADMIN pot executar una importació.' };

  const token = field(formData, 'token') ?? '';
  const label = field(formData, 'label') ?? '';
  const notes = field(formData, 'notes');
  const mode = field(formData, 'mode') === 'REAL' ? 'REAL' : 'SIMULACIO';
  const force = field(formData, 'force') === 'true';
  const planRaw = field(formData, 'plan') ?? '[]';

  const full = token.startsWith('::font::')
    ? resolveSourceName(token.slice('::font::'.length))
    : resolveToken(token);
  if (!full) return { ok: false, error: 'Fitxer no vàlid.' };
  if (!label) return { ok: false, error: 'Cal un nom per a la importació.' };

  let plan: PlannedSheet[];
  try {
    plan = JSON.parse(planRaw) as PlannedSheet[];
  } catch {
    return { ok: false, error: 'El pla d’importació no és vàlid.' };
  }
  if (!Array.isArray(plan) || plan.length === 0) {
    return { ok: false, error: 'Cal triar com a mínim un full.' };
  }
  for (const sheet of plan) {
    for (const required of REQUIRED_FIELDS[sheet.kind] ?? []) {
      if (!sheet.columns[required]) {
        return {
          ok: false,
          error: `El full «${sheet.sheet}» no té assignada la columna obligatòria «${required}».`,
        };
      }
    }
  }

  const source: SourceSpec = {
    file: specFileFor(full),
    description: label,
    trust: 1,
    sheets: plan.map<SheetSpec>((s) => ({
      sheet: s.sheet,
      kind: s.kind,
      ...(s.headerRow ? { headerRow: s.headerRow } : {}),
      columns: Object.fromEntries(
        Object.entries(s.columns).filter(([, header]) => Boolean(header)).map(([f, header]) => [f, [header]]),
      ),
      ...(s.kind === 'REFERENCE' ? { skipReason: 'Marcat com a full de referència en el mapatge.' } : {}),
    })),
  };

  const kind = await backendKind();

  try {
    const outcome = await elevated(session, 'IMPORTACIO', async (q) => {
      if (!force) {
        const sha = createHash('sha256').update(await readFile(full)).digest('hex');
        const already = await q.one<{ label: string }>(
          `select i.label from public.import_files f
             join public.imports i on i.id = f.import_id
            where f.sha256 = $1 and i.workspace_id = $2 and i.undone_at is null and i.status = 'APLICAT'
            limit 1`,
          [sha, session.workspaceId],
        );
        if (already) throw new Error(`JA_IMPORTAT:${already.label}`);
      }

      const runner: SqlRunner = {
        kind,
        async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
          return q.many<T>(sql, params);
        },
        async exec(sql: string): Promise<void> {
          await q.run(sql);
        },
        // The whole run already lives inside one transaction opened by
        // `withServiceRole`; nested BEGIN/COMMIT would only break it.
        begin: async () => undefined,
        commit: async () => undefined,
        rollback: async () => undefined,
        close: async () => undefined,
      };

      const created = await q.one<{ id: string }>(
        `insert into public.imports (workspace_id, label, status, created_by, notes)
         values ($1, $2, 'BORRADOR', $3, $4) returning id`,
        [session.workspaceId, label, session.userId, notes],
      );
      if (!created) throw new Error('No s’ha pogut crear la importació.');

      const ctx: ImportContext = {
        db: runner,
        workspaceId: session.workspaceId,
        importId: created.id,
        ownerId: session.userId,
        resolved: new Map(),
        stats: emptyStats(),
        provenanceBuffer: [],
      };

      const staged = await stageWorkbook(ctx, source);
      await q.run(`update public.imports set status = 'INSPECCIONAT' where id = $1`, [created.id]);
      await q.run(`update public.import_files set stored_path = $2 where import_id = $1`, [
        created.id,
        path.relative(repoRoot(), full),
      ]);
      await q.run(`update public.imports set status = 'MAPEJAT' where id = $1`, [created.id]);

      for (const sheet of staged) {
        switch (sheet.spec.kind) {
          case 'CLIENTS':
            await importClientSheet(ctx, source, sheet);
            break;
          case 'PUBLIC_DIRECTORY':
            await importPublicDirectory(ctx, source, sheet);
            break;
          case 'CONTACTS_EXPORT':
            await importExportContacts(ctx, source, sheet);
            break;
          case 'SALES':
            await importSalesSheet(ctx, source, sheet);
            break;
          case 'PRIORITY_ORDER':
            await importPriorityOrder(ctx, source, sheet);
            break;
          default:
            break; // REFERENCE rows are already marked IGNORADA by stageWorkbook
        }
      }

      await flushProvenance(ctx);
      await q.run(`update public.imports set status = 'NORMALITZAT' where id = $1`, [created.id]);
      await q.run(
        `select app.refresh_proposed_classification(id)
           from public.clients where workspace_id = $1 and deleted_at is null`,
        [session.workspaceId],
      );

      const stats = {
        ...ctx.stats,
        productsUnmapped: [...ctx.stats.productsUnmapped],
        campaignsUnmapped: [...ctx.stats.campaignsUnmapped],
      };
      await q.run(
        `update public.imports set status = 'APLICAT', finished_at = now(), stats = $2::jsonb where id = $1`,
        [created.id, JSON.stringify(stats)],
      );

      const duplicates = await q.many<{
        id: string; candidate_name: string | null; score: string; existing: string | null;
      }>(
        `select d.id, d.candidate_name, d.score::text as score, l.name as existing
           from public.duplicate_candidates d
           left join public.clients l on l.id = d.left_client_id
          where d.import_id = $1 order by d.score desc limit 50`,
        [created.id],
      );
      const excluded = await q.many<{ module: string; n: string }>(
        `select module, count(*)::text as n from public.excluded_records
          where import_id = $1 group by module order by 2 desc`,
        [created.id],
      );
      const unmapped = await q.many<{ kind: string; raw_value: string; occurrences: number }>(
        `select kind, raw_value, occurrences from public.unmapped_values
          where import_id = $1 and resolved_at is null order by occurrences desc limit 50`,
        [created.id],
      );
      const rejected = await q.many<{ sheet: string; row_number: number; reason: string | null }>(
        `select s.sheet_name as sheet, r.row_number, r.outcome_reason as reason
           from public.import_rows r
           join public.import_sheets s on s.id = r.import_sheet_id
          where r.import_id = $1 and r.outcome = 'REBUTJADA'
          order by s.sheet_name, r.row_number limit 100`,
        [created.id],
      );

      const numeric: Record<string, number> = {};
      for (const [key, value] of Object.entries(ctx.stats)) {
        if (typeof value === 'number') numeric[key] = value;
      }
      const result: RunOutcome = {
        simulated: mode === 'SIMULACIO',
        importId: created.id,
        label,
        stats: numeric,
        reconciled:
          ctx.stats.rowsRead ===
          ctx.stats.rowsImported +
            ctx.stats.rowsIgnored +
            ctx.stats.rowsRejected +
            ctx.stats.rowsExcluded +
            ctx.stats.rowsDuplicate,
        duplicates,
        excluded,
        unmapped,
        rejected,
      };

      if (mode === 'SIMULACIO') throw new DryRun({ ...result, importId: null });
      return result;
    });

    revalidatePath('/administracio/importacions');
    revalidatePath('/administracio/duplicats');
    revalidatePath('/clients', 'layout');
    return { ok: true, data: outcome };
  } catch (error) {
    if (error instanceof DryRun) return { ok: true, data: error.outcome };
    if (error instanceof Error && error.message.startsWith('JA_IMPORTAT:')) {
      return {
        ok: false,
        error: `Aquest fitxer, byte a byte, ja es va importar a «${error.message.slice('JA_IMPORTAT:'.length)}». Marca FORÇAR per tornar-lo a passar.`,
      };
    }
    if (error instanceof Error && error.message === ONLY_ADMIN) {
      return { ok: false, error: 'Només un ADMIN pot executar una importació.' };
    }
    return { ok: false, error: `Importació aturada: ${(error as Error).message}` };
  }
}

// ---------------------------------------------------------------------------
// Undo / abandon
// ---------------------------------------------------------------------------

export interface UndoSafety {
  safe: boolean;
  reason: string;
  laterImports: number;
  changesAfter: number;
}

/**
 * An import may be undone only while nothing has been built on top of it: no
 * later applied import, and no change to the workspace after it finished. The
 * check is a query over `audit_log`, so it cannot be fooled by a UI state.
 */
export async function undoSafety(importId: string): Promise<UndoSafety> {
  const session = await requireSession();
  const row = await query(session, (q) =>
    q.one<{ later: string; changes: string; status: string; undone: string | null }>(
      `select
         (select count(*)::text from public.imports i2
           where i2.workspace_id = $2 and i2.status = 'APLICAT' and i2.undone_at is null
             and i2.started_at > i.started_at) as later,
         (select count(*)::text from public.audit_log a
           where a.workspace_id = $2 and a.created_at > coalesce(i.finished_at, i.started_at)) as changes,
         i.status::text as status, i.undone_at::text as undone
       from public.imports i where i.id = $1 and i.workspace_id = $2`,
      [importId, session.workspaceId],
    ),
  );
  if (!row) return { safe: false, reason: 'La importació no existeix.', laterImports: 0, changesAfter: 0 };
  if (row.undone) {
    return { safe: false, reason: 'Ja s’ha desfet.', laterImports: 0, changesAfter: 0 };
  }
  const later = Number(row.later);
  const changes = Number(row.changes);
  if (later > 0) {
    return {
      safe: false,
      reason: `Hi ha ${later} importació(ns) posterior(s) aplicada(es) al damunt.`,
      laterImports: later,
      changesAfter: changes,
    };
  }
  if (changes > 0) {
    return {
      safe: false,
      reason: `Hi ha ${changes} canvi(s) registrats a l’auditoria després d’aquesta importació. Desfer-la esborraria feina feta a mà.`,
      laterImports: 0,
      changesAfter: changes,
    };
  }
  return { safe: true, reason: 'Cap canvi posterior: es pot desfer sense perdre feina.', laterImports: 0, changesAfter: 0 };
}

export async function undoImport(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (session.role !== 'ADMIN') return { ok: false, error: 'Només un ADMIN pot desfer una importació.' };
  const id = field(formData, 'id');
  const confirmation = field(formData, 'confirmation');
  if (!id) return { ok: false, error: 'Falta la importació.' };
  if (confirmation !== 'DESFER') return { ok: false, error: 'Cal escriure DESFER per confirmar.' };

  const safety = await undoSafety(id);
  if (!safety.safe) return { ok: false, error: safety.reason };

  try {
    await elevated(session, 'IMPORTACIO', async (q) => {
      // Only the companies this import actually created are removed; the ones
      // it merely enriched were already there and stay.
      await q.run(
        `with created as (
            select distinct (r.entities_created ->> 'client_id')::uuid as client_id
              from public.import_rows r
             where r.import_id = $1
               and coalesce((r.entities_created ->> 'created')::boolean, false)
               and r.entities_created ->> 'client_id' is not null
          )
          delete from public.clients c using created
           where c.id = created.client_id and c.workspace_id = $2`,
        [id, session.workspaceId],
      );
      await q.run(`delete from public.duplicate_candidates where import_id = $1`, [id]);
      await q.run(`delete from public.excluded_records where import_id = $1`, [id]);
      await q.run(`delete from public.unmapped_values where import_id = $1`, [id]);
      await q.run(`delete from public.field_provenance where import_id = $1`, [id]);
      await q.run(`delete from public.import_rows where import_id = $1`, [id]);
      await q.run(
        `delete from public.import_sheets s
          using public.import_files f
          where s.import_file_id = f.id and f.import_id = $1`,
        [id],
      );
      await q.run(`delete from public.import_files where import_id = $1`, [id]);
      await q.run(
        `update public.imports set status = 'DESFET', undone_at = now(), undone_by = $2 where id = $1`,
        [id, session.userId],
      );
    });
  } catch (error) {
    return { ok: false, error: `No s’ha pogut desfer: ${(error as Error).message}` };
  }
  revalidatePath('/administracio/importacions');
  revalidatePath('/clients', 'layout');
  return { ok: true };
}

/** Closes an import left half-way (BORRADOR…NORMALITZAT) without touching data. */
export async function abandonImport(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (session.role !== 'ADMIN') return { ok: false, error: 'Només un ADMIN pot fer aquesta acció.' };
  const id = field(formData, 'id');
  if (!id) return { ok: false, error: 'Falta la importació.' };
  try {
    await query(session, (q) =>
      q.run(
        `update public.imports set status = 'ERROR', finished_at = coalesce(finished_at, now())
          where id = $1 and workspace_id = $2 and status in ('BORRADOR','INSPECCIONAT','MAPEJAT','NORMALITZAT')`,
        [id, session.workspaceId],
      ),
    );
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath('/administracio/importacions');
  return { ok: true };
}
