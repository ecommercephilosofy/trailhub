import Link from 'next/link';
import { query, requireRole } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { decideDuplicate, undoMerge } from '@/lib/actions/admin';
import { AccioBoto, AccioFormulari } from '@/components/admin/accions';

export const dynamic = 'force-dynamic';

/**
 * DUPLICATS — the review queue. Nothing merges silently: every pair waits here
 * until a person decides, and FUSIONAR additionally demands typing CONFIRMO.
 * A GERENT may look; only an ADMIN may decide (enforced again in the action
 * and again by RLS).
 */

interface Candidate {
  id: string;
  score: string;
  candidate_name: string | null;
  created_at: string;
  signals: Record<string, unknown> | null;
  left_id: string | null;
  left_name: string | null;
  left_municipality: string | null;
  left_contacts: string;
  left_activities: string;
  right_id: string | null;
  right_name: string | null;
  right_municipality: string | null;
  right_contacts: string;
  right_activities: string;
}

interface Merge {
  id: string;
  merged_at: string;
  reason: string;
  surviving_name: string | null;
  merged_name: string;
  undone_at: string | null;
}

export default async function DuplicatsPage({
  searchParams,
}: {
  searchParams: Promise<{ pagina?: string }>;
}) {
  const session = await requireRole('ADMIN', 'GERENT');
  const admin = session.role === 'ADMIN';
  const params = await searchParams;
  const page = Math.max(1, Number(params.pagina ?? '1') || 1);
  const PER_PAGE = 10;

  const data = await query(session, async (q) => {
    const [total, candidates, merges] = await Promise.all([
      q.one<{ n: string }>(
        `select count(*)::text as n from public.duplicate_candidates
          where workspace_id = $1 and decision = 'PENDENT'`,
        [session.workspaceId],
      ),
      q.many<Candidate>(
        `select d.id, d.score::text as score, d.candidate_name, d.created_at::text as created_at,
                d.signals,
                l.id::text as left_id, l.name as left_name, l.municipality as left_municipality,
                (select count(*)::text from public.contacts ct
                  where ct.client_id = l.id and ct.deleted_at is null) as left_contacts,
                (select count(*)::text from public.activities a
                  where a.client_id = l.id and a.deleted_at is null) as left_activities,
                r.id::text as right_id, r.name as right_name, r.municipality as right_municipality,
                (select count(*)::text from public.contacts ct
                  where ct.client_id = r.id and ct.deleted_at is null) as right_contacts,
                (select count(*)::text from public.activities a
                  where a.client_id = r.id and a.deleted_at is null) as right_activities
           from public.duplicate_candidates d
           left join public.clients l on l.id = d.left_client_id
           left join public.clients r on r.id = d.right_client_id
          where d.workspace_id = $1 and d.decision = 'PENDENT'
          order by d.score desc, d.created_at
          limit ${PER_PAGE} offset ${(page - 1) * PER_PAGE}`,
        [session.workspaceId],
      ),
      q.many<Merge>(
        `select m.id, m.merged_at::text as merged_at, m.reason,
                s.name as surviving_name,
                coalesce(m.snapshot -> 'client' ->> 'name', '?') as merged_name,
                m.undone_at::text as undone_at
           from public.client_merges m
           left join public.clients s on s.id = m.surviving_client_id
          where m.workspace_id = $1
          order by m.merged_at desc limit 10`,
        [session.workspaceId],
      ),
    ]);
    return { total: Number(total?.n ?? 0), candidates, merges };
  });

  const pages = Math.max(1, Math.ceil(data.total / PER_PAGE));

  return (
    <div className="grid gap-6 max-w-[1100px]">
      <header>
        <p className="etiqueta m-0">
          <Link href="/administracio">ADMINISTRACIÓ</Link> / DUPLICATS
        </p>
        <h1 className="text-2xl font-semibold tracking-tight m-0">CUA DE REVISIÓ</h1>
        <p className="text-[13px] text-[var(--color-ink-soft)] mt-1 mb-0 max-w-[68ch]">
          Parelles que s&apos;assemblen però que la importació no va gosar fusionar. Res no es
          fusiona sol; una fusió conserva una còpia completa i es pot desfer.
        </p>
      </header>

      {!admin && (
        <p className="targeta p-3 m-0 text-[13px] border-l-[3px] border-l-[var(--color-warn)]">
          Com a GERENT pots consultar la cua. Les decisions són d&apos;un ADMIN.
        </p>
      )}

      <p className="etiqueta m-0">
        {data.total} PENDENTS {pages > 1 && `· pàgina ${page} de ${pages}`}
      </p>

      {data.candidates.length === 0 ? (
        <p className="targeta p-4 m-0 text-[13px]">
          Cap candidat pendent. {data.total > 0 ? 'Torna a la primera pàgina.' : 'Tot revisat.'}
        </p>
      ) : (
        <ul className="list-none p-0 m-0 grid gap-4">
          {data.candidates.map((c) => {
            const similar = Math.round(Number(c.score) * 100);
            return (
              <li key={c.id} className="targeta p-4 grid gap-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <span className={`estat ${similar >= 80 ? 'estat-perill' : similar >= 60 ? 'estat-avis' : 'estat-neutre'}`}>
                    SEMBLANÇA {similar}%
                  </span>
                  <span className="text-[11px] text-[var(--color-ink-faint)]">
                    detectat {formatDate(c.created_at)}
                  </span>
                </div>

                <div className="grid md:grid-cols-2 gap-3">
                  {(
                    [
                      ['ESQUERRA', c.left_id, c.left_name, c.left_municipality, c.left_contacts, c.left_activities],
                      ['DRETA', c.right_id, c.right_name ?? c.candidate_name, c.right_municipality, c.right_contacts, c.right_activities],
                    ] as const
                  ).map(([side, id, name, municipality, contacts, activities]) => (
                    <div key={side} className="border border-[var(--color-line)] rounded-[var(--radius-sm)] p-3">
                      <p className="etiqueta m-0">{side}</p>
                      {id ? (
                        <Link href={`/clients/${id}`} className="font-semibold">
                          {name}
                        </Link>
                      ) : (
                        <span className="font-semibold">{name ?? '—'}</span>
                      )}
                      <p className="m-0 mt-1 text-[12px] text-[var(--color-ink-soft)]">
                        {municipality ?? 'sense municipi'} · {contacts} contactes · {activities} accions
                      </p>
                    </div>
                  ))}
                </div>

                {admin && (
                  <div className="grid gap-2">
                    <div className="flex flex-wrap gap-2">
                      <AccioBoto
                        accio={decideDuplicate}
                        camps={{ id: c.id, decision: 'MANTENIR SEPARADES' }}
                        etiqueta="MANTENIR SEPARADES"
                      />
                      <AccioBoto
                        accio={decideDuplicate}
                        camps={{ id: c.id, decision: 'IGNORAR' }}
                        etiqueta="IGNORAR"
                      />
                    </div>
                    <details>
                      <summary className="cursor-pointer text-[12px] text-[var(--color-burgundy)]">
                        FUSIONAR… (reversible, demana confirmació)
                      </summary>
                      <div className="mt-2">
                        <AccioFormulari accio={decideDuplicate} etiqueta="FUSIONAR">
                          <input type="hidden" name="id" value={c.id} />
                          <input type="hidden" name="decision" value="FUSIONAR" />
                          <label className="grid gap-1">
                            <span className="etiqueta">QUINA SOBREVIU?</span>
                            <select name="survivor" className="camp max-w-[260px]" defaultValue="ESQUERRA">
                              <option value="ESQUERRA">{c.left_name ?? 'Esquerra'}</option>
                              <option value="DRETA">{c.right_name ?? c.candidate_name ?? 'Dreta'}</option>
                            </select>
                          </label>
                          <label className="grid gap-1">
                            <span className="etiqueta">ESCRIU «CONFIRMO»</span>
                            <input name="confirmation" className="camp max-w-[260px]" autoComplete="off" />
                          </label>
                          <p className="text-[11px] text-[var(--color-ink-faint)] m-0">
                            Els contactes, l&apos;historial i les tasques passen a la supervivent.
                            L&apos;altra queda com a àlies i la fusió es pot desfer des d&apos;aquí sota.
                          </p>
                        </AccioFormulari>
                      </div>
                    </details>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pages > 1 && (
        <nav className="flex gap-2" aria-label="Paginació">
          {page > 1 && (
            <Link className="boto" href={`/administracio/duplicats?pagina=${page - 1}`}>
              ← ANTERIORS
            </Link>
          )}
          {page < pages && (
            <Link className="boto" href={`/administracio/duplicats?pagina=${page + 1}`}>
              SEGÜENTS →
            </Link>
          )}
        </nav>
      )}

      {data.merges.length > 0 && (
        <section>
          <h2 className="etiqueta mb-2">FUSIONS FETES</h2>
          <div className="taula-ampla targeta">
            <table className="taula">
              <thead>
                <tr>
                  <th>DATA</th>
                  <th>ABSORBIDA</th>
                  <th>SUPERVIVENT</th>
                  <th>MOTIU</th>
                  <th className="text-right">ACCIONS</th>
                </tr>
              </thead>
              <tbody>
                {data.merges.map((m) => (
                  <tr key={m.id}>
                    <td className="tabular-nums whitespace-nowrap">{formatDate(m.merged_at)}</td>
                    <td>{m.merged_name}</td>
                    <td>{m.surviving_name ?? '—'}</td>
                    <td className="text-[var(--color-ink-soft)]">{m.reason}</td>
                    <td className="text-right">
                      {m.undone_at ? (
                        <span className="estat estat-neutre">DESFETA</span>
                      ) : admin ? (
                        <AccioBoto
                          accio={undoMerge}
                          camps={{ id: m.id }}
                          etiqueta="DESFER"
                          variant="perill"
                          titol="Restaura l'empresa absorbida amb les seves dades"
                        />
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}
