'use client';

import { useState } from 'react';
import {
  createContact,
  deactivateContact,
  setPrimaryContact,
  updateContact,
} from '@/lib/actions/contacts';
import { AccioForm, Camp, Panell } from './accio-form';

export interface ContacteRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  role_title: string | null;
  phone_original: string | null;
  phone: string | null;
  email_original: string | null;
  email: string | null;
  contact_type: string;
  is_primary: boolean;
  is_active: boolean;
  notes: string | null;
  source: string | null;
}

/**
 * CONTACTES — everyone ever recorded, including the people who no longer work
 * there. Deactivating keeps the history that points at them readable; only one
 * active contact can be primary and the unique index says so.
 */
export function EditorContactes({
  clientId,
  contacts,
  canEdit,
}: {
  clientId: string;
  contacts: ContacteRow[];
  canEdit: boolean;
}): React.ReactElement {
  const [editing, setEditing] = useState<ContacteRow | 'nou' | null>(null);
  const actius = contacts.filter((c) => c.is_active);
  const inactius = contacts.filter((c) => !c.is_active);

  return (
    <section className="grid gap-3">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="etiqueta m-0">CONTACTES ({contacts.length})</h2>
        {canEdit && (
          <button type="button" className="boto boto-principal" onClick={() => setEditing('nou')}>
            AFEGIR CONTACTE
          </button>
        )}
      </header>

      {contacts.length === 0 ? (
        <p className="targeta p-4 m-0 text-[13px] text-[var(--color-ink-faint)]">
          Cap contacte registrat.
        </p>
      ) : (
        <Taula
          rows={actius}
          clientId={clientId}
          canEdit={canEdit}
          onEdit={setEditing}
          title="ACTIUS"
        />
      )}
      {inactius.length > 0 && (
        <Taula
          rows={inactius}
          clientId={clientId}
          canEdit={canEdit}
          onEdit={setEditing}
          title="INACTIUS"
        />
      )}

      {editing && (
        <Panell
          title={editing === 'nou' ? 'AFEGIR CONTACTE' : 'EDITAR CONTACTE'}
          onClose={() => setEditing(null)}
        >
          <AccioForm
            action={editing === 'nou' ? createContact : updateContact}
            onDone={() => setEditing(null)}
            onCancel={() => setEditing(null)}
            hidden={
              editing === 'nou'
                ? { clientId }
                : { clientId, contactId: editing.id }
            }
          >
            <Camp label="NOM">
              <input
                className="camp"
                name="firstName"
                defaultValue={editing === 'nou' ? '' : (editing.first_name ?? '')}
              />
            </Camp>
            <Camp label="COGNOMS">
              <input
                className="camp"
                name="lastName"
                defaultValue={editing === 'nou' ? '' : (editing.last_name ?? '')}
              />
            </Camp>
            <Camp label="CÀRREC">
              <input
                className="camp"
                name="roleTitle"
                defaultValue={editing === 'nou' ? '' : (editing.role_title ?? '')}
              />
            </Camp>
            <Camp label="TELÈFON">
              <input
                className="camp"
                name="phone"
                inputMode="tel"
                defaultValue={editing === 'nou' ? '' : (editing.phone_original ?? '')}
              />
            </Camp>
            <Camp label="CORREU">
              <input
                className="camp"
                name="email"
                type="email"
                defaultValue={editing === 'nou' ? '' : (editing.email_original ?? '')}
              />
            </Camp>
            <Camp label="TIPUS">
              <select
                className="camp"
                name="contactType"
                defaultValue={editing === 'nou' ? 'GENERAL' : editing.contact_type}
              >
                <option value="GENERAL">GENERAL</option>
                <option value="DIRECTE">DIRECTE</option>
              </select>
            </Camp>
            <Camp label="OBSERVACIONS">
              <textarea
                className="camp"
                name="notes"
                rows={3}
                defaultValue={editing === 'nou' ? '' : (editing.notes ?? '')}
              />
            </Camp>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                name="isPrimary"
                defaultChecked={editing !== 'nou' && editing.is_primary}
              />
              CONTACTE PRINCIPAL
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                name="isActive"
                defaultChecked={editing === 'nou' ? true : editing.is_active}
              />
              ACTIU
            </label>
            <p className="text-[11px] text-[var(--color-ink-faint)] m-0">
              Un contacte necessita com a mínim un nom, un telèfon o un correu.
            </p>
          </AccioForm>
        </Panell>
      )}
    </section>
  );
}

function Taula({
  rows,
  clientId,
  canEdit,
  onEdit,
  title,
}: {
  rows: ContacteRow[];
  clientId: string;
  canEdit: boolean;
  onEdit: (row: ContacteRow) => void;
  title: string;
}): React.ReactElement | null {
  if (rows.length === 0) return null;
  return (
    <div className="grid gap-1">
      <p className="etiqueta m-0">{title}</p>
      <div className="taula-ampla targeta">
        <table className="taula">
          <thead>
            <tr>
              <th scope="col">NOM</th>
              <th scope="col">CÀRREC</th>
              <th scope="col">TELÈFON</th>
              <th scope="col">CORREU</th>
              <th scope="col">TIPUS</th>
              <th scope="col">ESTAT</th>
              <th scope="col" className="text-right">
                ACCIONS
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const name =
                [row.first_name, row.last_name].filter(Boolean).join(' ') || 'SENSE NOM';
              return (
                <tr key={row.id}>
                  <td className="font-semibold">{name}</td>
                  <td>{row.role_title ?? '—'}</td>
                  <td>
                    {row.phone ? <a href={`tel:${row.phone}`}>{row.phone_original ?? row.phone}</a> : '—'}
                  </td>
                  <td>
                    {row.email ? <a href={`mailto:${row.email}`}>{row.email}</a> : '—'}
                  </td>
                  <td>{row.contact_type}</td>
                  <td>
                    <span className="flex flex-wrap gap-1">
                      {row.is_primary && <span className="estat estat-marca">PRINCIPAL</span>}
                      <span className={row.is_active ? 'estat estat-ok' : 'estat estat-neutre'}>
                        {row.is_active ? 'ACTIU' : 'INACTIU'}
                      </span>
                    </span>
                  </td>
                  <td className="text-right">
                    {canEdit && (
                      <span className="inline-flex gap-1 flex-wrap justify-end">
                        <button type="button" className="boto" onClick={() => onEdit(row)}>
                          EDITAR
                        </button>
                        {!row.is_primary && row.is_active && (
                          <AccioForm
                            action={setPrimaryContact}
                            submitLabel="FER PRINCIPAL"
                            pendingLabel="…"
                            className="inline"
                            submitClassName="boto"
                            hidden={{ clientId, contactId: row.id }}
                          />
                        )}
                        <AccioForm
                          action={deactivateContact}
                          submitLabel={row.is_active ? 'DESACTIVAR' : 'REACTIVAR'}
                          pendingLabel="…"
                          className="inline"
                          submitClassName="boto"
                          hidden={{
                            clientId,
                            contactId: row.id,
                            reactivar: row.is_active ? '0' : '1',
                          }}
                        />
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
