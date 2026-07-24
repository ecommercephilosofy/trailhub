'use client';

import { useState, useTransition } from 'react';
import { requestCode, verifyCode } from '@/lib/actions/auth';

/**
 * Two-step sign-in: e-mail, then the six-digit code Supabase sends.
 *
 * The second step keeps the address in a hidden field so `verifyOtp` gets the
 * same pair the code was issued for, and so a reload cannot land the user on a
 * code box with no idea which address it belongs to.
 */
export function EntrarAmbCorreu() {
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  function send(formData: FormData) {
    setError(null);
    startTransition(async () => {
      const result = await requestCode(formData);
      // codeSent can arrive with ok:false — rate-limited — and the person may
      // hold a perfectly valid code from minutes ago: never lock them out of
      // the code box, just surface the explanation alongside it.
      if (result.ok || result.codeSent) {
        setEmail(String(formData.get('email') ?? '').trim().toLowerCase());
        setStep('code');
        if (!result.ok) setError(result.error ?? null);
      } else {
        setError(result.error ?? 'No s\'ha pogut enviar el codi.');
      }
    });
  }

  function check(formData: FormData) {
    setError(null);
    startTransition(async () => {
      // On success this redirects, so nothing after it runs.
      const result = await verifyCode(formData);
      if (result && !result.ok) setError(result.error ?? 'El codi no és vàlid.');
    });
  }

  if (step === 'email') {
    return (
      <form action={send} className="grid gap-3">
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
        {error && <p className="error-camp m-0">{error}</p>}
        <button className="boto boto-principal" type="submit" disabled={pending}>
          {pending ? 'ENVIANT…' : 'ENVIAR CODI D\'ACCÉS'}
        </button>
        <p className="text-[12px] text-[var(--color-ink-faint)] m-0">
          Rebràs un codi de sis xifres. Només funciona si ja tens accés a
          l&apos;espai de treball.
        </p>
      </form>
    );
  }

  return (
    <form action={check} className="grid gap-3">
      <input type="hidden" name="email" value={email} />
      <p className="text-[13px] m-0">
        Hem enviat un codi a <strong>{email}</strong>. Mira també la carpeta de correu
        brossa.
      </p>
      <label className="grid gap-1">
        <span className="etiqueta">CODI DE SIS XIFRES</span>
        <input
          className="camp font-mono text-[18px] tracking-[0.3em]"
          type="text"
          name="code"
          inputMode="numeric"
          pattern="[0-9]*"
          maxLength={6}
          required
          autoFocus
          autoComplete="one-time-code"
          placeholder="000000"
        />
      </label>
      {error && <p className="error-camp m-0">{error}</p>}
      <button className="boto boto-principal" type="submit" disabled={pending}>
        {pending ? 'COMPROVANT…' : 'ENTRAR'}
      </button>
      <button
        type="button"
        className="boto"
        onClick={() => {
          setStep('email');
          setError(null);
        }}
        disabled={pending}
      >
        UTILITZAR UN ALTRE CORREU
      </button>
    </form>
  );
}
