'use client';

import { useState } from 'react';
import { confirmClassification, recordVerification } from '@/lib/actions/clients';
import { AccioForm, Camp, Panell } from './accio-form';

const CLASSIFICATIONS = [
  'ACTIU SEGUR',
  'POTENCIAL INTERESSAT',
  'POTENCIAL AMB UN ALTRE PROVEIDOR',
  'NO POTENCIAL',
];
const VERIFICATIONS = ['ACTIVA', 'INACTIVA', 'PENDENT DE VERIFICAR', 'DUBTOSA'];

/**
 * CLASSIFICACIÓ — proposal versus confirmation.
 *
 * The engine proposes from facts already recorded; only a person confirms, and
 * NO POTENCIAL cannot be confirmed without a reason. Both rules are enforced by
 * `app.confirm_classification`; the form makes them visible before the refusal.
 */
export function BlocClassificacio({
  clientId,
  proposed,
  confirmed,
  confirmedAt,
  confirmedBy,
  reason,
  canEdit,
}: {
  clientId: string;
  proposed: string | null;
  confirmed: string | null;
  confirmedAt: string | null;
  confirmedBy: string | null;
  reason: string | null;
  canEdit: boolean;
}): React.ReactElement {
  const [choice, setChoice] = useState<string>(confirmed ?? proposed ?? '');
  const [open, setOpen] = useState(false);

  return (
    <section className="targeta p-4 grid gap-3">
      <h2 className="etiqueta m-0">CLASSIFICACIÓ</h2>

      <dl className="grid gap-2 m-0 [grid-template-columns:repeat(auto-fit,minmax(200px,1fr))]">
        <div>
          <dt className="etiqueta">PROPOSTA DEL SISTEMA</dt>
          <dd className="m-0 text-[13px]">
            {proposed ? (
              <span className="estat estat-neutre">{proposed}</span>
            ) : (
              <span className="estat estat-neutre">PENDENT DE REVISAR</span>
            )}
          </dd>
        </div>
        <div>
          <dt className="etiqueta">CONFIRMADA</dt>
          <dd className="m-0 text-[13px]">
            {confirmed ? (
              <>
                <span className="estat estat-ok">{confirmed}</span>
                {confirmedAt && (
                  <span className="block text-[11px] text-[var(--color-ink-faint)] mt-1">
                    {confirmedAt}
                    {confirmedBy ? ` · ${confirmedBy}` : ''}
                  </span>
                )}
              </>
            ) : (
              <span className="estat estat-avis">SENSE CONFIRMAR</span>
            )}
          </dd>
        </div>
      </dl>

      {confirmed && proposed && confirmed !== proposed && (
        <p className="text-[12px] m-0 border-l-[3px] border-l-[var(--color-warn)] pl-2">
          La proposta del sistema ({proposed}) no coincideix amb la classificació confirmada.
          Revisa-ho i torna a confirmar si cal.
        </p>
      )}

      {reason && (
        <p className="text-[12px] text-[var(--color-ink-soft)] m-0">
          <span className="etiqueta">MOTIU NO POTENCIAL</span> {reason}
        </p>
      )}

      <p className="text-[11px] text-[var(--color-ink-faint)] m-0">
        La proposta surt només de fets ja registrats. Confirmar-la és sempre una decisió d&apos;una
        persona.
      </p>

      {canEdit ? (
        <AccioForm
          action={confirmClassification}
          submitLabel={confirmed ? 'TORNAR A CONFIRMAR' : 'CONFIRMAR'}
          hidden={{ clientId }}
          className="grid gap-3 border-t border-[var(--color-line)] pt-3"
        >
          <Camp label="CLASSIFICACIÓ A CONFIRMAR">
            <select
              className="camp"
              name="classification"
              value={choice}
              onChange={(event) => setChoice(event.target.value)}
              required
            >
              <option value="">Tria una classificació…</option>
              {CLASSIFICATIONS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </Camp>
          {choice === 'NO POTENCIAL' && (
            <Camp label="MOTIU (OBLIGATORI)" hint="Sense motiu, NO POTENCIAL no es pot confirmar.">
              <textarea className="camp" name="reason" rows={2} defaultValue={reason ?? ''} required />
            </Camp>
          )}
        </AccioForm>
      ) : (
        <p className="text-[12px] text-[var(--color-ink-faint)] m-0">
          Només qui té assignada aquesta empresa, o gerència, pot confirmar la classificació.
        </p>
      )}

      {canEdit && (
        <>
          <button type="button" className="boto justify-self-start" onClick={() => setOpen(true)}>
            REGISTRAR VERIFICACIÓ
          </button>
          {open && (
            <Panell
              title="REGISTRAR VERIFICACIÓ"
              subtitle="S'afegeix a l'historial de verificacions; no en substitueix cap."
              onClose={() => setOpen(false)}
            >
              <AccioForm
                action={recordVerification}
                onDone={() => setOpen(false)}
                onCancel={() => setOpen(false)}
                submitLabel="REGISTRAR"
                hidden={{ clientId }}
              >
                <Camp label="ESTAT">
                  <select className="camp" name="status" defaultValue="ACTIVA">
                    {VERIFICATIONS.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                  </select>
                </Camp>
                <Camp label="FONT" hint="D'on surt la comprovació: web, telèfon, registre, INCAVI…">
                  <input className="camp" name="source" required />
                </Camp>
                <Camp label="OBSERVACIONS">
                  <textarea className="camp" name="note" rows={3} />
                </Camp>
              </AccioForm>
            </Panell>
          )}
        </>
      )}
    </section>
  );
}
