'use client';

import { useState } from 'react';
import { formatDate } from '@/lib/format';
import { toCivilDate } from '@/components/calendar/dates';
import { addCorrection, createActivity, updateActivity } from '@/lib/actions/activities';
import { AccioForm, Camp, Panell } from './accio-form';

export interface AccioRow {
  id: string;
  occurred_on: string;
  activity_type: string;
  result: string | null;
  notes: string | null;
  user_name: string | null;
  product_name: string | null;
  campaign_name: string | null;
  origin: string;
  corrects_activity_id: string | null;
  is_corrected: boolean;
  created_at: string;
}

const ACTIVITY_TYPES = ['TRUCADA', 'CORREU', 'VISITA', 'MOSTRES', 'OFERTA', 'NOTA INTERNA', 'ALTRES'];
const RESULTS = [
  'INTERES CONCRET', 'DEMANA PREUS', 'DEMANA MOSTRES', 'ACORDAR VISITA',
  'TE UN ALTRE PROVEIDOR', 'REPETIRA COMANDA', 'NO DETERMINAT', 'NO COMPRARA',
  'NO COMPRA VI A GRANEL', 'TANCAT / INACTIU', 'ALTRES',
];

/**
 * HISTORIAL COMERCIAL — immutable, newest first.
 *
 * The normal way to fix something is to append a corrective action, which stays
 * linked to the one it corrects. A direct edit is possible for a manager only
 * (RLS decides, not this component) and is recorded in the audit log.
 */
export function EditorHistorial({
  clientId,
  rows,
  canEdit,
  manager,
  products,
  campaigns,
}: {
  clientId: string;
  rows: AccioRow[];
  canEdit: boolean;
  manager: boolean;
  products: { id: string; name: string }[];
  campaigns: { id: string; name: string }[];
}): React.ReactElement {
  const [panel, setPanel] = useState<
    { kind: 'nova' } | { kind: 'correccio'; row: AccioRow } | { kind: 'editar'; row: AccioRow } | null
  >(null);
  const close = (): void => setPanel(null);

  return (
    <section className="grid gap-3">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="etiqueta m-0">HISTORIAL COMERCIAL ({rows.length})</h2>
        {canEdit && (
          <button
            type="button"
            className="boto boto-principal"
            onClick={() => setPanel({ kind: 'nova' })}
          >
            REGISTRAR ACCIÓ
          </button>
        )}
      </header>

      <p className="text-[11px] text-[var(--color-ink-faint)] m-0">
        L&apos;historial no es reescriu. Per esmenar una acció, afegeix-ne una de correctiva: totes
        dues queden visibles.
      </p>

      {rows.length === 0 ? (
        <p className="targeta p-4 m-0 text-[13px] text-[var(--color-ink-faint)]">
          Cap acció comercial registrada.
        </p>
      ) : (
        <ol className="list-none p-0 m-0 grid gap-2">
          {rows.map((row) => (
            <li key={row.id} className="targeta p-3 grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums font-semibold">{formatDate(row.occurred_on)}</span>
                <span className="estat estat-neutre">{row.activity_type}</span>
                {row.result && <span className="estat estat-marca">{row.result}</span>}
                {row.corrects_activity_id && (
                  <span className="estat estat-avis">ACCIÓ CORRECTIVA</span>
                )}
                {row.is_corrected && <span className="estat estat-avis">CORREGIDA MÉS ENDAVANT</span>}
                <span className="ml-auto text-[11px] text-[var(--color-ink-faint)]">
                  {row.user_name ?? 'Sistema'} · {row.origin}
                </span>
              </div>
              {(row.product_name ?? row.campaign_name) && (
                <p className="m-0 text-[12px] text-[var(--color-ink-soft)]">
                  {[row.product_name, row.campaign_name].filter(Boolean).join(' · ')}
                </p>
              )}
              {row.notes && <p className="m-0 text-[13px] whitespace-pre-line">{row.notes}</p>}
              {canEdit && (
                <div className="flex flex-wrap gap-2 mt-1">
                  <button
                    type="button"
                    className="boto"
                    onClick={() => setPanel({ kind: 'correccio', row })}
                  >
                    AFEGIR ACCIÓ CORRECTIVA
                  </button>
                  {manager && (
                    <button
                      type="button"
                      className="boto"
                      onClick={() => setPanel({ kind: 'editar', row })}
                    >
                      CORREGIR (AUDITAT)
                    </button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ol>
      )}

      {panel?.kind === 'nova' && (
        <Panell title="REGISTRAR ACCIÓ" onClose={close}>
          <AccioForm action={createActivity} onDone={close} onCancel={close} hidden={{ clientId }}>
            <CampsAccio products={products} campaigns={campaigns} />
          </AccioForm>
        </Panell>
      )}

      {panel?.kind === 'correccio' && (
        <Panell
          title="AFEGIR ACCIÓ CORRECTIVA"
          subtitle={`Corregeix l'acció del ${formatDate(panel.row.occurred_on)}`}
          onClose={close}
        >
          <AccioForm
            action={addCorrection}
            onDone={close}
            onCancel={close}
            hidden={{ clientId, correctsId: panel.row.id }}
          >
            <CampsAccio
              products={products}
              campaigns={campaigns}
              initial={panel.row}
              notesRequired
            />
          </AccioForm>
        </Panell>
      )}

      {panel?.kind === 'editar' && (
        <Panell
          title="CORREGIR L'ACCIÓ"
          subtitle="El canvi queda registrat a CANVIS/AUDITORIA amb el valor anterior."
          onClose={close}
        >
          <AccioForm
            action={updateActivity}
            onDone={close}
            onCancel={close}
            hidden={{ clientId, activityId: panel.row.id }}
          >
            <CampsAccio products={products} campaigns={campaigns} initial={panel.row} noReferences />
          </AccioForm>
        </Panell>
      )}
    </section>
  );
}

function CampsAccio({
  products,
  campaigns,
  initial,
  notesRequired = false,
  noReferences = false,
}: {
  products: { id: string; name: string }[];
  campaigns: { id: string; name: string }[];
  initial?: AccioRow;
  notesRequired?: boolean;
  noReferences?: boolean;
}): React.ReactElement {
  const [result, setResult] = useState(initial?.result ?? '');
  return (
    <>
      <Camp label="DATA">
        <input
          className="camp"
          type="date"
          name="occurredOn"
          // `String(new Date())` is "Tue Jul 24 2026 …", so slicing it fed the
          // date input garbage. toCivilDate() takes either shape.
          defaultValue={initial ? toCivilDate(initial.occurred_on) : ''}
        />
      </Camp>
      <Camp label="TIPUS D'ACCIÓ">
        <select className="camp" name="activityType" defaultValue={initial?.activity_type ?? 'TRUCADA'}>
          {ACTIVITY_TYPES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Camp>
      <Camp label="RESULTAT">
        <select
          className="camp"
          name="result"
          value={result}
          onChange={(event) => setResult(event.target.value)}
        >
          <option value="">Sense resultat</option>
          {RESULTS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>
      </Camp>
      {!noReferences && (
        <>
          <Camp label="PRODUCTE">
            <select className="camp" name="productId" defaultValue="">
              <option value="">Cap</option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </Camp>
          <Camp label="CAMPANYA">
            <select className="camp" name="campaignId" defaultValue="">
              <option value="">Cap</option>
              {campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </Camp>
        </>
      )}
      <Camp
        label={
          notesRequired
            ? 'OBSERVACIONS (OBLIGATÒRIES)'
            : result === 'ALTRES'
              ? 'OBSERVACIONS (OBLIGATÒRIES)'
              : 'OBSERVACIONS'
        }
        hint={
          notesRequired
            ? 'Explica què es corregeix i quina és la versió bona.'
            : 'El resultat ALTRES exigeix una observació.'
        }
      >
        <textarea
          className="camp"
          name="notes"
          rows={4}
          defaultValue={initial?.notes ?? ''}
          required={notesRequired || result === 'ALTRES'}
        />
      </Camp>
    </>
  );
}
