'use client';

import { useState, useTransition } from 'react';

/**
 * The two interaction primitives the administration screens need: a button that
 * runs a server action, and the same button with a confirmation panel in front
 * of it. The panel always states what will happen and whether it can be undone,
 * because a destructive action that only says "Are you sure?" tells the user
 * nothing they did not already know.
 */

export interface Resultat {
  ok: boolean;
  error?: string;
}

export type Accio = (formData: FormData) => Promise<Resultat>;

function build(fields: Record<string, string | undefined>): FormData {
  const fd = new FormData();
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) fd.set(key, value);
  }
  return fd;
}

export function AccioBoto({
  accio,
  camps,
  etiqueta,
  variant = 'normal',
  titol,
  deshabilitat,
  onFet,
}: {
  accio: Accio;
  camps: Record<string, string | undefined>;
  etiqueta: string;
  variant?: 'normal' | 'principal' | 'perill';
  titol?: string;
  deshabilitat?: boolean;
  onFet?: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const className = `boto ${variant === 'principal' ? 'boto-principal' : variant === 'perill' ? 'boto-perill' : ''}`;

  return (
    <span className="inline-flex flex-col items-start gap-1">
      <button
        type="button"
        className={className}
        title={titol}
        disabled={pending || deshabilitat}
        onClick={() =>
          start(async () => {
            setError(null);
            const res = await accio(build(camps));
            if (!res.ok) setError(res.error ?? 'No s’ha pogut desar.');
            else onFet?.();
          })
        }
      >
        {pending ? 'DESANT…' : etiqueta}
      </button>
      {error && <span className="error-camp">{error}</span>}
    </span>
  );
}

/**
 * Destructive or irreversible action. The user must read what happens and type
 * the confirmation word; nothing is submitted until they do.
 */
export function AccioConfirmada({
  accio,
  camps,
  etiqueta,
  titolPanell,
  explicacio,
  reversible,
  paraula = 'CONFIRMO',
  campConfirmacio = 'confirmation',
  variant = 'perill',
  extra,
}: {
  accio: Accio;
  camps: Record<string, string | undefined>;
  etiqueta: string;
  titolPanell: string;
  explicacio: React.ReactNode;
  reversible: string;
  paraula?: string;
  campConfirmacio?: string;
  variant?: 'normal' | 'principal' | 'perill';
  extra?: React.ReactNode;
}) {
  const [obert, setObert] = useState(false);
  const [text, setText] = useState('');
  const [nota, setNota] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  if (!obert) {
    return (
      <span className="inline-flex flex-col items-start gap-1">
        <button
          type="button"
          className={`boto ${variant === 'principal' ? 'boto-principal' : variant === 'perill' ? 'boto-perill' : ''}`}
          onClick={() => setObert(true)}
        >
          {etiqueta}
        </button>
        {error && <span className="error-camp">{error}</span>}
      </span>
    );
  }

  return (
    <div className="targeta p-3 grid gap-2 max-w-[520px] border-l-[3px] border-l-[var(--color-danger)]">
      <p className="etiqueta m-0">{titolPanell}</p>
      <div className="text-[13px] text-[var(--color-ink-soft)]">{explicacio}</div>
      <p className="text-[12px] m-0">
        <span className="etiqueta">REVERSIBLE</span> {reversible}
      </p>
      {extra}
      <label className="grid gap-1">
        <span className="etiqueta">ESCRIU «{paraula}» PER CONFIRMAR</span>
        <input
          className="camp"
          value={text}
          onChange={(e) => setText(e.target.value)}
          autoComplete="off"
        />
      </label>
      <label className="grid gap-1">
        <span className="etiqueta">NOTA (opcional)</span>
        <input className="camp" value={nota} onChange={(e) => setNota(e.target.value)} />
      </label>
      {error && <p className="error-camp m-0">{error}</p>}
      <div className="flex gap-2">
        <button
          type="button"
          className="boto boto-principal"
          disabled={pending || text.trim().toUpperCase() !== paraula}
          onClick={() =>
            start(async () => {
              setError(null);
              const fd = build({ ...camps, [campConfirmacio]: paraula, note: nota || undefined });
              const res = await accio(fd);
              if (res.ok) {
                setObert(false);
                setText('');
                setNota('');
              } else {
                setError(res.error ?? 'No s’ha pogut fer.');
              }
            })
          }
        >
          {pending ? 'FENT…' : etiqueta}
        </button>
        <button type="button" className="boto" disabled={pending} onClick={() => setObert(false)}>
          CANCEL·LAR
        </button>
      </div>
    </div>
  );
}

/** A small form whose submit runs a server action and reports the error inline. */
export function AccioFormulari({
  accio,
  etiqueta,
  children,
  reinicia = true,
}: {
  accio: Accio;
  etiqueta: string;
  children: React.ReactNode;
  reinicia?: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      className="grid gap-2"
      action={(fd) =>
        start(async () => {
          setError(null);
          const res = await accio(fd);
          if (!res.ok) setError(res.error ?? 'No s’ha pogut desar.');
        })
      }
      onSubmit={(e) => {
        if (reinicia) setTimeout(() => (e.target as HTMLFormElement).reset(), 0);
      }}
    >
      {children}
      {error && <p className="error-camp m-0">{error}</p>}
      <div>
        <button className="boto boto-principal" type="submit" disabled={pending}>
          {pending ? 'DESANT…' : etiqueta}
        </button>
      </div>
    </form>
  );
}
