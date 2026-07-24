import Link from 'next/link';
import { query, requireRole } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * AUDITORIA — read-only by construction. Rows arrive exclusively through the
 * database trigger; audit_log has no INSERT, UPDATE or DELETE policy, so this
 * screen could not alter it even if it tried. The diff shows only the fields
 * that changed, not the full row, so a long record stays readable.
 */

interface LogRow {
  id: string;
  created_at: string;
  entity: string;
  entity_id: string | null;
  action: string;
  changed_fields: string[] | null;
  before_value: Record<string, unknown> | null;
  after_value: Record<string, unknown> | null;
  actor: string | null;
  origin: string;
}

const ACTION_TONE: Record<string, string> = {
  INSERT: 'estat-ok',
  UPDATE: 'estat-neutre',
  DELETE: 'estat-perill',
  MERGE: 'estat-avis',
  RESTORE: 'estat-marca',
};

function cell(value: unknown): string {
  if (value === null || value === undefined) return '∅';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  return s.length > 80 ? `${s.slice(0, 77)}…` : s;
}

export default async function AuditoriaPage({
  searchParams,
}: {
  searchParams: Promise<{ entitat?: string; accio?: string; pagina?: string; id?: string }>;
}) {
  const session = await requireRole('ADMIN', 'GERENT');
  const params = await searchParams;
  const page = Math.max(1, Number(params.pagina ?? '1') || 1);
  const PER_PAGE = 40;

  const data = await query(session, async (q) => {
    const conditions: string[] = ['workspace_id = $1'];
    const args: unknown[] = [session.workspaceId];
    if (params.entitat) {
      args.push(params.entitat);
      conditions.push(`entity = $${args.length}`);
    }
    if (params.accio) {
      args.push(params.accio);
      conditions.push(`action = $${args.length}`);
    }
    if (params.id) {
      args.push(params.id);
      conditions.push(`entity_id = $${args.length}`);
    }
    const where = conditions.join(' and ');

    const [entities, rows, total] = await Promise.all([
      q.many<{ entity: string }>(
        `select distinct entity from public.audit_log where workspace_id = $1 order by entity`,
        [session.workspaceId],
      ),
      q.many<LogRow>(
        `select l.id::text as id, l.created_at::text as created_at, l.entity,
                l.entity_id, l.action, l.changed_fields, l.before_value, l.after_value,
                coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email) as actor,
                l.origin::text as origin
           from public.audit_log l
           left join public.profiles p on p.id = l.actor_id
          where ${where}
          order by l.created_at desc
          limit ${PER_PAGE} offset ${(page - 1) * PER_PAGE}`,
        args,
      ),
      q.one<{ n: string }>(`select count(*)::text as n from public.audit_log where ${where}`, args),
    ]);
    return { entities, rows, total: Number(total?.n ?? 0) };
  });

  const pages = Math.max(1, Math.ceil(data.total / PER_PAGE));
  const qs = (overrides: Record<string, string | undefined>) => {
    const merged = { ...params, ...overrides };
    const parts = Object.entries(merged)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}=${encodeURIComponent(v!)}`);
    return parts.length > 0 ? `?${parts.join('&')}` : '';
  };

  return (
    <div className="grid gap-5 max-w-[1200px]">
      <header>
        <p className="etiqueta m-0">
          <Link href="/administracio">ADMINISTRACIÓ</Link> / AUDITORIA
        </p>
        <h1 className="text-2xl font-semibold tracking-tight m-0">QUI VA CANVIAR QUÈ</h1>
        <p className="text-[13px] text-[var(--color-ink-soft)] mt-1 mb-0">
          Registre immutable: hi escriu només la base de dades, i cap pantalla —aquesta
          inclosa— el pot modificar ni buidar.
        </p>
      </header>

      <form method="get" className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="etiqueta">ENTITAT</span>
          <select name="entitat" defaultValue={params.entitat ?? ''} className="camp min-w-[170px]">
            <option value="">Totes</option>
            {data.entities.map((e) => (
              <option key={e.entity} value={e.entity}>
                {e.entity}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="etiqueta">ACCIÓ</span>
          <select name="accio" defaultValue={params.accio ?? ''} className="camp min-w-[130px]">
            <option value="">Totes</option>
            {['INSERT', 'UPDATE', 'DELETE', 'MERGE', 'RESTORE', 'IMPORT', 'SYNC'].map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="etiqueta">ID D&apos;ENTITAT</span>
          <input name="id" defaultValue={params.id ?? ''} className="camp min-w-[240px] font-mono text-[12px]" />
        </label>
        <button className="boto" type="submit">
          FILTRAR
        </button>
        {(params.entitat || params.accio || params.id) && (
          <Link className="boto" href="/administracio/auditoria">
            NETEJAR
          </Link>
        )}
      </form>

      <p className="etiqueta m-0">
        {data.total.toLocaleString('ca-ES')} REGISTRES {pages > 1 && `· pàgina ${page} de ${pages}`}
      </p>

      <div className="taula-ampla targeta">
        <table className="taula taula-compacta">
          <thead>
            <tr>
              <th>QUAN</th>
              <th>QUI</th>
              <th>ENTITAT</th>
              <th>ACCIÓ</th>
              <th>ORIGEN</th>
              <th>CANVIS</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => (
              <tr key={r.id}>
                <td className="tabular-nums whitespace-nowrap">{formatDateTime(r.created_at)}</td>
                <td>{r.actor ?? <span className="text-[var(--color-ink-faint)]">sistema</span>}</td>
                <td>
                  <code className="text-[11px]">{r.entity}</code>
                </td>
                <td>
                  <span className={`estat ${ACTION_TONE[r.action] ?? 'estat-neutre'}`}>{r.action}</span>
                </td>
                <td className="text-[11px] text-[var(--color-ink-faint)]">{r.origin}</td>
                <td>
                  {r.action === 'UPDATE' && r.changed_fields ? (
                    <details>
                      <summary className="cursor-pointer text-[12px]">
                        {r.changed_fields.length} camps: {r.changed_fields.slice(0, 4).join(', ')}
                        {r.changed_fields.length > 4 ? '…' : ''}
                      </summary>
                      <dl className="grid grid-cols-[auto_1fr_1fr] gap-x-3 gap-y-1 m-0 mt-2 text-[11px]">
                        <dt className="etiqueta">CAMP</dt>
                        <dd className="etiqueta m-0">ABANS</dd>
                        <dd className="etiqueta m-0">DESPRÉS</dd>
                        {r.changed_fields.map((f) => (
                          <FieldDiff key={f} field={f} before={r.before_value} after={r.after_value} />
                        ))}
                      </dl>
                    </details>
                  ) : r.action === 'INSERT' ? (
                    <span className="text-[12px] text-[var(--color-ink-soft)]">
                      {cell(r.after_value?.name ?? r.after_value?.title ?? r.entity_id)}
                    </span>
                  ) : (
                    <span className="text-[12px] text-[var(--color-ink-faint)]">{r.entity_id ?? '—'}</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <nav className="flex gap-2" aria-label="Paginació">
          {page > 1 && (
            <Link className="boto" href={`/administracio/auditoria${qs({ pagina: String(page - 1) })}`}>
              ← MÉS RECENTS
            </Link>
          )}
          {page < pages && (
            <Link className="boto" href={`/administracio/auditoria${qs({ pagina: String(page + 1) })}`}>
              MÉS ANTICS →
            </Link>
          )}
        </nav>
      )}
    </div>
  );
}

function FieldDiff({
  field,
  before,
  after,
}: {
  field: string;
  before: Record<string, unknown> | null;
  after: Record<string, unknown> | null;
}) {
  return (
    <>
      <dt className="font-mono">{field}</dt>
      <dd className="m-0 text-[var(--color-danger)] break-all">{cell(before?.[field])}</dd>
      <dd className="m-0 text-[var(--color-ok)] break-all">{cell(after?.[field])}</dd>
    </>
  );
}
