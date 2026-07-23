'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Hit {
  kind: 'EMPRESA' | 'CONTACTE' | 'PRODUCTE' | 'ACCIO';
  id: string;
  title: string;
  subtitle: string;
  href: string;
}

const RECENTS_KEY = 'vitalpe.cerques';

/**
 * Global search and command palette.
 * ⌘K / Ctrl+K anywhere, ↑↓ to move, Enter to open, Esc to close.
 * Recent searches are kept in this browser only.
 */
export function CercaGlobal() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<Hit[]>([]);
  const [cursor, setCursor] = useState(0);
  const [loading, setLoading] = useState(false);
  const [recents, setRecents] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
      try {
        setRecents(JSON.parse(localStorage.getItem(RECENTS_KEY) ?? '[]') as string[]);
      } catch {
        setRecents([]);
      }
    }
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const q = term.trim();
    if (q.length < 2) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      setLoading(true);
      try {
        const res = await fetch(`/api/cerca?q=${encodeURIComponent(q)}`, { signal: controller.signal });
        if (res.ok) {
          const data = (await res.json()) as { hits: Hit[] };
          setHits(data.hits);
          setCursor(0);
        }
      } catch {
        /* aborted */
      } finally {
        setLoading(false);
      }
    }, 180);
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [term, open]);

  function go(hit: Hit) {
    const next = [term.trim(), ...recents.filter((r) => r !== term.trim())].filter(Boolean).slice(0, 6);
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
    setOpen(false);
    setTerm('');
    router.push(hit.href);
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="camp flex items-center justify-between gap-2 text-left text-[var(--color-ink-faint)] max-w-md cursor-pointer"
        aria-label="Cerca global"
      >
        <span>Cerca empresa, contacte, telèfon…</span>
        <kbd className="hidden md:inline text-[10px] border border-[var(--color-line-strong)] rounded px-1 py-[1px] font-mono">
          ⌘K
        </kbd>
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-black/25 flex items-start justify-center p-4 pt-[10vh]"
          onClick={() => setOpen(false)}
          role="presentation"
        >
          <div
            className="targeta w-full max-w-xl overflow-hidden shadow-lg"
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Cerca global"
          >
            <input
              ref={inputRef}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setCursor((c) => Math.min(c + 1, hits.length - 1));
                }
                if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setCursor((c) => Math.max(c - 1, 0));
                }
                if (e.key === 'Enter' && hits[cursor]) go(hits[cursor]);
              }}
              className="w-full border-0 border-b border-[var(--color-line)] px-4 py-3 text-[15px] outline-none bg-[var(--color-paper-raised)]"
              placeholder="Empresa, àlies, persona, correu, telèfon, municipi, producte…"
              aria-label="Terme de cerca"
            />

            <div className="max-h-[55vh] overflow-y-auto">
              {loading && <p className="px-4 py-3 text-[13px] text-[var(--color-ink-faint)] m-0">Cercant…</p>}

              {!loading && term.trim().length >= 2 && hits.length === 0 && (
                <p className="px-4 py-3 text-[13px] text-[var(--color-ink-faint)] m-0">
                  Cap resultat per «{term.trim()}».
                </p>
              )}

              {!loading && term.trim().length < 2 && recents.length > 0 && (
                <>
                  <p className="etiqueta px-4 pt-3 pb-1 m-0">CERQUES RECENTS</p>
                  <ul className="list-none p-0 m-0">
                    {recents.map((r) => (
                      <li key={r}>
                        <button
                          type="button"
                          className="w-full text-left px-4 py-2 text-[13px] bg-transparent border-0 cursor-pointer hover:bg-[var(--color-paper-sunken)]"
                          onClick={() => setTerm(r)}
                        >
                          {r}
                        </button>
                      </li>
                    ))}
                  </ul>
                </>
              )}

              <ul className="list-none p-0 m-0">
                {hits.map((hit, i) => (
                  <li key={`${hit.kind}-${hit.id}`}>
                    <button
                      type="button"
                      onMouseEnter={() => setCursor(i)}
                      onClick={() => go(hit)}
                      className={`w-full text-left px-4 py-2 border-0 cursor-pointer flex items-center justify-between gap-3 ${
                        i === cursor ? 'bg-[var(--color-burgundy-wash)]' : 'bg-transparent'
                      }`}
                    >
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold truncate">{hit.title}</span>
                        <span className="block text-[11px] text-[var(--color-ink-faint)] truncate">
                          {hit.subtitle}
                        </span>
                      </span>
                      <span className="estat estat-neutre">{hit.kind}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
