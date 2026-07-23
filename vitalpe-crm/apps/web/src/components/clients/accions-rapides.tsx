'use client';

import Link from 'next/link';
import { useState } from 'react';
import { createTask } from '@/lib/actions/tasks';
import { createVisit } from '@/lib/actions/activities';
import { createOpportunity } from '@/lib/actions/opportunities';
import { AccioForm, Camp, Panell } from './accio-form';

export interface Referencia {
  id: string;
  name: string;
}

const PRIORITIES = ['ALTA', 'MITJANA', 'BAIXA'];
const SAMPLE_SUBTYPES = ['PORTAR MOSTRES AL CLIENT', 'CATA A VITALPE', 'PENDENT DE CONCRETAR'];
const DATA_TYPES = [
  { value: 'COMPRA REAL', label: 'COMPRA REAL' },
  { value: 'PREVISIO CONFIRMADA', label: 'PREVISIÓ CONFIRMADA' },
  { value: 'POSSIBLE COMPRA', label: 'POSSIBLE COMPRA' },
];
const FORECASTS = ['REPETIR COMANDA', 'NO DETERMINAT', 'NO COMPRARAN', 'ALTRES'];

type PanelKind = 'visita' | 'tasca' | 'recordatori' | 'mostres' | 'oferta' | 'oportunitat' | null;

/**
 * The row of things a commercial does from the card itself. Everything that
 * writes opens a side panel with a sectioned form; nothing writes on one click.
 */
export function AccionsRapides({
  clientId,
  clientName,
  phone,
  email,
  mapHref,
  canEdit,
  locations,
  products,
  campaigns,
  defaultCampaignId,
}: {
  clientId: string;
  clientName: string;
  phone: string | null;
  email: string | null;
  mapHref: string | null;
  canEdit: boolean;
  locations: Referencia[];
  products: { id: string; name: string; category: string }[];
  campaigns: Referencia[];
  defaultCampaignId: string | null;
}): React.ReactElement {
  const [panel, setPanel] = useState<PanelKind>(null);
  const close = (): void => setPanel(null);

  return (
    <>
      <div className="flex flex-wrap gap-2">
        {phone ? (
          <a className="boto" href={`tel:${phone}`}>
            TRUCAR
          </a>
        ) : (
          <span className="boto opacity-50" aria-disabled="true" title="Sense telèfon registrat">
            TRUCAR
          </span>
        )}
        {email ? (
          <a className="boto" href={`mailto:${email}`}>
            ENVIAR CORREU
          </a>
        ) : (
          <span className="boto opacity-50" aria-disabled="true" title="Sense correu registrat">
            ENVIAR CORREU
          </span>
        )}
        <Accio label="REGISTRAR VISITA" onClick={() => setPanel('visita')} disabled={!canEdit} />
        <Link className="boto" href={`/registre?client=${clientId}`}>
          GRAVAR NOTA DE VEU
        </Link>
        <Accio label="CREAR TASCA" onClick={() => setPanel('tasca')} disabled={!canEdit} />
        <Accio label="CREAR RECORDATORI" onClick={() => setPanel('recordatori')} disabled={!canEdit} />
        <Accio label="AFEGIR MOSTRES" onClick={() => setPanel('mostres')} disabled={!canEdit} />
        <Accio label="AFEGIR OFERTA" onClick={() => setPanel('oferta')} disabled={!canEdit} />
        <Accio label="AFEGIR OPORTUNITAT" onClick={() => setPanel('oportunitat')} disabled={!canEdit} />
        <Link className="boto" href={`/clients/${clientId}?tab=contactes`}>
          EDITAR CONTACTE
        </Link>
        {mapHref ? (
          <a className="boto" href={mapHref} target="_blank" rel="noreferrer">
            OBRIR MAPA
          </a>
        ) : (
          <span className="boto opacity-50" aria-disabled="true" title="Sense adreça ni coordenades">
            OBRIR MAPA
          </span>
        )}
      </div>

      {panel === 'visita' && (
        <Panell title="REGISTRAR VISITA" subtitle={clientName} onClose={close}>
          <p className="text-[12px] text-[var(--color-ink-faint)] m-0">
            La visita i la seva tasca es creen alhora, en una sola operació.
          </p>
          <AccioForm
            action={createVisit}
            onDone={close}
            onCancel={close}
            submitLabel="CREAR VISITA"
            hidden={{ clientId }}
          >
            <Camp label="DATA I HORA">
              <input className="camp" type="datetime-local" name="startsAt" required />
            </Camp>
            <Camp label="DURADA (MINUTS)">
              <input className="camp" type="number" name="minutes" min={5} max={1440} defaultValue={60} />
            </Camp>
            <Camp label="UBICACIÓ">
              <select className="camp" name="locationId" defaultValue="">
                <option value="">Sense ubicació concreta</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </select>
            </Camp>
            <Camp label="TÍTOL">
              <input className="camp" name="title" placeholder={`VISITA · ${clientName}`} />
            </Camp>
            <Camp label="OBJECTIU">
              <textarea className="camp" name="objective" rows={3} />
            </Camp>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" name="syncToGoogle" defaultChecked />
              SINCRONITZAR AMB GOOGLE CALENDAR
            </label>
          </AccioForm>
        </Panell>
      )}

      {(panel === 'tasca' || panel === 'recordatori' || panel === 'mostres' || panel === 'oferta') && (
        <Panell
          title={
            panel === 'tasca'
              ? 'CREAR TASCA'
              : panel === 'recordatori'
                ? 'CREAR RECORDATORI'
                : panel === 'mostres'
                  ? 'AFEGIR MOSTRES'
                  : 'AFEGIR OFERTA'
          }
          subtitle={clientName}
          onClose={close}
        >
          <AccioForm
            action={createTask}
            onDone={close}
            onCancel={close}
            submitLabel="CREAR"
            hidden={{
              clientId,
              kind: panel === 'recordatori' ? 'RECORDATORI' : 'TASCA',
            }}
          >
            {panel === 'mostres' || panel === 'oferta' ? (
              <input type="hidden" name="action" value={panel === 'mostres' ? 'MOSTRES' : 'ENVIAR OFERTA'} />
            ) : (
              <Camp label="ACCIÓ">
                <select className="camp" name="action" defaultValue="TRUCAR">
                  <option value="TRUCAR">TRUCAR</option>
                  <option value="VISITA">VISITA</option>
                  <option value="MOSTRES">MOSTRES</option>
                  <option value="ENVIAR CORREU">ENVIAR CORREU</option>
                  <option value="ENVIAR PREUS">ENVIAR PREUS</option>
                  <option value="ENVIAR OFERTA">ENVIAR OFERTA</option>
                  <option value="VERIFICAR EMPRESA">VERIFICAR EMPRESA</option>
                  <option value="ALTRES">ALTRES</option>
                </select>
              </Camp>
            )}
            {panel === 'mostres' && (
              <Camp label="TIPUS DE MOSTRA">
                <select className="camp" name="sampleSubtype" defaultValue="PENDENT DE CONCRETAR">
                  {SAMPLE_SUBTYPES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </Camp>
            )}
            <Camp label="TÍTOL">
              <input className="camp" name="title" />
            </Camp>
            <Camp
              label="DATA I HORA"
              hint="Sense data queda com a propera acció: no venç ni ocupa el dia."
            >
              <input className="camp" type="datetime-local" name="due" />
            </Camp>
            <Camp label="IMPORTÀNCIA">
              <select className="camp" name="priority" defaultValue="MITJANA">
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </Camp>
            <Camp label="EXPLICACIÓ SI L'ACCIÓ ÉS ALTRES">
              <input className="camp" name="otherAction" />
            </Camp>
            <Camp label="OBSERVACIONS">
              <textarea className="camp" name="notes" rows={3} />
            </Camp>
          </AccioForm>
        </Panell>
      )}

      {panel === 'oportunitat' && (
        <Panell title="AFEGIR OPORTUNITAT" subtitle={clientName} onClose={close}>
          <FormulariOportunitat
            clientId={clientId}
            products={products}
            campaigns={campaigns}
            defaultCampaignId={defaultCampaignId}
            onDone={close}
            onCancel={close}
          />
        </Panell>
      )}
    </>
  );
}

function Accio({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      className="boto"
      onClick={onClick}
      disabled={disabled}
      title={disabled ? 'No tens permisos per editar aquesta empresa.' : undefined}
    >
      {label}
    </button>
  );
}

/** Shared by the quick action and by the VINS I OPORTUNITATS tab. */
export function FormulariOportunitat({
  clientId,
  products,
  campaigns,
  defaultCampaignId,
  onDone,
  onCancel,
  initial,
  action,
}: {
  clientId: string;
  products: { id: string; name: string; category: string }[];
  campaigns: Referencia[];
  defaultCampaignId: string | null;
  onDone: () => void;
  onCancel?: () => void;
  initial?: {
    id: string;
    productId: string;
    campaignId: string;
    dataType: string;
    volume: string;
    forecastNext: string;
    status: string;
    notes: string;
  };
  action?: (formData: FormData) => Promise<{ ok: boolean; error?: string }>;
}): React.ReactElement {
  const grouped = new Map<string, { id: string; name: string }[]>();
  for (const product of products) {
    const list = grouped.get(product.category) ?? [];
    list.push({ id: product.id, name: product.name });
    grouped.set(product.category, list);
  }

  return (
    <AccioForm
      action={action ?? createOpportunity}
      onDone={onDone}
      onCancel={onCancel}
      submitLabel={initial ? 'DESAR' : 'AFEGIR'}
      hidden={initial ? { clientId, opportunityId: initial.id } : { clientId }}
    >
      <Camp label="PRODUCTE">
        <select className="camp" name="productId" defaultValue={initial?.productId ?? ''} required>
          <option value="">Tria un producte…</option>
          {[...grouped.entries()].map(([category, list]) => (
            <optgroup key={category} label={category}>
              {list.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </Camp>
      <Camp label="CAMPANYA">
        <select
          className="camp"
          name="campaignId"
          defaultValue={initial?.campaignId ?? defaultCampaignId ?? ''}
          required
        >
          <option value="">Tria una campanya…</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </Camp>
      <Camp label="TIPUS DE DADA">
        <select className="camp" name="dataType" defaultValue={initial?.dataType ?? 'POSSIBLE COMPRA'}>
          {DATA_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </Camp>
      <Camp label="LITRES" hint="Positiu o buit. Mai zero ni negatiu.">
        <input
          className="camp"
          type="number"
          name="volume"
          min={1}
          step="1"
          defaultValue={initial?.volume ?? ''}
        />
      </Camp>
      <Camp label="PREVISIÓ PROPERA CAMPANYA">
        <select className="camp" name="forecastNext" defaultValue={initial?.forecastNext ?? ''}>
          <option value="">Sense previsió</option>
          {FORECASTS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </Camp>
      {initial && (
        <Camp label="ESTAT">
          <select className="camp" name="status" defaultValue={initial.status}>
            {['OBERTA', 'GUANYADA', 'PERDUDA', 'TANCADA'].map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </Camp>
      )}
      <Camp label="OBSERVACIONS" hint="Obligatòries si la previsió és ALTRES.">
        <textarea className="camp" name="notes" rows={3} defaultValue={initial?.notes ?? ''} />
      </Camp>
    </AccioForm>
  );
}
