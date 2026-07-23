import Link from 'next/link';
import { cookies } from 'next/headers';
import { isManager, query, requireSession } from '@/lib/auth';
import { CLASSIFICATION_TONE, formatDate, formatDateTime, formatNumber, relativeDays } from '@/lib/format';
import { FiltresClients } from '@/components/clients/filtres-clients';
import { PreferenciesTaula } from '@/components/clients/preferencies-taula';
import {
  buildOrderBy,
  buildWhere,
  CLIENT_FROM,
  COLUMNS,
  COLUMNS_COOKIE,
  countActiveFilters,
  DENSITY_COOKIE,
  parseColumns,
  parseFilters,
  PER_PAGE,
  toQueryString,
  type ClientFilters,
  type Search,
} from './filters';

export const dynamic = 'force-dynamic';

/**
 * LLISTAT MARE — one row per company.
 *
 * Server rendered and paginated with a real LIMIT/OFFSET: the browser never
 * receives 800 companies. Filters live in the URL, column choice and density in
 * a cookie, and the CSV export re-applies the very same WHERE clause.
 */

interface Row {
  id: string;
  name: string;
  municipality: string | null;
  comarca: string | null;
  province: string | null;
  client_type_code: string | null;
  other_client_type: string | null;
  do_cava: boolean;
  do_penedes: boolean;
  do_catalunya: boolean;
  do_altres: boolean;
  confirmed_classification: string | null;
  proposed_classification: string | null;
  verification_status: string;
  verification_is_stale: boolean;
  has_classification_discrepancy: boolean;
  last_contact_on: string | null;
  last_result: string | null;
  pending_tasks: number;
  overdue_tasks: number;
  next_visit_at: string | null;
  primary_contact_name: string | null;
  primary_contact_phone: string | null;
  primary_contact_email: string | null;
  geo_status: string | null;
  owner_name: string | null;
}

const SELECT = `
  select c.id, c.name, c.municipality, c.comarca, c.province,
         c.client_type_code, c.other_client_type,
         c.do_cava, c.do_penedes, c.do_catalunya, c.do_altres,
         c.confirmed_classification::text as confirmed_classification,
         c.proposed_classification::text as proposed_classification,
         c.verification_status::text as verification_status,
         d.verification_is_stale, d.has_classification_discrepancy,
         d.last_contact_on, d.last_result::text as last_result,
         d.pending_tasks, d.overdue_tasks, d.next_visit_at,
         nullif(d.primary_contact_name, '') as primary_contact_name,
         d.primary_contact_phone, d.primary_contact_email,
         g.geo_status,
         nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), '') as owner_name`;

const VISTES = [
  { key: '', label: 'TOTES' },
  { key: 'actius', label: 'ACTIUS' },
  { key: 'potencials', label: 'POTENCIALS' },
  { key: 'pendents', label: 'PENDENTS DE REVISAR' },
] as const;

export default async function ClientsPage({
  searchParams,
}: {
  searchParams: Promise<Search>;
}): Promise<React.ReactElement> {
  const session = await requireSession();
  const search = await searchParams;
  const filters = parseFilters(search);
  const store = await cookies();
  const visible = parseColumns(store.get(COLUMNS_COOKIE)?.value);
  const density = store.get(DENSITY_COOKIE)?.value === 'compacta' ? 'compacta' : 'normal';

  const where = buildWhere(filters, session.workspaceId);
  const offset = (filters.pagina - 1) * PER_PAGE;

  const data = await query(session, async (q) => {
    const [rows, totals, counts, municipis, comarques, provincies, tipus, comercials, origens, unmapped] =
      await Promise.all([
        q.many<Row>(
          `${SELECT} ${CLIENT_FROM} where ${where.sql}
             order by ${buildOrderBy(filters)}
             limit ${PER_PAGE} offset ${offset}`,
          where.params,
        ),
        q.one<{ n: string }>(
          `select count(*)::text as n ${CLIENT_FROM} where ${where.sql}`,
          where.params,
        ),
        q.one<{ total: string; actius: string; potencials: string; pendents: string }>(
          `select count(*)::text as total,
                  count(*) filter (
                    where coalesce(c.confirmed_classification, c.proposed_classification) = 'ACTIU SEGUR'
                  )::text as actius,
                  count(*) filter (
                    where coalesce(c.confirmed_classification, c.proposed_classification)
                            in ('POTENCIAL INTERESSAT', 'POTENCIAL AMB UN ALTRE PROVEIDOR')
                  )::text as potencials,
                  count(*) filter (
                    where c.confirmed_classification is null
                       or d.has_classification_discrepancy
                       or c.verification_status in ('PENDENT DE VERIFICAR', 'DUBTOSA')
                       or d.verification_is_stale
                       or coalesce(g.geo_status, 'PENDENT DE GEOLOCALITZAR') = 'PENDENT DE GEOLOCALITZAR'
                  )::text as pendents
             ${CLIENT_FROM}
            where c.workspace_id = $1 and c.deleted_at is null`,
          [session.workspaceId],
        ),
        q.many<{ v: string }>(
          `select distinct municipality as v from public.clients
            where workspace_id = $1 and deleted_at is null and municipality is not null
            order by 1`,
          [session.workspaceId],
        ),
        q.many<{ v: string }>(
          `select distinct comarca as v from public.clients
            where workspace_id = $1 and deleted_at is null and comarca is not null
            order by 1`,
          [session.workspaceId],
        ),
        q.many<{ v: string }>(
          `select distinct province as v from public.clients
            where workspace_id = $1 and deleted_at is null and province is not null
            order by 1`,
          [session.workspaceId],
        ),
        q.many<{ code: string; label: string }>(
          `select code, label from public.client_types where is_active order by sort_order, label`,
        ),
        q.many<{ id: string; name: string }>(
          `select p.id, coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email) as name
             from public.profiles p
             join public.workspace_memberships m
               on m.user_id = p.id and m.workspace_id = $1 and m.status = 'ACTIU'
            order by name`,
          [session.workspaceId],
        ),
        q.many<{ v: string }>(
          `select source as v, count(*) as n from public.client_aliases
            where workspace_id = $1 and source is not null
            group by 1 having count(*) > 2 order by n desc`,
          [session.workspaceId],
        ),
        q.one<{ n: string }>(
          `select coalesce(sum(occurrences), 0)::text as n from public.unmapped_values
            where workspace_id = $1 and resolved_at is null`,
          [session.workspaceId],
        ),
      ]);
    return { rows, totals, counts, municipis, comarques, provincies, tipus, comercials, origens, unmapped };
  });

  const total = Number(data.totals?.n ?? '0');
  const pages = Math.max(1, Math.ceil(total / PER_PAGE));
  const manager = isManager(session.role);
  const actius = countActiveFilters(filters);

  return (
    <div className="grid gap-4 max-w-[1500px]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="etiqueta m-0">CARTERA</p>
          <h1 className="text-2xl font-semibold tracking-tight m-0">CLIENTS</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <PreferenciesTaula
            columns={COLUMNS.map((c) => ({ key: c.key, label: c.label }))}
            visible={[...visible]}
            density={density}
          />
          <a className="boto" href={`/clients/exportacio${toQueryString(filters, { pagina: '' })}`}>
            EXPORTAR CSV
          </a>
        </div>
      </header>

      <nav aria-label="Vistes automàtiques">
        <ul className="list-none p-0 m-0 flex flex-wrap gap-1 border-b border-[var(--color-line-strong)]">
          {VISTES.map((v) => {
            const active = filters.vista === v.key;
            const count =
              v.key === ''
                ? data.counts?.total
                : v.key === 'actius'
                  ? data.counts?.actius
                  : v.key === 'potencials'
                    ? data.counts?.potencials
                    : data.counts?.pendents;
            return (
              <li key={v.key || 'totes'}>
                <Link
                  href={`/clients${toQueryString(filters, { vista: v.key, pagina: '' })}`}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex items-center gap-2 px-3 py-2 text-[12px] font-semibold uppercase tracking-wide no-underline border border-b-0 rounded-t-[var(--radius-sm)] ${
                    active
                      ? 'bg-[var(--color-paper-raised)] border-[var(--color-line-strong)] text-[var(--color-burgundy)]'
                      : 'bg-transparent border-transparent text-[var(--color-ink-soft)]'
                  }`}
                >
                  {v.label}
                  <span className="font-mono text-[var(--color-ink-faint)]">
                    {formatNumber(count ?? '0')}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {filters.vista === 'pendents' && (
        <p className="targeta p-3 m-0 text-[12px] text-[var(--color-ink-soft)] border-l-[3px] border-l-[var(--color-warn)]">
          PENDENTS DE REVISAR apila tot el que necessita una decisió humana: classificació sense
          confirmar, dades contradictòries, verificació caducada, empreses sense ubicació i
          duplicats pendents.{' '}
          {Number(data.unmapped?.n ?? '0') > 0 && (
            <>
              Hi ha {formatNumber(data.unmapped?.n ?? '0')} valors d&apos;importació sense mapar; es
              revisen a{' '}
              <Link href="/administracio/importacions">IMPORTACIONS</Link>, perquè no pengen de cap
              empresa concreta.
            </>
          )}
        </p>
      )}

      <FiltresClients
        actius={actius}
        values={{
          q: filters.q,
          municipi: filters.municipi,
          comarca: filters.comarca,
          provincia: filters.provincia,
          tipus: filters.tipus,
          do: filters.do,
          confirmada: filters.confirmada,
          proposada: filters.proposada,
          verificacio: filters.verificacio,
          comercial: filters.comercial,
          tasques: filters.tasques,
          sensecontacte: filters.sensecontacte,
          pendentverificar: filters.pendentverificar,
          propervisita: filters.propervisita,
          geo: filters.geo,
          conflicte: filters.conflicte,
          origen: filters.origen,
          vista: filters.vista,
          ordre: filters.ordre,
          dir: filters.dir,
        }}
        options={{
          municipis: data.municipis.map((r) => r.v),
          comarques: data.comarques.map((r) => r.v),
          provincies: data.provincies.map((r) => r.v),
          tipus: data.tipus,
          comercials: manager
            ? data.comercials
            : data.comercials.filter((c) => c.id === session.userId),
          origens: data.origens.map((r) => r.v),
        }}
      />

      <p className="text-[12px] text-[var(--color-ink-faint)] m-0" aria-live="polite">
        {formatNumber(total)} {total === 1 ? 'empresa' : 'empreses'}
        {total > 0 && ` · pàgina ${filters.pagina} de ${pages}`}
        {actius > 0 && ` · ${actius} ${actius === 1 ? 'filtre actiu' : 'filtres actius'}`}
      </p>

      {data.rows.length === 0 ? (
        <p className="targeta p-4 m-0 text-[13px]">
          Cap empresa coincideix amb aquests filtres.{' '}
          <Link href={filters.vista ? `/clients?vista=${filters.vista}` : '/clients'}>
            Netejar els filtres
          </Link>
          .
        </p>
      ) : (
        <div className="taula-ampla targeta max-h-[70vh] overflow-y-auto">
          <table className={`taula ${density === 'compacta' ? 'taula-compacta' : ''}`}>
            <caption className="sr-only">
              Llistat d&apos;empreses, una fila per empresa, ordenat per {filters.ordre}.
            </caption>
            <thead>
              <tr>
                <Th filters={filters} ordre="empresa">
                  EMPRESA
                </Th>
                {COLUMNS.filter((c) => visible.has(c.key)).map((column) => (
                  <Th key={column.key} filters={filters} ordre={column.ordre}>
                    {column.label}
                  </Th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.rows.map((row) => (
                <tr key={row.id} className={row.overdue_tasks > 0 ? 'fila-vencuda' : ''}>
                  <td>
                    <Link href={`/clients/${row.id}`} className="font-semibold">
                      {row.name}
                    </Link>
                    <span className="flex flex-wrap gap-1 mt-1">
                      {row.geo_status === 'PENDENT DE GEOLOCALITZAR' && (
                        <span className="estat estat-neutre">SENSE UBICACIÓ</span>
                      )}
                      {row.has_classification_discrepancy && (
                        <span className="estat estat-avis">CONFLICTE DE DADES</span>
                      )}
                    </span>
                  </td>
                  {visible.has('municipi') && (
                    <td>{row.municipality ?? <Buit />}</td>
                  )}
                  {visible.has('comarca') && <td>{row.comarca ?? <Buit />}</td>}
                  {visible.has('tipus') && (
                    <td className="whitespace-nowrap">
                      {row.client_type_code
                        ? row.client_type_code === 'ALTRES'
                          ? `ALTRES · ${row.other_client_type ?? 'PENDENT DE REVISAR'}`
                          : row.client_type_code
                        : <Buit text="NO DETERMINAT" />}
                    </td>
                  )}
                  {visible.has('do') && (
                    <td>
                      <Dos row={row} />
                    </td>
                  )}
                  {visible.has('classificacio') && (
                    <td>
                      <Classificacio row={row} />
                    </td>
                  )}
                  {visible.has('ultim_contacte') && (
                    <td className="whitespace-nowrap tabular-nums">
                      {row.last_contact_on ? (
                        <>
                          {formatDate(row.last_contact_on)}
                          <span className="block text-[11px] text-[var(--color-ink-faint)]">
                            {relativeDays(row.last_contact_on)}
                          </span>
                        </>
                      ) : (
                        <Buit text="SENSE CONTACTE" />
                      )}
                    </td>
                  )}
                  {visible.has('ultim_resultat') && (
                    <td className="text-[var(--color-ink-soft)]">{row.last_result ?? <Buit />}</td>
                  )}
                  {visible.has('tasques') && (
                    <td className="tabular-nums">
                      {row.pending_tasks > 0 ? (
                        <span className="inline-flex items-center gap-2">
                          {row.pending_tasks}
                          {row.overdue_tasks > 0 && (
                            <span className="estat estat-perill">
                              {row.overdue_tasks} VENÇUDES
                            </span>
                          )}
                        </span>
                      ) : (
                        <span className="text-[var(--color-ink-faint)]">0</span>
                      )}
                    </td>
                  )}
                  {visible.has('propera_visita') && (
                    <td className="whitespace-nowrap tabular-nums">
                      {row.next_visit_at ? formatDateTime(row.next_visit_at) : <Buit />}
                    </td>
                  )}
                  {visible.has('contacte') && (
                    <td>
                      {row.primary_contact_name ?? <Buit />}
                      {(row.primary_contact_phone ?? row.primary_contact_email) && (
                        <span className="block text-[11px] text-[var(--color-ink-faint)]">
                          {row.primary_contact_phone ?? row.primary_contact_email}
                        </span>
                      )}
                    </td>
                  )}
                  {visible.has('comercial') && (
                    <td className="text-[var(--color-ink-soft)]">
                      {row.owner_name ?? <Buit text="SENSE ASSIGNAR" />}
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {pages > 1 && (
        <nav className="flex items-center gap-2 flex-wrap" aria-label="Paginació">
          <PageLink filters={filters} page={1} disabled={filters.pagina === 1}>
            PRIMERA
          </PageLink>
          <PageLink
            filters={filters}
            page={filters.pagina - 1}
            disabled={filters.pagina <= 1}
          >
            ANTERIOR
          </PageLink>
          <span className="text-[12px] text-[var(--color-ink-soft)] tabular-nums">
            {filters.pagina} / {pages}
          </span>
          <PageLink
            filters={filters}
            page={filters.pagina + 1}
            disabled={filters.pagina >= pages}
          >
            SEGÜENT
          </PageLink>
          <PageLink filters={filters} page={pages} disabled={filters.pagina === pages}>
            ÚLTIMA
          </PageLink>
        </nav>
      )}
    </div>
  );
}

function Buit({ text = '—' }: { text?: string }): React.ReactElement {
  return <span className="text-[var(--color-ink-faint)]">{text}</span>;
}

function Th({
  children,
  filters,
  ordre,
}: {
  children: React.ReactNode;
  filters: ClientFilters;
  ordre?: string;
}): React.ReactElement {
  if (!ordre) return <th scope="col">{children}</th>;
  const active = filters.ordre === ordre;
  const nextDir = active && filters.dir === 'asc' ? 'desc' : 'asc';
  return (
    <th scope="col" aria-sort={active ? (filters.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <Link
        href={`/clients${toQueryString(filters, { ordre, dir: nextDir, pagina: '' })}`}
        className="no-underline text-inherit inline-flex items-center gap-1"
      >
        {children}
        <span aria-hidden="true">{active ? (filters.dir === 'asc' ? '▲' : '▼') : '↕'}</span>
      </Link>
    </th>
  );
}

function PageLink({
  filters,
  page,
  disabled,
  children,
}: {
  filters: ClientFilters;
  page: number;
  disabled: boolean;
  children: React.ReactNode;
}): React.ReactElement {
  if (disabled) {
    return (
      <span className="boto opacity-50 cursor-not-allowed" aria-disabled="true">
        {children}
      </span>
    );
  }
  return (
    <Link className="boto" href={`/clients${toQueryString(filters, { pagina: String(page) })}`}>
      {children}
    </Link>
  );
}

function Dos({ row }: { row: Row }): React.ReactElement {
  const tags = [
    row.do_cava && 'CAVA',
    row.do_penedes && 'PENEDÈS',
    row.do_catalunya && 'CATALUNYA',
    row.do_altres && 'ALTRES',
  ].filter(Boolean) as string[];
  if (tags.length === 0) return <Buit />;
  return (
    <span className="flex flex-wrap gap-1">
      {tags.map((tag) => (
        <span key={tag} className="estat estat-marca">
          {tag}
        </span>
      ))}
    </span>
  );
}

function Classificacio({ row }: { row: Row }): React.ReactElement {
  if (row.confirmed_classification) {
    return (
      <span className="flex flex-wrap gap-1">
        <span className={CLASSIFICATION_TONE[row.confirmed_classification] ?? 'estat estat-neutre'}>
          {row.confirmed_classification}
        </span>
        {row.has_classification_discrepancy && (
          <span className="estat estat-avis">PROPOSTA: {row.proposed_classification}</span>
        )}
      </span>
    );
  }
  if (row.proposed_classification) {
    return (
      <span className="flex flex-wrap gap-1">
        <span className="estat estat-neutre">PROPOSTA PENDENT</span>
        <span className="text-[11px] text-[var(--color-ink-soft)] self-center">
          {row.proposed_classification}
        </span>
      </span>
    );
  }
  return <span className="estat estat-neutre">PENDENT DE REVISAR</span>;
}
