'use client';

import { useState, useTransition } from 'react';
import {
  addProductAlias,
  createProduct,
  dismissUnmappedValue,
  mapUnmappedProduct,
  removeProductAlias,
} from '@/lib/actions/admin';
import { AccioBoto } from './accions';

export interface OpcioProducte {
  id: string;
  name: string;
  category: string;
}

const CATEGORIES = ['BASE CAVA', 'DO PENEDES', 'DO CATALUNYA', 'ALTRES / SENSE DO'] as const;

export function NouProducte() {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="grid gap-2 md:grid-cols-[1fr_200px_auto_auto] md:items-end"
      action={(fd) =>
        start(async () => {
          setError(null);
          const res = await createProduct(fd);
          if (!res.ok) setError(res.error ?? 'No s’ha pogut crear.');
        })
      }
    >
      <label className="grid gap-1">
        <span className="etiqueta">NOM NORMALITZAT</span>
        <input
          className="camp"
          name="name"
          required
          placeholder="VI BLANC PARELLADA BASE CAVA GUARDA SUPERIOR ECOLÒGIC"
        />
      </label>
      <label className="grid gap-1">
        <span className="etiqueta">CATEGORIA</span>
        <select className="camp" name="category" defaultValue="BASE CAVA">
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </label>
      <label className="flex items-center gap-2 text-[13px] md:pb-2">
        <input type="checkbox" name="organic" />
        <span className="etiqueta">ECOLÒGIC</span>
      </label>
      <button className="boto boto-principal" type="submit" disabled={pending}>
        {pending ? 'CREANT…' : 'AFEGIR AL CATÀLEG'}
      </button>
      {error && <p className="error-camp m-0 md:col-span-4">{error}</p>}
    </form>
  );
}

export function AliesGestor({
  productId,
  alies,
}: {
  productId: string;
  alies: { id: string; alias: string; source: string | null }[];
}) {
  const [obert, setObert] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!obert) {
    return (
      <button type="button" className="boto" onClick={() => setObert(true)}>
        ÀLIES ({alies.length})
      </button>
    );
  }

  return (
    <div className="targeta p-3 grid gap-2 min-w-[320px] max-w-[520px]">
      <p className="etiqueta m-0">ÀLIES D’IMPORTACIÓ</p>
      <p className="text-[12px] text-[var(--color-ink-soft)] m-0">
        Text tal com apareix a l’albarà. L’importador el fa servir abans del reconeixement per
        atributs, i s’aplica a la propera importació.
      </p>
      {alies.length === 0 ? (
        <p className="text-[13px] text-[var(--color-ink-faint)] m-0">Cap àlies.</p>
      ) : (
        <ul className="list-none p-0 m-0 grid gap-1">
          {alies.map((a) => (
            <li key={a.id} className="flex items-center justify-between gap-2 text-[13px]">
              <span>
                {a.alias}
                {a.source && (
                  <span className="text-[11px] text-[var(--color-ink-faint)]"> · {a.source}</span>
                )}
              </span>
              <AccioBoto
                accio={removeProductAlias}
                camps={{ id: a.id }}
                etiqueta="TREURE"
                variant="perill"
              />
            </li>
          ))}
        </ul>
      )}
      <form
        className="flex items-end gap-2"
        action={(fd) =>
          start(async () => {
            setError(null);
            fd.set('productId', productId);
            const res = await addProductAlias(fd);
            if (!res.ok) setError(res.error ?? 'No s’ha pogut afegir.');
          })
        }
      >
        <label className="grid gap-1 flex-1">
          <span className="etiqueta">NOU ÀLIES</span>
          <input className="camp" name="alias" required />
        </label>
        <button className="boto" type="submit" disabled={pending}>
          {pending ? 'AFEGINT…' : 'AFEGIR'}
        </button>
      </form>
      {error && <p className="error-camp m-0">{error}</p>}
      <div>
        <button type="button" className="boto" onClick={() => setObert(false)}>
          TANCAR
        </button>
      </div>
    </div>
  );
}

export function MapejarValor({
  id,
  rawValue,
  productes,
  suggeriment,
}: {
  id: string;
  rawValue: string;
  productes: OpcioProducte[];
  suggeriment: string | null;
}) {
  const [productId, setProductId] = useState(suggeriment ?? '');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <div className="grid gap-1">
      <div className="flex flex-wrap items-end gap-2">
        <label className="grid gap-1">
          <span className="etiqueta sr-only">PRODUCTE DEL CATÀLEG</span>
          <select
            className="camp min-w-[320px]"
            value={productId}
            onChange={(e) => setProductId(e.target.value)}
            aria-label={`Producte del catàleg per a ${rawValue}`}
          >
            <option value="">Tria un producte del catàleg…</option>
            {productes.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="boto boto-principal"
          disabled={pending || !productId}
          onClick={() =>
            start(async () => {
              setError(null);
              const fd = new FormData();
              fd.set('id', id);
              fd.set('productId', productId);
              const res = await mapUnmappedProduct(fd);
              if (!res.ok) setError(res.error ?? 'No s’ha pogut mapar.');
            })
          }
        >
          {pending ? 'MAPANT…' : 'MAPAR'}
        </button>
        <AccioBoto
          accio={dismissUnmappedValue}
          camps={{ id, note: 'FORA D’ABAST' }}
          etiqueta="FORA D’ABAST"
          titol="Es marca com a resolt sense inventar cap producte."
        />
      </div>
      {error && <p className="error-camp m-0">{error}</p>}
    </div>
  );
}
