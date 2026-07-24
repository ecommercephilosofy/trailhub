import Link from 'next/link';
import { query, requireSession } from '@/lib/auth';
import { withServiceRole } from '@/lib/db';
import { formatDate, formatTime } from '@/lib/format';
import { GooglePanel } from '@/components/calendar/google-panel';
import {
  DEDICATED_CALENDAR_NAME,
  googleConfigReport,
  listCalendars,
  readConnection,
} from '@/app/api/google/sync-engine';

/**
 * CALENDARI › GOOGLE CALENDAR.
 *
 * Shows exactly what is true: whether Google is configured at all, whether this
 * user has authorised it, which calendar the visits go to, when the last sync
 * ran, what the last error was, and the last notifications received. Nothing on
 * this page is a token or derived from one.
 *
 * With no Google credentials the screen does not show an error — it explains
 * which variables are missing and states that the local calendar provider is
 * doing the work, which it really is.
 */
export const dynamic = 'force-dynamic';

const ERRORS: Record<string, string> = {
  'no-configurat':
    'Google Calendar no està configurat en aquest entorn: falten GOOGLE_CLIENT_ID i GOOGLE_CLIENT_SECRET.',
  denegat: 'Has cancel·lat l’autorització a Google.',
  'sense-codi': 'Google no ha retornat cap codi d’autorització.',
  'estat-invalid':
    'La resposta de Google no coincidia amb la petició que havíem obert. No s’ha desat res.',
  'sense-refresh':
    'Google no ha retornat cap testimoni de renovació. Torna a autoritzar acceptant el permís d’accés fora de línia.',
  fallida: 'No s’ha pogut completar l’autorització amb Google.',
};

export default async function GoogleCalendarPage({
  searchParams,
}: {
  searchParams: Promise<{ ok?: string; error?: string; detall?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;
  const config = googleConfigReport();
  const connection = await readConnection(session.userId);

  const calendars = connection && connection.status !== 'DESCONNECTAT'
    ? await listCalendars(connection.id)
    : [];

  const channels = connection
    ? await withServiceRole((q) =>
        q.many<{
          channel_id: string;
          status: string;
          expires_at: string;
          last_message_at: string | null;
          last_message_number: string | null;
        }>(
          `select channel_id, status, expires_at, last_message_at, last_message_number::text
             from public.calendar_watch_channels
            where connection_id = $1 order by created_at desc limit 5`,
          [connection.id],
        ),
      )
    : [];

  // calendar_sync_events is server-only bookkeeping with no RLS policy, so the
  // service role is unavoidable here — which is exactly why the query must be
  // scoped BY HAND to this user's own channels. Unscoped, it showed the last
  // 12 webhook hits of every workspace in the deployment (audit 24/07/2026).
  const recent = connection
    ? await withServiceRole((q) =>
        q.many<{
          id: string;
          channel_id: string | null;
          message_number: string | null;
          received_at: string;
          processed_at: string | null;
          outcome: string | null;
          error: string | null;
        }>(
          `select e.id::text as id, e.channel_id, e.message_number::text, e.received_at,
                  e.processed_at, e.outcome, e.error
             from public.calendar_sync_events e
            where e.channel_id in (
                    select w.channel_id from public.calendar_watch_channels w
                     where w.connection_id = $1)
            order by e.id desc limit 12`,
          [connection.id],
        ),
      )
    : [];

  // Aggregate sync state is workspace data with a real RLS policy: read it as
  // the user, not as the service role.
  const links = await query(session, (q) =>
    q.many<{ status: string; n: string }>(
      `select status::text as status, count(*)::text as n
         from public.calendar_event_links where workspace_id = $1 group by status`,
      [session.workspaceId],
    ),
  );

  const connected = Boolean(connection && connection.status === 'CONNECTAT');
  const isGoogle = connection?.provider === 'google';

  return (
    <div className="grid gap-5 max-w-[900px]">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="etiqueta m-0">CALENDARI</p>
          <h1 className="text-2xl font-semibold tracking-tight m-0">GOOGLE CALENDAR</h1>
        </div>
        <Link className="boto" href="/calendari">
          TORNAR AL CALENDARI
        </Link>
      </header>

      {params.ok === 'connectat' && (
        <p className="targeta p-3 m-0 text-[13px] border-l-[3px] border-l-[var(--color-ok)]">
          Compte de Google connectat correctament.
        </p>
      )}
      {params.error && (
        <p className="targeta p-3 m-0 text-[13px] border-l-[3px] border-l-[var(--color-danger)]">
          {ERRORS[params.error] ?? 'No s’ha pogut completar l’operació amb Google.'}
          {params.detall ? ` · ${params.detall}` : ''}
        </p>
      )}

      {/* ---------------- configuration ---------------- */}
      <section className="targeta p-4 grid gap-2">
        <h2 className="etiqueta m-0">CONFIGURACIÓ DE L&apos;ENTORN</h2>
        {config.configured ? (
          <p className="m-0 text-[13px]">
            <span className="estat estat-ok">CONFIGURAT</span> Les credencials OAuth hi són. Els
            comercials poden connectar el seu compte i sincronitzar les visites en tots dos sentits.
          </p>
        ) : (
          <>
            <p className="m-0 text-[13px]">
              <span className="estat estat-neutre">NO CONFIGURAT</span> Google Calendar no està
              configurat en aquest entorn. <strong>Tot funciona igual</strong>: les visites, les
              tasques, la reprogramació, els avisos i la reconciliació s&apos;executen contra el
              proveïdor de calendari local.
            </p>
            <p className="m-0 text-[13px]">
              Per activar Google cal crear un client OAuth a Google Cloud amb l&apos;API de Calendar
              habilitada i definir:
            </p>
            <ul className="m-0 pl-5 text-[13px]">
              {config.missing.map((name) => (
                <li key={name}>
                  <code>{name}</code>
                </li>
              ))}
              <li>
                <code>GOOGLE_REDIRECT_URI</code> — ara mateix{' '}
                <code>{config.redirectUri ?? 'per defecte /api/google/callback'}</code>
              </li>
              <li>
                <code>GOOGLE_CALENDAR_WEBHOOK_URL</code> — URL HTTPS pública per rebre els avisos
                instantanis. Sense ella els canvis es detecten per sondeig (FORÇAR RECONCILIACIÓ).
              </li>
              <li>
                <code>APP_ENCRYPTION_KEY</code> — clau mestra per xifrar els testimonis desats.
                {config.encryptionKeyPresent ? ' Definida.' : ' Encara no està definida.'}
              </li>
            </ul>
          </>
        )}
        <p className="m-0 text-[12px] text-[var(--color-ink-faint)]">
          Àmbits demanats: només lectura/escriptura d&apos;esdeveniments del calendari triat, la
          llista de calendaris i la creació del calendari propi de l&apos;aplicació. Els testimonis
          es xifren amb AES-256-GCM abans de desar-los i no surten mai del servidor.
        </p>
      </section>

      {/* ---------------- connection ---------------- */}
      <section className="targeta p-4 grid gap-2">
        <h2 className="etiqueta m-0">CONNEXIÓ D&apos;AQUEST USUARI</h2>
        {!connection ? (
          <p className="m-0 text-[13px]">
            Encara no hi ha cap connexió. Es crea sola en desar la primera visita, o pots activar-la
            ara.
          </p>
        ) : (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 m-0 text-[13px]">
            <dt className="etiqueta m-0">PROVEÏDOR</dt>
            <dd className="m-0">{isGoogle ? 'GOOGLE CALENDAR' : 'CALENDARI LOCAL'}</dd>
            <dt className="etiqueta m-0">ESTAT</dt>
            <dd className="m-0">
              <span
                className={`estat ${
                  connection.status === 'CONNECTAT'
                    ? 'estat-ok'
                    : connection.status === 'DESCONNECTAT'
                      ? 'estat-neutre'
                      : 'estat-perill'
                }`}
              >
                {connection.status}
              </span>
            </dd>
            <dt className="etiqueta m-0">COMPTE</dt>
            <dd className="m-0">{connection.google_account_email ?? '—'}</dd>
            <dt className="etiqueta m-0">CALENDARI</dt>
            <dd className="m-0">
              {connection.calendar_name ?? connection.calendar_id ?? '—'}
            </dd>
            <dt className="etiqueta m-0">DARRERA SINCRONITZACIÓ</dt>
            <dd className="m-0">
              {connection.last_sync_at
                ? `${formatDate(connection.last_sync_at)} ${formatTime(connection.last_sync_at)}`
                : 'Encara cap'}
            </dd>
            <dt className="etiqueta m-0">DARRER ERROR</dt>
            <dd className="m-0">{connection.last_error ?? '—'}</dd>
          </dl>
        )}

        <GooglePanel
          calendars={calendars.map((c) => ({
            id: c.id,
            summary: c.summary,
            primary: c.primary === true,
          }))}
          currentCalendarId={connection?.calendar_id ?? null}
          connected={connected}
          googleConfigured={config.configured}
        />
        <p className="m-0 text-[12px] text-[var(--color-ink-faint)]">
          «CREAR CALENDARI DEDICAT» crea un calendari anomenat{' '}
          <strong>{DEDICATED_CALENDAR_NAME}</strong> i hi envia totes les visites, de manera que el
          calendari personal queda intacte.
        </p>
      </section>

      {/* ---------------- state of the links ---------------- */}
      <section className="targeta p-4 grid gap-2">
        <h2 className="etiqueta m-0">ESTAT DE LES VISITES SINCRONITZADES</h2>
        {links.length === 0 ? (
          <p className="m-0 text-[13px] text-[var(--color-ink-faint)]">
            Cap visita enllaçada encara.
          </p>
        ) : (
          <ul className="list-none p-0 m-0 flex flex-wrap gap-2">
            {links.map((row) => (
              <li key={row.status}>
                <span
                  className={`estat ${
                    row.status === 'SINCRONITZAT'
                      ? 'estat-ok'
                      : row.status === 'ERROR'
                        ? 'estat-perill'
                        : 'estat-neutre'
                  }`}
                >
                  {row.status} · {row.n}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------- watch channels ---------------- */}
      <section className="targeta p-4 grid gap-2">
        <h2 className="etiqueta m-0">CANALS D&apos;AVISOS</h2>
        {channels.length === 0 ? (
          <p className="m-0 text-[13px] text-[var(--color-ink-faint)]">
            Cap canal obert. Sense canal, els canvis fets al calendari es recuperen amb FORÇAR
            RECONCILIACIÓ.
          </p>
        ) : (
          <div className="taula-ampla">
            <table className="taula taula-compacta">
              <thead>
                <tr>
                  <th>CANAL</th>
                  <th>ESTAT</th>
                  <th>CADUCA</th>
                  <th>DARRER AVÍS</th>
                </tr>
              </thead>
              <tbody>
                {channels.map((c) => (
                  <tr key={c.channel_id}>
                    <td className="font-mono text-[11px]">{c.channel_id}</td>
                    <td>
                      <span
                        className={`estat ${c.status === 'ACTIU' ? 'estat-ok' : 'estat-neutre'}`}
                      >
                        {c.status}
                      </span>
                    </td>
                    <td className="tabular-nums">
                      {formatDate(c.expires_at)} {formatTime(c.expires_at)}
                    </td>
                    <td className="tabular-nums">
                      {c.last_message_at
                        ? `${formatDate(c.last_message_at)} ${formatTime(c.last_message_at)} · núm. ${c.last_message_number ?? '—'}`
                        : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="m-0 text-[12px] text-[var(--color-ink-faint)]">
          Els canals caduquen com a molt al cap d&apos;una setmana. Es renoven automàticament un dia
          abans cada cop que s&apos;executa la reconciliació.
        </p>
      </section>

      {/* ---------------- notification log ---------------- */}
      <section className="targeta p-4 grid gap-2">
        <h2 className="etiqueta m-0">DIARI D&apos;AVISOS REBUTS</h2>
        {recent.length === 0 ? (
          <p className="m-0 text-[13px] text-[var(--color-ink-faint)]">Cap avís encara.</p>
        ) : (
          <div className="taula-ampla">
            <table className="taula taula-compacta">
              <thead>
                <tr>
                  <th>REBUT</th>
                  <th>CANAL</th>
                  <th>NÚM.</th>
                  <th>RESULTAT</th>
                  <th>ERROR</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((row) => (
                  <tr key={row.id}>
                    <td className="tabular-nums whitespace-nowrap">
                      {formatDate(row.received_at)} {formatTime(row.received_at)}
                    </td>
                    <td className="font-mono text-[11px]">{row.channel_id ?? '—'}</td>
                    <td className="tabular-nums">{row.message_number ?? '—'}</td>
                    <td>{row.outcome ?? 'PENDENT'}</td>
                    <td className="text-[var(--color-danger)]">{row.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="m-0 text-[12px] text-[var(--color-ink-faint)]">
          Un avís repetit amb el mateix número de missatge no es torna a processar mai: la clau
          (canal, número) és única. Un canvi que ve del calendari s&apos;aplica al CRM i{' '}
          <strong>no es reenvia mai al calendari</strong> — el resultat queda registrat com a «cap
          canvi» perquè els dos costats ja coincideixen.
        </p>
      </section>
    </div>
  );
}
