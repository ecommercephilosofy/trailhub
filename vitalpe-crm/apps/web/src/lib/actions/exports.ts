import 'server-only';
import { query, type Session } from '@/lib/auth';
import type { Query } from '@/lib/db';
import { formatDate, formatDateTime } from '@/lib/format';

/**
 * Export catalogue.
 *
 * Every query below runs inside `query(session, …)`, i.e. as the signed-in user
 * with RLS on. That is the whole security model of this feature: a COMERCIAL
 * exporting "auditoria" does not get a filtered file, they get an empty one,
 * because `audit_select` never returns them a row. Nothing here re-implements
 * a permission check, and nothing here can leak what the policies hide.
 *
 * Tokens, encrypted Google credentials, audio paths and transcripts are not in
 * any column list, and `google_calendar_connections` is not queried at all.
 */

export type ExportFormat = 'xlsx' | 'csv';

export interface SheetPayload {
  name: string;
  headers: string[];
  rows: (string | number | null)[][];
}

export interface ExportPayload {
  filename: string;
  sheets: SheetPayload[];
}

export interface DatasetSpec {
  slug: string;
  label: string;
  description: string;
  /** Only offered to ADMIN/GERENT; RLS returns nothing to anybody else anyway. */
  managerOnly: boolean;
  build: (q: Query, session: Session, params: URLSearchParams) => Promise<SheetPayload[]>;
}

const d = (v: unknown): string => formatDate(v as string | null);
const dt = (v: unknown): string => formatDateTime(v as string | null);
const n = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));

function sheet(name: string, headers: string[], rows: (string | number | null)[][]): SheetPayload {
  return { name: name.slice(0, 31), headers, rows };
}

// ---------------------------------------------------------------------------
// Individual datasets
// ---------------------------------------------------------------------------

interface ClientRow {
  id: string; name: string; legal_name: string | null; tax_id: string | null;
  client_type: string | null; municipality: string | null; comarca: string | null;
  province: string | null; website: string | null;
  do_cava: boolean; do_penedes: boolean; do_catalunya: boolean; do_altres: boolean;
  proposed: string | null; confirmed: string | null; not_potential_reason: string | null;
  verification: string | null; last_verified_at: string | null;
  owner: string | null; account_code: string | null; created_at: string;
  liters_bought: string | null; last_activity: string | null;
}

const CLIENT_SELECT = `
  select c.id, c.name, c.legal_name, c.tax_id,
         coalesce(c.client_type_code, c.other_client_type) as client_type,
         c.municipality, c.comarca, c.province, c.website,
         c.do_cava, c.do_penedes, c.do_catalunya, c.do_altres,
         c.proposed_classification::text as proposed,
         c.confirmed_classification::text as confirmed,
         c.not_potential_reason,
         c.verification_status::text as verification, c.last_verified_at,
         nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') as owner,
         c.external_account_code as account_code, c.created_at,
         (select round(sum(o.volume_liters))::text from public.opportunities o
           where o.client_id = c.id and o.data_type = 'COMPRA REAL' and o.deleted_at is null) as liters_bought,
         (select max(a.occurred_on)::text from public.activities a
           where a.client_id = c.id and a.deleted_at is null) as last_activity
    from public.clients c
    left join public.profiles p on p.id = c.owner_id
   where c.workspace_id = $1 and c.deleted_at is null`;

const CLIENT_HEADERS = [
  'ID', 'EMPRESA', 'RAÓ SOCIAL', 'NIF', 'TIPUS', 'MUNICIPI', 'COMARCA', 'PROVÍNCIA', 'WEB',
  'DO CAVA', 'DO PENEDÈS', 'DO CATALUNYA', 'DO ALTRES',
  'CLASSIFICACIÓ PROPOSADA', 'CLASSIFICACIÓ CONFIRMADA', 'MOTIU NO POTENCIAL',
  'VERIFICACIÓ', 'DARRERA VERIFICACIÓ', 'RESPONSABLE', 'COMPTE COMPTABLE',
  'LITRES COMPRATS', 'DARRERA ACCIÓ', 'ALTA',
];

const si = (v: boolean): string => (v ? 'SÍ' : 'NO');

function clientRows(rows: ClientRow[]): (string | number | null)[][] {
  return rows.map((c) => [
    c.id, c.name, c.legal_name, c.tax_id, c.client_type, c.municipality, c.comarca,
    c.province, c.website, si(c.do_cava), si(c.do_penedes), si(c.do_catalunya), si(c.do_altres),
    c.proposed, c.confirmed, c.not_potential_reason, c.verification,
    c.last_verified_at ? d(c.last_verified_at) : '', c.owner, c.account_code,
    n(c.liters_bought), c.last_activity ? d(c.last_activity) : '', d(c.created_at),
  ]);
}

/** Filters shared by the company exports, mirroring the /clients list. */
function clientFilter(params: URLSearchParams, args: unknown[]): string {
  const parts: string[] = [];
  const text = params.get('q')?.trim();
  if (text) {
    args.push(`%${text}%`);
    parts.push(`and (c.name ilike $${args.length} or c.municipality ilike $${args.length})`);
  }
  const classification = params.get('classificacio')?.trim();
  if (classification) {
    args.push(classification);
    parts.push(
      `and coalesce(c.confirmed_classification::text, c.proposed_classification::text) = $${args.length}`,
    );
  }
  const province = params.get('provincia')?.trim();
  if (province) {
    args.push(province);
    parts.push(`and c.province = $${args.length}`);
  }
  const owner = params.get('responsable')?.trim();
  if (owner) {
    args.push(owner);
    parts.push(`and c.owner_id = $${args.length}::uuid`);
  }
  return parts.join(' ');
}

async function companiesSheet(
  q: Query,
  session: Session,
  params: URLSearchParams,
  extra = '',
  name = 'EMPRESES',
): Promise<SheetPayload> {
  const args: unknown[] = [session.workspaceId];
  const filter = clientFilter(params, args);
  const rows = await q.many<ClientRow>(
    `${CLIENT_SELECT} ${filter} ${extra} order by c.name`,
    args,
  );
  return sheet(name, CLIENT_HEADERS, clientRows(rows));
}

async function contactsSheet(q: Query, session: Session): Promise<SheetPayload> {
  const rows = await q.many<Record<string, string | null>>(
    `select c.name as empresa, ct.first_name, ct.last_name, ct.role_title,
            ct.phone_original, ct.email_original, ct.contact_type::text as tipus,
            ct.is_primary, ct.is_active, ct.notes, ct.source
       from public.contacts ct
       join public.clients c on c.id = ct.client_id and c.deleted_at is null
      where ct.workspace_id = $1 and ct.deleted_at is null
      order by c.name, ct.last_name, ct.first_name`,
    [session.workspaceId],
  );
  return sheet(
    'CONTACTES',
    ['EMPRESA', 'NOM', 'COGNOMS', 'CÀRREC', 'TELÈFON', 'CORREU', 'TIPUS', 'PRINCIPAL', 'ACTIU', 'NOTES', 'ORIGEN'],
    rows.map((r) => [
      r.empresa, r.first_name, r.last_name, r.role_title, r.phone_original, r.email_original,
      r.tipus, si(Boolean(r.is_primary)), si(Boolean(r.is_active)), r.notes, r.source,
    ]),
  );
}

async function tasksSheet(q: Query, session: Session): Promise<SheetPayload> {
  const rows = await q.many<Record<string, string | null>>(
    `select t.due_at, t.kind::text as kind, t.action::text as action, t.other_action,
            t.title, t.priority::text as priority, t.status::text as status,
            t.result::text as result, c.name as empresa, p.name as producte,
            nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), '') as comercial,
            t.notes, t.completed_at, t.postponed_to, t.created_at
       from public.tasks t
       left join public.clients c on c.id = t.client_id
       left join public.products p on p.id = t.product_id
       left join public.profiles pr on pr.id = t.assigned_to
      where t.workspace_id = $1 and t.deleted_at is null
      order by t.due_at nulls last, c.name`,
    [session.workspaceId],
  );
  return sheet(
    'TASQUES',
    ['DATA', 'HORA', 'TIPUS', 'ACCIÓ', 'TÍTOL', 'IMPORTÀNCIA', 'ESTAT', 'RESULTAT', 'EMPRESA',
     'PRODUCTE', 'COMERCIAL', 'OBSERVACIONS', 'COMPLETADA', 'AJORNADA A', 'CREADA'],
    rows.map((r) => [
      r.due_at ? d(r.due_at) : 'SENSE DATA',
      r.due_at ? dt(r.due_at).slice(11) : '',
      r.kind, r.other_action ?? r.action, r.title, r.priority, r.status, r.result,
      r.empresa, r.producte, r.comercial, r.notes,
      r.completed_at ? dt(r.completed_at) : '', r.postponed_to ? d(r.postponed_to) : '',
      dt(r.created_at),
    ]),
  );
}

async function visitsSheet(q: Query, session: Session): Promise<SheetPayload> {
  const rows = await q.many<Record<string, string | null>>(
    `select v.starts_at, v.ends_at, c.name as empresa, v.status::text as status,
            v.objective, v.result::text as result,
            nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), '') as comercial,
            l.formatted_address as adreca, v.notes_before, v.notes_after,
            v.cancellation_reason, cel.status::text as sincronitzacio
       from public.visits v
       join public.clients c on c.id = v.client_id
       left join public.profiles pr on pr.id = v.user_id
       left join public.client_locations l on l.id = v.location_id
       left join public.calendar_event_links cel on cel.visit_id = v.id
      where v.workspace_id = $1 and v.deleted_at is null
      order by v.starts_at desc`,
    [session.workspaceId],
  );
  return sheet(
    'VISITES',
    ['DATA', 'INICI', 'FI', 'EMPRESA', 'ESTAT', 'OBJECTIU', 'RESULTAT', 'COMERCIAL', 'ADREÇA',
     'NOTES PRÈVIES', 'NOTES POSTERIORS', 'MOTIU CANCEL·LACIÓ', 'SINCRONITZACIÓ'],
    rows.map((r) => [
      d(r.starts_at), dt(r.starts_at).slice(11), dt(r.ends_at).slice(11), r.empresa, r.status,
      r.objective, r.result, r.comercial, r.adreca, r.notes_before, r.notes_after,
      r.cancellation_reason, r.sincronitzacio,
    ]),
  );
}

async function historySheet(q: Query, session: Session): Promise<SheetPayload> {
  const rows = await q.many<Record<string, string | null>>(
    `select a.occurred_on, c.name as empresa, a.activity_type::text as tipus,
            a.result::text as result, p.name as producte, cp.name as campanya,
            nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), '') as usuari,
            a.origin::text as origen, a.notes, a.created_at
       from public.activities a
       join public.clients c on c.id = a.client_id
       left join public.products p on p.id = a.product_id
       left join public.campaigns cp on cp.id = a.campaign_id
       left join public.profiles pr on pr.id = a.user_id
      where a.workspace_id = $1 and a.deleted_at is null
      order by a.occurred_on desc, a.created_at desc`,
    [session.workspaceId],
  );
  return sheet(
    'HISTORIAL',
    ['DATA', 'EMPRESA', 'TIPUS', 'RESULTAT', 'PRODUCTE', 'CAMPANYA', 'USUARI', 'ORIGEN', 'OBSERVACIONS', 'REGISTRAT'],
    rows.map((r) => [
      d(r.occurred_on), r.empresa, r.tipus, r.result, r.producte, r.campanya, r.usuari,
      r.origen, r.notes, dt(r.created_at),
    ]),
  );
}

async function opportunitiesSheet(
  q: Query,
  session: Session,
  where: string,
  name: string,
): Promise<SheetPayload> {
  const rows = await q.many<Record<string, string | null>>(
    `select cp.name as campanya, c.name as empresa, p.name as producte, p.category as categoria,
            o.data_type::text as tipus, o.volume_liters, o.forecast_next::text as previsio,
            o.status::text as estat, o.probability, o.notes, o.source,
            nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), '') as responsable
       from public.opportunities o
       join public.clients c on c.id = o.client_id and c.deleted_at is null
       join public.products p on p.id = o.product_id
       join public.campaigns cp on cp.id = o.campaign_id
       left join public.profiles pr on pr.id = o.owner_id
      where o.workspace_id = $1 and o.deleted_at is null ${where}
      order by cp.name desc, c.name, p.sort_order`,
    [session.workspaceId],
  );
  return sheet(
    name,
    ['CAMPANYA', 'EMPRESA', 'PRODUCTE', 'CATEGORIA', 'TIPUS DE DADA', 'LITRES', 'PREVISIÓ',
     'ESTAT', 'PROBABILITAT', 'OBSERVACIONS', 'ORIGEN', 'RESPONSABLE'],
    rows.map((r) => [
      r.campanya, r.empresa, r.producte, r.categoria, r.tipus, n(r.volume_liters), r.previsio,
      r.estat, n(r.probability), r.notes, r.source, r.responsable,
    ]),
  );
}

async function deliveriesSheet(q: Query, session: Session): Promise<SheetPayload> {
  const rows = await q.many<Record<string, string | null>>(
    `select od.guide_date, od.guide_number, c.name as empresa, p.name as producte,
            od.raw_product, od.volume_liters, cp.name as campanya, od.source
       from public.opportunity_deliveries od
       join public.opportunities o on o.id = od.opportunity_id
       join public.clients c on c.id = o.client_id
       join public.products p on p.id = o.product_id
       join public.campaigns cp on cp.id = o.campaign_id
      where od.workspace_id = $1
      order by od.guide_date desc nulls last, od.guide_number`,
    [session.workspaceId],
  );
  return sheet(
    'COMPRES',
    ['DATA GUIA', 'Nº GUIA', 'EMPRESA', 'PRODUCTE CATÀLEG', 'PRODUCTE ORIGINAL', 'LITRES', 'CAMPANYA', 'ORIGEN'],
    rows.map((r) => [
      r.guide_date ? d(r.guide_date) : '', r.guide_number, r.empresa, r.producte,
      r.raw_product, n(r.volume_liters), r.campanya, r.source,
    ]),
  );
}

async function duplicatesSheet(q: Query, session: Session): Promise<SheetPayload> {
  const rows = await q.many<Record<string, string | null>>(
    `select d.score, d.decision::text as decision, d.is_deterministic,
            l.name as existent, l.municipality as municipi_existent,
            r.name as nova, r.municipality as municipi_nou,
            d.candidate_name, d.signals::text as senyals, d.decision_note,
            nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') as decidit_per,
            d.decided_at, d.created_at
       from public.duplicate_candidates d
       left join public.clients l on l.id = d.left_client_id
       left join public.clients r on r.id = d.right_client_id
       left join public.profiles p on p.id = d.decided_by
      where d.workspace_id = $1
      order by d.score desc`,
    [session.workspaceId],
  );
  return sheet(
    'DUPLICATS',
    ['PUNTUACIÓ', 'DECISIÓ', 'DETERMINISTA', 'EMPRESA EXISTENT', 'MUNICIPI EXISTENT',
     'EMPRESA NOVA', 'MUNICIPI NOU', 'NOM DEL CANDIDAT', 'SENYALS', 'NOTA', 'DECIDIT PER', 'DECIDIT', 'CREAT'],
    rows.map((r) => [
      n(r.score), r.decision, si(Boolean(r.is_deterministic)), r.existent, r.municipi_existent,
      r.nova, r.municipi_nou, r.candidate_name, r.senyals, r.decision_note, r.decidit_per,
      r.decided_at ? dt(r.decided_at) : '', dt(r.created_at),
    ]),
  );
}

async function auditSheet(q: Query, session: Session, params: URLSearchParams): Promise<SheetPayload> {
  const args: unknown[] = [session.workspaceId];
  const parts: string[] = [];
  for (const [key, column] of [['entitat', 'a.entity'], ['accio', 'a.action']] as const) {
    const value = params.get(key)?.trim();
    if (value) {
      args.push(value);
      parts.push(`and ${column} = $${args.length}`);
    }
  }
  const from = params.get('des')?.trim();
  if (from) {
    args.push(from);
    parts.push(`and a.created_at >= $${args.length}::date`);
  }
  const to = params.get('fins')?.trim();
  if (to) {
    args.push(to);
    parts.push(`and a.created_at < ($${args.length}::date + interval '1 day')`);
  }
  const rows = await q.many<Record<string, string | null>>(
    `select a.created_at, a.entity, a.entity_id, a.action,
            array_to_string(a.changed_fields, ', ') as camps,
            nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') as actor,
            a.origin::text as origen, a.device, a.correlation_id
       from public.audit_log a
       left join public.profiles p on p.id = a.actor_id
      where a.workspace_id = $1 ${parts.join(' ')}
      order by a.created_at desc
      limit 20000`,
    args,
  );
  return sheet(
    'AUDITORIA',
    ['MOMENT', 'ENTITAT', 'IDENTIFICADOR', 'ACCIÓ', 'CAMPS CANVIATS', 'USUARI', 'ORIGEN', 'DISPOSITIU', 'CORRELACIÓ'],
    rows.map((r) => [
      dt(r.created_at), r.entity, r.entity_id, r.action, r.camps, r.actor, r.origen,
      r.device, r.correlation_id,
    ]),
  );
}

async function importReportSheets(q: Query, session: Session): Promise<SheetPayload[]> {
  const imports = await q.many<Record<string, string | null>>(
    `select i.label, i.status::text as status, i.started_at, i.finished_at,
            nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), '') as autor,
            i.stats::text as stats, i.notes, i.undone_at
       from public.imports i
       left join public.profiles p on p.id = i.created_by
      where i.workspace_id = $1 order by i.started_at desc`,
    [session.workspaceId],
  );
  const sheets = await q.many<Record<string, string | null>>(
    `select i.label as importacio, f.filename, f.byte_size, f.sha256,
            s.sheet_name, s.header_row, s.rows_total, s.rows_read, s.entity_hint,
            s.is_excluded, s.exclusion_reason
       from public.import_sheets s
       join public.import_files f on f.id = s.import_file_id
       join public.imports i on i.id = f.import_id
      where i.workspace_id = $1
      order by i.started_at desc, f.filename, s.sheet_name`,
    [session.workspaceId],
  );
  const outcomes = await q.many<Record<string, string | null>>(
    `select i.label as importacio, r.outcome, count(*)::text as files
       from public.import_rows r join public.imports i on i.id = r.import_id
      where i.workspace_id = $1 group by 1, 2 order by 1, 2`,
    [session.workspaceId],
  );
  const rejected = await q.many<Record<string, string | null>>(
    `select f.filename, s.sheet_name, r.row_number, r.outcome, r.outcome_reason, r.raw::text as dades
       from public.import_rows r
       join public.import_sheets s on s.id = r.import_sheet_id
       join public.import_files f on f.id = s.import_file_id
       join public.imports i on i.id = r.import_id
      where i.workspace_id = $1 and r.outcome in ('REBUTJADA', 'EXCLOSA')
      order by f.filename, s.sheet_name, r.row_number`,
    [session.workspaceId],
  );
  const excluded = await q.many<Record<string, string | null>>(
    `select e.module, e.reason, e.raw::text as dades, e.created_at
       from public.excluded_records e where e.workspace_id = $1 order by e.module`,
    [session.workspaceId],
  );
  const unmapped = await q.many<Record<string, string | null>>(
    `select kind, raw_value, occurrences, resolved_to, resolved_at
       from public.unmapped_values where workspace_id = $1 order by kind, occurrences desc`,
    [session.workspaceId],
  );

  return [
    sheet('IMPORTACIONS',
      ['IMPORTACIÓ', 'ESTAT', 'INICI', 'FI', 'AUTOR', 'ESTADÍSTIQUES', 'NOTES', 'DESFETA'],
      imports.map((r) => [r.label, r.status, dt(r.started_at), r.finished_at ? dt(r.finished_at) : '',
        r.autor, r.stats, r.notes, r.undone_at ? dt(r.undone_at) : ''])),
    sheet('FITXERS I FULLS',
      ['IMPORTACIÓ', 'FITXER', 'BYTES', 'SHA-256', 'FULL', 'FILA CAPÇALERA', 'FILES TOTALS',
       'FILES LLEGIDES', 'TIPUS', 'EXCLÒS', 'MOTIU'],
      sheets.map((r) => [r.importacio, r.filename, n(r.byte_size), r.sha256, r.sheet_name,
        n(r.header_row), n(r.rows_total), n(r.rows_read), r.entity_hint,
        si(Boolean(r.is_excluded)), r.exclusion_reason])),
    sheet('RECONCILIACIÓ', ['IMPORTACIÓ', 'RESULTAT', 'FILES'],
      outcomes.map((r) => [r.importacio, r.outcome, n(r.files)])),
    sheet('FILES NO IMPORTADES', ['FITXER', 'FULL', 'FILA', 'RESULTAT', 'MOTIU', 'DADES'],
      rejected.map((r) => [r.filename, r.sheet_name, n(r.row_number), r.outcome, r.outcome_reason, r.dades])),
    sheet('REGISTRES EXCLOSOS', ['MÒDUL', 'MOTIU', 'DADES', 'CREAT'],
      excluded.map((r) => [r.module, r.reason, r.dades, dt(r.created_at)])),
    sheet('VALORS SENSE MAPATGE', ['TIPUS', 'VALOR ORIGINAL', 'OCURRÈNCIES', 'RESOLT COM A', 'RESOLT'],
      unmapped.map((r) => [r.kind, r.raw_value, n(r.occurrences), r.resolved_to,
        r.resolved_at ? dt(r.resolved_at) : ''])),
  ];
}

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const DATASETS: DatasetSpec[] = [
  {
    slug: 'empreses',
    label: 'EMPRESES FILTRADES',
    description: 'Totes les empreses visibles, amb els filtres que triïs a sota.',
    managerOnly: false,
    build: async (q, s, p) => [await companiesSheet(q, s, p)],
  },
  {
    slug: 'clients-actius',
    label: 'CLIENTS ACTIUS',
    description: 'Empreses classificades com a ACTIU SEGUR.',
    managerOnly: false,
    build: async (q, s, p) => [
      await companiesSheet(
        q, s, p,
        `and coalesce(c.confirmed_classification, c.proposed_classification) = 'ACTIU SEGUR'`,
        'CLIENTS ACTIUS',
      ),
    ],
  },
  {
    slug: 'potencials',
    label: 'CLIENTS POTENCIALS',
    description: 'Empreses potencials: interessades o amb un altre proveïdor.',
    managerOnly: false,
    build: async (q, s, p) => [
      await companiesSheet(
        q, s, p,
        `and coalesce(c.confirmed_classification, c.proposed_classification) in
             ('POTENCIAL INTERESSAT', 'POTENCIAL AMB UN ALTRE PROVEIDOR')`,
        'POTENCIALS',
      ),
    ],
  },
  {
    slug: 'contactes',
    label: 'CONTACTES',
    description: 'Persones de contacte amb el seu telèfon, correu i càrrec.',
    managerOnly: false,
    build: async (q, s) => [await contactsSheet(q, s)],
  },
  {
    slug: 'tasques',
    label: 'TASQUES',
    description: 'Totes les tasques i recordatoris, amb estat i resultat.',
    managerOnly: false,
    build: async (q, s) => [await tasksSheet(q, s)],
  },
  {
    slug: 'visites',
    label: 'VISITES',
    description: 'Visites planificades, fetes i cancel·lades.',
    managerOnly: false,
    build: async (q, s) => [await visitsSheet(q, s)],
  },
  {
    slug: 'historial',
    label: 'HISTORIAL COMERCIAL',
    description: 'Accions registrades a la fitxa de cada empresa.',
    managerOnly: false,
    build: async (q, s) => [await historySheet(q, s)],
  },
  {
    slug: 'oportunitats',
    label: 'OPORTUNITATS PER CAMPANYA',
    description: 'Compres reals, previsions confirmades i possibles compres, per campanya.',
    managerOnly: false,
    build: async (q, s) => [await opportunitiesSheet(q, s, '', 'OPORTUNITATS')],
  },
  {
    slug: 'compres',
    label: 'COMPRES (ALBARANS)',
    description: 'Línies d’albarà que sustenten cada compra real.',
    managerOnly: false,
    build: async (q, s) => [await deliveriesSheet(q, s)],
  },
  {
    slug: 'previsions',
    label: 'PREVISIONS',
    description: 'Previsions confirmades i possibles compres de la propera campanya.',
    managerOnly: false,
    build: async (q, s) => [
      await opportunitiesSheet(
        q, s,
        `and o.data_type in ('PREVISIO CONFIRMADA', 'POSSIBLE COMPRA')`,
        'PREVISIONS',
      ),
    ],
  },
  {
    slug: 'duplicats',
    label: 'DUPLICATS',
    description: 'Cua de revisió de duplicats amb els senyals i la decisió presa.',
    managerOnly: true,
    build: async (q, s) => [await duplicatesSheet(q, s)],
  },
  {
    slug: 'auditoria',
    label: 'AUDITORIA',
    description: 'Registre de canvis que el teu rol pot llegir. Filtrable per entitat, acció i dates.',
    managerOnly: true,
    build: async (q, s, p) => [await auditSheet(q, s, p)],
  },
  {
    slug: 'informe-importacio',
    label: 'INFORME D’IMPORTACIÓ',
    description: 'Fitxers, fulls, reconciliació, files no importades, exclusions i valors sense mapatge.',
    managerOnly: true,
    build: async (q, s) => importReportSheets(q, s),
  },
  {
    slug: 'tot',
    label: 'TOT',
    description: 'Un sol llibre amb totes les pestanyes anteriors que el teu rol pugui llegir.',
    managerOnly: false,
    build: async (q, s, p) => {
      const parts: SheetPayload[] = [
        await companiesSheet(q, s, p),
        await contactsSheet(q, s),
        await tasksSheet(q, s),
        await visitsSheet(q, s),
        await historySheet(q, s),
        await opportunitiesSheet(q, s, '', 'OPORTUNITATS'),
        await deliveriesSheet(q, s),
        await duplicatesSheet(q, s),
        await auditSheet(q, s, p),
      ];
      return parts;
    },
  },
];

export function findDataset(slug: string): DatasetSpec | undefined {
  return DATASETS.find((dset) => dset.slug === slug);
}

export async function buildExport(
  session: Session,
  spec: DatasetSpec,
  params: URLSearchParams,
): Promise<ExportPayload> {
  const sheets = await query(session, (q) => spec.build(q, session, params));
  const stamp = new Date().toISOString().slice(0, 10);
  return { filename: `vitalpe-${spec.slug}-${stamp}`, sheets };
}
