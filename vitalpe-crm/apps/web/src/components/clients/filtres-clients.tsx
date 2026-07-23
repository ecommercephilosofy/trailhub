'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';

export interface FilterOptions {
  municipis: string[];
  comarques: string[];
  provincies: string[];
  tipus: { code: string; label: string }[];
  comercials: { id: string; name: string }[];
  origens: string[];
}

export interface FilterValues {
  q: string;
  municipi: string;
  comarca: string;
  provincia: string;
  tipus: string;
  do: string;
  confirmada: string;
  proposada: string;
  verificacio: string;
  comercial: string;
  tasques: boolean;
  sensecontacte: string;
  pendentverificar: boolean;
  propervisita: boolean;
  geo: boolean;
  conflicte: boolean;
  origen: string;
  vista: string;
  ordre: string;
  dir: string;
}

const CLASSIFICATIONS = [
  'ACTIU SEGUR',
  'POTENCIAL INTERESSAT',
  'POTENCIAL AMB UN ALTRE PROVEIDOR',
  'NO POTENCIAL',
];
const VERIFICATIONS = ['ACTIVA', 'INACTIVA', 'PENDENT DE VERIFICAR', 'DUBTOSA'];

/**
 * Filters live in the URL, never in component state: the resulting link is the
 * saved search. Submitting rebuilds the query string from the form and drops
 * every empty value, so a shared URL carries only what is actually filtering.
 */
export function FiltresClients({
  values,
  options,
  actius,
}: {
  values: FilterValues;
  options: FilterOptions;
  actius: number;
}): React.ReactElement {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [open, setOpen] = useState(actius > 0);

  function submit(form: HTMLFormElement): void {
    const data = new FormData(form);
    const params = new URLSearchParams();
    for (const [key, raw] of data.entries()) {
      const value = String(raw).trim();
      if (value && value !== 'off') params.set(key, value);
    }
    // A new filter always returns to page 1.
    params.delete('pagina');
    const qs = params.toString();
    startTransition(() => router.push(qs ? `/clients?${qs}` : '/clients'));
  }

  return (
    <form
      className="targeta p-3 grid gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        submit(event.currentTarget);
      }}
      aria-label="Filtres del llistat d'empreses"
    >
      {values.vista && <input type="hidden" name="vista" value={values.vista} />}
      {values.ordre !== 'empresa' && <input type="hidden" name="ordre" value={values.ordre} />}
      {values.dir !== 'asc' && <input type="hidden" name="dir" value={values.dir} />}

      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1 flex-1 min-w-[220px]">
          <span className="etiqueta">CERCA</span>
          <input
            className="camp"
            type="search"
            name="q"
            defaultValue={values.q}
            placeholder="Nom, àlies, contacte o municipi…"
          />
        </label>
        <label className="grid gap-1 min-w-[160px]">
          <span className="etiqueta">MUNICIPI</span>
          <select className="camp" name="municipi" defaultValue={values.municipi}>
            <option value="">Tots</option>
            {options.municipis.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1 min-w-[150px]">
          <span className="etiqueta">CLASSIFICACIÓ CONFIRMADA</span>
          <select className="camp" name="confirmada" defaultValue={values.confirmada}>
            <option value="">Totes</option>
            <option value="SENSE">SENSE CONFIRMAR</option>
            {CLASSIFICATIONS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </label>
        <button className="boto boto-principal" type="submit" disabled={pending}>
          {pending ? 'FILTRANT…' : 'FILTRAR'}
        </button>
        <button
          type="button"
          className="boto"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? 'MENYS FILTRES' : 'MÉS FILTRES'}
          {actius > 0 && <span className="estat estat-marca">{actius}</span>}
        </button>
        <button
          type="button"
          className="boto"
          disabled={actius === 0 && !values.q}
          onClick={() =>
            startTransition(() =>
              router.push(values.vista ? `/clients?vista=${values.vista}` : '/clients'),
            )
          }
        >
          NETEJAR FILTRES
        </button>
      </div>

      {open && (
        <div className="grid gap-3 border-t border-[var(--color-line)] pt-3">
          <div className="grid gap-2 [grid-template-columns:repeat(auto-fill,minmax(190px,1fr))]">
            <label className="grid gap-1">
              <span className="etiqueta">COMARCA</span>
              <select className="camp" name="comarca" defaultValue={values.comarca}>
                <option value="">Totes</option>
                {options.comarques.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="etiqueta">PROVÍNCIA</span>
              <select className="camp" name="provincia" defaultValue={values.provincia}>
                <option value="">Totes</option>
                {options.provincies.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="etiqueta">TIPUS D&apos;EMPRESA</span>
              <select className="camp" name="tipus" defaultValue={values.tipus}>
                <option value="">Tots</option>
                <option value="SENSE">SENSE TIPUS</option>
                {options.tipus.map((t) => (
                  <option key={t.code} value={t.code}>
                    {t.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="etiqueta">DO</span>
              <select className="camp" name="do" defaultValue={values.do}>
                <option value="">Totes</option>
                <option value="CAVA">DO CAVA</option>
                <option value="PENEDES">DO PENEDÈS</option>
                <option value="CATALUNYA">DO CATALUNYA</option>
                <option value="ALTRES">ALTRES DO</option>
                <option value="CAP">SENSE DO</option>
              </select>
            </label>
            <label className="grid gap-1">
              <span className="etiqueta">CLASSIFICACIÓ PROPOSADA</span>
              <select className="camp" name="proposada" defaultValue={values.proposada}>
                <option value="">Totes</option>
                <option value="SENSE">SENSE PROPOSTA</option>
                {CLASSIFICATIONS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="etiqueta">VERIFICACIÓ</span>
              <select className="camp" name="verificacio" defaultValue={values.verificacio}>
                <option value="">Totes</option>
                {VERIFICATIONS.map((v) => (
                  <option key={v} value={v}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="etiqueta">COMERCIAL</span>
              <select className="camp" name="comercial" defaultValue={values.comercial}>
                <option value="">Tots</option>
                <option value="SENSE">SENSE ASSIGNAR</option>
                {options.comercials.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="grid gap-1">
              <span className="etiqueta">SENSE CONTACTE DES DE (DIES)</span>
              <input
                className="camp"
                type="number"
                name="sensecontacte"
                min={1}
                max={3650}
                defaultValue={values.sensecontacte}
                placeholder="p. ex. 90"
              />
            </label>
            <label className="grid gap-1">
              <span className="etiqueta">ORIGEN (IMPORTACIÓ)</span>
              <select className="camp" name="origen" defaultValue={values.origen}>
                <option value="">Tots</option>
                {options.origens.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <fieldset className="border border-[var(--color-line)] rounded-[var(--radius-sm)] p-2 m-0">
            <legend className="etiqueta px-1">MARQUES</legend>
            <div className="flex flex-wrap gap-x-5 gap-y-2">
              <Casella name="tasques" label="AMB TASQUES PENDENTS" checked={values.tasques} />
              <Casella
                name="pendentverificar"
                label="PENDENT DE VERIFICAR"
                checked={values.pendentverificar}
              />
              <Casella name="propervisita" label="AMB VISITA PROPERA" checked={values.propervisita} />
              <Casella name="geo" label="PENDENT DE GEOLOCALITZAR" checked={values.geo} />
              <Casella name="conflicte" label="AMB CONFLICTE DE DADES" checked={values.conflicte} />
            </div>
          </fieldset>
        </div>
      )}
    </form>
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
    <label className="flex items-center gap-2 text-[12px] font-semibold tracking-wide">
      <input type="checkbox" name={name} value="1" defaultChecked={checked} />
      {label}
    </label>
  );
}
