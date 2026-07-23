/**
 * Calendar arithmetic in Europe/Madrid.
 *
 * The calendar is a *civil* object: "Tuesday the 14th, 09:00" is what the user
 * moves around, and it must mean 09:00 in Madrid whether the server runs in UTC
 * (production) or in CET (a laptop). So every conversion goes through the two
 * functions below rather than through `new Date(string)`, which would silently
 * apply the server's zone and shift half the visits by an hour twice a year.
 *
 * A "civil" value here is a string: `YYYY-MM-DD` or `YYYY-MM-DDTHH:mm`.
 * Nothing in this file depends on the browser, so it is shared by the server
 * page, the server actions and the client grid.
 */

export const TZ = 'Europe/Madrid';

const CIVIL = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/;

/** Milliseconds Madrid is ahead of UTC at a given instant. */
export function offsetAt(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const read = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour') % 24,
    read('minute'),
    read('second'),
  );
  return asUtc - instant.getTime();
}

/**
 * Civil Madrid wall clock → instant.
 *
 * Two passes: the offset is evaluated at the candidate instant, which is right
 * on every day of the year including the two daylight-saving switches.
 */
export function civilToInstant(civil: string): Date | null {
  const match = CIVIL.exec(civil.trim());
  if (!match) {
    const fallback = new Date(civil);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  const naiveUtc = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4] ?? '0'),
    Number(match[5] ?? '0'),
  );
  let guess = naiveUtc;
  for (let pass = 0; pass < 2; pass += 1) guess = naiveUtc - offsetAt(new Date(guess));
  const result = new Date(guess);
  return Number.isNaN(result.getTime()) ? null : result;
}

const CIVIL_FMT = new Intl.DateTimeFormat('sv-SE', {
  timeZone: TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
});

/** Instant → `YYYY-MM-DDTHH:mm` in Madrid (the `datetime-local` shape). */
export function toCivilDateTime(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return CIVIL_FMT.format(date).replace(' ', 'T');
}

/** Instant → `YYYY-MM-DD` in Madrid. */
export function toCivilDate(value: string | Date): string {
  return toCivilDateTime(value).slice(0, 10);
}

export function todayCivil(now: Date = new Date()): string {
  return toCivilDate(now);
}

/** Minutes since midnight, in Madrid. */
export function minutesOfDay(value: string | Date): number {
  const civil = toCivilDateTime(value);
  return Number(civil.slice(11, 13)) * 60 + Number(civil.slice(14, 16));
}

// ---------------------------------------------------------------------------
// Pure civil-date arithmetic (no zone involved: a day is a day)
// ---------------------------------------------------------------------------

function civilParts(civil: string): [number, number, number] {
  const match = CIVIL.exec(civil);
  if (!match) {
    const today = todayCivil();
    return [Number(today.slice(0, 4)), Number(today.slice(5, 7)), Number(today.slice(8, 10))];
  }
  return [Number(match[1]), Number(match[2]), Number(match[3])];
}

function fromUtcDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function toUtcDay(civil: string): number {
  const [y, m, d] = civilParts(civil);
  return Date.UTC(y, m - 1, d);
}

export function addDays(civil: string, days: number): string {
  return fromUtcDay(toUtcDay(civil) + days * 86_400_000);
}

export function addMonths(civil: string, months: number): string {
  const [y, m, d] = civilParts(civil);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return fromUtcDay(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, lastDay)),
  );
}

/** 0 = Monday … 6 = Sunday, matching how a Catalan week is displayed. */
export function weekdayIndex(civil: string): number {
  return (new Date(toUtcDay(civil)).getUTCDay() + 6) % 7;
}

export function startOfWeek(civil: string): string {
  return addDays(civil, -weekdayIndex(civil));
}

export function startOfMonth(civil: string): string {
  const [y, m] = civilParts(civil);
  return fromUtcDay(Date.UTC(y, m - 1, 1));
}

export function daysInMonth(civil: string): number {
  const [y, m] = civilParts(civil);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export function isSameCivilDay(a: string | Date, b: string | Date): boolean {
  return toCivilDate(a) === toCivilDate(b);
}

// ---------------------------------------------------------------------------
// View windows
// ---------------------------------------------------------------------------

export type CalendarView = 'dia' | 'setmana' | 'mes' | 'agenda' | 'visites' | 'comercials';

export const VIEWS: readonly { id: CalendarView; label: string; managerOnly: boolean }[] = [
  { id: 'dia', label: 'DIA', managerOnly: false },
  { id: 'setmana', label: 'SETMANA', managerOnly: false },
  { id: 'mes', label: 'MES', managerOnly: false },
  { id: 'agenda', label: 'AGENDA', managerOnly: false },
  { id: 'visites', label: 'VISITES', managerOnly: true },
  { id: 'comercials', label: 'PER COMERCIAL', managerOnly: true },
];

export interface CivilWindow {
  /** Inclusive first civil day shown. */
  readonly fromCivil: string;
  /** Exclusive last civil day shown. */
  readonly toCivil: string;
  readonly from: Date;
  readonly to: Date;
  readonly days: readonly string[];
}

/** The civil days a view covers, and the instants that bound the query. */
export function windowFor(view: CalendarView, anchor: string): CivilWindow {
  let fromCivil = anchor;
  let dayCount = 1;

  switch (view) {
    case 'setmana':
      fromCivil = startOfWeek(anchor);
      dayCount = 7;
      break;
    case 'mes': {
      // The month grid always shows whole weeks, so the edges of the
      // neighbouring months are visible and droppable.
      const first = startOfMonth(anchor);
      fromCivil = startOfWeek(first);
      dayCount = Math.ceil((weekdayIndex(first) + daysInMonth(anchor)) / 7) * 7;
      break;
    }
    case 'agenda':
      dayCount = 30;
      break;
    case 'visites':
    case 'comercials':
      fromCivil = startOfWeek(anchor);
      dayCount = 28;
      break;
    case 'dia':
    default:
      dayCount = 1;
  }

  const toCivil = addDays(fromCivil, dayCount);
  const days: string[] = [];
  for (let i = 0; i < dayCount; i += 1) days.push(addDays(fromCivil, i));

  return {
    fromCivil,
    toCivil,
    from: civilToInstant(`${fromCivil}T00:00`) ?? new Date(),
    to: civilToInstant(`${toCivil}T00:00`) ?? new Date(),
    days,
  };
}

/** Where the previous/next arrows land for each view. */
export function shiftAnchor(view: CalendarView, anchor: string, direction: -1 | 1): string {
  switch (view) {
    case 'setmana':
      return addDays(anchor, 7 * direction);
    case 'mes':
      return addMonths(anchor, direction);
    case 'agenda':
      return addDays(anchor, 30 * direction);
    case 'visites':
    case 'comercials':
      return addDays(anchor, 28 * direction);
    case 'dia':
    default:
      return addDays(anchor, direction);
  }
}
