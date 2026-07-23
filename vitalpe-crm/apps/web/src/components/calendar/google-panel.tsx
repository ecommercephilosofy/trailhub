'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  chooseCalendar,
  connectLocalCalendar,
  createCalendar,
  disconnectCalendar,
  forceReconciliation,
  renewChannel,
  type CalendarActionResult,
} from '@/lib/actions/calendar';

/**
 * The buttons on the Google Calendar settings screen.
 *
 * Everything here is a server action; nothing in this component ever holds a
 * token, an authorisation code or an encrypted value — the server never sends
 * one to the browser.
 */
export function GooglePanel({
  calendars,
  currentCalendarId,
  connected,
  googleConfigured,
}: {
  calendars: { id: string; summary: string; primary: boolean }[];
  currentCalendarId: string | null;
  connected: boolean;
  googleConfigured: boolean;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const [choice, setChoice] = useState(currentCalendarId ?? '');

  function run(fn: () => Promise<CalendarActionResult>): void {
    setMessage(null);
    setError(null);
    startTransition(async () => {
      const result = await fn();
      if (result.ok) setMessage(result.message ?? 'Fet.');
      else setError(result.error ?? 'No s’ha pogut completar l’operació.');
      router.refresh();
    });
  }

  return (
    <div className="grid gap-3">
      {(message || error) && (
        <p
          className={`targeta p-3 m-0 text-[13px] border-l-[3px] ${
            error ? 'border-l-[var(--color-danger)]' : 'border-l-[var(--color-ok)]'
          }`}
          role="status"
        >
          {error ?? message}
        </p>
      )}

      <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-end">
        <label className="grid gap-1 min-w-[280px]">
          <span className="etiqueta">CALENDARI DE DESTÍ</span>
          <select
            className="camp"
            value={choice}
            onChange={(e) => setChoice(e.target.value)}
            disabled={calendars.length === 0}
          >
            {calendars.length === 0 && <option value="">Cap calendari disponible</option>}
            {calendars.map((c) => (
              <option key={c.id} value={c.id}>
                {c.summary}
                {c.primary ? ' (principal)' : ''}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="boto"
          disabled={pending || !choice}
          onClick={() => {
            const fd = new FormData();
            fd.set('calendarId', choice);
            fd.set(
              'calendarName',
              calendars.find((c) => c.id === choice)?.summary ?? choice,
            );
            run(() => chooseCalendar(fd));
          }}
        >
          FER SERVIR AQUEST CALENDARI
        </button>
        <button type="button" className="boto" disabled={pending} onClick={() => run(createCalendar)}>
          CREAR CALENDARI DEDICAT
        </button>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="boto boto-principal"
          disabled={pending}
          onClick={() => run(forceReconciliation)}
        >
          {pending ? 'RECONCILIANT…' : 'FORÇAR RECONCILIACIÓ'}
        </button>
        <button type="button" className="boto" disabled={pending} onClick={() => run(renewChannel)}>
          RENOVAR CANAL D&apos;AVISOS
        </button>
        {!connected && !googleConfigured && (
          <button
            type="button"
            className="boto"
            disabled={pending}
            onClick={() => run(connectLocalCalendar)}
          >
            ACTIVAR CALENDARI LOCAL
          </button>
        )}
        {googleConfigured && (
          <a className="boto" href="/api/google/oauth/start">
            {connected ? 'TORNAR A AUTORITZAR' : 'CONNECTAR AMB GOOGLE'}
          </a>
        )}
        <button
          type="button"
          className="boto boto-perill"
          disabled={pending}
          onClick={() => run(disconnectCalendar)}
        >
          DESCONNECTAR
        </button>
      </div>
    </div>
  );
}
