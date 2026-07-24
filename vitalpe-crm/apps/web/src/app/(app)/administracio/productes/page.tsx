import Link from 'next/link';
import { query, requireRole } from '@/lib/auth';
import { setProductActive, dismissUnmappedValue, reopenUnmappedValue } from '@/lib/actions/admin';
import { AccioBoto } from '@/components/admin/accions';
import { AliesGestor, MapejarValor, NouProducte, type OpcioProducte } from '@/components/admin/productes-client';
import { buildCatalogueIndex, matchProduct } from '../../../../../../../scripts/import/products';

export const dynamic = 'force-dynamic';

/**
 * PRODUCTES — the normalised catalogue, its import aliases, and the queue of
 * source values nobody has mapped yet. Resolving an unmapped product is what
 * recovers the delivery-note lines parked in excluded_records.
 *
 * Bag in Box, BRISA and MARES are deliberately absent and must stay so: the
 * brief excludes them from the bulk-wine module. The page says so instead of
 * silently letting someone add them.
 */

interface ProductRow {
  id: string;
  name: string;
  category: string;
  is_organic: boolean;
  is_active: boolean;
  aliases: { id: string; alias: string; source: string | null }[] | null;
  opportunities: string;
}

interface UnmappedRow {
  id: string;
  kind: string;
  raw_value: string;
  occurrences: number;
  resolved_to: string | null;
  resolved_at: string | null;
}

const CATEGORIES = ['BASE CAVA', 'DO PENEDES', 'DO CATALUNYA', 'ALTRES / SENSE DO'] as const;

export default async function ProductesPage() {
  const session = await requireRole('ADMIN');

  const data = await query(session, async (q) => {
    const [products, unmapped] = await Promise.all([
      q.many<ProductRow>(
        `select p.id, p.name, p.category, p.is_organic, p.is_active,
                (select json_agg(json_build_object('id', a.id, 'alias', a.alias, 'source', a.source)
                        order by a.alias)
                   from public.product_aliases a where a.product_id = p.id) as aliases,
                (select count(*)::text from public.opportunities o
                  where o.product_id = p.id and o.deleted_at is null) as opportunities
           from public.products p
          where p.deleted_at is null
          order by p.category, p.sort_order, p.name`,
      ),
      q.many<UnmappedRow>(
        `select id, kind, raw_value, occurrences, resolved_to, resolved_at::text as resolved_at
           from public.unmapped_values
          where workspace_id = $1
          order by (resolved_at is null) desc, kind, occurrences desc, raw_value`,
        [session.workspaceId],
      ),
    ]);
    return { products, unmapped };
  });

  const options: OpcioProducte[] = data.products
    .filter((p) => p.is_active)
    .map((p) => ({ id: p.id, name: p.name, category: p.category }));

  // The same facet parser the importer uses (kind · colour · variety ·
  // category · organic) pre-selects the likely catalogue product for each
  // unmapped value. A suggestion, not a decision: the admin still confirms.
  const { index } = buildCatalogueIndex(
    data.products.filter((p) => p.is_active).map((p) => ({ id: p.id, name: p.name })),
  );
  const suggest = (raw: string): string | null => matchProduct(raw, index).productId;

  const pendingProducts = data.unmapped.filter((u) => u.kind === 'PRODUCTE' && !u.resolved_at);
  const pendingOther = data.unmapped.filter((u) => u.kind !== 'PRODUCTE' && !u.resolved_at);
  const resolved = data.unmapped.filter((u) => u.resolved_at);

  return (
    <div className="grid gap-6 max-w-[1100px]">
      <header>
        <p className="etiqueta m-0">
          <Link href="/administracio">ADMINISTRACIÓ</Link> / PRODUCTES
        </p>
        <h1 className="text-2xl font-semibold tracking-tight m-0">CATÀLEG NORMALITZAT</h1>
        <p className="text-[13px] text-[var(--color-ink-soft)] mt-1 mb-0 max-w-[68ch]">
          Els noms visibles no porten mai la campanya ni codis interns. Bag in Box, BRISA i
          MARES queden fora d&apos;aquest mòdul per especificació: les seves vendes són a
          «registres exclosos», no perdudes.
        </p>
      </header>

      {pendingProducts.length > 0 && (
        <section className="targeta p-4 border-l-[3px] border-l-[var(--color-warn)]">
          <h2 className="etiqueta m-0 mb-1">
            PRODUCTES SENSE MAPAR ({pendingProducts.length})
          </h2>
          <p className="text-[13px] text-[var(--color-ink-soft)] mt-0">
            Descripcions d&apos;albarà que no coincideixen amb cap producte. Assigna-les i les
            línies de venda aparcades es recuperaran a la propera importació.
          </p>
          <ul className="list-none p-0 m-0 grid gap-2">
            {pendingProducts.map((u) => (
              <li key={u.id} className="border border-[var(--color-line)] rounded-[var(--radius-sm)] p-3">
                <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
                  <code className="text-[13px]">{u.raw_value}</code>
                  <span className="estat estat-neutre">{u.occurrences} APARICIONS</span>
                </div>
                <MapejarValor
                  id={u.id}
                  rawValue={u.raw_value}
                  productes={options}
                  suggeriment={suggest(u.raw_value)}
                />
              </li>
            ))}
          </ul>
        </section>
      )}

      {pendingOther.length > 0 && (
        <section>
          <h2 className="etiqueta mb-2">ALTRES VALORS PENDENTS ({pendingOther.length})</h2>
          <p className="text-[12px] text-[var(--color-ink-faint)] mt-0">
            Accions, resultats i tipus vistos a les fonts que no són al vocabulari. No bloquegen
            res: les files es van importar amb el text original conservat. Descarta&apos;ls quan
            no calgui ampliar cap llista mestra.
          </p>
          <div className="taula-ampla targeta">
            <table className="taula taula-compacta">
              <thead>
                <tr>
                  <th>TIPUS</th>
                  <th>VALOR ORIGINAL</th>
                  <th>APARICIONS</th>
                  <th className="text-right">ACCIONS</th>
                </tr>
              </thead>
              <tbody>
                {pendingOther.map((u) => (
                  <tr key={u.id}>
                    <td><span className="estat estat-neutre">{u.kind}</span></td>
                    <td><code className="text-[12px]">{u.raw_value}</code></td>
                    <td className="tabular-nums">{u.occurrences}</td>
                    <td className="text-right">
                      <AccioBoto
                        accio={dismissUnmappedValue}
                        camps={{ id: u.id }}
                        etiqueta="DESCARTAR"
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      <section>
        <div className="flex items-center justify-between gap-3 flex-wrap mb-2">
          <h2 className="etiqueta m-0">CATÀLEG ({data.products.length})</h2>
          <NouProducte />
        </div>
        {CATEGORIES.map((cat) => {
          const rows = data.products.filter((p) => p.category === cat);
          if (rows.length === 0) return null;
          return (
            <details key={cat} open className="mb-3">
              <summary className="cursor-pointer etiqueta py-1">
                {cat} ({rows.length})
              </summary>
              <div className="taula-ampla targeta mt-1">
                <table className="taula taula-compacta">
                  <thead>
                    <tr>
                      <th>PRODUCTE</th>
                      <th>ECOLÒGIC</th>
                      <th>OPORTUNITATS</th>
                      <th>ÀLIES D&apos;IMPORTACIÓ</th>
                      <th className="text-right">ESTAT</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.id} id={p.id}>
                        <td className={p.is_active ? '' : 'text-[var(--color-ink-faint)] line-through'}>
                          {p.name}
                        </td>
                        <td>{p.is_organic ? <span className="estat estat-ok">ECO</span> : '—'}</td>
                        <td className="tabular-nums">{p.opportunities}</td>
                        <td>
                          <AliesGestor productId={p.id} alies={p.aliases ?? []} />
                        </td>
                        <td className="text-right">
                          <AccioBoto
                            accio={setProductActive}
                            camps={{ id: p.id, active: p.is_active ? '' : '1' }}
                            etiqueta={p.is_active ? 'DESACTIVAR' : 'ACTIVAR'}
                            variant={p.is_active ? 'perill' : 'normal'}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
      </section>

      {resolved.length > 0 && (
        <details>
          <summary className="cursor-pointer etiqueta">RESOLTS ({resolved.length})</summary>
          <ul className="list-none p-0 mt-2 grid gap-1 text-[12px]">
            {resolved.map((u) => (
              <li key={u.id} className="flex items-center gap-2 flex-wrap">
                <span className="estat estat-ok">{u.kind}</span>
                <code>{u.raw_value}</code>
                <span className="text-[var(--color-ink-faint)]">→ {u.resolved_to ?? 'descartat'}</span>
                <AccioBoto accio={reopenUnmappedValue} camps={{ id: u.id }} etiqueta="REOBRIR" />
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
