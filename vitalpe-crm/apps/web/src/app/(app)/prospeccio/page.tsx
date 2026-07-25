import { query, requireRole } from '@/lib/auth';
import { formatDate } from '@/lib/format';
import { ProspectRow } from '@/components/prospect-row';

export const dynamic = 'force-dynamic';

/**
 * PROSPECCIÓ — companies found in public registers that are not in the CRM.
 *
 * Every row carries the register it came from and the day it was consulted.
 * That is the whole guarantee: a prospect nobody can trace back to a source is
 * indistinguishable from an invented one, so the table refuses to hold one.
 *
 * Nothing here becomes a customer on its own. Converting is a button a person
 * presses, and the created company starts with no classification, because an
 * unqualified lead is precisely a company nobody has judged yet.
 */

interface Row {
  id: string;
  name: string;
  municipality: string | null;
  province: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  source: string;
  source_url: string | null;
  discovered_on: string;
  suggested_product: string | null;
  rationale: string | null;
  status: string;
  review_note: string | null;
  reviewed_at: string | null;
  reviewer: string | null;
  client_id: string | null;
}

export default async function ProspeccioPage({
  searchParams,
}: {
  searchParams: Promise<{ estat?: string }>;
}) {
  const session = await requireRole('ADMIN', 'GERENT');
  const params = await searchParams;
  const status = ['CANDIDAT', 'DESCARTAT', 'CONVERTIT'].includes(params.estat ?? '')
    ? (params.estat as string)
    : 'CANDIDAT';

  const { rows, counts } = await query(session, async (q) => {
    const rows = await q.many<Row>(
      `select p.id, p.name, p.municipality, p.province, p.website, p.phone, p.email,
              p.source, p.source_url, p.discovered_on::text as discovered_on,
              p.suggested_product, p.rationale, p.status::text as status,
              p.review_note, p.reviewed_at::text as reviewed_at, p.client_id,
              nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), '') as reviewer
         from public.prospects p
         left join public.profiles pr on pr.id = p.reviewed_by
        where p.workspace_id = $1 and p.status = $2::app.prospect_status
        order by p.municipality nulls last, p.name`,
      [session.workspaceId, status],
    );
    const counts = await q.many<{ status: string; n: string }>(
      `select status::text as status, count(*)::text as n
         from public.prospects where workspace_id = $1 group by status`,
      [session.workspaceId],
    );
    return { rows, counts };
  });

  const countFor = (s: string): string => counts.find((c) => c.status === s)?.n ?? '0';
  const isAdmin = session.role === 'ADMIN';

  return (
    <div className="grid gap-5 max-w-[1000px]">
      <header>
        <p className="etiqueta m-0">CARTERA FUTURA</p>
        <h1 className="text-2xl font-semibold tracking-tight m-0">PROSPECCIÓ</h1>
        <p className="text-[13px] text-[var(--color-ink-soft)] mt-1 mb-0 max-w-[70ch]">
          Empreses trobades a registres públics que encara no són al CRM. Cada fila diu d&apos;on
          surt i quin dia es va consultar. Cap es converteix en client sola: ho decideixes tu, i la
          fitxa que es crea neix sense classificació perquè ningú l&apos;ha valorada encara.
        </p>
      </header>

      <nav className="flex flex-wrap gap-2">
        {[
          { id: 'CANDIDAT', label: 'PER REVISAR' },
          { id: 'CONVERTIT', label: 'DONATS D’ALTA' },
          { id: 'DESCARTAT', label: 'DESCARTATS' },
        ].map((tab) => (
          <a
            key={tab.id}
            href={`/prospeccio?estat=${tab.id}`}
            className={`boto no-underline ${status === tab.id ? 'boto-principal' : ''}`}
          >
            {tab.label} ({countFor(tab.id)})
          </a>
        ))}
      </nav>

      {rows.length === 0 ? (
        <section className="targeta p-4">
          <p className="etiqueta m-0 mb-1">RES A REVISAR</p>
          <p className="text-[13px] text-[var(--color-ink-soft)] m-0">
            {status === 'CANDIDAT'
              ? 'No hi ha cap candidat pendent. Els registres consultats fins ara ja són tots a la base.'
              : 'Cap empresa en aquest estat.'}
          </p>
        </section>
      ) : (
        <ul className="list-none p-0 m-0 grid gap-3">
          {rows.map((row) => (
            <li key={row.id}>
              <ProspectRow
                prospect={{
                  id: row.id,
                  name: row.name,
                  municipality: row.municipality,
                  province: row.province,
                  website: row.website,
                  phone: row.phone,
                  email: row.email,
                  source: row.source,
                  sourceUrl: row.source_url,
                  discoveredOn: formatDate(row.discovered_on),
                  suggestedProduct: row.suggested_product,
                  rationale: row.rationale,
                  status: row.status,
                  reviewNote: row.review_note,
                  reviewedAt: row.reviewed_at ? formatDate(row.reviewed_at) : null,
                  reviewer: row.reviewer,
                  clientId: row.client_id,
                }}
                canDecide={isAdmin && row.status === 'CANDIDAT'}
              />
            </li>
          ))}
        </ul>
      )}

      <section className="targeta p-4">
        <h2 className="etiqueta mb-2">D&apos;ON SURTEN AQUESTES EMPRESES</h2>
        <p className="text-[13px] text-[var(--color-ink-soft)] m-0">
          De registres públics dels consells reguladors, no d&apos;una llista comprada ni d&apos;una
          invenció. Fins ara s&apos;han contrastat el registre de la <strong>DO Penedès</strong> i el
          de la <strong>DO Catalunya</strong>: dels 260 cellers publicats, 258 ja eren a la base.
          Per afegir-ne un altre registre, es prepara un fitxer a <code>data/prospects/</code> amb la
          font i la URL, i s&apos;executa <code>pnpm prospeccio</code>.
        </p>
      </section>
    </div>
  );
}
