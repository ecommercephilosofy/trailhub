/**
 * Display formatting — the phone's twin of `apps/web/src/lib/format.ts`.
 *
 * Same rules: Europe/Madrid, DD/MM/YYYY, 24-hour clock, Catalan, litres with a
 * thousands separator, an em dash for "nothing".
 *
 * One deliberate difference: dates and times are built from
 * `zonedParts()` in `@vitalpe/domain` and from hard-coded Catalan month and
 * weekday names, instead of `Intl.DateTimeFormat('ca-ES')`. Hermes ships a
 * reduced ICU on Android and `ca-ES` is exactly the sort of locale that falls
 * back to English there, which would silently turn "dijous" into "Thursday" on
 * some devices and not others. The web output is the specification and these
 * tables reproduce it.
 *
 * Pure module: no React, no Expo, no I/O.
 */

import { DEFAULT_TIMEZONE, zonedParts } from '@vitalpe/domain';

export const TZ = DEFAULT_TIMEZONE;

const WEEKDAYS_CA = [
  'Diumenge',
  'Dilluns',
  'Dimarts',
  'Dimecres',
  'Dijous',
  'Divendres',
  'Dissabte',
] as const;

const MONTHS_CA = [
  'gener',
  'febrer',
  'març',
  'abril',
  'maig',
  'juny',
  'juliol',
  'agost',
  'setembre',
  'octubre',
  'novembre',
  'desembre',
] as const;

export const EMPTY = '—';

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `DD/MM/YYYY`. */
export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (date === null) return EMPTY;
  const p = zonedParts(date, TZ);
  return `${pad2(p.day)}/${pad2(p.month)}/${p.year}`;
}

/** `HH:MM`, 24 h. */
export function formatTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (date === null) return EMPTY;
  const p = zonedParts(date, TZ);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (date === null) return EMPTY;
  return `${formatDate(date)} ${formatTime(date)}`;
}

/** `10:00 – 11:30`, or just the start when the end is unknown. */
export function formatTimeRange(
  start: string | Date | null | undefined,
  end: string | Date | null | undefined,
): string {
  const from = formatTime(start);
  const to = formatTime(end);
  if (from === EMPTY) return EMPTY;
  return to === EMPTY ? from : `${from} – ${to}`;
}

/** "Dijous", capitalised like the web helper. */
export function formatWeekday(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (date === null) return '';
  const p = zonedParts(date, TZ);
  const index = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  return WEEKDAYS_CA[index] ?? '';
}

/** "Juliol 2026". */
export function formatMonth(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (date === null) return '';
  const p = zonedParts(date, TZ);
  const name = MONTHS_CA[p.month - 1] ?? '';
  return name === '' ? '' : `${name.charAt(0).toUpperCase()}${name.slice(1)} ${p.year}`;
}

/** "Dijous 23/07/2026" — the header of the day on INICI. */
export function formatLongDay(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (date === null) return EMPTY;
  return `${formatWeekday(date)} ${formatDate(date)}`;
}

function groupThousands(value: number): string {
  const rounded = Math.round(value);
  const negative = rounded < 0;
  const digits = String(Math.abs(rounded));
  let out = '';
  for (let i = 0; i < digits.length; i += 1) {
    if (i > 0 && (digits.length - i) % 3 === 0) out += '.';
    out += digits.charAt(i);
  }
  return negative ? `-${out}` : out;
}

/** `12.500 L` — Catalan uses a full stop as the thousands separator. */
export function formatLiters(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return EMPTY;
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return EMPTY;
  return `${groupThousands(n)} L`;
}

export function formatNumber(value: number | string | null | undefined): string {
  if (value === null || value === undefined || value === '') return '0';
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? groupThousands(n) : '0';
}

/**
 * "avui" / "demà" / "ahir" / "fa 3 dies" / "d'aquí a 2 dies".
 * Same wording as the web helper, with the clock passed in so it is testable.
 */
export function relativeDays(
  value: string | Date | null | undefined,
  now: Date = new Date(),
): string {
  const date = toDate(value);
  if (date === null) return EMPTY;
  const days = Math.round((date.getTime() - now.getTime()) / 86_400_000);
  if (days === 0) return 'avui';
  if (days === 1) return 'demà';
  if (days === -1) return 'ahir';
  return days < 0 ? `fa ${Math.abs(days)} dies` : `d'aquí a ${days} dies`;
}

/** "450 m" below a kilometre, "2,3 km" above it. */
export function formatDistance(meters: number | null | undefined): string {
  if (meters === null || meters === undefined || !Number.isFinite(meters)) return EMPTY;
  if (meters < 1000) return `${Math.round(meters)} m`;
  const km = meters / 1000;
  const rounded = km < 10 ? Math.round(km * 10) / 10 : Math.round(km);
  return `${String(rounded).replace('.', ',')} km`;
}

/** "1 min 20 s" for a voice note. */
export function formatDuration(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return EMPTY;
  const total = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return minutes === 0 ? `${rest} s` : `${minutes} min ${pad2(rest)} s`;
}
