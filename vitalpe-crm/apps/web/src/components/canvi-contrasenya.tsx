'use client';

import { useState, useTransition } from 'react';
import { changePassword } from '@/lib/actions/auth';

/**
 * Change-password form. Collapsed until asked for, so the account card is not
 * dominated by a control used once. On success it clears and confirms.
 */
export function CanviContrasenya() {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    setDone(false);
    startTransition(async () => {
      const result = await changePassword(formData);
      if (result.ok) {
        setDone(true);
        setOpen(false);
      } else {
        setError(result.error ?? 'No s\'ha pogut canviar la contrasenya.');
      }
    });
  }

  if (!open) {
    return (
      <div className="mt-3">
        {done && (
          <p className="text-[12px] text-[var(--color-success,#2f7d32)] m-0 mb-2">
            Contrasenya actualitzada.
          </p>
        )}
        <button type="button" className="boto" onClick={() => setOpen(true)}>
          CANVIAR LA CONTRASENYA
        </button>
      </div>
    );
  }

  return (
    <form action={submit} className="grid gap-2 mt-3">
      <label className="grid gap-1">
        <span className="etiqueta">CONTRASENYA ACTUAL</span>
        <input
          className="camp"
          type="password"
          name="current"
          required
          autoComplete="current-password"
        />
      </label>
      <label className="grid gap-1">
        <span className="etiqueta">NOVA CONTRASENYA</span>
        <input
          className="camp"
          type="password"
          name="next"
          required
          minLength={8}
          autoComplete="new-password"
          placeholder="Mínim 8 caràcters"
        />
      </label>
      {error && <p className="error-camp m-0">{error}</p>}
      <div className="flex gap-2">
        <button className="boto boto-principal" type="submit" disabled={pending}>
          {pending ? 'DESANT…' : 'DESAR'}
        </button>
        <button
          type="button"
          className="boto"
          disabled={pending}
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
        >
          CANCEL·LAR
        </button>
      </div>
    </form>
  );
}
