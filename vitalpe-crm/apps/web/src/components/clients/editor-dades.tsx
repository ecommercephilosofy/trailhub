'use client';

import { useState } from 'react';
import { assignClient, updateClient } from '@/lib/actions/clients';
import { AccioForm, Camp, Panell } from './accio-form';

export interface DadesClient {
  id: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  municipality: string | null;
  comarca: string | null;
  province: string | null;
  website: string | null;
  client_type_code: string | null;
  other_client_type: string | null;
  do_cava: boolean;
  do_penedes: boolean;
  do_catalunya: boolean;
  do_altres: boolean;
  general_notes: string | null;
  external_account_code: string | null;
  owner_id: string | null;
}

/**
 * DADES DE L'EMPRESA. Simple fields are edited in place; the whole record is
 * edited in a sectioned side panel. Nothing here re-implements a rule: ALTRES
 * without an explanation is refused by the CHECK constraint and the message
 * comes back through `friendlyError`.
 */
export function EditorDades({
  client,
  canEdit,
  manager,
  types,
  comercials,
}: {
  client: DadesClient;
  canEdit: boolean;
  manager: boolean;
  types: { code: string; label: string }[];
  comercials: { id: string; name: string }[];
}): React.ReactElement {
  const [open, setOpen] = useState(false);
  const [assigning, setAssigning] = useState(false);

  return (
    <section className="targeta p-4 grid gap-3">
      <header className="flex items-center justify-between gap-2 flex-wrap">
        <h2 className="etiqueta m-0">DADES DE L&apos;EMPRESA</h2>
        {canEdit && (
          <span className="flex gap-2">
            <button type="button" className="boto" onClick={() => setOpen(true)}>
              EDITAR DADES
            </button>
            {manager && (
              <button type="button" className="boto" onClick={() => setAssigning(true)}>
                ASSIGNAR COMERCIAL
              </button>
            )}
          </span>
        )}
      </header>

      <dl className="grid gap-x-5 gap-y-3 m-0 [grid-template-columns:repeat(auto-fit,minmax(180px,1fr))]">
        <Dada label="NOM FISCAL" value={client.legal_name} />
        <Dada label="NIF" value={client.tax_id} />
        <InlineText
          clientId={client.id}
          field="municipality"
          label="MUNICIPI"
          value={client.municipality}
          canEdit={canEdit}
        />
        <InlineText
          clientId={client.id}
          field="comarca"
          label="COMARCA"
          value={client.comarca}
          canEdit={canEdit}
        />
        <InlineText
          clientId={client.id}
          field="province"
          label="PROVÍNCIA"
          value={client.province}
          canEdit={canEdit}
        />
        <InlineText
          clientId={client.id}
          field="website"
          label="WEB"
          value={client.website}
          canEdit={canEdit}
        />
        <Dada
          label="TIPUS D'EMPRESA"
          value={
            client.client_type_code === 'ALTRES'
              ? `ALTRES · ${client.other_client_type ?? 'PENDENT DE REVISAR'}`
              : client.client_type_code
          }
        />
        <Dada label="COMPTE COMPTABLE" value={client.external_account_code} />
      </dl>

      {client.general_notes && (
        <div>
          <p className="etiqueta m-0">OBSERVACIONS GENERALS</p>
          <p className="m-0 text-[13px] whitespace-pre-line text-[var(--color-ink-soft)]">
            {client.general_notes}
          </p>
        </div>
      )}

      {open && (
        <Panell title="EDITAR DADES" subtitle={client.name} onClose={() => setOpen(false)}>
          <AccioForm
            action={updateClient}
            onDone={() => setOpen(false)}
            onCancel={() => setOpen(false)}
            hidden={{
              clientId: client.id,
              camps:
                'name,legal_name,tax_id,municipality,comarca,province,website,client_type_code,other_client_type,do_cava,do_penedes,do_catalunya,do_altres,general_notes,external_account_code',
            }}
          >
            <Camp label="NOM">
              <input className="camp" name="name" defaultValue={client.name} required />
            </Camp>
            <Camp label="NOM FISCAL">
              <input className="camp" name="legal_name" defaultValue={client.legal_name ?? ''} />
            </Camp>
            <Camp label="NIF">
              <input className="camp" name="tax_id" defaultValue={client.tax_id ?? ''} />
            </Camp>
            <Camp label="MUNICIPI">
              <input className="camp" name="municipality" defaultValue={client.municipality ?? ''} />
            </Camp>
            <Camp label="COMARCA">
              <input className="camp" name="comarca" defaultValue={client.comarca ?? ''} />
            </Camp>
            <Camp label="PROVÍNCIA">
              <input className="camp" name="province" defaultValue={client.province ?? ''} />
            </Camp>
            <Camp label="WEB">
              <input className="camp" name="website" defaultValue={client.website ?? ''} />
            </Camp>
            <Camp label="TIPUS D'EMPRESA">
              <select
                className="camp"
                name="client_type_code"
                defaultValue={client.client_type_code ?? ''}
              >
                <option value="">NO DETERMINAT</option>
                {types.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </select>
            </Camp>
            <Camp
              label="EXPLICACIÓ SI EL TIPUS ÉS ALTRES"
              hint="ALTRES sense explicació no es pot desar."
            >
              <input
                className="camp"
                name="other_client_type"
                defaultValue={client.other_client_type ?? ''}
              />
            </Camp>
            <fieldset className="border border-[var(--color-line)] rounded-[var(--radius-sm)] p-3 m-0 grid gap-2">
              <legend className="etiqueta px-1">DENOMINACIONS D&apos;ORIGEN</legend>
              <Casella name="do_cava" label="DO CAVA" checked={client.do_cava} />
              <Casella name="do_penedes" label="DO PENEDÈS" checked={client.do_penedes} />
              <Casella name="do_catalunya" label="DO CATALUNYA" checked={client.do_catalunya} />
              <Casella name="do_altres" label="ALTRES DO" checked={client.do_altres} />
            </fieldset>
            <Camp label="COMPTE COMPTABLE">
              <input
                className="camp"
                name="external_account_code"
                defaultValue={client.external_account_code ?? ''}
              />
            </Camp>
            <Camp label="OBSERVACIONS GENERALS">
              <textarea
                className="camp"
                name="general_notes"
                rows={5}
                defaultValue={client.general_notes ?? ''}
              />
            </Camp>
          </AccioForm>
        </Panell>
      )}

      {assigning && (
        <Panell title="ASSIGNAR COMERCIAL" subtitle={client.name} onClose={() => setAssigning(false)}>
          <AccioForm
            action={assignClient}
            onDone={() => setAssigning(false)}
            onCancel={() => setAssigning(false)}
            hidden={{ clientId: client.id }}
          >
            <Camp label="COMERCIAL">
              <select className="camp" name="ownerId" defaultValue={client.owner_id ?? ''}>
                <option value="">SENSE ASSIGNAR</option>
                {comercials.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </Camp>
          </AccioForm>
        </Panell>
      )}
    </section>
  );
}

function Dada({ label, value }: { label: string; value: string | null }): React.ReactElement {
  return (
    <div>
      <dt className="etiqueta">{label}</dt>
      <dd className="m-0 text-[13px]">
        {value ?? <span className="text-[var(--color-ink-faint)]">NO DETERMINAT</span>}
      </dd>
    </div>
  );
}

function Casella({
  name,
  label,
  checked,
}: {
  name: string;
  label: string;
  checked: boolean;
}): React.ReactElement {
  return (
    <label className="flex items-center gap-2 text-[13px]">
      <input type="checkbox" name={name} defaultChecked={checked} />
      {label}
    </label>
  );
}

/** Click-to-edit for a single text field. Escape cancels, Enter saves. */
function InlineText({
  clientId,
  field,
  label,
  value,
  canEdit,
}: {
  clientId: string;
  field: string;
  label: string;
  value: string | null;
  canEdit: boolean;
}): React.ReactElement {
  const [editing, setEditing] = useState(false);

  if (!canEdit || !editing) {
    return (
      <div>
        <dt className="etiqueta">{label}</dt>
        <dd className="m-0 text-[13px] flex items-center gap-2">
          {value ?? <span className="text-[var(--color-ink-faint)]">NO DETERMINAT</span>}
          {canEdit && (
            <button
              type="button"
              className="text-[11px] underline bg-transparent border-0 p-0 cursor-pointer text-[var(--color-burgundy)]"
              onClick={() => setEditing(true)}
            >
              EDITAR<span className="sr-only"> {label}</span>
            </button>
          )}
        </dd>
      </div>
    );
  }

  return (
    <div>
      <dt className="etiqueta">{label}</dt>
      <dd className="m-0">
        <AccioForm
          action={updateClient}
          submitLabel="DESAR"
          pendingLabel="…"
          className="grid gap-1"
          submitClassName="boto"
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
          hidden={{ clientId, camps: field }}
        >
          <input
            className="camp"
            name={field}
            defaultValue={value ?? ''}
            aria-label={label}
            onKeyDown={(event) => {
              if (event.key === 'Escape') setEditing(false);
            }}
          />
        </AccioForm>
      </dd>
    </div>
  );
}
