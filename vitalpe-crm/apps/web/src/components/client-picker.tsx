'use client';

import { useEffect, useRef, useState } from 'react';

interface Hit {
  kind: string;
  id: string;
  title: string;
  subtitle: string;
}

/**
 * Company picker.
 *
 * A native <select> over the whole portfolio would ship ~800 options into the
 * DOM on every render of every page that needs one. This queries the same
 * RLS-scoped search endpoint as the command palette and only ever holds the
 * handful of matches on screen.
 */
export function ClientPicker({
  name,
  value,
  label,
  initialLabel,
  onChange,
  allowEmpty = true,
  emptyLabel = 'Sense empresa',
}: {
  name: string;
  value: string;
  label: string;
  initialLabel?: string | null;
  onChange: (id: string, label: string) => void;
  allowEmpty?: boolean;
  emptyLabel?: string;
}) {
  const [term, setTerm] = useState('');
  const [open, setOpen] = useState(false);
  const [hits, setHits] = useState<Hit[]>([]);
  const [cursor, setCursor] = useState(0);
  const [chosen, setChosen] = useState<string | null>(initialLabel ?? null);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onClickOutside = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClickOutside);
    return () => document.removeEventListener('mousedown', onClickOutside);
  }, []);

  useEffect(() => {
    const q = term.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(`/api/cerca?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (!res.ok) return;
        const data = (await res.json()) as { hits: Hit[] };
        setHits(data.hits.filter((h) => h.kind === 'EMPRESA').slice(0, 8));
        setCursor(0);
      } catch {
        /* aborted */
      }
    }, 170);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [term]);

  function choose(hit: Hit | null) {
    if (hit) {
      setChosen(hit.title);
      onChange(hit.id, hit.title);
    } else {
      setChosen(null);
      onChange('', '');
    }
    setTerm('');
    setOpen(false);
  }

  return (
    <div className="grid gap-1 relative" ref={boxRef}>
      <span className="etiqueta" id={`${name}-label`}>
        {label}
      </span>
      <input type="hidden" name={name} value={value} />

      {chosen && value ? (
        <div className="flex items-center gap-2">
          <span className="camp flex-1 flex items-center">{chosen}</span>
          {allowEmpty && (
            <button type="button" className="boto" onClick={() => choose(null)}>
              CANVIAR
            </button>
          )}
        </div>
      ) : (
        <>
          <input
            className="camp"
            value={term}
            onChange={(e) => {
              setTerm(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                setCursor((c) => Math.min(c + 1, hits.length - 1));
              }
              if (e.key === 'ArrowUp') {
                e.preventDefault();
                setCursor((c) => Math.max(c - 1, 0));
              }
              if (e.key === 'Enter') {
                e.preventDefault();
                if (hits[cursor]) choose(hits[cursor]);
              }
              if (e.key === 'Escape') setOpen(false);
            }}
            placeholder={allowEmpty ? `${emptyLabel} — escriu per cercar…` : 'Escriu per cercar…'}
            aria-labelledby={`${name}-label`}
            aria-autocomplete="list"
            aria-expanded={open}
            role="combobox"
            aria-controls={`${name}-list`}
          />
          {open && term.trim().length >= 2 && (
            <ul
              id={`${name}-list`}
              role="listbox"
              className="absolute top-full left-0 right-0 z-30 targeta list-none p-0 m-0 mt-1 max-h-[240px] overflow-y-auto shadow-md"
            >
              {hits.length === 0 ? (
                <li className="px-3 py-2 text-[13px] text-[var(--color-ink-faint)]">
                  Cap empresa per «{term.trim()}».
                </li>
              ) : (
                hits.map((hit, i) => (
                  <li key={hit.id} role="option" aria-selected={i === cursor}>
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => choose(hit)}
                      className={`w-full text-left px-3 py-2 border-0 cursor-pointer ${
                        i === cursor ? 'bg-[var(--color-burgundy-wash)]' : 'bg-transparent'
                      }`}
                    >
                      <span className="block text-[13px] font-semibold">{hit.title}</span>
                      {hit.subtitle && (
                        <span className="block text-[11px] text-[var(--color-ink-faint)]">
                          {hit.subtitle}
                        </span>
                      )}
                    </button>
                  </li>
                ))
              )}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
