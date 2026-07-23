'use client';

import { useEffect, useState, useTransition } from 'react';
import {
  companyLocations,
  createVisit,
  searchCompanies,
  updateVisit,
  type ActionResult,
} from '@/lib/actions/visits';
import type { CalendarEvent, CommercialOption, CompanyLocation } from './types';
import { toCivilDateTime } from './dates';

/**
 * Create / edit a visit.
 *
 * The company field is a search box, not a `<select>`: the workspace holds
 * thousands of companies. Choosing one loads that company's own locations —
 * a visit can only ever point at an address that belongs to it.
 *
 * Creating goes to `app.create_visit_with_task`, so the paired VISITA task is
 * born in the same transaction and immediately appears in TASQUES and on INICI.
 */

const PRIORITIES = ['ALTA', 'MITJANA', 'BAIXA'] as const;
const REMINDER_PRESETS = [
  { value: '', label: 'CAP' },
  { value: '15', label: '15 MINUTS ABANS' },
  { value: '30', label: '30 MINUTS ABANS' },
  { value: '60', label: "1 HORA ABANS" },
  { value: '1440', label: '1 DIA ABANS' },
  { value: '60,1440', label: '1 HORA I 1 DIA ABANS' },
];

export interface VisitFormProps {
  mode: 'crear' | 'editar';
  /** Prefilled slot for "new visit here". Civil `YYYY-MM-DDTHH:mm`. */
  defaultStart?: string;
  event?: CalendarEvent;
  commercials: CommercialOption[];
  canReassign: boolean;
  currentUserId: string;
  googleConfigured: boolean;
  onDone: (result: ActionResult) => void;
  onCancel: () => void;
}

export function VisitForm({
  mode,
  defaultStart,
  event,
  commercials,
  canReassign,
  currentUserId,
  googleConfigured,
  onDone,
  onCancel,
}: VisitFormProps) {
  const [clientId, setClientId] = useState(event?.clientId ?? '');
  const [clientName, setClientName] = useState(event?.clientName ?? '');
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState<{ id: string; name: string; subtitle: string }[]>([]);
  const [locations, setLocations] = useState<CompanyLocation[]>([]);
  const [locationId, setLocationId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const start =
    event?.startsAt !== undefined
      ? toCivilDateTime(event.startsAt)
      : (defaultStart ?? '');
  const end = event?.endsAt !== undefined ? toCivilDateTime(event.endsAt) : addMinutes(start, 60);

  useEffect(() => {
    const needle = term.trim();
    if (needle.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void searchCompanies(needle).then((rows) => {
        if (!cancelled) setHits(rows);
      });
    }, 180);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [term]);

  useEffect(() => {
    if (!clientId) {
      setLocations([]);
      return;
    }
    let cancelled = false;
    void companyLocations(clientId).then((rows) => {
      if (cancelled) return;
      setLocations(rows);
      setLocationId((current) => current || (rows[0]?.id ?? ''));
    });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  function submit(formData: FormData): void {
    setError(null);
    formData.set('clientId', clientId);
    if (event) formData.set('visitId', event.id);
    startTransition(async () => {
      const result = await (mode === 'crear' ? createVisit(formData) : updateVisit(formData));
      if (result.ok) onDone(result);
      else setError(result.error ?? 'No s’ha pogut desar.');
    });
  }

  return (
    <form action={submit} className="grid gap-3">
      <p className="etiqueta m-0">{mode === 'crear' ? 'NOVA VISITA' : 'EDITAR VISITA'}</p>

      {/* --- company ------------------------------------------------------ */}
      <div className="grid gap-1">
        <span className="etiqueta">EMPRESA</span>
        {clientId ? (
          <div className="flex items-center gap-2 flex-wrap">
            <strong className="text-[14px]">{clientName}</strong>
            {mode === 'crear' && (
              <button
                type="button"
                className="boto"
                onClick={() => {
                  setClientId('');
                  setClientName('');
                  setLocationId('');
                }}
              >
                CANVIAR
              </button>
            )}
          </div>
        ) : (
          <>
            <input
              className="camp"
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              placeholder="Escriu el nom de l’empresa…"
              aria-label="Cercar empresa"
              autoComplete="off"
            />
            {hits.length > 0 && (
              <ul className="list-none p-0 m-0 targeta max-h-44 overflow-y-auto">
                {hits.map((hit) => (
                  <li key={hit.id}>
                    <button
                      type="button"
                      className="w-full text-left px-3 py-2 bg-transparent border-0 cursor-pointer hover:bg-[var(--color-paper-sunken)]"
                      onClick={() => {
                        setClientId(hit.id);
                        setClientName(hit.name);
                        setHits([]);
                        setTerm('');
                      }}
                    >
                      <span className="block text-[13px] font-semibold">{hit.name}</span>
                      <span className="block text-[11px] text-[var(--color-ink-faint)]">
                        {hit.subtitle}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {term.trim().length >= 2 && hits.length === 0 && (
              <p className="text-[12px] text-[var(--color-ink-faint)] m-0">
                Cap empresa amb aquest nom.
              </p>
            )}
          </>
        )}
      </div>

      {/* --- location ----------------------------------------------------- */}
      <label className="grid gap-1">
        <span className="etiqueta">UBICACIÓ</span>
        <select
          className="camp"
          name="locationId"
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
          disabled={!clientId}
        >
          <option value="">SENSE UBICACIÓ CONCRETA</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        {clientId && locations.length === 0 && (
          <span className="text-[11px] text-[var(--color-ink-faint)]">
            Aquesta empresa encara no té cap adreça registrada.
          </span>
        )}
      </label>

      {/* --- when --------------------------------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="etiqueta">INICI</span>
          <input
            className="camp"
            type="datetime-local"
            name="startsAt"
            defaultValue={start}
            required
          />
        </label>
        <label className="grid gap-1">
          <span className="etiqueta">FI</span>
          <input className="camp" type="datetime-local" name="endsAt" defaultValue={end} required />
        </label>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="grid gap-1">
          <span className="etiqueta">IMPORTÀNCIA</span>
          <select className="camp" name="priority" defaultValue={event?.priority ?? 'MITJANA'}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <label className="grid gap-1">
          <span className="etiqueta">RECORDATORIS</span>
          <select className="camp" name="reminders" defaultValue="60">
            {REMINDER_PRESETS.map((r) => (
              <option key={r.label} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      {canReassign && (
        <label className="grid gap-1">
          <span className="etiqueta">COMERCIAL</span>
          <select
            className="camp"
            name="assignedTo"
            defaultValue={event?.assigneeId ?? currentUserId}
          >
            {commercials.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}

      <label className="grid gap-1">
        <span className="etiqueta">OBJECTIU</span>
        <textarea className="camp" name="objective" rows={2} defaultValue={event?.objective ?? ''} />
      </label>

      <label className="grid gap-1">
        <span className="etiqueta">INFORMACIÓ IMPORTANT</span>
        <textarea
          className="camp"
          name="importantInfo"
          rows={2}
          defaultValue={event?.importantInfo ?? ''}
        />
        <span className="text-[11px] text-[var(--color-ink-faint)]">
          Surt al calendari com a informació operativa. No hi posis dades sensibles.
        </span>
      </label>

      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          name="syncToGoogle"
          defaultChecked={event ? event.syncEnabled : true}
        />
        <span className="etiqueta m-0">SINCRONITZAR AMB GOOGLE</span>
      </label>
      {!googleConfigured && (
        <p className="text-[11px] text-[var(--color-ink-faint)] m-0">
          Google Calendar no està configurat en aquest entorn: la visita se sincronitza amb el
          calendari local i tot el circuit funciona igual.
        </p>
      )}

      {error && <p className="error-camp m-0">{error}</p>}

      <div className="flex gap-2 flex-wrap">
        <button
          className="boto boto-principal"
          type="submit"
          disabled={pending || (mode === 'crear' && !clientId)}
        >
          {pending ? 'DESANT…' : mode === 'crear' ? 'CREAR VISITA' : 'DESAR CANVIS'}
        </button>
        <button className="boto" type="button" onClick={onCancel} disabled={pending}>
          CANCEL·LAR
        </button>
      </div>
    </form>
  );
}

function addMinutes(civil: string, minutes: number): string {
  if (!civil) return '';
  const [date, time] = civil.split('T');
  if (!date || !time) return '';
  const total =
    Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5)) + minutes;
  const day = Math.floor(total / 1440);
  const rest = ((total % 1440) + 1440) % 1440;
  const shifted =
    day === 0
      ? date
      : new Date(Date.parse(`${date}T00:00:00Z`) + day * 86_400_000).toISOString().slice(0, 10);
  const hh = String(Math.floor(rest / 60)).padStart(2, '0');
  const mm = String(rest % 60).padStart(2, '0');
  return `${shifted}T${hh}:${mm}`;
}
