import 'server-only';

/**
 * LLISTAT MARE — filter contract.
 *
 * Every filter lives in the URL query string so a filtered list is a shareable
 * link, and the very same parser + SQL builder is used by the page and by the
 * CSV export route. There is exactly one place where a filter turns into SQL,
 * so the export can never disagree with what is on screen.
 */

export type Search = Record<string, string | string[] | undefined>;

export const VISTES = ['actius', 'potencials', 'pendents'] as const;
export type Vista = (typeof VISTES)[number];

export const ORDRES = ['empresa', 'municipi', 'classificacio', 'contacte', 'tasques', 'visita'] as const;
export type Ordre = (typeof ORDRES)[number];

export interface ClientFilters {
  q: string;
  municipi: string;
  comarca: string;
  provincia: string;
  tipus: string;
  do: string;
  confirmada: string;
  proposada: string;
  verificacio: string;
  comercial: string;
  tasques: boolean;
  sensecontacte: string;
  pendentverificar: boolean;
  propervisita: boolean;
  geo: boolean;
  conflicte: boolean;
  origen: string;
  vista: Vista | '';
  ordre: Ordre;
  dir: 'asc' | 'desc';
  pagina: number;
}

export const PER_PAGE = 50;
/** Hard ceiling for the CSV export so a bad filter can never stream the world. */
export const EXPORT_MAX = 5000;

function one(value: string | string[] | undefined): string {
  if (Array.isArray(value)) return (value[0] ?? '').trim();
  return (value ?? '').trim();
}

export function parseFilters(search: Search): ClientFilters {
  const vista = one(search.vista);
  const ordre = one(search.ordre);
  const dir = one(search.dir);
  const pagina = Number.parseInt(one(search.pagina), 10);
  const dies = one(search.sensecontacte);

  return {
    q: one(search.q).slice(0, 120),
    municipi: one(search.municipi),
    comarca: one(search.comarca),
    provincia: one(search.provincia),
    tipus: one(search.tipus),
    do: one(search.do).toUpperCase(),
    confirmada: one(search.confirmada),
    proposada: one(search.proposada),
    verificacio: one(search.verificacio),
    comercial: one(search.comercial),
    tasques: one(search.tasques) === '1',
    sensecontacte: /^\d{1,4}$/.test(dies) ? dies : '',
    pendentverificar: one(search.pendentverificar) === '1',
    propervisita: one(search.propervisita) === '1',
    geo: one(search.geo) === '1',
    conflicte: one(search.conflicte) === '1',
    origen: one(search.origen),
    vista: (VISTES as readonly string[]).includes(vista) ? (vista as Vista) : '',
    ordre: (ORDRES as readonly string[]).includes(ordre) ? (ordre as Ordre) : 'empresa',
    dir: dir === 'desc' ? 'desc' : 'asc',
    pagina: Number.isFinite(pagina) && pagina > 0 ? pagina : 1,
  };
}

/** True when anything other than the view preset narrows the list. */
export function hasActiveFilters(f: ClientFilters): boolean {
  return Boolean(
    f.q || f.municipi || f.comarca || f.provincia || f.tipus || f.do || f.confirmada ||
      f.proposada || f.verificacio || f.comercial || f.tasques || f.sensecontacte ||
      f.pendentverificar || f.propervisita || f.geo || f.conflicte || f.origen,
  );
}

export function countActiveFilters(f: ClientFilters): number {
  const values = [
    f.q, f.municipi, f.comarca, f.provincia, f.tipus, f.do, f.confirmada, f.proposada,
    f.verificacio, f.comercial, f.sensecontacte, f.origen,
  ];
  const flags = [f.tasques, f.pendentverificar, f.propervisita, f.geo, f.conflicte];
  return values.filter(Boolean).length + flags.filter(Boolean).length;
}

/** Serialises the filters back into a query string, dropping empty values. */
export function toQueryString(f: ClientFilters, overrides: Partial<Record<string, string>> = {}): string {
  const params = new URLSearchParams();
  const set = (key: string, value: string): void => {
    if (value) params.set(key, value);
  };
  set('vista', f.vista);
  set('q', f.q);
  set('municipi', f.municipi);
  set('comarca', f.comarca);
  set('provincia', f.provincia);
  set('tipus', f.tipus);
  set('do', f.do);
  set('confirmada', f.confirmada);
  set('proposada', f.proposada);
  set('verificacio', f.verificacio);
  set('comercial', f.comercial);
  set('tasques', f.tasques ? '1' : '');
  set('sensecontacte', f.sensecontacte);
  set('pendentverificar', f.pendentverificar ? '1' : '');
  set('propervisita', f.propervisita ? '1' : '');
  set('geo', f.geo ? '1' : '');
  set('conflicte', f.conflicte ? '1' : '');
  set('origen', f.origen);
  if (f.ordre !== 'empresa') set('ordre', f.ordre);
  if (f.dir !== 'asc') set('dir', f.dir);
  if (f.pagina > 1) set('pagina', String(f.pagina));

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined || value === '') params.delete(key);
    else params.set(key, value);
  }
  const text = params.toString();
  return text ? `?${text}` : '';
}

// ---------------------------------------------------------------------------
// SQL
// ---------------------------------------------------------------------------

export interface WhereClause {
  sql: string;
  params: unknown[];
}

/**
 * The FROM used by the list, the count and the export. `v_client_derived`
 * carries last contact, pending tasks, next visit and the primary contact;
 * `v_client_geo_status` carries PENDENT DE GEOLOCALITZAR.
 */
export const CLIENT_FROM = `
  from public.clients c
  join public.v_client_derived d on d.client_id = c.id
  left join public.v_client_geo_status g on g.client_id = c.id
  left join public.profiles pr on pr.id = c.owner_id
  left join public.client_types ct on ct.code = c.client_type_code`;

/**
 * Builds the WHERE clause. Every value is a bound parameter — nothing from the
 * query string is ever concatenated into the statement.
 */
export function buildWhere(f: ClientFilters, workspaceId: string): WhereClause {
  const params: unknown[] = [workspaceId];
  const parts: string[] = ['c.workspace_id = $1', 'c.deleted_at is null'];
  const push = (value: unknown): string => {
    params.push(value);
    return `$${params.length}`;
  };

  if (f.q) {
    const like = push(`%${f.q}%`);
    const raw = push(f.q);
    parts.push(`(
      c.name ilike ${like}
      or c.municipality ilike ${like}
      or c.name_norm % app.normalize_company(${raw})
      or exists (select 1 from public.client_aliases a
                  where a.client_id = c.id and a.alias ilike ${like})
      or exists (select 1 from public.contacts x
                  where x.client_id = c.id and x.deleted_at is null
                    and (x.first_name ilike ${like} or x.last_name ilike ${like}
                         or x.email_original ilike ${like} or x.phone_original ilike ${like}))
    )`);
  }

  if (f.municipi) parts.push(`c.municipality = ${push(f.municipi)}`);
  if (f.comarca) parts.push(`c.comarca = ${push(f.comarca)}`);
  if (f.provincia) parts.push(`c.province = ${push(f.provincia)}`);

  if (f.tipus === 'SENSE') parts.push('c.client_type_code is null');
  else if (f.tipus) parts.push(`c.client_type_code = ${push(f.tipus)}`);

  if (f.do === 'CAVA') parts.push('c.do_cava');
  else if (f.do === 'PENEDES') parts.push('c.do_penedes');
  else if (f.do === 'CATALUNYA') parts.push('c.do_catalunya');
  else if (f.do === 'ALTRES') parts.push('c.do_altres');
  else if (f.do === 'CAP') {
    parts.push('not (c.do_cava or c.do_penedes or c.do_catalunya or c.do_altres)');
  }

  if (f.confirmada === 'SENSE') parts.push('c.confirmed_classification is null');
  else if (f.confirmada) {
    parts.push(`c.confirmed_classification = ${push(f.confirmada)}::app.classification`);
  }

  if (f.proposada === 'SENSE') parts.push('c.proposed_classification is null');
  else if (f.proposada) {
    parts.push(`c.proposed_classification = ${push(f.proposada)}::app.classification`);
  }

  if (f.verificacio) {
    parts.push(`c.verification_status = ${push(f.verificacio)}::app.verification_status`);
  }

  if (f.comercial === 'SENSE') parts.push('c.owner_id is null');
  else if (f.comercial) parts.push(`c.owner_id = ${push(f.comercial)}::uuid`);

  if (f.tasques) parts.push('d.pending_tasks > 0');

  if (f.sensecontacte) {
    const days = push(Number(f.sensecontacte));
    parts.push(`(d.last_contact_on is null
                 or d.last_contact_on < (now() at time zone 'Europe/Madrid')::date - (${days}::int))`);
  }

  // "Pendent de verificar" covers both the explicit state and a verification
  // that has gone stale (older than app.verification_stale_months()).
  if (f.pendentverificar) {
    parts.push(`(c.verification_status in ('PENDENT DE VERIFICAR', 'DUBTOSA') or d.verification_is_stale)`);
  }

  if (f.propervisita) parts.push('d.next_visit_at is not null');
  if (f.geo) parts.push(`coalesce(g.geo_status, 'PENDENT DE GEOLOCALITZAR') = 'PENDENT DE GEOLOCALITZAR'`);
  if (f.conflicte) parts.push('d.has_classification_discrepancy');

  if (f.origen) {
    const origen = push(f.origen);
    parts.push(`exists (select 1 from public.client_aliases a
                         where a.client_id = c.id and a.source = ${origen})`);
  }

  // ---- automatic views -----------------------------------------------------
  // Nothing is confirmed yet on the imported data, so the presets work on the
  // EFFECTIVE classification (confirmed if there is one, otherwise the
  // proposal). The list always shows which of the two it is.
  if (f.vista === 'actius') {
    parts.push(`coalesce(c.confirmed_classification, c.proposed_classification) = 'ACTIU SEGUR'`);
  } else if (f.vista === 'potencials') {
    parts.push(`coalesce(c.confirmed_classification, c.proposed_classification)
                  in ('POTENCIAL INTERESSAT', 'POTENCIAL AMB UN ALTRE PROVEIDOR')`);
  } else if (f.vista === 'pendents') {
    // duplicate_candidates is manager-only under RLS: for a COMERCIAL that
    // branch simply contributes nothing, which is the correct behaviour.
    parts.push(`(
      c.confirmed_classification is null
      or d.has_classification_discrepancy
      or c.verification_status in ('PENDENT DE VERIFICAR', 'DUBTOSA')
      or d.verification_is_stale
      or coalesce(g.geo_status, 'PENDENT DE GEOLOCALITZAR') = 'PENDENT DE GEOLOCALITZAR'
      or (c.client_type_code = 'ALTRES' and nullif(btrim(coalesce(c.other_client_type, '')), '') is null)
      or exists (select 1 from public.duplicate_candidates dc
                  where dc.decision = 'PENDENT'
                    and (dc.left_client_id = c.id or dc.right_client_id = c.id))
    )`);
  }

  return { sql: parts.join('\n   and '), params };
}

const ORDER_SQL: Record<Ordre, (dir: string) => string> = {
  empresa: (dir) => `c.name ${dir}`,
  municipi: (dir) => `c.municipality ${dir} nulls last, c.name asc`,
  classificacio: (dir) =>
    `coalesce(c.confirmed_classification, c.proposed_classification) ${dir} nulls last, c.name asc`,
  contacte: (dir) => `d.last_contact_on ${dir} nulls last, c.name asc`,
  tasques: (dir) => `d.pending_tasks ${dir}, d.overdue_tasks ${dir}, c.name asc`,
  visita: (dir) => `d.next_visit_at ${dir} nulls last, c.name asc`,
};

export function buildOrderBy(f: ClientFilters): string {
  const dir = f.dir === 'desc' ? 'desc' : 'asc';
  return ORDER_SQL[f.ordre](dir);
}

// ---------------------------------------------------------------------------
// Columns
// ---------------------------------------------------------------------------

export interface ColumnDef {
  key: string;
  label: string;
  /** Shown when the user has never chosen. */
  byDefault: boolean;
  /** Sort key, when the column can order the list. */
  ordre?: Ordre;
}

/** EMPRESA is always present; everything else can be switched off. */
export const COLUMNS: readonly ColumnDef[] = [
  { key: 'municipi', label: 'MUNICIPI', byDefault: true, ordre: 'municipi' },
  { key: 'comarca', label: 'COMARCA', byDefault: false },
  { key: 'tipus', label: 'TIPUS', byDefault: true },
  { key: 'do', label: 'DO', byDefault: true },
  { key: 'classificacio', label: 'CLASSIFICACIÓ CONFIRMADA', byDefault: true, ordre: 'classificacio' },
  { key: 'ultim_contacte', label: 'ÚLTIM CONTACTE', byDefault: true, ordre: 'contacte' },
  { key: 'ultim_resultat', label: 'ÚLTIM RESULTAT', byDefault: false },
  { key: 'tasques', label: 'TASQUES PENDENTS', byDefault: true, ordre: 'tasques' },
  { key: 'propera_visita', label: 'PROPERA VISITA', byDefault: true, ordre: 'visita' },
  { key: 'contacte', label: 'CONTACTE PRINCIPAL', byDefault: true },
  { key: 'comercial', label: 'COMERCIAL', byDefault: true },
] as const;

export const COLUMNS_COOKIE = 'vitalpe_clients_columnes';
export const DENSITY_COOKIE = 'vitalpe_clients_densitat';

export function parseColumns(cookieValue: string | undefined): Set<string> {
  if (!cookieValue) return new Set(COLUMNS.filter((c) => c.byDefault).map((c) => c.key));
  const wanted = new Set(cookieValue.split(',').map((s) => s.trim()).filter(Boolean));
  const valid = new Set(COLUMNS.filter((c) => wanted.has(c.key)).map((c) => c.key));
  // An empty or corrupt cookie must never produce a table with one column.
  return valid.size > 0 ? valid : new Set(COLUMNS.filter((c) => c.byDefault).map((c) => c.key));
}
