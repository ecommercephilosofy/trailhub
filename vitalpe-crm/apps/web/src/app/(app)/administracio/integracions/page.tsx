import Link from 'next/link';
import { query, requireRole } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import { integrationStatus } from '@vitalpe/config';

export const dynamic = 'force-dynamic';

/**
 * INTEGRACIONS — status only, never values. integrationStatus() reports which
 * environment variables exist without reading what is inside them, so this
 * page can render its output verbatim and still keep every secret off the
 * wire. Channel health comes from the calendar tables in the caller's RLS
 * context.
 */

const TONE: Record<string, string> = {
  CONFIGURED: 'estat-ok',
  NOT_CONFIGURED: 'estat-neutre',
};

export default async function IntegracionsPage() {
  const session = await requireRole('ADMIN');
  const reports = integrationStatus();

  const calendar = await query(session, async (q) => {
    const [connections, channels, errors] = await Promise.all([
      q.many<{ email: string | null; status: string; last_sync: string | null; last_error: string | null }>(
        `select c.google_account_email as email, c.status, c.last_sync_at::text as last_sync,
                c.last_error
           from public.google_calendar_connections c
          where c.user_id = $1`,
        [session.userId],
      ),
      q.many<{ status: string; expires_at: string }>(
        `select w.status, w.expires_at::text as expires_at
           from public.calendar_watch_channels w
           join public.google_calendar_connections c on c.id = w.connection_id
          where c.user_id = $1
          order by w.expires_at desc limit 5`,
        [session.userId],
      ),
      q.many<{ client: string; error: string | null; at: string }>(
        `select cl.name as client, l.last_error as error, l.updated_at::text as at
           from public.calendar_event_links l
           join public.visits v on v.id = l.visit_id
           join public.clients cl on cl.id = v.client_id
          where l.workspace_id = $1 and l.status = 'ERROR'
          order by l.updated_at desc limit 10`,
        [session.workspaceId],
      ),
    ]);
    return { connections, channels, errors };
  });

  return (
    <div className="grid gap-6 max-w-[900px]">
      <header>
        <p className="etiqueta m-0">
          <Link href="/administracio">ADMINISTRACIÓ</Link> / INTEGRACIONS
        </p>
        <h1 className="text-2xl font-semibold tracking-tight m-0">ESTAT DE LES INTEGRACIONS</h1>
        <p className="text-[13px] text-[var(--color-ink-soft)] mt-1 mb-0 max-w-[68ch]">
          Aquesta pantalla diu què està configurat i com activar la resta. Mai mostra el valor
          de cap clau, només si existeix. Sense credencials, cada integració treballa amb el
          seu proveïdor local i l&apos;aplicació és completa igualment.
        </p>
      </header>

      <ul className="list-none p-0 m-0 grid gap-3">
        {reports.map((r) => (
          <li key={r.key} className="targeta p-4">
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <p className="font-semibold m-0">{r.label}</p>
              <span className={`estat ${TONE[r.status] ?? 'estat-neutre'}`}>
                {r.status === 'CONFIGURED' ? 'CONFIGURADA' : 'NO CONFIGURADA'}
              </span>
            </div>
            <p className="text-[13px] text-[var(--color-ink-soft)] m-0 mt-1">{r.explanation}</p>
            {r.missing.length > 0 && (
              <p className="text-[12px] m-0 mt-2">
                Variables pendents:{' '}
                {r.missing.map((v) => (
                  <code key={v} className="mr-1">
                    {v}
                  </code>
                ))}
              </p>
            )}
          </li>
        ))}
      </ul>

      <section>
        <h2 className="etiqueta mb-2">GOOGLE CALENDAR — SALUT DE LA CONNEXIÓ</h2>
        {calendar.connections.length === 0 ? (
          <p className="targeta p-3 m-0 text-[13px]">
            Cap compte connectat. Es connecta des de{' '}
            <Link href="/calendari/google">CALENDARI → GOOGLE CALENDAR</Link>, i és personal:
            cada comercial connecta el seu.
          </p>
        ) : (
          <div className="grid gap-2">
            {calendar.connections.map((c, i) => (
              <div key={i} className="targeta p-3 text-[13px] flex flex-wrap gap-3 items-center">
                <span className="font-semibold">{c.email ?? 'compte'}</span>
                <span className={`estat ${c.status === 'CONNECTAT' ? 'estat-ok' : 'estat-perill'}`}>
                  {c.status}
                </span>
                <span className="text-[var(--color-ink-faint)]">
                  última sincronització: {c.last_sync ? formatDateTime(c.last_sync) : 'mai'}
                </span>
                {c.last_error && <span className="text-[var(--color-danger)]">{c.last_error}</span>}
              </div>
            ))}
            {calendar.channels.length > 0 && (
              <p className="text-[12px] text-[var(--color-ink-faint)] m-0">
                Canals d&apos;avís:{' '}
                {calendar.channels
                  .map((ch) => `${ch.status} (caduca ${formatDateTime(ch.expires_at)})`)
                  .join(' · ')}
              </p>
            )}
          </div>
        )}

        {calendar.errors.length > 0 && (
          <div className="mt-3">
            <h3 className="etiqueta mb-1">ERRORS DE SINCRONITZACIÓ RECENTS</h3>
            <ul className="list-none p-0 m-0 grid gap-1 text-[13px]">
              {calendar.errors.map((e, i) => (
                <li key={i} className="flex gap-2 flex-wrap">
                  <span className="estat estat-perill">ERROR</span>
                  <span>{e.client}</span>
                  <span className="text-[var(--color-ink-faint)]">{e.error ?? ''}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      <p className="text-[12px] text-[var(--color-ink-faint)] m-0">
        Les instruccions completes d&apos;activació són a <code>GOOGLE_CALENDAR_SETUP.md</code> i{' '}
        <code>VOICE_AI_SETUP.md</code> al repositori.
      </p>
    </div>
  );
}
