import Link from 'next/link';
import { isManager, query, requireSession } from '@/lib/auth';
import { formatDate, formatTime, relativeDays, TASK_TONE } from '@/lib/format';
import { TaskRowActions } from '@/components/task-row-actions';
import { civilToInstant, todayCivil } from '@/components/calendar/dates';
import { AssigneeSelect } from './assignee-select';

/**
 * TASQUES I RECORDATORIS.
 *
 * One screen for both, because they are the same row in the database and the
 * user thinks of them the same way: something to do, with or without a clock on
 * it. The only structural distinction the screen makes is the one that matters:
 *
 *   **dated** tasks can be overdue and occupy a day;
 *   **undated** "next actions" belong to the company, never appear as overdue,
 *   and are listed separately so they cannot silently rot at the bottom of a
 *   list sorted by a date they do not have.
 *
 * Everything else is a filter.
 */
export const dynamic = 'force-dynamic';

const KINDS = ['TASCA', 'RECORDATORI'] as const;
const STATUSES = ['PENDENT', 'FET', 'AJORNAT', 'CANCEL·LAT'] as const;
const PRIORITIES = ['ALTA', 'MITJANA', 'BAIXA'] as const;
const ACTIONS = [
  'TRUCAR',
  'VISITA',
  'MOSTRES',
  'ENVIAR CORREU',
  'ENVIAR PREUS',
  'ENVIAR OFERTA',
  'VERIFICAR EMPRESA',
  'ALTRES',
] as const;

interface TaskRow {
  id: string;
  kind: string;
  action: string;
  other_action: string | null;
  title: string | null;
  due_at: string | null;
  duration_minutes: number | null;
  priority: string;
  status: string;
  notes: string | null;
  result: string | null;
  client_id: string | null;
  client_name: string | null;
  product_name: string | null;
  assigned_to: string | null;
  assignee: string | null;
  visit_id: string | null;
  visit_status: string | null;
  sync_state: string | null;
  location_label: string | null;
}

interface Filters {
  tipus: string;
  estat: string;
  importancia: string;
  accio: string;
  comercial: string;
  empresa: string;
  client: string;
  desde: string;
  fins: string;
  vencudes: boolean;
  sensedata: boolean;
}

function readFilters(params: Record<string, string | undefined>, manager: boolean): Filters {
  const pick = (value: string | undefined, allowed: readonly string[]): string =>
    value && allowed.includes(value) ? value : '';
  return {
    tipus: pick(params.tipus, KINDS),
    // PENDENT by default: the screen is a worklist, not an archive.
    estat: params.estat === 'TOTS' ? 'TOTS' : pick(params.estat, STATUSES) || 'PENDENT',
    importancia: pick(params.importancia, PRIORITIES),
    accio: pick(params.accio, ACTIONS),
    comercial: manager ? (params.comercial ?? '') : '',
    empresa: (params.empresa ?? '').trim(),
    client: (params.client ?? '').trim(),
    desde: /^\d{4}-\d{2}-\d{2}$/.test(params.desde ?? '') ? (params.desde as string) : '',
    fins: /^\d{4}-\d{2}-\d{2}$/.test(params.fins ?? '') ? (params.fins as string) : '',
    vencudes: params.vencudes === '1',
    sensedata: params.sensedata === '1',
  };
}

export default async function TasquesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const manager = isManager(session.role);
  const f = readFilters(params, manager);

  const data = await query(session, async (q) => {
    const args: unknown[] = [session.workspaceId];
    const where: string[] = ['t.workspace_id = $1', 't.deleted_at is null'];

    const add = (sql: string, value: unknown): void => {
      args.push(value);
      where.push(sql.replace('$?', `$${args.length}`));
    };

    if (f.tipus) add('t.kind = $?::app.task_kind', f.tipus);
    if (f.estat !== 'TOTS') add('t.status = $?::app.task_status', f.estat);
    if (f.importancia) add('t.priority = $?::app.task_priority', f.importancia);
    if (f.accio) add('t.action = $?::app.commercial_action', f.accio);
    // A COMERCIAL is limited to their own rows here as well as by RLS.
    if (manager) {
      if (f.comercial) add('t.assigned_to = $?', f.comercial);
    } else {
      add('t.assigned_to = $?', session.userId);
    }
    if (f.client) add('t.client_id = $?', f.client);
    if (f.empresa) add('c.name ilike $?', `%${f.empresa}%`);
    if (f.desde) add('t.due_at >= $?::timestamptz', civilToInstant(`${f.desde}T00:00`)?.toISOString());
    if (f.fins) {
      add('t.due_at < $?::timestamptz', civilToInstant(`${f.fins}T00:00`)?.toISOString());
    }
    if (f.vencudes) where.push("t.due_at is not null and t.due_at < now() and t.status = 'PENDENT'");
    if (f.sensedata) where.push('t.due_at is null');

    const base = `
      select t.id, t.kind::text as kind, t.action::text as action, t.other_action, t.title,
             t.due_at, t.duration_minutes, t.priority::text as priority, t.status::text as status,
             t.notes, t.result::text as result,
             t.client_id, c.name as client_name, p.name as product_name,
             t.assigned_to,
             nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), '') as assignee,
             t.visit_id, v.status::text as visit_status,
             cel.status::text as sync_state,
             coalesce(
               nullif(btrim(concat_ws(', ', nullif(l.street, ''), nullif(l.municipality, ''))), ''),
               nullif(c.municipality, '')
             ) as location_label
        from public.tasks t
        left join public.clients c on c.id = t.client_id
        left join public.products p on p.id = t.product_id
        left join public.profiles pr on pr.id = t.assigned_to
        left join public.visits v on v.id = t.visit_id
        left join public.calendar_event_links cel on cel.task_id = t.id
        left join public.client_locations l
          on l.client_id = t.client_id and l.is_primary and l.deleted_at is null
       where ${where.join(' and ')}`;

    const priorityRank = `case t.priority when 'ALTA' then 1 when 'MITJANA' then 2 else 3 end`;

    const [dated, undated, colleagues] = await Promise.all([
      // Sorted by date, then importance — exactly the order the day is worked in.
      q.many<TaskRow>(
        `${base} and t.due_at is not null order by t.due_at, ${priorityRank} limit 400`,
        args,
      ),
      q.many<TaskRow>(
        `${base} and t.due_at is null order by ${priorityRank}, c.name nulls last limit 200`,
        args,
      ),
      manager
        ? q.many<{ id: string; name: string }>(
            `select p.id,
                    coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email) as name
               from public.profiles p
               join public.workspace_memberships m
                 on m.user_id = p.id and m.workspace_id = $1 and m.status = 'ACTIU'
              where p.is_active order by name`,
            [session.workspaceId],
          )
        : Promise.resolve<{ id: string; name: string }[]>([]),
    ]);

    return { dated, undated, colleagues };
  });

  const now = Date.now();
  const isOverdue = (row: TaskRow): boolean =>
    row.due_at !== null && row.status === 'PENDENT' && Date.parse(row.due_at) < now;
  const overdueCount = data.dated.filter(isOverdue).length;

  return (
    <div className="grid gap-5 max-w-[1400px]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="etiqueta m-0">PLA DE TREBALL</p>
          <h1 className="text-2xl font-semibold tracking-tight m-0">TASQUES I RECORDATORIS</h1>
        </div>
        <p className="m-0 text-[13px] text-[var(--color-ink-faint)]">
          {data.dated.length} amb data · {data.undated.length} sense data ·{' '}
          <span className={overdueCount > 0 ? 'text-[var(--color-danger)] font-semibold' : ''}>
            {overdueCount} vençudes
          </span>
        </p>
      </header>

      {/* ---------------- filters ---------------- */}
      <form method="get" className="targeta p-3 grid gap-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Select name="tipus" label="TIPUS" value={f.tipus} options={KINDS} anyLabel="TOTS" />
          <label className="grid gap-1">
            <span className="etiqueta">ESTAT</span>
            <select name="estat" defaultValue={f.estat} className="camp">
              <option value="TOTS">TOTS</option>
              {STATUSES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </label>
          <Select
            name="importancia"
            label="IMPORTÀNCIA"
            value={f.importancia}
            options={PRIORITIES}
            anyLabel="QUALSEVOL"
          />
          <Select name="accio" label="ACCIÓ" value={f.accio} options={ACTIONS} anyLabel="QUALSEVOL" />

          {manager && (
            <label className="grid gap-1">
              <span className="etiqueta">COMERCIAL</span>
              <select name="comercial" defaultValue={f.comercial} className="camp">
                <option value="">Tot l&apos;equip</option>
                {data.colleagues.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
          )}

          <label className="grid gap-1">
            <span className="etiqueta">EMPRESA</span>
            <input className="camp" type="search" name="empresa" defaultValue={f.empresa} placeholder="Nom de l’empresa" />
          </label>
          <label className="grid gap-1">
            <span className="etiqueta">DES DE</span>
            <input className="camp" type="date" name="desde" defaultValue={f.desde} />
          </label>
          <label className="grid gap-1">
            <span className="etiqueta">FINS A</span>
            <input className="camp" type="date" name="fins" defaultValue={f.fins} />
          </label>
        </div>

        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" name="vencudes" value="1" defaultChecked={f.vencudes} />
            NOMÉS VENÇUDES
          </label>
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" name="sensedata" value="1" defaultChecked={f.sensedata} />
            NOMÉS SENSE DATA
          </label>
          {f.client && <input type="hidden" name="client" value={f.client} />}
          <button className="boto boto-principal" type="submit">
            FILTRAR
          </button>
          <Link className="boto" href="/tasques">
            NETEJAR
          </Link>
          <Link className="boto" href={`/tasques?vencudes=1&data=${todayCivil()}`}>
            VENÇUDES
          </Link>
        </div>
      </form>

      {/* ---------------- dated ---------------- */}
      {!f.sensedata && (
        <section>
          <h2 className="etiqueta flex items-center gap-2 mb-2">
            AMB DATA <span className="font-mono text-[var(--color-ink-faint)]">({data.dated.length})</span>
          </h2>
          {data.dated.length === 0 ? (
            <p className="text-[13px] text-[var(--color-ink-faint)] m-0">
              Cap tasca amb data que compleixi el filtre.
            </p>
          ) : (
            <div className="taula-ampla targeta">
              <table className="taula">
                <thead>
                  <tr>
                    <th>DATA</th>
                    <th>HORA</th>
                    <th>TIPUS</th>
                    <th>IMPORTÀNCIA</th>
                    <th>EMPRESA</th>
                    <th>ACCIÓ</th>
                    <th>PRODUCTE</th>
                    <th>UBICACIÓ</th>
                    <th>COMERCIAL</th>
                    <th>ESTAT</th>
                    <th>SINCRONITZACIÓ</th>
                    <th className="text-right">ACCIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {data.dated.map((row) => (
                    <tr key={row.id} className={isOverdue(row) ? 'fila-vencuda' : ''}>
                      <td className="tabular-nums whitespace-nowrap">
                        {formatDate(row.due_at)}
                        {isOverdue(row) && (
                          <span className="block text-[11px] text-[var(--color-danger)]">
                            {relativeDays(row.due_at)}
                          </span>
                        )}
                      </td>
                      <td className="tabular-nums whitespace-nowrap">
                        {formatTime(row.due_at)}
                        {row.duration_minutes ? (
                          <span className="block text-[11px] text-[var(--color-ink-faint)]">
                            {row.duration_minutes} min
                          </span>
                        ) : null}
                      </td>
                      <td>
                        <span className="estat estat-neutre">{row.kind}</span>
                      </td>
                      <td>
                        <span
                          className={`estat ${
                            row.priority === 'ALTA'
                              ? 'estat-perill'
                              : row.priority === 'MITJANA'
                                ? 'estat-avis'
                                : 'estat-neutre'
                          }`}
                        >
                          {row.priority}
                        </span>
                      </td>
                      <td>
                        {row.client_id ? (
                          <Link href={`/clients/${row.client_id}`}>{row.client_name}</Link>
                        ) : (
                          <span className="text-[var(--color-ink-faint)]">—</span>
                        )}
                      </td>
                      <td>
                        {row.other_action ?? row.action}
                        {row.visit_id && (
                          <Link
                            className="block text-[11px]"
                            href={`/calendari?vista=dia&data=${(row.due_at ?? '').slice(0, 10)}`}
                          >
                            VEURE AL CALENDARI
                          </Link>
                        )}
                      </td>
                      <td className="text-[var(--color-ink-soft)]">{row.product_name ?? '—'}</td>
                      <td className="text-[var(--color-ink-soft)]">{row.location_label ?? '—'}</td>
                      <td className="text-[var(--color-ink-soft)]">
                        {manager ? (
                          <AssigneeSelect
                            taskId={row.id}
                            value={row.assigned_to}
                            options={data.colleagues}
                          />
                        ) : (
                          (row.assignee ?? '—')
                        )}
                      </td>
                      <td>
                        <span className={TASK_TONE[row.status] ?? 'estat estat-neutre'}>
                          {row.status}
                        </span>
                      </td>
                      <td>
                        <SyncBadge state={row.sync_state} />
                      </td>
                      <td className="text-right">
                        {row.status === 'PENDENT' ? (
                          <TaskRowActions
                            task={{ id: row.id, undated: false, clientName: row.client_name }}
                          />
                        ) : (
                          <span className="text-[12px] text-[var(--color-ink-faint)]">
                            {row.result ?? '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}

      {/* ---------------- undated ---------------- */}
      {!f.vencudes && (
        <section>
          <h2 className="etiqueta flex items-center gap-2 mb-2">
            SENSE DATA{' '}
            <span className="font-mono text-[var(--color-ink-faint)]">({data.undated.length})</span>
          </h2>
          <p className="text-[12px] text-[var(--color-ink-faint)] mt-0 mb-2">
            Properes accions lligades a l&apos;empresa. No ocupen cap dia i{' '}
            <strong>mai no compten com a vençudes</strong>. Programa-les quan toqui.
          </p>
          {data.undated.length === 0 ? (
            <p className="text-[13px] text-[var(--color-ink-faint)] m-0">
              Cap acció sense data que compleixi el filtre.
            </p>
          ) : (
            <div className="taula-ampla targeta">
              <table className="taula">
                <thead>
                  <tr>
                    <th>TIPUS</th>
                    <th>IMPORTÀNCIA</th>
                    <th>EMPRESA</th>
                    <th>ACCIÓ</th>
                    <th>PRODUCTE</th>
                    <th>COMERCIAL</th>
                    <th>ESTAT</th>
                    <th className="text-right">ACCIONS</th>
                  </tr>
                </thead>
                <tbody>
                  {data.undated.map((row) => (
                    <tr key={row.id}>
                      <td>
                        <span className="estat estat-neutre">{row.kind}</span>
                      </td>
                      <td>
                        <span
                          className={`estat ${
                            row.priority === 'ALTA'
                              ? 'estat-perill'
                              : row.priority === 'MITJANA'
                                ? 'estat-avis'
                                : 'estat-neutre'
                          }`}
                        >
                          {row.priority}
                        </span>
                      </td>
                      <td>
                        {row.client_id ? (
                          <Link href={`/clients/${row.client_id}`}>{row.client_name}</Link>
                        ) : (
                          <span className="text-[var(--color-ink-faint)]">—</span>
                        )}
                      </td>
                      <td>{row.other_action ?? row.action}</td>
                      <td className="text-[var(--color-ink-soft)]">{row.product_name ?? '—'}</td>
                      <td className="text-[var(--color-ink-soft)]">
                        {manager ? (
                          <AssigneeSelect
                            taskId={row.id}
                            value={row.assigned_to}
                            options={data.colleagues}
                          />
                        ) : (
                          (row.assignee ?? '—')
                        )}
                      </td>
                      <td>
                        <span className={TASK_TONE[row.status] ?? 'estat estat-neutre'}>
                          {row.status}
                        </span>
                      </td>
                      <td className="text-right">
                        {row.status === 'PENDENT' ? (
                          <TaskRowActions
                            task={{ id: row.id, undated: true, clientName: row.client_name }}
                          />
                        ) : (
                          <span className="text-[12px] text-[var(--color-ink-faint)]">
                            {row.result ?? '—'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
      )}
    </div>
  );
}

function Select({
  name,
  label,
  value,
  options,
  anyLabel,
}: {
  name: string;
  label: string;
  value: string;
  options: readonly string[];
  anyLabel: string;
}) {
  return (
    <label className="grid gap-1">
      <span className="etiqueta">{label}</span>
      <select name={name} defaultValue={value} className="camp">
        <option value="">{anyLabel}</option>
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}

function SyncBadge({ state }: { state: string | null }) {
  if (!state) return <span className="text-[var(--color-ink-faint)]">—</span>;
  const tone =
    state === 'SINCRONITZAT' ? 'estat-ok' : state === 'ERROR' ? 'estat-perill' : 'estat-neutre';
  return <span className={`estat ${tone}`}>{state}</span>;
}
