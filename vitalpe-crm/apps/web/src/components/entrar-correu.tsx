'use client';

import { useState, useTransition } from 'react';
import { signIn } from '@/lib/actions/auth';

/**
 * Sign-in: e-mail and password, one step.
 *
 * On success the server action redirects, so nothing after the call runs; the
 * only thing this component handles is showing the error when it does not.
 */
export function EntrarAmbCorreu() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await signIn(formData);
      if (result && !result.ok) setError(result.error ?? 'No s\'ha pogut iniciar la sessió.');
    });
  }

  return (
    <form action={submit} className="grid gap-3">
      <label className="grid gap-1">
        <span className="etiqueta">CORREU</span>
        <input
          className="camp"
          type="email"
          name="email"
          required
          autoComplete="email"
          autoFocus
          placeholder="nom@empresa.com"
        />
      </label>
      <label className="grid gap-1">
        <span className="etiqueta">CONTRASENYA</span>
        <input
          className="camp"
          type="password"
          name="password"
          required
          autoComplete="current-password"
          placeholder="••••••••"
        />
      </label>
      {error && <p className="error-camp m-0">{error}</p>}
      <button className="boto boto-principal" type="submit" disabled={pending}>
        {pending ? 'ENTRANT…' : 'ENTRAR'}
      </button>
      <p className="text-[12px] text-[var(--color-ink-faint)] m-0">
        Només funciona si un administrador ja t&apos;ha donat d&apos;alta. Si has oblidat la
        contrasenya, demana-li que te&apos;n posi una de nova.
      </p>
    </form>
  );
}
