import Link from 'next/link';
import { isManager, query, requireSession } from '@/lib/auth';
import { formatDate, formatTime, formatWeekday, relativeDays, TASK_TONE } from '@/lib/format';
import { TaskRowActions } from '@/components/task-row-actions';

export const dynamic = 'force-dynamic';

/**
 * INICI — what has to happen today.
 * No decorative charts: rows the user can act on, ordered by urgency.
 */

interface TaskRow {
  id: string;
  kind: string;
  action: string;
  other_action: string | null;
  title: string | null;
  due_at: string | null;
  priority: string;
  status: string;
  client_id: string | null;
  client_name: string | null;
  product_name: string | null;
  assignee: string | null;
  visit_id: string | null;
  sync_state: string | null;
  location_label: string | null;
}

interface VisitRow {
  id: string;
  client_id: string;
  client_name: string;
  starts_at: string;
  ends_at: string;
  status: string;
  objective: string | null;
  assignee: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  sync_state: string | null;
}

const TASK_SELECT = `
  select t.id, t.kind::text as kind, t.action::text as action, t.other_action, t.title,
         t.due_at, t.priority::text as priority, t.status::text as status,
         t.client_id, c.name as client_name, p.name as product_name,
         nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), '') as assignee,
         t.visit_id,
         cel.status::text as sync_state,
         nullif(concat_ws(', ', l.street, l.municipality), '') as location_label
    from public.tasks t
    left join public.clients c on c.id = t.client_id
    left join public.products p on p.id = t.product_id
    left join public.profiles pr on pr.id = t.assigned_to
    left join public.calendar_event_links cel on cel.task_id = t.id
    left join public.client_locations l on l.client_id = t.client_id and l.is_primary and l.deleted_at is null
   where t.workspace_id = $1 and t.deleted_at is null and t.status = 'PENDENT'`;

export default async function IniciPage({
  searchParams,
}: {
  searchParams: Promise<{ comercial?: string; error?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const manager = isManager(session.role);
  // A manager may look at the whole team; a commercial only ever sees their own.
  const filterUser = manager ? (params.comercial ?? '') : session.userId;

  const data = await query(session, async (q) => {
    const scope = filterUser ? 'and t.assigned_to = $2' : '';
    const scopeArgs = filterUser ? [session.workspaceId, filterUser] : [session.workspaceId];

    const [today, overdue, upcoming, undated, reminders, visits, colleagues, review, syncErrors] =
      await Promise.all([
        q.many<TaskRow>(
          `${TASK_SELECT} ${scope} and t.kind = 'TASCA'
             and t.due_at >= date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid'
             and t.due_at < (date_trunc('day', now() at time zone 'Europe/Madrid') + interval '1 day') at time zone 'Europe/Madrid'
           order by t.due_at, case t.priority when 'ALTA' then 1 when 'MITJANA' then 2 else 3 end`,
          scopeArgs,
        ),
        q.many<TaskRow>(
          `${TASK_SELECT} ${scope} and t.due_at is not null and t.due_at < now()
           order by t.due_at, case t.priority when 'ALTA' then 1 when 'MITJANA' then 2 else 3 end
           limit 50`,
          scopeArgs,
        ),
        q.many<TaskRow>(
          `${TASK_SELECT} ${scope} and t.kind = 'TASCA'
             and t.due_at >= (date_trunc('day', now() at time zone 'Europe/Madrid') + interval '1 day') at time zone 'Europe/Madrid'
             and t.due_at < (date_trunc('day', now() at time zone 'Europe/Madrid') + interval '8 days') at time zone 'Europe/Madrid'
           order by t.due_at limit 25`,
          scopeArgs,
        ),
        q.many<TaskRow>(
          `${TASK_SELECT} ${scope} and t.due_at is null
           order by case t.priority when 'ALTA' then 1 when 'MITJANA' then 2 else 3 end, c.name
           limit 15`,
          scopeArgs,
        ),
        q.many<TaskRow>(
          `${TASK_SELECT} ${scope} and t.kind = 'RECORDATORI' and t.due_at is not null
             and t.due_at < (date_trunc('day', now() at time zone 'Europe/Madrid') + interval '8 days') at time zone 'Europe/Madrid'
           order by t.due_at limit 15`,
          scopeArgs,
        ),
        q.many<VisitRow>(
          `select v.id, v.client_id, c.name as client_name, v.starts_at, v.ends_at,
                  v.status::text as status, v.objective,
                  nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), '') as assignee,
                  l.formatted_address as address, l.latitude, l.longitude,
                  cel.status::text as sync_state
             from public.visits v
             join public.clients c on c.id = v.client_id
             left join public.profiles pr on pr.id = v.user_id
             left join public.client_locations l on l.id = v.location_id
             left join public.calendar_event_links cel on cel.visit_id = v.id
            where v.workspace_id = $1 and v.deleted_at is null and v.status <> 'CANCEL·LADA'
              and v.starts_at >= date_trunc('day', now() at time zone 'Europe/Madrid') at time zone 'Europe/Madrid'
              and v.starts_at < (date_trunc('day', now() at time zone 'Europe/Madrid') + interval '1 day') at time zone 'Europe/Madrid'
              ${filterUser ? 'and v.user_id = $2' : ''}
            order by v.starts_at`,
          scopeArgs,
        ),
        manager
          ? q.many<{ id: string; name: string; pending: string }>(
              `select p.id, coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email) as name,
                      count(t.id) filter (where t.status = 'PENDENT' and t.deleted_at is null)::text as pending
                 from public.profiles p
                 join public.workspace_memberships m on m.user_id = p.id and m.workspace_id = $1 and m.status = 'ACTIU'
                 left join public.tasks t on t.assigned_to = p.id and t.workspace_id = $1
                group by p.id, name order by name`,
              [session.workspaceId],
            )
          : Promise.resolve([]),
        q.one<{ n: string }>(
          `select (
             (select count(*) from public.clients
               where workspace_id = $1 and deleted_at is null and confirmed_classification is null)
             + (select count(*) from public.duplicate_candidates
                 where workspace_id = $1 and decision = 'PENDENT')
           )::text as n`,
          [session.workspaceId],
        ),
        q.many<{ id: string; client_name: string; last_error: string | null }>(
          `select cel.id, c.name as client_name, cel.last_error
             from public.calendar_event_links cel
             join public.visits v on v.id = cel.visit_id
             join public.clients c on c.id = v.client_id
            where cel.workspace_id = $1 and cel.status = 'ERROR' limit 10`,
          [session.workspaceId],
        ),
      ]);

    return { today, overdue, upcoming, undated, reminders, visits, colleagues, review, syncErrors };
  });

  const highPriority = [...data.overdue, ...data.today, ...data.upcoming].filter(
    (t) => t.priority === 'ALTA',
  );

  return (
    <div className="grid gap-6 max-w-[1200px]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="etiqueta m-0">
            {formatWeekday(new Date())} · {formatDate(new Date())}
          </p>
          <h1 className="text-2xl font-semibold tracking-tight m-0">INICI</h1>
        </div>
        {manager && data.colleagues.length > 0 && (
          <form method="get" className="flex items-end gap-2">
            <label className="grid gap-1">
              <span className="etiqueta">COMERCIAL</span>
              <select name="comercial" defaultValue={filterUser} className="camp min-w-[190px]">
                <option value="">Tot l&apos;equip</option>
                {data.colleagues.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name} ({c.pending})
                  </option>
                ))}
              </select>
            </label>
            <button className="boto" type="submit">
              FILTRAR
            </button>
          </form>
        )}
      </header>

      {params.error === 'permisos' && (
        <p className="targeta p-3 m-0 text-[13px] border-l-[3px] border-l-[var(--color-danger)]">
          No tens permisos per accedir a aquella secció.
        </p>
      )}

      <Section title="VISITES D'AVUI" count={data.visits.length}>
        {data.visits.length === 0 ? (
          <Empty>Cap visita programada per avui.</Empty>
        ) : (
          <ul className="list-none p-0 m-0 grid gap-2">
            {data.visits.map((v) => (
              <li key={v.id} className="targeta p-3 flex flex-wrap items-center gap-x-4 gap-y-2">
                <span className="font-mono text-[15px] font-semibold tabular-nums">
                  {formatTime(v.starts_at)}–{formatTime(v.ends_at)}
                </span>
                <Link href={`/clients/${v.client_id}`} className="font-semibold">
                  {v.client_name}
                </Link>
                <span className="estat estat-marca">VISITA</span>
                {v.assignee && <span className="text-[12px] text-[var(--color-ink-faint)]">{v.assignee}</span>}
                {v.objective && (
                  <span className="text-[12px] text-[var(--color-ink-soft)] basis-full md:basis-auto">
                    {v.objective}
                  </span>
                )}
                <span className="ml-auto flex items-center gap-2">
                  <SyncBadge state={v.sync_state} />
                  {v.latitude !== null && v.longitude !== null ? (
                    <a
                      className="boto"
                      href={`https://www.google.com/maps/search/?api=1&query=${v.latitude},${v.longitude}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      MAPA
                    </a>
                  ) : v.address ? (
                    <a
                      className="boto"
                      href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(v.address)}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      MAPA
                    </a>
                  ) : null}
                  <Link className="boto" href={`/clients/${v.client_id}`}>
                    FITXA
                  </Link>
                </span>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <TaskSection title="TASQUES ENDARRERIDES" rows={data.overdue} tone="vencuda" />
      <TaskSection title="TASQUES D'AVUI" rows={data.today} tone="avui" />
      <TaskSection title="PROPERES TASQUES" rows={data.upcoming} />
      <TaskSection title="RECORDATORIS" rows={data.reminders} />

      {highPriority.length > 0 && (
        <Section title="IMPORTÀNCIA ALTA" count={highPriority.length}>
          <ul className="list-none p-0 m-0 grid gap-1">
            {highPriority.slice(0, 10).map((t) => (
              <li key={t.id} className="text-[13px] flex flex-wrap items-center gap-2">
                <span className="estat estat-perill">ALTA</span>
                <span className="tabular-nums text-[var(--color-ink-faint)]">
                  {t.due_at ? formatDate(t.due_at) : 'sense data'}
                </span>
                <Link href={t.client_id ? `/clients/${t.client_id}` : '/tasques'}>
                  {t.client_name ?? 'Sense empresa'}
                </Link>
                <span className="text-[var(--color-ink-soft)]">
                  {t.other_action ?? t.action}
                </span>
              </li>
            ))}
          </ul>
        </Section>
      )}

      {data.syncErrors.length > 0 && (
        <Section title="PENDENT DE SINCRONITZAR" count={data.syncErrors.length}>
          <ul className="list-none p-0 m-0 grid gap-1 text-[13px]">
            {data.syncErrors.map((e) => (
              <li key={e.id} className="flex items-center gap-2">
                <span className="estat estat-perill">ERROR</span>
                <span>{e.client_name}</span>
                <span className="text-[var(--color-ink-faint)]">{e.last_error ?? ''}</span>
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-[var(--color-ink-faint)] mt-2 mb-0">
            {session.role === 'ADMIN' ? (
              <>
                Revisa la connexió a <Link href="/administracio/integracions">INTEGRACIONS</Link>.
              </>
            ) : (
              'Avisa un administrador perquè revisi la connexió.'
            )}
          </p>
        </Section>
      )}

      {data.undated.length > 0 && (
        <Section title="PROPERES ACCIONS SENSE DATA" count={data.undated.length}>
          <p className="text-[12px] text-[var(--color-ink-faint)] mt-0">
            No compten com a vençudes ni ocupen el dia. Programa-les quan toqui.
          </p>
          <ul className="list-none p-0 m-0 grid gap-1 text-[13px]">
            {data.undated.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-2">
                <Link href={t.client_id ? `/clients/${t.client_id}` : '/tasques'}>
                  {t.client_name ?? 'Sense empresa'}
                </Link>
                <span className="text-[var(--color-ink-soft)]">{t.other_action ?? t.action}</span>
                <TaskRowActions task={{ id: t.id, undated: true, clientName: t.client_name }} />
              </li>
            ))}
          </ul>
        </Section>
      )}

      <p className="text-[12px] text-[var(--color-ink-faint)] m-0">
        {data.review?.n ?? '0'} elements pendents de revisar ·{' '}
        <Link href="/clients?vista=pendents">Obrir PENDENTS DE REVISAR</Link>
      </p>
    </div>
  );
}

function Section({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="etiqueta flex items-center gap-2 mb-2">
        {title}
        {count !== undefined && (
          <span className="text-[var(--color-ink-faint)] font-mono">({count})</span>
        )}
      </h2>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-[13px] text-[var(--color-ink-faint)] m-0 py-2">{children}</p>
  );
}

function SyncBadge({ state }: { state: string | null }) {
  if (!state) return null;
  const tone =
    state === 'SINCRONITZAT' ? 'estat-ok' : state === 'ERROR' ? 'estat-perill' : 'estat-neutre';
  return <span className={`estat ${tone}`}>{state}</span>;
}

function TaskSection({
  title,
  rows,
  tone,
}: {
  title: string;
  rows: TaskRow[];
  tone?: 'vencuda' | 'avui';
}) {
  if (rows.length === 0) {
    return (
      <Section title={title} count={0}>
        <Empty>Res pendent.</Empty>
      </Section>
    );
  }
  return (
    <Section title={title} count={rows.length}>
      <div className="taula-ampla targeta">
        <table className="taula">
          <thead>
            <tr>
              <th>DATA</th>
              <th>HORA</th>
              <th>IMPORTÀNCIA</th>
              <th>CLIENT</th>
              <th>ACCIÓ</th>
              <th>PRODUCTE</th>
              <th>COMERCIAL</th>
              <th>ESTAT</th>
              <th>SINCRONITZACIÓ</th>
              <th className="text-right">ACCIONS</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id} className={tone === 'vencuda' ? 'fila-vencuda' : tone === 'avui' ? 'fila-avui' : ''}>
                <td className="tabular-nums whitespace-nowrap">
                  {t.due_at ? formatDate(t.due_at) : '—'}
                  {tone === 'vencuda' && (
                    <span className="block text-[11px] text-[var(--color-danger)]">
                      {relativeDays(t.due_at)}
                    </span>
                  )}
                </td>
                <td className="tabular-nums">{t.due_at ? formatTime(t.due_at) : '—'}</td>
                <td>
                  <span
                    className={`estat ${
                      t.priority === 'ALTA'
                        ? 'estat-perill'
                        : t.priority === 'MITJANA'
                          ? 'estat-neutre'
                          : 'estat-neutre'
                    }`}
                  >
                    {t.priority}
                  </span>
                </td>
                <td>
                  {t.client_id ? (
                    <Link href={`/clients/${t.client_id}`}>{t.client_name}</Link>
                  ) : (
                    <span className="text-[var(--color-ink-faint)]">—</span>
                  )}
                </td>
                <td>{t.other_action ?? t.action}</td>
                <td className="text-[var(--color-ink-soft)]">{t.product_name ?? '—'}</td>
                <td className="text-[var(--color-ink-soft)]">{t.assignee ?? '—'}</td>
                <td>
                  <span className={TASK_TONE[t.status] ?? 'estat estat-neutre'}>{t.status}</span>
                </td>
                <td>
                  <SyncBadge state={t.sync_state} />
                </td>
                <td className="text-right">
                  <TaskRowActions
                    task={{ id: t.id, undated: t.due_at === null, clientName: t.client_name }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
