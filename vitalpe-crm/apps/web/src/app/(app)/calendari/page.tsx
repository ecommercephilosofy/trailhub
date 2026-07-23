import Link from 'next/link';
import { isManager, query, requireSession } from '@/lib/auth';
import { formatDate, formatMonth } from '@/lib/format';
import { CalendarWorkspace } from '@/components/calendar/calendar-workspace';
import type { CalendarEvent, CommercialOption } from '@/components/calendar/types';
import {
  shiftAnchor,
  todayCivil,
  VIEWS,
  windowFor,
  type CalendarView,
} from '@/components/calendar/dates';
import { googleConfigReport, readConnection } from '@/app/api/google/sync-engine';

/**
 * CALENDARI.
 *
 * Six views over the same query. The day view is the one that has to be
 * unambiguous, so it is the only one that prints every field of an event on the
 * block itself — hour, duration, company, action, commercial, location,
 * product, importance, state and synchronisation.
 *
 * Scope: a COMERCIAL always sees their own visits and nothing else — that is
 * enforced by RLS, not by this filter. A manager may look at the team, and what
 * they see is strictly CRM visits: a colleague's personal calendar entries have
 * no CRM identity, are never imported by the sync, and therefore cannot appear.
 */
export const dynamic = 'force-dynamic';

interface VisitRow {
  id: string;
  client_id: string;
  client_name: string;
  task_id: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  task_status: string | null;
  action: string | null;
  other_action: string | null;
  priority: string | null;
  objective: string | null;
  important_info: string | null;
  result: string | null;
  user_id: string | null;
  assignee: string | null;
  product_name: string | null;
  location_label: string | null;
  latitude: number | null;
  longitude: number | null;
  sync_state: string | null;
  sync_origin: string | null;
  sync_error: string | null;
  last_synced_at: string | null;
  google_event_id: string | null;
  calendar_id: string | null;
  sync_to_google: boolean | null;
  cancellation_reason: string | null;
  cancellation_origin: string | null;
}

function parseView(raw: string | undefined, manager: boolean): CalendarView {
  const found = VIEWS.find((v) => v.id === raw);
  if (!found) return 'dia';
  if (found.managerOnly && !manager) return 'dia';
  return found.id;
}

function mapsUrl(row: VisitRow): string | null {
  if (row.latitude !== null && row.longitude !== null) {
    return `https://www.google.com/maps/search/?api=1&query=${row.latitude},${row.longitude}`;
  }
  if (row.location_label) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(row.location_label)}`;
  }
  return null;
}

/** Google's `eid` deep link. Only built when the event really lives in Google. */
function googleEventUrl(row: VisitRow, isGoogle: boolean): string | null {
  if (!isGoogle || !row.google_event_id || !row.calendar_id) return null;
  const eid = Buffer.from(`${row.google_event_id} ${row.calendar_id}`, 'utf8')
    .toString('base64')
    .replace(/=+$/, '');
  return `https://calendar.google.com/calendar/u/0/r/eventedit/${eid}`;
}

export default async function CalendariPage({
  searchParams,
}: {
  searchParams: Promise<{ vista?: string; data?: string; comercial?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const manager = isManager(session.role);

  const view = parseView(params.vista, manager);
  const anchor = /^\d{4}-\d{2}-\d{2}$/.test(params.data ?? '') ? (params.data as string) : todayCivil();
  const filterUser = manager ? (params.comercial ?? '') : session.userId;
  const win = windowFor(view, anchor);

  const google = googleConfigReport();
  const connection = await readConnection(session.userId);
  const isGoogleConnection = connection?.provider === 'google' && connection.status === 'CONNECTAT';

  const data = await query(session, async (q) => {
    const args: unknown[] = [session.workspaceId, win.from.toISOString(), win.to.toISOString()];
    if (filterUser) args.push(filterUser);

    const [visits, colleagues] = await Promise.all([
      q.many<VisitRow>(
        `select v.id, v.client_id, c.name as client_name, v.task_id,
                v.starts_at, v.ends_at, v.status::text as status,
                t.status::text as task_status, t.action::text as action, t.other_action,
                t.priority::text as priority, t.sync_to_google,
                v.objective, v.important_info, v.result::text as result,
                v.user_id,
                nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), '') as assignee,
                p.name as product_name,
                coalesce(
                  nullif(btrim(concat_ws(' · ', nullif(l.name, ''), nullif(l.formatted_address, ''))), ''),
                  nullif(btrim(concat_ws(', ', nullif(l.street, ''), nullif(l.municipality, ''))), ''),
                  nullif(c.municipality, '')
                ) as location_label,
                l.latitude, l.longitude,
                cel.status::text as sync_state,
                cel.last_change_origin::text as sync_origin,
                cel.last_error as sync_error,
                cel.last_synced_at,
                cel.google_event_id, cel.calendar_id,
                v.cancellation_reason, v.cancellation_origin::text as cancellation_origin
           from public.visits v
           join public.clients c on c.id = v.client_id
           left join public.tasks t on t.id = v.task_id and t.deleted_at is null
           left join public.products p on p.id = t.product_id
           left join public.profiles pr on pr.id = v.user_id
           left join public.client_locations l on l.id = v.location_id and l.deleted_at is null
           left join public.calendar_event_links cel on cel.visit_id = v.id
          where v.workspace_id = $1 and v.deleted_at is null
            and v.starts_at >= $2::timestamptz and v.starts_at < $3::timestamptz
            ${filterUser ? 'and v.user_id = $4' : ''}
          order by v.starts_at, c.name`,
        args,
      ),
      manager
        ? q.many<{ id: string; name: string }>(
            `select p.id,
                    coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email) as name
               from public.profiles p
               join public.workspace_memberships m
                 on m.user_id = p.id and m.workspace_id = $1 and m.status = 'ACTIU'
              where p.is_active
              order by name`,
            [session.workspaceId],
          )
        : Promise.resolve<{ id: string; name: string }[]>([]),
    ]);

    return { visits, colleagues };
  });

  const commercials: CommercialOption[] = manager
    ? data.colleagues
    : [{ id: session.userId, name: session.fullName }];

  const events: CalendarEvent[] = data.visits.map((row) => ({
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    taskId: row.task_id,
    startsAt: new Date(row.starts_at).toISOString(),
    endsAt: new Date(row.ends_at).toISOString(),
    durationMinutes: Math.max(
      5,
      Math.round((new Date(row.ends_at).getTime() - new Date(row.starts_at).getTime()) / 60000),
    ),
    status: row.status,
    taskStatus: row.task_status,
    action: row.other_action ?? row.action ?? 'VISITA',
    priority: row.priority ?? 'MITJANA',
    objective: row.objective,
    importantInfo: row.important_info,
    result: row.result,
    assigneeId: row.user_id,
    assignee: row.assignee,
    productName: row.product_name,
    locationLabel: row.location_label,
    mapsUrl: mapsUrl(row),
    syncState: row.sync_state,
    syncOrigin: row.sync_origin,
    syncError: row.sync_error,
    lastSyncedAt: row.last_synced_at ? new Date(row.last_synced_at).toISOString() : null,
    googleUrl: googleEventUrl(row, isGoogleConnection),
    syncEnabled: row.sync_to_google !== false,
    cancellationReason: row.cancellation_reason,
    cancellationOrigin: row.cancellation_origin,
    // A commercial may move their own visits; a manager may move anyone's.
    editable: manager || row.user_id === session.userId,
  }));

  const heading =
    view === 'mes'
      ? formatMonth(`${anchor.slice(0, 8)}15T12:00:00Z`)
      : view === 'dia'
        ? formatDate(`${anchor}T12:00:00Z`)
        : `${formatDate(`${win.fromCivil}T12:00:00Z`)} — ${formatDate(
            `${addDaysLocal(win.toCivil, -1)}T12:00:00Z`,
          )}`;

  const link = (next: Partial<{ vista: string; data: string; comercial: string }>): string => {
    const search = new URLSearchParams();
    search.set('vista', next.vista ?? view);
    search.set('data', next.data ?? anchor);
    const commercial = next.comercial ?? filterUser;
    if (manager && commercial) search.set('comercial', commercial);
    return `/calendari?${search.toString()}`;
  };

  return (
    <div className="grid gap-4 max-w-[1400px]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="etiqueta m-0">CALENDARI</p>
          <h1 className="text-2xl font-semibold tracking-tight m-0">{heading}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link className="boto" href={link({ data: shiftAnchor(view, anchor, -1) })}>
            ← ANTERIOR
          </Link>
          <Link className="boto" href={link({ data: todayCivil() })}>
            AVUI
          </Link>
          <Link className="boto" href={link({ data: shiftAnchor(view, anchor, 1) })}>
            SEGÜENT →
          </Link>
          <Link className="boto" href="/calendari/google">
            GOOGLE CALENDAR
          </Link>
        </div>
      </header>

      <nav className="flex flex-wrap gap-1" aria-label="Vistes del calendari">
        {VIEWS.filter((v) => !v.managerOnly || manager).map((v) => (
          <Link
            key={v.id}
            href={link({ vista: v.id })}
            className={`boto ${v.id === view ? 'boto-principal' : ''}`}
            aria-current={v.id === view ? 'page' : undefined}
          >
            {v.label}
          </Link>
        ))}
      </nav>

      {manager && (
        <form method="get" className="flex flex-wrap items-end gap-2">
          <input type="hidden" name="vista" value={view} />
          <input type="hidden" name="data" value={anchor} />
          <label className="grid gap-1">
            <span className="etiqueta">COMERCIAL</span>
            <select name="comercial" defaultValue={filterUser} className="camp min-w-[200px]">
              <option value="">Tot l&apos;equip</option>
              {data.colleagues.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <button className="boto" type="submit">
            FILTRAR
          </button>
        </form>
      )}

      {!google.configured && (
        <p className="targeta p-3 m-0 text-[13px] border-l-[3px] border-l-[var(--color-warn)]">
          <strong>Google Calendar no està configurat.</strong> Les visites se sincronitzen amb el
          calendari local i tot funciona igual. Per activar Google cal definir{' '}
          <code>{google.missing.join(', ')}</code> i, per rebre avisos instantanis,{' '}
          <code>GOOGLE_CALENDAR_WEBHOOK_URL</code>.{' '}
          <Link href="/calendari/google">Veure l&apos;estat de la connexió</Link>.
        </p>
      )}

      <CalendarWorkspace
        events={events}
        view={view}
        anchor={anchor}
        days={[...win.days]}
        commercials={commercials}
        canReassign={manager}
        currentUserId={session.userId}
        googleConfigured={google.configured}
        googleConnected={isGoogleConnection}
      />
    </div>
  );
}

function addDaysLocal(civil: string, days: number): string {
  const ms = Date.parse(`${civil}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}
