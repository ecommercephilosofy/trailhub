'use client';

import { useState, useTransition } from 'react';
import { completeTask, postponeTask, scheduleUndatedTask } from '@/lib/actions/tasks';

const RESULTS = [
  'INTERES CONCRET',
  'DEMANA PREUS',
  'DEMANA MOSTRES',
  'ACORDAR VISITA',
  'TE UN ALTRE PROVEIDOR',
  'REPETIRA COMANDA',
  'NO DETERMINAT',
  'NO COMPRARA',
  'NO COMPRA VI A GRANEL',
  'TANCAT / INACTIU',
  'ALTRES',
] as const;

/**
 * Complete / postpone / schedule, inline on the row.
 *
 * Completing always asks for a result first — the database refuses otherwise,
 * and asking here turns a rejected write into an obvious two-click flow.
 */
export function TaskRowActions({
  task,
}: {
  task: { id: string; undated: boolean; clientName: string | null };
}) {
  const [panel, setPanel] = useState<'none' | 'complete' | 'postpone' | 'schedule'>('none');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [pending, startTransition] = useTransition();

  function submit(fn: (fd: FormData) => Promise<{ ok: boolean; error?: string }>, fd: FormData) {
    setError(null);
    startTransition(async () => {
      const res = await fn(fd);
      if (res.ok) {
        setPanel('none');
        setNotes('');
        setResult('');
      } else {
        setError(res.error ?? 'No s\'ha pogut desar.');
      }
    });
  }

  if (panel === 'none') {
    return (
      <span className="inline-flex gap-1 justify-end flex-wrap">
        <button type="button" className="boto" onClick={() => setPanel('complete')}>
          COMPLETAR
        </button>
        {task.undated ? (
          <button type="button" className="boto" onClick={() => setPanel('schedule')}>
            PROGRAMAR
          </button>
        ) : (
          <button type="button" className="boto" onClick={() => setPanel('postpone')}>
            AJORNAR
          </button>
        )}
      </span>
    );
  }

  return (
    <div className="targeta p-3 text-left grid gap-2 min-w-[260px]">
      {panel === 'complete' && (
        <>
          <p className="etiqueta m-0">
            COMPLETAR {task.clientName ? `· ${task.clientName}` : ''}
          </p>
          <label className="grid gap-1">
            <span className="etiqueta">RESULTAT (obligatori)</span>
            <select
              className="camp"
              value={result}
              onChange={(e) => setResult(e.target.value)}
              required
            >
              <option value="">Tria un resultat…</option>
              {RESULTS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="grid gap-1">
            <span className="etiqueta">
              OBSERVACIONS {result === 'ALTRES' ? '(obligatòries)' : ''}
            </span>
            <textarea
              className="camp"
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </label>
          <p className="text-[11px] text-[var(--color-ink-faint)] m-0">
            En completar-la es crea automàticament l&apos;acció a l&apos;historial comercial.
          </p>
        </>
      )}

      {panel === 'postpone' && (
        <>
          <p className="etiqueta m-0">AJORNAR</p>
          <label className="grid gap-1">
            <span className="etiqueta">NOVA DATA (obligatòria)</span>
            <input className="camp" type="datetime-local" name="newDate" id={`nd-${task.id}`} required />
          </label>
        </>
      )}

      {panel === 'schedule' && (
        <>
          <p className="etiqueta m-0">PROGRAMAR</p>
          <p className="text-[11px] text-[var(--color-ink-faint)] m-0">
            La tasca manté la seva identitat i el seu historial; no se&apos;n crea cap còpia.
          </p>
          <label className="grid gap-1">
            <span className="etiqueta">DATA I HORA</span>
            <input className="camp" type="datetime-local" id={`sd-${task.id}`} required />
          </label>
        </>
      )}

      {error && <p className="error-camp m-0">{error}</p>}

      <div className="flex gap-2">
        <button
          type="button"
          className="boto boto-principal"
          disabled={pending || (panel === 'complete' && !result)}
          onClick={() => {
            const fd = new FormData();
            fd.set('taskId', task.id);
            if (panel === 'complete') {
              fd.set('result', result);
              fd.set('notes', notes);
              submit(completeTask, fd);
            } else if (panel === 'postpone') {
              const el = document.getElementById(`nd-${task.id}`) as HTMLInputElement | null;
              fd.set('newDate', el?.value ?? '');
              submit(postponeTask, fd);
            } else {
              const el = document.getElementById(`sd-${task.id}`) as HTMLInputElement | null;
              fd.set('due', el?.value ?? '');
              submit(scheduleUndatedTask, fd);
            }
          }}
        >
          {pending ? 'DESANT…' : 'DESAR'}
        </button>
        <button type="button" className="boto" onClick={() => setPanel('none')} disabled={pending}>
          CANCEL·LAR
        </button>
      </div>
    </div>
  );
}
