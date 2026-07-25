'use client';

import Link from 'next/link';
import { useState, useTransition } from 'react';
import { convertProspect, discardProspect } from '@/lib/actions/prospects';

/**
 * One prospect, with its origin on show.
 *
 * The source line is not decoration: it is the only thing that separates a
 * lead worth a phone call from a name somebody made up, so it is displayed
 * before the actions rather than hidden behind a tooltip.
 */
export interface ProspectView {
  id: string;
  name: string;
  municipality: string | null;
  province: string | null;
  website: string | null;
  phone: string | null;
  email: string | null;
  source: string;
  sourceUrl: string | null;
  discoveredOn: string;
  suggestedProduct: string | null;
  rationale: string | null;
  status: string;
  reviewNote: string | null;
  reviewedAt: string | null;
  reviewer: string | null;
  clientId: string | null;
}

export function ProspectRow({
  prospect,
  canDecide,
}: {
  prospect: ProspectView;
  canDecide: boolean;
}) {
  const [note, setNote] = useState('');
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function decide(action: 'ALTA' | 'DESCARTAR'): void {
    setError(null);
    const formData = new FormData();
    formData.set('prospectId', prospect.id);
    formData.set('note', note);
    startTransition(async () => {
      const result =
        action === 'ALTA' ? await convertProspect(formData) : await discardProspect(formData);
      if (result.ok) {
        setDone(action === 'ALTA' ? "Donada d'alta com a empresa." : 'Descartada.');
      } else {
        setError(result.error ?? 'No s\'ha pogut desar la decisió.');
      }
    });
  }

  return (
    <article className="targeta p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <p className="m-0 font-semibold text-[15px]">{prospect.name}</p>
          <p className="m-0 text-[12px] text-[var(--color-ink-faint)]">
            {prospect.municipality ?? 'Municipi no publicat a la font'}
            {prospect.province ? ` · ${prospect.province}` : ''}
          </p>
        </div>
        {prospect.status !== 'CANDIDAT' && (
          <span className={`estat ${prospect.status === 'CONVERTIT' ? 'estat-ok' : 'estat-neutre'}`}>
            {prospect.status}
          </span>
        )}
      </div>

      <p className="m-0 mt-2 text-[12px] text-[var(--color-ink-soft)]">
        <span className="etiqueta">FONT</span>{' '}
        {prospect.sourceUrl ? (
          <a href={prospect.sourceUrl} target="_blank" rel="noreferrer">
            {prospect.source}
          </a>
        ) : (
          prospect.source
        )}{' '}
        · consultada el {prospect.discoveredOn}
      </p>

      {prospect.rationale && (
        <p className="m-0 mt-1 text-[12px] text-[var(--color-ink-soft)]">{prospect.rationale}</p>
      )}
      {prospect.suggestedProduct && (
        <p className="m-0 mt-1 text-[12px]">
          <span className="etiqueta">PRODUCTE SUGGERIT</span> {prospect.suggestedProduct}
        </p>
      )}

      {(prospect.phone || prospect.email || prospect.website) && (
        <p className="m-0 mt-1 text-[12px] flex flex-wrap gap-3">
          {prospect.phone && <a href={`tel:${prospect.phone}`}>{prospect.phone}</a>}
          {prospect.email && <a href={`mailto:${prospect.email}`}>{prospect.email}</a>}
          {prospect.website && (
            <a href={prospect.website} target="_blank" rel="noreferrer">
              web
            </a>
          )}
        </p>
      )}

      {prospect.clientId && (
        <p className="m-0 mt-2 text-[12px]">
          <Link href={`/clients/${prospect.clientId}`}>Obrir la fitxa creada</Link>
        </p>
      )}
      {prospect.reviewedAt && (
        <p className="m-0 mt-1 text-[11px] text-[var(--color-ink-faint)]">
          Decidit el {prospect.reviewedAt}
          {prospect.reviewer ? ` per ${prospect.reviewer}` : ''}
          {prospect.reviewNote ? ` — ${prospect.reviewNote}` : ''}
        </p>
      )}

      {done !== null && <p className="m-0 mt-2 text-[12px] text-[var(--color-ok,#2f6b43)]">{done}</p>}
      {error !== null && <p className="error-camp m-0 mt-2">{error}</p>}

      {canDecide && done === null && (
        <div className="mt-3 grid gap-2">
          {open && (
            <label className="grid gap-1">
              <span className="etiqueta">NOTA DE LA DECISIÓ (opcional)</span>
              <input
                className="camp"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Per què sí, o per què no"
              />
            </label>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              className="boto boto-principal"
              type="button"
              disabled={pending}
              onClick={() => decide('ALTA')}
            >
              {pending ? 'DESANT…' : "DONAR D'ALTA COM A EMPRESA"}
            </button>
            <button className="boto" type="button" disabled={pending} onClick={() => decide('DESCARTAR')}>
              DESCARTAR
            </button>
            {!open && (
              <button className="boto" type="button" onClick={() => setOpen(true)}>
                AFEGIR NOTA
              </button>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
