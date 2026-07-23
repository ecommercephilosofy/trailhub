import Link from 'next/link';
import { query, requireSession } from '@/lib/auth';
import { interpreter, transcriptionProvider } from '@/lib/voice/providers';
import { RegistreRapid } from '@/components/registre/registre-rapid';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

/**
 * REGISTRE RÀPID — one screen for structured form, free text and voice.
 * All three converge on the same preview, so the flow is identical whether or
 * not an AI provider is configured.
 */
export default async function RegistrePage({
  searchParams,
}: {
  searchParams: Promise<{ client?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;

  const data = await query(session, async (q) => {
    const [selected, recent] = await Promise.all([
      params.client
        ? q.one<{ id: string; name: string }>(
            `select id, name from public.clients where id = $1 and deleted_at is null`,
            [params.client],
          )
        : Promise.resolve(null),
      q.many<{
        id: string; created_at: string; transcript: string | null; summary: string | null;
        client_name: string | null; confirmed_at: string | null; transcription_status: string;
      }>(
        `select v.id, v.created_at::text as created_at, left(coalesce(v.transcript,''), 180) as transcript,
                v.summary, c.name as client_name, v.confirmed_at::text as confirmed_at,
                v.transcription_status::text as transcription_status
           from public.voice_notes v
           left join public.clients c on c.id = v.client_id
          where v.user_id = $1
          order by v.created_at desc
          limit 8`,
        [session.userId],
      ),
    ]);
    return { selected, recent };
  });

  const transcription = transcriptionProvider().info;
  const interpretation = interpreter().info;

  return (
    <div className="grid gap-6 max-w-[1000px]">
      <header>
        <p className="etiqueta m-0">CAPTURA RÀPIDA</p>
        <h1 className="text-2xl font-semibold tracking-tight m-0">REGISTRE</h1>
        <p className="text-[13px] text-[var(--color-ink-soft)] mt-1 mb-0">
          Dicta o escriu què ha passat. Sempre veuràs una previsualització abans de desar res.
        </p>
      </header>

      {(!transcription.configured || !interpretation.configured) && (
        <div className="targeta p-3 border-l-[3px] border-l-[var(--color-warn)] text-[13px] grid gap-1">
          <p className="etiqueta m-0">CONFIGURACIÓ PENDENT</p>
          {transcription.notice && <p className="m-0">{transcription.notice}</p>}
          {interpretation.notice && <p className="m-0">{interpretation.notice}</p>}
          <p className="m-0 text-[var(--color-ink-faint)]">
            Res d&apos;això impedeix treballar: pots escriure el text, enganxar una transcripció o
            fer servir el formulari estructurat.
          </p>
        </div>
      )}

      <RegistreRapid
        selectedClientId={data.selected?.id ?? null}
        selectedClientName={data.selected?.name ?? null}
        interpreterName={interpretation.name}
      />

      {data.recent.length > 0 && (
        <section>
          <h2 className="etiqueta mb-2">NOTES RECENTS</h2>
          <div className="taula-ampla targeta">
            <table className="taula">
              <thead>
                <tr>
                  <th>DATA</th>
                  <th>CLIENT</th>
                  <th>TRANSCRIPCIÓ</th>
                  <th>ESTAT</th>
                </tr>
              </thead>
              <tbody>
                {data.recent.map((n) => (
                  <tr key={n.id}>
                    <td className="whitespace-nowrap tabular-nums">{formatDateTime(n.created_at)}</td>
                    <td>{n.client_name ?? <span className="text-[var(--color-ink-faint)]">—</span>}</td>
                    <td className="text-[var(--color-ink-soft)]">
                      {n.transcript || <em>sense transcripció</em>}
                    </td>
                    <td>
                      {n.confirmed_at ? (
                        <span className="estat estat-ok">APLICADA</span>
                      ) : n.transcription_status === 'NO DISPONIBLE' ? (
                        <span className="estat estat-avis">TRANSCRIPCIÓ PENDENT</span>
                      ) : (
                        <span className="estat estat-neutre">SENSE CONFIRMAR</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-[12px] text-[var(--color-ink-faint)] mt-2 mb-0">
            Les notes queden també a la pestanya NOTES DE VEU de cada{' '}
            <Link href="/clients">fitxa d&apos;empresa</Link>.
          </p>
        </section>
      )}
    </div>
  );
}
