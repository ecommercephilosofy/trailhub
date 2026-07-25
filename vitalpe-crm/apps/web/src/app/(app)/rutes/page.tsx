import Link from 'next/link';
import { query, requireSession } from '@/lib/auth';
import { formatDate, formatLiters, formatWeekday } from '@/lib/format';
import { planWeek, type RouteCandidate } from '@vitalpe/domain';

export const dynamic = 'force-dynamic';

/**
 * RUTES — the suggested week.
 *
 * A suggestion, not an itinerary. There are no coordinates in this portfolio,
 * so the plan groups by comarca (a day's driving stays in one) and orders by
 * urgency inside the day. It never claims to be the shortest path, and every
 * stop shows the reasons it was picked so the commercial can overrule it — he
 * is the one who knows which cellar is shut on Mondays.
 */

interface Row {
  client_id: string;
  name: string;
  municipality: string | null;
  province: string | null;
  classification: string | null;
  priority: string | null;
  open_tasks: string;
  overdue_tasks: string;
  next_due_at: string | null;
  last_contact_at: string | null;
  volume_liters: string | null;
  has_visit: boolean;
  latitude: number | null;
  longitude: number | null;
}

export default async function RutesPage({
  searchParams,
}: {
  searchParams: Promise<{ dies?: string; parades?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const maxStopsPerDay = Math.min(8, Math.max(2, Number(params.parades ?? '5') || 5));

  const rows = await query(session, async (q) =>
    q.many<Row>(
      `select c.id as client_id,
              c.name,
              c.municipality,
              c.province,
              coalesce(c.confirmed_classification::text, c.proposed_classification::text) as classification,
              -- The highest priority among the open tasks stands for the company.
              (select min(case t.priority when 'ALTA' then 1 when 'MITJANA' then 2 else 3 end)
                 from public.tasks t
                where t.client_id = c.id and t.deleted_at is null and t.status = 'PENDENT') as priority_rank,
              (select count(*) from public.tasks t
                where t.client_id = c.id and t.deleted_at is null and t.status = 'PENDENT')::text as open_tasks,
              (select count(*) from public.tasks t
                where t.client_id = c.id and t.deleted_at is null and t.status = 'PENDENT'
                  and t.due_at is not null and t.due_at < now())::text as overdue_tasks,
              (select min(t.due_at)::text from public.tasks t
                where t.client_id = c.id and t.deleted_at is null and t.status = 'PENDENT'
                  and t.due_at is not null) as next_due_at,
              (select max(a.occurred_on)::text from public.activities a
                where a.client_id = c.id and a.deleted_at is null) as last_contact_at,
              (select sum(o.volume_liters)::text from public.opportunities o
                where o.client_id = c.id and o.deleted_at is null) as volume_liters,
              exists (select 1 from public.visits v
                       where v.client_id = c.id and v.deleted_at is null
                         and v.status <> 'CANCEL·LADA' and v.starts_at >= now()) as has_visit,
              (select l.latitude from public.client_locations l
                where l.client_id = c.id and l.deleted_at is null and l.latitude is not null
                order by l.is_primary desc limit 1) as latitude,
              (select l.longitude from public.client_locations l
                where l.client_id = c.id and l.deleted_at is null and l.longitude is not null
                order by l.is_primary desc limit 1) as longitude
         from public.clients c
        where c.workspace_id = $1 and c.deleted_at is null and c.in_working_list`,
      [session.workspaceId],
    ),
  );

  const PRIORITY_BY_RANK: Record<string, string> = { '1': 'ALTA', '2': 'MITJANA', '3': 'BAIXA' };

  const candidates: RouteCandidate[] = rows.map((row) => {
    const rank = (row as unknown as { priority_rank: number | null }).priority_rank;
    return {
      clientId: row.client_id,
      name: row.name,
      municipality: row.municipality,
      province: row.province,
      classification: row.classification,
      priority: rank === null || rank === undefined ? null : (PRIORITY_BY_RANK[String(rank)] ?? null),
      openTasks: Number(row.open_tasks ?? '0'),
      overdueTasks: Number(row.overdue_tasks ?? '0'),
      nextDueAt: row.next_due_at,
      lastContactAt: row.last_contact_at,
      volumeLiters: row.volume_liters === null ? null : Number(row.volume_liters),
      hasScheduledVisit: row.has_visit,
      latitude: row.latitude,
      longitude: row.longitude,
    };
  });

  const plan = planWeek(candidates, { now: new Date(), maxStopsPerDay });
  const planned = plan.days.reduce((n, d) => n + d.stops.length, 0);
  const geocoded = candidates.filter((c) => c.latitude !== null && c.latitude !== undefined).length;

  return (
    <div className="grid gap-6 max-w-[1100px]">
      <header>
        <p className="etiqueta m-0">PROPOSTA</p>
        <h1 className="text-2xl font-semibold tracking-tight m-0">
          RUTA DE LA SETMANA DEL {formatDate(plan.weekStart)}
        </h1>
        <p className="text-[13px] text-[var(--color-ink-soft)] mt-1 mb-0 max-w-[70ch]">
          Un dia, una comarca: així no es fan tres hores de cotxe per veure dos cellers. La
          urgència tria <em>a qui</em> veure; quan totes les parades del dia estan geolocalitzades,
          la distància decideix <em>en quin ordre</em> i es mostren els quilòmetres. Segueix sent
          una proposta: canvia-la sense pensar-t&apos;ho, tu saps quin celler tanca els dilluns.
        </p>
        {geocoded < candidates.length && (
          <p className="text-[12px] text-[var(--color-ink-faint)] mt-1 mb-0">
            {geocoded} de {candidates.length} empreses tenen coordenades. Les altres s&apos;agrupen
            per comarca però no s&apos;ordenen per distància — executa <code>pnpm geocodifica</code>.
          </p>
        )}
      </header>

      <form className="targeta p-3 flex flex-wrap items-end gap-3">
        <label className="grid gap-1">
          <span className="etiqueta">VISITES PER DIA</span>
          <input
            className="camp w-[110px]"
            type="number"
            name="parades"
            min={2}
            max={8}
            defaultValue={maxStopsPerDay}
          />
        </label>
        <button className="boto" type="submit">
          RECALCULAR
        </button>
        <span className="text-[12px] text-[var(--color-ink-faint)]">
          {planned} visites proposades · {plan.days.length} dies · {candidates.length} empreses a la
          llista de treball
        </span>
      </form>

      {plan.days.length === 0 ? (
        <section className="targeta p-4">
          <p className="etiqueta m-0 mb-1">CAP RUTA PROPOSADA</p>
          <p className="text-[13px] text-[var(--color-ink-soft)] m-0">
            No hi ha cap comarca amb prou feina pendent per justificar un dia de ruta. Això vol dir
            que les tasques estan al dia, o que cal registrar-ne de noves.
          </p>
        </section>
      ) : (
        plan.days.map((day) => (
          <section key={day.date} className="targeta p-4">
            <header className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
              <div>
                <p className="etiqueta m-0">
                  {formatWeekday(day.date)} · {formatDate(day.date)}
                </p>
                <h2 className="text-lg font-semibold m-0">{day.zone}</h2>
              </div>
              <span className="text-[12px] text-[var(--color-ink-faint)]">
                {day.stops.length} {day.stops.length === 1 ? 'visita' : 'visites'}
                {day.travelMeters !== null &&
                  ` · ${(day.travelMeters / 1000).toFixed(1).replace('.', ',')} km entre parades`}
                {!day.orderedByDistance && ' · ordre per urgència (falten coordenades)'}
                {!day.zoneKnown && ' · zona no agrupada (municipi sol)'}
              </span>
            </header>

            <div className="taula-envolvent">
              <table className="taula">
                <thead>
                  <tr>
                    <th className="w-[36px]">#</th>
                    <th>EMPRESA</th>
                    <th>MUNICIPI</th>
                    <th>PER QUÈ</th>
                    <th className="text-right">LITRES</th>
                  </tr>
                </thead>
                <tbody>
                  {day.stops.map((stop, index) => (
                    <tr key={stop.candidate.clientId}>
                      <td className="tabular-nums text-[var(--color-ink-faint)]">{index + 1}</td>
                      <td>
                        <Link href={`/clients/${stop.candidate.clientId}`}>
                          {stop.candidate.name}
                        </Link>
                      </td>
                      <td className="text-[13px]">{stop.candidate.municipality ?? '—'}</td>
                      <td className="text-[12px] text-[var(--color-ink-soft)]">
                        {stop.reasons.join(' · ')}
                      </td>
                      <td className="text-right tabular-nums text-[13px]">
                        {stop.candidate.volumeLiters === null
                          ? '—'
                          : formatLiters(stop.candidate.volumeLiters)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      {plan.deferred.length > 0 && (
        <section className="targeta p-4">
          <h2 className="etiqueta mb-2">ZONES QUE NO HI CABEN ({plan.deferred.length})</h2>
          <ul className="list-none p-0 m-0 grid gap-1">
            {plan.deferred.slice(0, 10).map((zone) => (
              <li key={zone.zone} className="text-[13px]">
                <strong>{zone.zone}</strong>{' '}
                <span className="text-[var(--color-ink-faint)]">
                  — {zone.stops.length} empreses pendents
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {plan.alreadyScheduled.length > 0 && (
        <section className="targeta p-4">
          <h2 className="etiqueta mb-2">JA TENEN VISITA AL CALENDARI ({plan.alreadyScheduled.length})</h2>
          <p className="text-[12px] text-[var(--color-ink-soft)] m-0">
            No es proposen aquí perquè ja estan programades:{' '}
            {plan.alreadyScheduled.slice(0, 8).map((s) => s.candidate.name).join(', ')}
            {plan.alreadyScheduled.length > 8 ? '…' : ''}
          </p>
        </section>
      )}

      {plan.unroutable.length > 0 && (
        <section className="targeta p-4">
          <h2 className="etiqueta mb-2">SENSE MUNICIPI ({plan.unroutable.length})</h2>
          <p className="text-[12px] text-[var(--color-ink-soft)] m-0 mb-2">
            Aquestes empreses no es poden posar en cap ruta perquè no consta on són. No s&apos;han
            endevinat: omple el municipi a la fitxa i entraran soles.
          </p>
          <ul className="list-none p-0 m-0 grid gap-1">
            {plan.unroutable.slice(0, 12).map((stop) => (
              <li key={stop.candidate.clientId} className="text-[13px]">
                <Link href={`/clients/${stop.candidate.clientId}`}>{stop.candidate.name}</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
