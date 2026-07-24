import Link from 'next/link';
import { query, requireRole } from '@/lib/auth';
import { formatDate, formatDateTime, formatLiters, formatNumber, relativeDays } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * SUPERVISIÓ — what the manager sees.
 *
 * Vitalpe has one salesperson. His manager does not work the portfolio; she
 * wants to know what he has been doing: visits made and what was said in them,
 * calls and their outcome, what is closing, what is overdue. So this is a
 * narrative of activity, not a console: there is not a single control on this
 * page that changes data, and the database would refuse it anyway (migration
 * 0008 — the supervisor tier is SELECT-only).
 *
 * Deliberately not here: revenue targets, conversion funnels, decorative
 * charts. Those measure a sales team. This measures whether one person's week
 * went well.
 */

const PERIODS = { '7': '7 DIES', '30': '30 DIES', '90': '90 DIES' } as const;
type Period = keyof typeof PERIODS;

interface ActivityRow {
  occurred_on: string;
  activity_type: string;
  result: string | null;
  notes: string | null;
  client_id: string;
  client_name: string;
  who: string | null;
  product: string | null;
}

interface VisitRow {
  id: string;
  starts_at: string;
  status: string;
  client_id: string;
  client_name: string;
  municipality: string | null;
  objective: string | null;
  notes_after: string | null;
  result: string | null;
  who: string | null;
}

export default async function SupervisioPage({
  searchParams,
}: {
  searchParams: Promise<{ dies?: string }>;
}) {
  const session = await requireRole('ADMIN', 'GERENT');
  const params = await searchParams;
  const period: Period = params.dies === '7' || params.dies === '90' ? params.dies : '30';
  const days = Number(period);

  const data = await query(session, async (q) => {
    const args = [session.workspaceId, days];

    const [totals, activities, visits, wins, overdue, upcoming, silent] = await Promise.all([
      q.one<Record<string, string>>(
        `select
           (select count(*) from public.activities
             where workspace_id = $1 and deleted_at is null
               and occurred_on >= current_date - ($2 || ' days')::interval)::text as accions,
           (select count(*) from public.visits
             where workspace_id = $1 and deleted_at is null and status = 'FETA'
               and starts_at >= now() - ($2 || ' days')::interval)::text as visites_fetes,
           (select count(*) from public.tasks
             where workspace_id = $1 and deleted_at is null and status = 'FET'
               and completed_at >= now() - ($2 || ' days')::interval)::text as tasques_fetes,
           (select count(*) from public.tasks
             where workspace_id = $1 and deleted_at is null and status = 'PENDENT'
               and due_at is not null and due_at < now())::text as vencudes,
           (select count(*) from public.clients
             where workspace_id = $1 and deleted_at is null
               and confirmed_classification = 'ACTIU SEGUR')::text as actius,
           (select coalesce(round(sum(volume_liters)), 0)::text from public.opportunities
             where workspace_id = $1 and deleted_at is null
               and data_type = 'PREVISIO CONFIRMADA') as litres_previstos`,
        [session.workspaceId, days],
      ),

      q.many<ActivityRow>(
        `select a.occurred_on::text as occurred_on, a.activity_type::text as activity_type,
                a.result::text as result, a.notes, a.client_id::text as client_id,
                c.name as client_name, p.name as product,
                coalesce(nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.email) as who
           from public.activities a
           join public.clients c on c.id = a.client_id
           left join public.profiles pr on pr.id = a.user_id
           left join public.products p on p.id = a.product_id
          where a.workspace_id = $1 and a.deleted_at is null
            and a.occurred_on >= current_date - ($2 || ' days')::interval
          order by a.occurred_on desc, a.created_at desc
          limit 60`,
        args,
      ),

      q.many<VisitRow>(
        `select v.id::text as id, v.starts_at::text as starts_at, v.status::text as status,
                v.client_id::text as client_id, c.name as client_name, c.municipality,
                v.objective, v.notes_after, v.result::text as result,
                coalesce(nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), ''), pr.email) as who
           from public.visits v
           join public.clients c on c.id = v.client_id
           left join public.profiles pr on pr.id = v.user_id
          where v.workspace_id = $1 and v.deleted_at is null
            and v.starts_at >= now() - ($2 || ' days')::interval
            and v.starts_at <= now()
          order by v.starts_at desc
          limit 30`,
        args,
      ),

      // "Wins": what the commercial actually brought home, in the client's words.
      q.many<{ client_id: string; client_name: string; result: string; occurred_on: string; notes: string | null }>(
        `select a.client_id::text as client_id, c.name as client_name,
                a.result::text as result, a.occurred_on::text as occurred_on, a.notes
           from public.activities a
           join public.clients c on c.id = a.client_id
          where a.workspace_id = $1 and a.deleted_at is null
            and a.occurred_on >= current_date - ($2 || ' days')::interval
            and a.result in ('INTERES CONCRET','DEMANA PREUS','DEMANA MOSTRES',
                             'ACORDAR VISITA','REPETIRA COMANDA')
          order by a.occurred_on desc limit 25`,
        args,
      ),

      q.many<{ client_id: string; client_name: string; action: string; due_at: string; priority: string }>(
        `select t.client_id::text as client_id, c.name as client_name,
                coalesce(t.other_action, t.action::text) as action,
                t.due_at::text as due_at, t.priority::text as priority
           from public.tasks t
           join public.clients c on c.id = t.client_id
          where t.workspace_id = $1 and t.deleted_at is null and t.status = 'PENDENT'
            and t.due_at is not null and t.due_at < now()
          order by t.due_at limit 20`,
        [session.workspaceId],
      ),

      q.many<{ client_id: string; client_name: string; starts_at: string; municipality: string | null }>(
        `select v.client_id::text as client_id, c.name as client_name,
                v.starts_at::text as starts_at, c.municipality
           from public.visits v
           join public.clients c on c.id = v.client_id
          where v.workspace_id = $1 and v.deleted_at is null
            and v.status in ('PLANIFICADA','CONFIRMADA') and v.starts_at >= now()
          order by v.starts_at limit 15`,
        [session.workspaceId],
      ),

      // Companies that matter and have gone quiet: the thing a supervisor is
      // actually placed to notice.
      q.many<{ client_id: string; client_name: string; last_contact: string | null }>(
        `select c.id::text as client_id, c.name as client_name,
                d.last_contact_on::text as last_contact
           from public.clients c
           join public.v_client_derived d on d.client_id = c.id
          where c.workspace_id = $1 and c.deleted_at is null
            and c.confirmed_classification in ('ACTIU SEGUR','POTENCIAL INTERESSAT')
            and (d.last_contact_on is null or d.last_contact_on < current_date - interval '60 days')
          order by d.last_contact_on nulls first limit 15`,
        [session.workspaceId],
      ),
    ]);

    return { totals, activities, visits, wins, overdue, upcoming, silent };
  });

  const t = data.totals ?? {};

  return (
    <div className="grid gap-6 max-w-[1150px]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="etiqueta m-0">VITALPE</p>
          <h1 className="text-2xl font-semibold tracking-tight m-0">SUPERVISIÓ</h1>
          <p className="text-[13px] text-[var(--color-ink-soft)] mt-1 mb-0 max-w-[64ch]">
            Què s&apos;ha fet, amb qui, i què s&apos;hi ha dit. Aquesta pantalla només mira:
            no hi ha cap control que canviï dades.
          </p>
        </div>
        <nav className="flex gap-1" aria-label="Període">
          {(Object.keys(PERIODS) as Period[]).map((p) => (
            <Link
              key={p}
              href={`/supervisio?dies=${p}`}
              className={`boto ${p === period ? 'boto-principal' : ''}`}
            >
              {PERIODS[p]}
            </Link>
          ))}
        </nav>
      </header>

      {/* ---------------- the week in six numbers ---------------- */}
      <section className="grid gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {[
          ['ACCIONS', t.accions, null],
          ['VISITES FETES', t.visites_fetes, null],
          ['TASQUES TANCADES', t.tasques_fetes, null],
          ['VENÇUDES', t.vencudes, Number(t.vencudes ?? 0) > 0 ? 'perill' : null],
          ['CLIENTS ACTIUS', t.actius, null],
          ['LITRES PREVISTOS', t.litres_previstos ? formatLiters(t.litres_previstos) : '—', null],
        ].map(([label, value, tone]) => (
          <div key={String(label)} className="targeta p-3">
            <p className="etiqueta m-0">{label}</p>
            <p
              className={`m-0 text-[22px] font-semibold tabular-nums ${
                tone === 'perill' ? 'text-[var(--color-danger)]' : ''
              }`}
            >
              {typeof value === 'string' && value.includes('L') ? value : formatNumber(value as string)}
            </p>
          </div>
        ))}
      </section>

      {/* ---------------- visits, with what was said ---------------- */}
      <section>
        <h2 className="etiqueta mb-2">VISITES FETES ({data.visits.length})</h2>
        {data.visits.length === 0 ? (
          <p className="targeta p-3 m-0 text-[13px] text-[var(--color-ink-faint)]">
            Cap visita registrada en aquest període.
          </p>
        ) : (
          <ul className="list-none p-0 m-0 grid gap-2">
            {data.visits.map((v) => (
              <li key={v.id} className="targeta p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="tabular-nums text-[13px] text-[var(--color-ink-faint)]">
                    {formatDate(v.starts_at)}
                  </span>
                  <Link href={`/clients/${v.client_id}`} className="font-semibold">
                    {v.client_name}
                  </Link>
                  {v.municipality && (
                    <span className="text-[12px] text-[var(--color-ink-faint)]">{v.municipality}</span>
                  )}
                  <span className={`estat ${v.status === 'FETA' ? 'estat-ok' : 'estat-neutre'}`}>
                    {v.status}
                  </span>
                  {v.result && <span className="estat estat-marca">{v.result}</span>}
                  {v.who && (
                    <span className="text-[12px] text-[var(--color-ink-faint)] ml-auto">{v.who}</span>
                  )}
                </div>
                {(v.objective || v.notes_after) && (
                  <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 m-0 mt-2 text-[13px]">
                    {v.objective && (
                      <>
                        <dt className="etiqueta">OBJECTIU</dt>
                        <dd className="m-0">{v.objective}</dd>
                      </>
                    )}
                    {v.notes_after && (
                      <>
                        <dt className="etiqueta">OBSERVACIONS</dt>
                        <dd className="m-0">{v.notes_after}</dd>
                      </>
                    )}
                  </dl>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* ---------------- wins ---------------- */}
        <section>
          <h2 className="etiqueta mb-2">EL QUE S&apos;HA GUANYAT ({data.wins.length})</h2>
          {data.wins.length === 0 ? (
            <p className="targeta p-3 m-0 text-[13px] text-[var(--color-ink-faint)]">
              Cap resultat concret registrat en aquest període.
            </p>
          ) : (
            <ul className="list-none p-0 m-0 grid gap-1">
              {data.wins.map((w, i) => (
                <li key={i} className="targeta p-3 text-[13px]">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="estat estat-ok">{w.result}</span>
                    <Link href={`/clients/${w.client_id}`}>{w.client_name}</Link>
                    <span className="text-[12px] text-[var(--color-ink-faint)] ml-auto tabular-nums">
                      {formatDate(w.occurred_on)}
                    </span>
                  </div>
                  {w.notes && <p className="m-0 mt-1 text-[var(--color-ink-soft)]">{w.notes}</p>}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* ---------------- what needs attention ---------------- */}
        <section className="grid gap-4">
          <div>
            <h2 className="etiqueta mb-2">PROPERES VISITES ({data.upcoming.length})</h2>
            {data.upcoming.length === 0 ? (
              <p className="targeta p-3 m-0 text-[13px] text-[var(--color-ink-faint)]">
                Cap visita programada.
              </p>
            ) : (
              <ul className="list-none p-0 m-0 grid gap-1 text-[13px]">
                {data.upcoming.map((v, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <span className="tabular-nums text-[var(--color-ink-faint)]">
                      {formatDateTime(v.starts_at)}
                    </span>
                    <Link href={`/clients/${v.client_id}`}>{v.client_name}</Link>
                    {v.municipality && (
                      <span className="text-[12px] text-[var(--color-ink-faint)]">{v.municipality}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {data.overdue.length > 0 && (
            <div>
              <h2 className="etiqueta mb-2">TASQUES VENÇUDES ({data.overdue.length})</h2>
              <ul className="list-none p-0 m-0 grid gap-1 text-[13px]">
                {data.overdue.map((o, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <span className={`estat ${o.priority === 'ALTA' ? 'estat-perill' : 'estat-neutre'}`}>
                      {o.priority}
                    </span>
                    <Link href={`/clients/${o.client_id}`}>{o.client_name}</Link>
                    <span className="text-[var(--color-ink-soft)]">{o.action}</span>
                    <span className="text-[12px] text-[var(--color-danger)] ml-auto">
                      {relativeDays(o.due_at)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {data.silent.length > 0 && (
            <div>
              <h2 className="etiqueta mb-2">CLIENTS QUE PORTEN TEMPS SENSE CONTACTE</h2>
              <p className="text-[12px] text-[var(--color-ink-faint)] mt-0">
                Actius o interessats sense cap acció des de fa més de 60 dies.
              </p>
              <ul className="list-none p-0 m-0 grid gap-1 text-[13px]">
                {data.silent.map((s, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2">
                    <Link href={`/clients/${s.client_id}`}>{s.client_name}</Link>
                    <span className="text-[12px] text-[var(--color-ink-faint)] ml-auto">
                      {s.last_contact ? `últim contacte ${formatDate(s.last_contact)}` : 'mai contactat'}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      {/* ---------------- the log ---------------- */}
      <section>
        <h2 className="etiqueta mb-2">ACTIVITAT REGISTRADA ({data.activities.length})</h2>
        <div className="taula-ampla targeta">
          <table className="taula taula-compacta">
            <thead>
              <tr>
                <th>DATA</th>
                <th>CLIENT</th>
                <th>ACCIÓ</th>
                <th>RESULTAT</th>
                <th>PRODUCTE</th>
                <th>OBSERVACIONS</th>
              </tr>
            </thead>
            <tbody>
              {data.activities.map((a, i) => (
                <tr key={i}>
                  <td className="tabular-nums whitespace-nowrap">{formatDate(a.occurred_on)}</td>
                  <td>
                    <Link href={`/clients/${a.client_id}`}>{a.client_name}</Link>
                  </td>
                  <td>{a.activity_type}</td>
                  <td>
                    {a.result ? <span className="estat estat-neutre">{a.result}</span> : '—'}
                  </td>
                  <td className="text-[var(--color-ink-soft)]">{a.product ?? '—'}</td>
                  <td className="text-[var(--color-ink-soft)]">{a.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
