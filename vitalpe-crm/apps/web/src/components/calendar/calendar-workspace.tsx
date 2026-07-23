'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useMemo, useRef, useState, useTransition } from 'react';
import {
  cancelVisit,
  completeVisit,
  rescheduleVisit,
  resyncVisit,
  type ActionResult,
} from '@/lib/actions/visits';
import { formatDate, formatTime, formatWeekday, TASK_TONE } from '@/lib/format';
import { VisitForm } from './visit-form';
import type { CalendarEvent, CommercialOption } from './types';
import {
  minutesOfDay,
  toCivilDate,
  toCivilDateTime,
  todayCivil,
  type CalendarView,
} from './dates';

/**
 * The calendar surface.
 *
 * Navigation (view, date, commercial) lives in the URL and is rendered on the
 * server; this component owns only what needs a browser: the time grid, the
 * drag-and-drop and the detail panel.
 *
 * Drag-and-drop uses the platform's own drag events — no library. A drop is one
 * call to `rescheduleVisit`, a single server action that moves the visit and
 * its task inside one database transaction, lets the audit trigger record the
 * change, queues the calendar push and revalidates. The component never patches
 * several tables itself, and never optimistically rewrites a row it did not
 * hear back about.
 */

const START_HOUR = 7;
const END_HOUR = 21;
const PX_PER_HOUR = 56;
const SLOT_MINUTES = 30;

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

const VISIT_TONE: Record<string, string> = {
  PLANIFICADA: 'estat estat-neutre',
  CONFIRMADA: 'estat estat-marca',
  FETA: 'estat estat-ok',
  'CANCEL·LADA': 'estat estat-perill',
};

export interface CalendarWorkspaceProps {
  events: CalendarEvent[];
  view: CalendarView;
  anchor: string;
  days: string[];
  commercials: CommercialOption[];
  canReassign: boolean;
  currentUserId: string;
  googleConfigured: boolean;
  googleConnected: boolean;
}

type Panel =
  | { kind: 'none' }
  | { kind: 'event'; id: string }
  | { kind: 'create'; start: string }
  | { kind: 'edit'; id: string };

export function CalendarWorkspace(props: CalendarWorkspaceProps) {
  const { events, view, days } = props;
  const router = useRouter();
  const [panel, setPanel] = useState<Panel>({ kind: 'none' });
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const dragged = useRef<CalendarEvent | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  const byId = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const selected = panel.kind === 'event' || panel.kind === 'edit' ? byId.get(panel.id) : undefined;

  const run = useCallback(
    (fn: () => Promise<ActionResult>, onOk?: () => void) => {
      setError(null);
      startTransition(async () => {
        const result = await fn();
        if (result.ok) {
          setNotice(result.sync ? `Desat · sincronització: ${result.sync}` : 'Desat.');
          onOk?.();
          router.refresh();
        } else {
          setError(result.error ?? 'No s’ha pogut desar.');
        }
      });
    },
    [router],
  );

  /** One drop = one server action. Validation, audit and sync all happen there. */
  const drop = useCallback(
    (civilDateTime: string) => {
      const event = dragged.current;
      dragged.current = null;
      setDropTarget(null);
      if (!event) return;
      if (toCivilDateTime(event.startsAt) === civilDateTime) return;
      const fd = new FormData();
      fd.set('visitId', event.id);
      fd.set('startsAt', civilDateTime);
      run(() => rescheduleVisit(fd));
    },
    [run],
  );

  function dragProps(event: CalendarEvent) {
    if (!event.editable) return {};
    return {
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        dragged.current = event;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', event.id);
      },
      onDragEnd: () => {
        dragged.current = null;
        setDropTarget(null);
      },
    };
  }

  function dropProps(civilDateTime: string) {
    return {
      onDragOver: (e: React.DragEvent) => {
        if (!dragged.current) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        setDropTarget(civilDateTime);
      },
      onDragLeave: () => setDropTarget((t) => (t === civilDateTime ? null : t)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        drop(civilDateTime);
      },
    };
  }

  return (
    <div className="grid gap-3">
      {(notice || error) && (
        <p
          className={`targeta p-3 m-0 text-[13px] border-l-[3px] ${
            error ? 'border-l-[var(--color-danger)]' : 'border-l-[var(--color-ok)]'
          }`}
          role="status"
        >
          {error ?? notice}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="boto boto-principal"
          onClick={() =>
            setPanel({ kind: 'create', start: `${days[0] ?? todayCivil()}T09:00` })
          }
        >
          NOVA VISITA
        </button>
        <span className="text-[12px] text-[var(--color-ink-faint)]">
          {events.length} esdeveniments · arrossega una visita a una altra hora per reprogramar-la
        </span>
        {pending && <span className="etiqueta">DESANT…</span>}
      </div>

      {view === 'dia' && (
        <TimeGrid
          days={days.slice(0, 1)}
          events={events}
          dragProps={dragProps}
          dropProps={dropProps}
          dropTarget={dropTarget}
          onOpen={(id) => setPanel({ kind: 'event', id })}
          onEmpty={(start) => setPanel({ kind: 'create', start })}
          detailed
        />
      )}

      {view === 'setmana' && (
        <TimeGrid
          days={days}
          events={events}
          dragProps={dragProps}
          dropProps={dropProps}
          dropTarget={dropTarget}
          onOpen={(id) => setPanel({ kind: 'event', id })}
          onEmpty={(start) => setPanel({ kind: 'create', start })}
        />
      )}

      {view === 'mes' && (
        <MonthGrid
          days={days}
          anchor={props.anchor}
          events={events}
          dragProps={dragProps}
          dropProps={dropProps}
          dropTarget={dropTarget}
          draggedRef={dragged}
          onOpen={(id) => setPanel({ kind: 'event', id })}
          onEmpty={(start) => setPanel({ kind: 'create', start })}
        />
      )}

      {view === 'agenda' && (
        <AgendaList days={days} events={events} onOpen={(id) => setPanel({ kind: 'event', id })} />
      )}

      {view === 'visites' && (
        <VisitsTable events={events} onOpen={(id) => setPanel({ kind: 'event', id })} />
      )}

      {view === 'comercials' && (
        <ByCommercial
          events={events}
          commercials={props.commercials}
          onOpen={(id) => setPanel({ kind: 'event', id })}
        />
      )}

      {panel.kind !== 'none' && (
        <Dialog
          onClose={() => {
            setPanel({ kind: 'none' });
            setError(null);
          }}
        >
          {panel.kind === 'create' && (
            <VisitForm
              mode="crear"
              defaultStart={panel.start}
              commercials={props.commercials}
              canReassign={props.canReassign}
              currentUserId={props.currentUserId}
              googleConfigured={props.googleConfigured}
              onCancel={() => setPanel({ kind: 'none' })}
              onDone={(result) => {
                setPanel({ kind: 'none' });
                setNotice(`Visita creada · sincronització: ${result.sync ?? '—'}`);
                router.refresh();
              }}
            />
          )}

          {panel.kind === 'edit' && selected && (
            <VisitForm
              mode="editar"
              event={selected}
              commercials={props.commercials}
              canReassign={props.canReassign}
              currentUserId={props.currentUserId}
              googleConfigured={props.googleConfigured}
              onCancel={() => setPanel({ kind: 'event', id: selected.id })}
              onDone={(result) => {
                setPanel({ kind: 'none' });
                setNotice(`Visita desada · sincronització: ${result.sync ?? '—'}`);
                router.refresh();
              }}
            />
          )}

          {panel.kind === 'event' && selected && (
            <EventPanel
              event={selected}
              pending={pending}
              error={error}
              googleConnected={props.googleConnected}
              googleConfigured={props.googleConfigured}
              onEdit={() => setPanel({ kind: 'edit', id: selected.id })}
              onClose={() => setPanel({ kind: 'none' })}
              run={run}
            />
          )}

          {panel.kind === 'event' && !selected && (
            <p className="text-[13px] m-0">Aquesta visita ja no és a la vista actual.</p>
          )}
        </Dialog>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Time grid (DIA + SETMANA)
// ---------------------------------------------------------------------------

interface GridProps {
  days: string[];
  events: CalendarEvent[];
  dragProps: (event: CalendarEvent) => Record<string, unknown>;
  dropProps: (civil: string) => Record<string, unknown>;
  dropTarget: string | null;
  onOpen: (id: string) => void;
  onEmpty: (start: string) => void;
  detailed?: boolean;
}

function TimeGrid({
  days,
  events,
  dragProps,
  dropProps,
  dropTarget,
  onOpen,
  onEmpty,
  detailed = false,
}: GridProps) {
  const hours: number[] = [];
  for (let h = START_HOUR; h < END_HOUR; h += 1) hours.push(h);
  const height = (END_HOUR - START_HOUR) * PX_PER_HOUR;
  const today = todayCivil();

  return (
    <div className="taula-ampla targeta">
      <div
        className="grid min-w-[640px]"
        style={{ gridTemplateColumns: `56px repeat(${days.length}, minmax(0, 1fr))` }}
      >
        {/* header row */}
        <div className="border-b border-[var(--color-line-strong)] bg-[var(--color-paper-sunken)]" />
        {days.map((day) => (
          <div
            key={`h-${day}`}
            className={`border-b border-l border-[var(--color-line-strong)] px-2 py-1 bg-[var(--color-paper-sunken)] ${
              day === today ? 'text-[var(--color-burgundy)]' : ''
            }`}
          >
            <span className="etiqueta block">{formatWeekday(`${day}T12:00:00Z`)}</span>
            <span className="text-[13px] font-semibold tabular-nums">
              {formatDate(`${day}T12:00:00Z`)}
            </span>
          </div>
        ))}

        {/* hour gutter */}
        <div className="relative" style={{ height }}>
          {hours.map((h, i) => (
            <div
              key={h}
              className="absolute right-1 text-[11px] text-[var(--color-ink-faint)] tabular-nums -translate-y-1/2"
              style={{ top: i * PX_PER_HOUR }}
            >
              {String(h).padStart(2, '0')}:00
            </div>
          ))}
        </div>

        {/* day columns */}
        {days.map((day) => (
          <DayColumn
            key={day}
            day={day}
            height={height}
            hours={hours}
            events={events.filter((e) => toCivilDate(e.startsAt) === day)}
            dragProps={dragProps}
            dropProps={dropProps}
            dropTarget={dropTarget}
            onOpen={onOpen}
            onEmpty={onEmpty}
            detailed={detailed}
          />
        ))}
      </div>
    </div>
  );
}

function DayColumn({
  day,
  height,
  hours,
  events,
  dragProps,
  dropProps,
  dropTarget,
  onOpen,
  onEmpty,
  detailed,
}: {
  day: string;
  height: number;
  hours: number[];
  events: CalendarEvent[];
  dragProps: GridProps['dragProps'];
  dropProps: GridProps['dropProps'];
  dropTarget: string | null;
  onOpen: (id: string) => void;
  onEmpty: (start: string) => void;
  detailed: boolean;
}) {
  const slots: string[] = [];
  for (let h = START_HOUR; h < END_HOUR; h += 1) {
    for (let m = 0; m < 60; m += SLOT_MINUTES) {
      slots.push(`${day}T${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`);
    }
  }
  const lanes = assignLanes(events);

  return (
    <div className="relative border-l border-[var(--color-line)]" style={{ height }}>
      {hours.map((h, i) => (
        <div
          key={h}
          className="absolute inset-x-0 border-t border-[var(--color-line)]"
          style={{ top: i * PX_PER_HOUR }}
        />
      ))}

      {slots.map((slot, index) => {
        return (
          <button
            key={slot}
            type="button"
            aria-label={`Franja lliure ${slot.slice(11)} del ${slot.slice(0, 10)}`}
            className={`absolute inset-x-0 border-0 bg-transparent cursor-pointer p-0 ${
              dropTarget === slot ? 'bg-[var(--color-burgundy-wash)]' : ''
            }`}
            style={{ top: (index * SLOT_MINUTES * PX_PER_HOUR) / 60, height: (SLOT_MINUTES * PX_PER_HOUR) / 60 }}
            onClick={() => onEmpty(slot)}
            {...dropProps(slot)}
          />
        );
      })}

      {events.map((event) => {
        const top = ((minutesOfDay(event.startsAt) - START_HOUR * 60) * PX_PER_HOUR) / 60;
        const rawHeight = (event.durationMinutes * PX_PER_HOUR) / 60;
        const lane = lanes.get(event.id) ?? { index: 0, total: 1 };
        return (
          <div
            key={event.id}
            className="absolute px-[3px]"
            style={{
              top: Math.max(0, top),
              height: Math.max(26, rawHeight),
              left: `${(lane.index / lane.total) * 100}%`,
              width: `${100 / lane.total}%`,
            }}
          >
            <EventBlock
              event={event}
              detailed={detailed}
              onOpen={onOpen}
              dragProps={dragProps}
            />
          </div>
        );
      })}
    </div>
  );
}

function EventBlock({
  event,
  detailed,
  onOpen,
  dragProps,
}: {
  event: CalendarEvent;
  detailed: boolean;
  onOpen: (id: string) => void;
  dragProps: GridProps['dragProps'];
}) {
  const cancelled = event.status === 'CANCEL·LADA';
  return (
    <button
      type="button"
      onClick={() => onOpen(event.id)}
      {...dragProps(event)}
      className={`w-full h-full text-left overflow-hidden rounded-[var(--radius-sm)] border p-1 leading-tight cursor-pointer ${
        cancelled
          ? 'bg-[var(--color-paper-sunken)] border-[var(--color-line-strong)] text-[var(--color-ink-faint)] line-through'
          : 'bg-[var(--color-burgundy-wash)] border-[color-mix(in_srgb,var(--color-burgundy)_35%,transparent)]'
      } ${event.priority === 'ALTA' && !cancelled ? 'border-l-[3px] border-l-[var(--color-danger)]' : ''}`}
      title={`${event.clientName} · ${event.action}`}
    >
      <span className="block text-[11px] font-mono tabular-nums">
        {formatTime(event.startsAt)}–{formatTime(event.endsAt)} · {event.durationMinutes} MIN
      </span>
      <span className="block text-[12px] font-semibold truncate">{event.clientName}</span>
      <span className="block text-[11px] text-[var(--color-ink-soft)] truncate">
        {event.action}
        {event.productName ? ` · ${event.productName}` : ''}
      </span>
      {detailed && (
        <>
          <span className="block text-[11px] text-[var(--color-ink-soft)] truncate">
            {event.assignee ?? 'SENSE COMERCIAL'} · {event.locationLabel ?? 'SENSE UBICACIÓ'}
          </span>
          <span className="flex flex-wrap gap-1 mt-[2px]">
            <Chip tone={priorityTone(event.priority)}>{event.priority}</Chip>
            <Chip tone={VISIT_TONE[event.status] ?? 'estat estat-neutre'}>{event.status}</Chip>
            <Chip tone={syncTone(event.syncState)}>{event.syncState ?? 'NO SINCRONITZAT'}</Chip>
          </span>
        </>
      )}
    </button>
  );
}

function Chip({ tone, children }: { tone: string; children: React.ReactNode }) {
  return <span className={tone}>{children}</span>;
}

function priorityTone(priority: string): string {
  return priority === 'ALTA'
    ? 'estat estat-perill'
    : priority === 'BAIXA'
      ? 'estat estat-neutre'
      : 'estat estat-avis';
}

function syncTone(state: string | null): string {
  if (state === 'SINCRONITZAT') return 'estat estat-ok';
  if (state === 'ERROR') return 'estat estat-perill';
  if (state === 'PENDENT') return 'estat estat-avis';
  return 'estat estat-neutre';
}

/** Side-by-side lanes for overlapping visits, so nothing is hidden. */
function assignLanes(events: CalendarEvent[]): Map<string, { index: number; total: number }> {
  const sorted = [...events].sort(
    (a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt),
  );
  const lanes = new Map<string, { index: number; total: number }>();
  let cluster: CalendarEvent[] = [];
  let clusterEnd = 0;

  const flush = (): void => {
    cluster.forEach((event, index) =>
      lanes.set(event.id, { index, total: Math.max(1, cluster.length) }),
    );
    cluster = [];
  };

  for (const event of sorted) {
    const start = Date.parse(event.startsAt);
    if (cluster.length > 0 && start >= clusterEnd) flush();
    cluster.push(event);
    clusterEnd = Math.max(clusterEnd, Date.parse(event.endsAt));
  }
  flush();
  return lanes;
}

// ---------------------------------------------------------------------------
// Month grid
// ---------------------------------------------------------------------------

function MonthGrid({
  days,
  anchor,
  events,
  dragProps,
  dropProps,
  dropTarget,
  draggedRef,
  onOpen,
  onEmpty,
}: GridProps & { anchor: string; draggedRef: React.RefObject<CalendarEvent | null> }) {
  const month = anchor.slice(0, 7);
  const today = todayCivil();
  const weekdays = ['DL', 'DM', 'DC', 'DJ', 'DV', 'DS', 'DG'];

  return (
    <div className="taula-ampla targeta">
      <div className="grid grid-cols-7 min-w-[640px]">
        {weekdays.map((label) => (
          <div
            key={label}
            className="etiqueta px-2 py-1 bg-[var(--color-paper-sunken)] border-b border-[var(--color-line-strong)]"
          >
            {label}
          </div>
        ))}
        {days.map((day) => {
          const dayEvents = events.filter((e) => toCivilDate(e.startsAt) === day);
          // Dropping on a month cell keeps the visit's time of day: a month view
          // is about which day, not which hour.
          const target = `${day}T${
            draggedRef.current ? toCivilDateTime(draggedRef.current.startsAt).slice(11) : '09:00'
          }`;
          return (
            <div
              key={day}
              className={`min-h-[104px] border-b border-l border-[var(--color-line)] p-1 ${
                day.slice(0, 7) === month ? '' : 'bg-[var(--color-paper-sunken)]'
              } ${dropTarget?.startsWith(day) ? 'outline outline-2 outline-[var(--color-burgundy)]' : ''}`}
              {...dropProps(target)}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`text-[12px] tabular-nums ${
                    day === today ? 'font-bold text-[var(--color-burgundy)]' : ''
                  }`}
                >
                  {day.slice(8, 10)}
                </span>
                <button
                  type="button"
                  className="text-[11px] border-0 bg-transparent cursor-pointer text-[var(--color-ink-faint)]"
                  onClick={() => onEmpty(`${day}T09:00`)}
                  aria-label={`Nova visita el ${day}`}
                >
                  +
                </button>
              </div>
              <ul className="list-none p-0 m-0 grid gap-[2px]">
                {dayEvents.map((event) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => onOpen(event.id)}
                      {...dragProps(event)}
                      className={`w-full text-left text-[11px] px-1 py-[2px] rounded-[var(--radius-sm)] border cursor-pointer truncate ${
                        event.status === 'CANCEL·LADA'
                          ? 'bg-[var(--color-paper-sunken)] border-[var(--color-line-strong)] line-through text-[var(--color-ink-faint)]'
                          : 'bg-[var(--color-burgundy-wash)] border-[color-mix(in_srgb,var(--color-burgundy)_30%,transparent)]'
                      }`}
                    >
                      <span className="font-mono tabular-nums">{formatTime(event.startsAt)}</span>{' '}
                      {event.clientName}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agenda
// ---------------------------------------------------------------------------

function AgendaList({
  days,
  events,
  onOpen,
}: {
  days: string[];
  events: CalendarEvent[];
  onOpen: (id: string) => void;
}) {
  const withEvents = days
    .map((day) => ({ day, rows: events.filter((e) => toCivilDate(e.startsAt) === day) }))
    .filter((group) => group.rows.length > 0);

  if (withEvents.length === 0) {
    return <p className="text-[13px] text-[var(--color-ink-faint)] m-0">Cap visita en aquest interval.</p>;
  }

  return (
    <div className="grid gap-4">
      {withEvents.map((group) => (
        <section key={group.day}>
          <h3 className="etiqueta m-0 mb-1">
            {formatWeekday(`${group.day}T12:00:00Z`)} · {formatDate(`${group.day}T12:00:00Z`)}
          </h3>
          <ul className="list-none p-0 m-0 grid gap-2">
            {group.rows.map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => onOpen(event.id)}
                  className="targeta w-full text-left p-3 flex flex-wrap items-center gap-x-4 gap-y-1 cursor-pointer"
                >
                  <span className="font-mono text-[14px] font-semibold tabular-nums">
                    {formatTime(event.startsAt)}–{formatTime(event.endsAt)}
                  </span>
                  <span className="text-[12px] text-[var(--color-ink-faint)]">
                    {event.durationMinutes} MIN
                  </span>
                  <span className="font-semibold">{event.clientName}</span>
                  <span className="text-[12px]">{event.action}</span>
                  <span className="text-[12px] text-[var(--color-ink-soft)]">
                    {event.assignee ?? '—'}
                  </span>
                  <span className="text-[12px] text-[var(--color-ink-soft)]">
                    {event.locationLabel ?? 'SENSE UBICACIÓ'}
                  </span>
                  <span className="text-[12px] text-[var(--color-ink-soft)]">
                    {event.productName ?? '—'}
                  </span>
                  <span className="ml-auto flex flex-wrap gap-1">
                    <Chip tone={priorityTone(event.priority)}>{event.priority}</Chip>
                    <Chip tone={VISIT_TONE[event.status] ?? 'estat estat-neutre'}>{event.status}</Chip>
                    <Chip tone={syncTone(event.syncState)}>
                      {event.syncState ?? 'NO SINCRONITZAT'}
                    </Chip>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// VISITES (manager)
// ---------------------------------------------------------------------------

function VisitsTable({
  events,
  onOpen,
}: {
  events: CalendarEvent[];
  onOpen: (id: string) => void;
}) {
  if (events.length === 0) {
    return <p className="text-[13px] text-[var(--color-ink-faint)] m-0">Cap visita en aquest interval.</p>;
  }
  return (
    <div className="taula-ampla targeta">
      <table className="taula">
        <thead>
          <tr>
            <th>DATA</th>
            <th>HORA</th>
            <th>DURADA</th>
            <th>EMPRESA</th>
            <th>ACCIÓ</th>
            <th>COMERCIAL</th>
            <th>UBICACIÓ</th>
            <th>PRODUCTE</th>
            <th>IMPORTÀNCIA</th>
            <th>ESTAT</th>
            <th>SINCRONITZACIÓ</th>
            <th className="text-right">ACCIONS</th>
          </tr>
        </thead>
        <tbody>
          {events.map((event) => (
            <tr key={event.id}>
              <td className="tabular-nums whitespace-nowrap">{formatDate(event.startsAt)}</td>
              <td className="tabular-nums whitespace-nowrap">
                {formatTime(event.startsAt)}–{formatTime(event.endsAt)}
              </td>
              <td className="tabular-nums">{event.durationMinutes} min</td>
              <td>
                <Link href={`/clients/${event.clientId}`}>{event.clientName}</Link>
              </td>
              <td>{event.action}</td>
              <td className="text-[var(--color-ink-soft)]">{event.assignee ?? '—'}</td>
              <td className="text-[var(--color-ink-soft)]">{event.locationLabel ?? '—'}</td>
              <td className="text-[var(--color-ink-soft)]">{event.productName ?? '—'}</td>
              <td>
                <Chip tone={priorityTone(event.priority)}>{event.priority}</Chip>
              </td>
              <td>
                <Chip tone={VISIT_TONE[event.status] ?? 'estat estat-neutre'}>{event.status}</Chip>
              </td>
              <td>
                <Chip tone={syncTone(event.syncState)}>{event.syncState ?? 'NO SINCRONITZAT'}</Chip>
              </td>
              <td className="text-right">
                <button type="button" className="boto" onClick={() => onOpen(event.id)}>
                  OBRIR
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// PER COMERCIAL (manager)
// ---------------------------------------------------------------------------

function ByCommercial({
  events,
  commercials,
  onOpen,
}: {
  events: CalendarEvent[];
  commercials: CommercialOption[];
  onOpen: (id: string) => void;
}) {
  const groups = commercials
    .map((c) => ({ ...c, rows: events.filter((e) => e.assigneeId === c.id) }))
    .filter((g) => g.rows.length > 0);
  const orphans = events.filter((e) => !e.assigneeId);

  return (
    <div className="grid gap-4">
      <p className="text-[12px] text-[var(--color-ink-faint)] m-0">
        Només visites del CRM. El calendari personal d&apos;un company mai s&apos;hi mostra: un
        esdeveniment sense identitat de CRM s&apos;ignora en la sincronització i no arriba mai aquí.
      </p>
      {groups.length === 0 && orphans.length === 0 && (
        <p className="text-[13px] text-[var(--color-ink-faint)] m-0">
          Cap visita assignada en aquest interval.
        </p>
      )}
      {[...groups, ...(orphans.length > 0 ? [{ id: '', name: 'SENSE COMERCIAL', rows: orphans }] : [])].map(
        (group) => (
          <section key={group.id || 'sense'}>
            <h3 className="etiqueta m-0 mb-1">
              {group.name} <span className="font-mono">({group.rows.length})</span>
            </h3>
            <ul className="list-none p-0 m-0 grid gap-1">
              {group.rows.map((event) => (
                <li key={event.id}>
                  <button
                    type="button"
                    onClick={() => onOpen(event.id)}
                    className="targeta w-full text-left p-2 flex flex-wrap items-center gap-x-3 gap-y-1 cursor-pointer text-[13px]"
                  >
                    <span className="font-mono tabular-nums">
                      {formatDate(event.startsAt)} {formatTime(event.startsAt)}
                    </span>
                    <span className="font-semibold">{event.clientName}</span>
                    <span className="text-[12px]">{event.action}</span>
                    <span className="text-[12px] text-[var(--color-ink-soft)]">
                      {event.locationLabel ?? '—'}
                    </span>
                    <span className="ml-auto flex gap-1">
                      <Chip tone={VISIT_TONE[event.status] ?? 'estat estat-neutre'}>
                        {event.status}
                      </Chip>
                      <Chip tone={syncTone(event.syncState)}>
                        {event.syncState ?? 'NO SINCRONITZAT'}
                      </Chip>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ),
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail panel
// ---------------------------------------------------------------------------

function EventPanel({
  event,
  pending,
  error,
  googleConnected,
  googleConfigured,
  onEdit,
  onClose,
  run,
}: {
  event: CalendarEvent;
  pending: boolean;
  error: string | null;
  googleConnected: boolean;
  googleConfigured: boolean;
  onEdit: () => void;
  onClose: () => void;
  run: (fn: () => Promise<ActionResult>, onOk?: () => void) => void;
}) {
  const [mode, setMode] = useState<'none' | 'detalls' | 'reprogramar' | 'completar' | 'cancellar'>(
    'none',
  );
  const [result, setResult] = useState('');
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [newStart, setNewStart] = useState(toCivilDateTime(event.startsAt));
  const closed = event.status === 'CANCEL·LADA' || event.status === 'FETA';

  return (
    <div className="grid gap-3">
      <header className="grid gap-1">
        <p className="etiqueta m-0">VISITA</p>
        <h2 className="text-[18px] font-semibold m-0">{event.clientName}</h2>
        <p className="m-0 font-mono text-[13px] tabular-nums">
          {formatWeekday(event.startsAt)} {formatDate(event.startsAt)} ·{' '}
          {formatTime(event.startsAt)}–{formatTime(event.endsAt)} · {event.durationMinutes} MIN
        </p>
        <p className="flex flex-wrap gap-1 m-0">
          <Chip tone={priorityTone(event.priority)}>{event.priority}</Chip>
          <Chip tone={VISIT_TONE[event.status] ?? 'estat estat-neutre'}>{event.status}</Chip>
          {event.taskStatus && (
            <Chip tone={TASK_TONE[event.taskStatus] ?? 'estat estat-neutre'}>
              TASCA {event.taskStatus}
            </Chip>
          )}
          <Chip tone={syncTone(event.syncState)}>{event.syncState ?? 'NO SINCRONITZAT'}</Chip>
        </p>
      </header>

      <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 m-0 text-[13px]">
        <Row label="ACCIÓ">{event.action}</Row>
        <Row label="COMERCIAL">{event.assignee ?? '—'}</Row>
        <Row label="UBICACIÓ">{event.locationLabel ?? 'SENSE UBICACIÓ'}</Row>
        <Row label="PRODUCTE">{event.productName ?? '—'}</Row>
        {mode === 'detalls' && (
          <>
            <Row label="OBJECTIU">{event.objective ?? '—'}</Row>
            <Row label="INFORMACIÓ IMPORTANT">{event.importantInfo ?? '—'}</Row>
            <Row label="RESULTAT">{event.result ?? '—'}</Row>
            <Row label="ORIGEN DEL DARRER CANVI">{event.syncOrigin ?? '—'}</Row>
            <Row label="DARRERA SINCRONITZACIÓ">
              {event.lastSyncedAt ? `${formatDate(event.lastSyncedAt)} ${formatTime(event.lastSyncedAt)}` : '—'}
            </Row>
            {event.syncError && <Row label="ERROR DE SINCRONITZACIÓ">{event.syncError}</Row>}
            {event.cancellationReason && (
              <Row label="MOTIU DE CANCEL·LACIÓ">
                {event.cancellationReason}
                {event.cancellationOrigin ? ` (${event.cancellationOrigin})` : ''}
              </Row>
            )}
          </>
        )}
      </dl>

      <div className="flex flex-wrap gap-2">
        <Link className="boto" href={`/clients/${event.clientId}`}>
          OBRIR FITXA
        </Link>
        <button
          type="button"
          className="boto"
          onClick={() => setMode(mode === 'detalls' ? 'none' : 'detalls')}
        >
          {mode === 'detalls' ? 'AMAGAR DETALLS' : 'VEURE DETALLS'}
        </button>
        {event.editable && !closed && (
          <>
            <button type="button" className="boto" onClick={() => setMode('reprogramar')}>
              REPROGRAMAR
            </button>
            <button type="button" className="boto" onClick={onEdit}>
              EDITAR
            </button>
            <button type="button" className="boto" onClick={() => setMode('completar')}>
              COMPLETAR
            </button>
            <button type="button" className="boto boto-perill" onClick={() => setMode('cancellar')}>
              CANCEL·LAR
            </button>
          </>
        )}
        {event.mapsUrl ? (
          <a className="boto" href={event.mapsUrl} target="_blank" rel="noreferrer">
            OBRIR UBICACIÓ
          </a>
        ) : (
          <button className="boto" type="button" disabled title="La visita no té cap adreça amb coordenades ni text.">
            OBRIR UBICACIÓ
          </button>
        )}
        {event.googleUrl ? (
          <a className="boto" href={event.googleUrl} target="_blank" rel="noreferrer">
            OBRIR A GOOGLE CALENDAR
          </a>
        ) : (
          <button
            className="boto"
            type="button"
            disabled
            title={
              googleConfigured
                ? googleConnected
                  ? 'Encara no s’ha creat l’esdeveniment a Google.'
                  : 'Aquest usuari no té cap compte de Google connectat.'
                : 'Google Calendar no està configurat en aquest entorn (falten GOOGLE_CLIENT_ID i GOOGLE_CLIENT_SECRET).'
            }
          >
            OBRIR A GOOGLE CALENDAR
          </button>
        )}
        <button
          type="button"
          className="boto"
          disabled={pending}
          onClick={() => {
            const fd = new FormData();
            fd.set('visitId', event.id);
            run(() => resyncVisit(fd));
          }}
        >
          RESINCRONITZAR
        </button>
      </div>

      {mode === 'reprogramar' && (
        <section className="targeta p-3 grid gap-2">
          <p className="etiqueta m-0">REPROGRAMAR</p>
          <label className="grid gap-1">
            <span className="etiqueta">NOVA DATA I HORA</span>
            <input
              className="camp"
              type="datetime-local"
              value={newStart}
              onChange={(e) => setNewStart(e.target.value)}
            />
          </label>
          <p className="text-[11px] text-[var(--color-ink-faint)] m-0">
            La durada es manté. La tasca associada es mou amb la visita i el canvi queda auditat.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="boto boto-principal"
              disabled={pending || !newStart}
              onClick={() => {
                const fd = new FormData();
                fd.set('visitId', event.id);
                fd.set('startsAt', newStart);
                run(() => rescheduleVisit(fd), () => setMode('none'));
              }}
            >
              DESAR
            </button>
            <button type="button" className="boto" onClick={() => setMode('none')}>
              TORNAR
            </button>
          </div>
        </section>
      )}

      {mode === 'completar' && (
        <section className="targeta p-3 grid gap-2">
          <p className="etiqueta m-0">COMPLETAR I REGISTRAR RESULTAT</p>
          <label className="grid gap-1">
            <span className="etiqueta">RESULTAT (obligatori)</span>
            <select className="camp" value={result} onChange={(e) => setResult(e.target.value)}>
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
            En completar-la, la tasca es tanca i l&apos;acció queda a l&apos;historial comercial de
            l&apos;empresa.
          </p>
          <div className="flex gap-2">
            <button
              type="button"
              className="boto boto-principal"
              disabled={pending || !result}
              onClick={() => {
                const fd = new FormData();
                fd.set('visitId', event.id);
                fd.set('result', result);
                fd.set('notes', notes);
                run(() => completeVisit(fd), () => setMode('none'));
              }}
            >
              DESAR
            </button>
            <button type="button" className="boto" onClick={() => setMode('none')}>
              TORNAR
            </button>
          </div>
        </section>
      )}

      {mode === 'cancellar' && (
        <section className="targeta p-3 grid gap-2">
          <p className="etiqueta m-0">CANCEL·LAR VISITA</p>
          <p className="text-[11px] text-[var(--color-ink-faint)] m-0">
            La visita passa a CANCEL·LADA i la tasca a CANCEL·LAT. No s&apos;esborra res:
            l&apos;historial es manté sencer.
          </p>
          <label className="grid gap-1">
            <span className="etiqueta">MOTIU (obligatori)</span>
            <textarea
              className="camp"
              rows={2}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
            />
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className="boto boto-perill"
              disabled={pending || !reason.trim()}
              onClick={() => {
                const fd = new FormData();
                fd.set('visitId', event.id);
                fd.set('reason', reason);
                run(() => cancelVisit(fd), () => setMode('none'));
              }}
            >
              CANCEL·LAR LA VISITA
            </button>
            <button type="button" className="boto" onClick={() => setMode('none')}>
              TORNAR
            </button>
          </div>
        </section>
      )}

      {error && <p className="error-camp m-0">{error}</p>}

      <div>
        <button type="button" className="boto" onClick={onClose}>
          TANCAR
        </button>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="etiqueta m-0">{label}</dt>
      <dd className="m-0">{children}</dd>
    </>
  );
}

// ---------------------------------------------------------------------------

function Dialog({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 bg-black/25 flex items-start justify-center p-4 pt-[6vh] overflow-y-auto"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="targeta w-full max-w-xl p-4 shadow-lg"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        {children}
      </div>
    </div>
  );
}
