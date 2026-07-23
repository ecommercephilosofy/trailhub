'use client';

import { useState } from 'react';
import { formatDate, formatLiters } from '@/lib/format';
import { removeOpportunity, updateOpportunity } from '@/lib/actions/opportunities';
import { AccioForm, Panell } from './accio-form';
import { FormulariOportunitat, type Referencia } from './accions-rapides';

export interface Lliurament {
  id: string;
  guide_number: string | null;
  guide_date: string | null;
  volume_liters: string | null;
  raw_product: string | null;
}

export interface OportunitatRow {
  id: string;
  product_id: string;
  product_name: string;
  product_category: string;
  campaign_id: string;
  campaign_name: string;
  data_type: string;
  volume_liters: string | null;
  forecast_next: string | null;
  status: string;
  notes: string | null;
  source: string | null;
  deliveries: Lliurament[];
}

const DATA_TYPE_TONE: Record<string, string> = {
  'COMPRA REAL': 'estat estat-ok',
  'PREVISIO CONFIRMADA': 'estat estat-marca',
  'POSSIBLE COMPRA': 'estat estat-neutre',
};

const DATA_TYPE_LABEL: Record<string, string> = {
  'COMPRA REAL': 'COMPRA REAL',
  'PREVISIO CONFIRMADA': 'PREVISIÓ CONFIRMADA',
  'POSSIBLE COMPRA': 'POSSIBLE COMPRA',
};

/**
 * VINS I OPORTUNITATS — grouped by campaign, because that is how the trade
 * reasons about it. Delivery notes sit behind a disclosure so the common view
 * stays readable; they are the proof behind a COMPRA REAL.
 */
export function EditorOportunitats({
  clientId,
  rows,
  products,
  campaigns,
  defaultCampaignId,
  canEdit,
}: {
  clientId: string;
  rows: OportunitatRow[];
  products: { id: string; name: string; category: string }[];
  campaigns: Referencia[];
  defaultCampaignId: string | null;
  canEdit: boolean;
}): React.ReactElement {
  const [editing, setEditing] = useState<OportunitatRow | 'nova' | null>(null);

  const groups = new Map<string, { name: string; rows: OportunitatRow[] }>();
  for (const row of rows) {
    const group = groups.get(row.campaign_id) ?? { name: row.campaign_name, rows: [] };
    group.rows.push(row);
    groups.set(row.campaign_id, group);
  }
  const ordered = [...groups.entries()].sort((a, b) => b[1].name.localeCompare(a[1].name));

  return (
    <section className="grid gap-4">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="etiqueta m-0">VINS I OPORTUNITATS ({rows.length})</h2>
        {canEdit && (
          <button type="button" className="boto boto-principal" onClick={() => setEditing('nova')}>
            AFEGIR OPORTUNITAT
          </button>
        )}
      </header>

      {rows.length === 0 && (
        <p className="targeta p-4 m-0 text-[13px] text-[var(--color-ink-faint)]">
          Cap producte ni compra registrada per a aquesta empresa.
        </p>
      )}

      {ordered.map(([campaignId, group]) => (
        <div key={campaignId} className="grid gap-1">
          <p className="etiqueta m-0">CAMPANYA {group.name}</p>
          <div className="taula-ampla targeta">
            <table className="taula">
              <thead>
                <tr>
                  <th scope="col">PRODUCTE</th>
                  <th scope="col">TIPUS DE DADA</th>
                  <th scope="col">LITRES</th>
                  <th scope="col">PREVISIÓ PROPERA CAMPANYA</th>
                  <th scope="col">ESTAT</th>
                  <th scope="col">ALBARANS</th>
                  {canEdit && (
                    <th scope="col" className="text-right">
                      ACCIONS
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {group.rows.map((row) => (
                  <tr key={row.id}>
                    <td>
                      <span className="font-semibold">{row.product_name}</span>
                      <span className="block text-[11px] text-[var(--color-ink-faint)]">
                        {row.product_category}
                      </span>
                      {row.notes && (
                        <span className="block text-[11px] text-[var(--color-ink-soft)] mt-1">
                          {row.notes}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={DATA_TYPE_TONE[row.data_type] ?? 'estat estat-neutre'}>
                        {DATA_TYPE_LABEL[row.data_type] ?? row.data_type}
                      </span>
                    </td>
                    <td className="tabular-nums whitespace-nowrap">
                      {formatLiters(row.volume_liters)}
                    </td>
                    <td>
                      {row.forecast_next ?? (
                        <span className="text-[var(--color-ink-faint)]">NO DETERMINAT</span>
                      )}
                    </td>
                    <td>{row.status}</td>
                    <td>
                      {row.deliveries.length === 0 ? (
                        <span className="text-[var(--color-ink-faint)]">—</span>
                      ) : (
                        <details>
                          <summary className="cursor-pointer text-[12px]">
                            {row.deliveries.length} albarans
                          </summary>
                          <ul className="list-none p-0 m-0 mt-1 grid gap-1 text-[11px]">
                            {row.deliveries.map((delivery) => (
                              <li key={delivery.id} className="tabular-nums">
                                {delivery.guide_number ?? 'SENSE NÚMERO'} ·{' '}
                                {formatDate(delivery.guide_date)} ·{' '}
                                {formatLiters(delivery.volume_liters)}
                                {delivery.raw_product && (
                                  <span className="block text-[var(--color-ink-faint)]">
                                    {delivery.raw_product}
                                  </span>
                                )}
                              </li>
                            ))}
                          </ul>
                        </details>
                      )}
                    </td>
                    {canEdit && (
                      <td className="text-right">
                        <span className="inline-flex gap-1 justify-end flex-wrap">
                          <button type="button" className="boto" onClick={() => setEditing(row)}>
                            EDITAR
                          </button>
                          <AccioForm
                            action={removeOpportunity}
                            submitLabel="ELIMINAR"
                            submitClassName="boto boto-perill"
                            pendingLabel="…"
                            className="inline"
                            confirmText="L'oportunitat quedarà eliminada de la fitxa però es conserva a l'auditoria. Continuar?"
                            hidden={{ clientId, opportunityId: row.id }}
                          />
                        </span>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}

      {editing && (
        <Panell
          title={editing === 'nova' ? 'AFEGIR OPORTUNITAT' : 'EDITAR OPORTUNITAT'}
          onClose={() => setEditing(null)}
        >
          <FormulariOportunitat
            clientId={clientId}
            products={products}
            campaigns={campaigns}
            defaultCampaignId={defaultCampaignId}
            onDone={() => setEditing(null)}
            onCancel={() => setEditing(null)}
            {...(editing !== 'nova'
              ? {
                  action: updateOpportunity,
                  initial: {
                    id: editing.id,
                    productId: editing.product_id,
                    campaignId: editing.campaign_id,
                    dataType: editing.data_type,
                    volume: editing.volume_liters ? String(Number(editing.volume_liters)) : '',
                    forecastNext: editing.forecast_next ?? '',
                    status: editing.status,
                    notes: editing.notes ?? '',
                  },
                }
              : {})}
          />
        </Panell>
      )}
    </section>
  );
}
