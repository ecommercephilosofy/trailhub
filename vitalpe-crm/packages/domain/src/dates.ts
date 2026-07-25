/**
 * Deterministic date parsing for REGISTRE RÀPID, and the no-AI fallback for
 * voice notes.
 *
 * The governing rule is NEVER GUESS. Anything that a careful human would have
 * to ask about — "després de verema", "més endavant", "a principis" with no
 * month — comes back as `date: null` plus an ambiguity string, which the UI
 * shows as a question instead of silently inventing a due date.
 *
 * All arithmetic is done in a real IANA zone (Europe/Madrid by default) via
 * `Intl`, so DST transitions do not shift a due date by an hour.
 */

import { unaccentCa } from './normalize';

export const DEFAULT_TIMEZONE = 'Europe/Madrid';

/** Hour a bare calendar date resolves to when the text carries no time. */
export const DEFAULT_DUE_HOUR = 9;

/** Day-of-month used by "a principis / mitjans / finals de <mes>". */
export const MONTH_PART_DAYS = Object.freeze({ principis: 5, mitjans: 15, finals: 25 });

/** The exact ambiguity messages, exported so callers can match on them. */
export const AMBIGUITIES = Object.freeze({
  VEREMA:
    'La verema no és una data concreta: cal confirmar el dia abans de crear res.',
  VAGUE: 'Expressió de temps massa vaga: cal una data concreta.',
  MONTH_PART_WITHOUT_MONTH:
    'Falta el mes: «a principis / mitjans / finals» sol no determina cap data.',
  INVALID_DATE: 'La data escrita no existeix al calendari.',
});

// ---------------------------------------------------------------------------
// Time-zone primitives
// ---------------------------------------------------------------------------

export interface ZonedParts {
  year: number;
  month: number; // 1..12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let formatter = FORMATTERS.get(timeZone);
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    FORMATTERS.set(timeZone, formatter);
  }
  return formatter;
}

/** Calendar fields of `date` as seen in `timeZone`. */
export function zonedParts(date: Date, timeZone: string = DEFAULT_TIMEZONE): ZonedParts {
  const parts = partsFormatter(timeZone).formatToParts(date);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const found = parts.find((p) => p.type === type);
    return found === undefined ? 0 : Number.parseInt(found.value, 10);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    hour: read('hour'),
    minute: read('minute'),
    second: read('second'),
  };
}

function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/**
 * Builds the instant at which `timeZone` shows these calendar fields.
 * Out-of-range values overflow the way `Date.UTC` does (day 32 -> next month).
 */
export function zonedDate(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
  second = 0,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const guess = Date.UTC(year, month - 1, day, hour, minute, second);
  let ts = guess - offsetMs(new Date(guess), timeZone);
  ts = guess - offsetMs(new Date(ts), timeZone); // second pass settles DST edges
  return new Date(ts);
}

/** Midnight of `date`'s day, in `timeZone`. */
export function startOfZonedDay(date: Date, timeZone: string = DEFAULT_TIMEZONE): Date {
  const p = zonedParts(date, timeZone);
  return zonedDate(p.year, p.month, p.day, 0, 0, 0, timeZone);
}

/** Same calendar day in `timeZone`? */
export function isSameZonedDay(a: Date, b: Date, timeZone: string = DEFAULT_TIMEZONE): boolean {
  const pa = zonedParts(a, timeZone);
  const pb = zonedParts(b, timeZone);
  return pa.year === pb.year && pa.month === pb.month && pa.day === pb.day;
}

/** Day of week in `timeZone`: 0 = Sunday … 6 = Saturday (as `Date#getDay`). */
export function zonedWeekday(date: Date, timeZone: string = DEFAULT_TIMEZONE): number {
  const p = zonedParts(date, timeZone);
  return new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
}

/** Adds whole days in `timeZone`, keeping the wall-clock time. */
export function addZonedDays(
  date: Date,
  days: number,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const p = zonedParts(date, timeZone);
  return zonedDate(p.year, p.month, p.day + days, p.hour, p.minute, p.second, timeZone);
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * Adds whole months the way PostgreSQL's `+ interval 'n months'` does: the day
 * of month is CLAMPED to the target month rather than overflowing, so
 * 31 January + 1 month is 28 February, not 3 March.
 */
export function addZonedMonths(
  date: Date,
  months: number,
  timeZone: string = DEFAULT_TIMEZONE,
): Date {
  const p = zonedParts(date, timeZone);
  const absolute = p.year * 12 + (p.month - 1) + months;
  const year = Math.floor(absolute / 12);
  const month = (absolute % 12) + 1;
  const day = Math.min(p.day, daysInMonth(year, month));
  return zonedDate(year, month, day, p.hour, p.minute, p.second, timeZone);
}

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

function pad2(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** `DD/MM/YYYY` in Europe/Madrid (the format every Vitalpe document uses). */
export function formatDateEs(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const p = zonedParts(date, timeZone);
  return `${pad2(p.day)}/${pad2(p.month)}/${p.year}`;
}

/** `HH:MM`, 24 h, in Europe/Madrid. */
export function formatTime24(date: Date, timeZone: string = DEFAULT_TIMEZONE): string {
  const p = zonedParts(date, timeZone);
  return `${pad2(p.hour)}:${pad2(p.minute)}`;
}

// ---------------------------------------------------------------------------
// Lexicon (Catalan + Spanish, accent-folded)
// ---------------------------------------------------------------------------

/** Weekday word -> `Date#getDay` index. Written accent-folded and lowercase. */
const WEEKDAYS: ReadonlyMap<string, number> = new Map([
  ['diumenge', 0],
  ['domingo', 0],
  ['dilluns', 1],
  ['lunes', 1],
  ['dimarts', 2],
  ['martes', 2],
  ['dimecres', 3],
  ['miercoles', 3],
  ['dijous', 4],
  ['jueves', 4],
  ['divendres', 5],
  ['viernes', 5],
  ['dissabte', 6],
  ['sabado', 6],
]);

/** Month word -> 1..12, accent-folded. */
const MONTHS: ReadonlyMap<string, number> = new Map([
  ['gener', 1],
  ['enero', 1],
  ['febrer', 2],
  ['febrero', 2],
  ['marc', 3],
  ['marzo', 3],
  ['abril', 4],
  ['maig', 5],
  ['mayo', 5],
  ['juny', 6],
  ['junio', 6],
  ['juliol', 7],
  ['julio', 7],
  ['agost', 8],
  ['agosto', 8],
  ['setembre', 9],
  ['septiembre', 9],
  ['setiembre', 9],
  ['octubre', 10],
  ['novembre', 11],
  ['noviembre', 11],
  ['desembre', 12],
  ['diciembre', 12],
]);

/** Spelled-out small numbers, Catalan and Spanish. */
const NUMBER_WORDS: ReadonlyMap<string, number> = new Map([
  ['un', 1],
  ['una', 1],
  ['uno', 1],
  ['dos', 2],
  ['dues', 2],
  ['tres', 3],
  ['quatre', 4],
  ['cuatro', 4],
  ['cinc', 5],
  ['cinco', 5],
  ['sis', 6],
  ['seis', 6],
  ['set', 7],
  ['siete', 7],
  ['vuit', 8],
  ['ocho', 8],
  ['nou', 9],
  ['nueve', 9],
  ['deu', 10],
  ['diez', 10],
  ['onze', 11],
  ['once', 11],
  ['dotze', 12],
  ['doce', 12],
  ['tretze', 13],
  ['trece', 13],
  ['catorze', 14],
  ['catorce', 14],
  ['quinze', 15],
  ['quince', 15],
  ['vint', 20],
  ['veinte', 20],
  ['trenta', 30],
  ['treinta', 30],
]);

const WEEKDAY_ALT = [...WEEKDAYS.keys()].sort((a, b) => b.length - a.length).join('|');
const MONTH_ALT = [...MONTHS.keys()].sort((a, b) => b.length - a.length).join('|');
const NUMBER_WORD_ALT = [...NUMBER_WORDS.keys()].sort((a, b) => b.length - a.length).join('|');

const APOSTROPHES = new Set(['’', '´', '`', 'ʼ']);

/**
 * Accent-folds and lowercases while preserving the string length, so a match
 * index into the folded text still points at the right place in the original.
 */
export function foldForMatch(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (APOSTROPHES.has(ch)) {
      out += "'";
      continue;
    }
    const folded = unaccentCa(ch).toLowerCase();
    if (folded.length === 1) {
      out += folded;
      continue;
    }
    const lowered = ch.toLowerCase();
    out += lowered.length === 1 ? lowered : ch;
  }
  return out;
}

// ---------------------------------------------------------------------------
// parseRelativeDate
// ---------------------------------------------------------------------------

export interface ParsedDate {
  /** The resolved instant, or null when nothing concrete could be determined. */
  date: Date | null;
  /** Present only when the text DID mention time but refused to be pinned down. */
  ambiguity?: string;
  /** The exact substring of the ORIGINAL text that produced this result. */
  matchedText: string;
}

export interface ParseRelativeDateOptions {
  /** Hour applied when the text names a day but no time. Default 9. */
  defaultHour?: number;
  defaultMinute?: number;
}

interface TimeOfDay {
  hour: number;
  minute: number;
}

/** Finds an explicit clock time: "10:30", "a les 10h", "18 h". */
function extractTime(haystack: string, excludeFrom = -1, excludeTo = -1): TimeOfDay | null {
  const colon = /\b([01]?\d|2[0-3]):([0-5]\d)\b/g;
  let match: RegExpExecArray | null;
  while ((match = colon.exec(haystack)) !== null) {
    if (match.index >= excludeFrom && match.index < excludeTo) continue;
    return { hour: Number.parseInt(match[1] as string, 10), minute: Number.parseInt(match[2] as string, 10) };
  }
  const bare = /\b([01]?\d|2[0-3])\s*h\b/g;
  while ((match = bare.exec(haystack)) !== null) {
    if (match.index >= excludeFrom && match.index < excludeTo) continue;
    return { hour: Number.parseInt(match[1] as string, 10), minute: 0 };
  }
  return null;
}

/**
 * Parses the FIRST concrete date expression in `text`.
 *
 * Concrete expressions always win over vague ones: "després de verema, el
 * 3/10/2026" resolves to 3 October 2026. Only when nothing concrete is present
 * does a vague expression produce an ambiguity.
 *
 * @param text  free text, Catalan or Spanish
 * @param now   the reference instant ("today")
 * @param timezone IANA zone used for all calendar arithmetic
 */
export function parseRelativeDate(
  text: string,
  now: Date = new Date(),
  timezone: string = DEFAULT_TIMEZONE,
  options: ParseRelativeDateOptions = {},
): ParsedDate {
  const hour = options.defaultHour ?? DEFAULT_DUE_HOUR;
  const minute = options.defaultMinute ?? 0;
  const haystack = foldForMatch(text ?? '');
  const today = startOfZonedDay(now, timezone);
  const todayParts = zonedParts(now, timezone);

  const original = (start: number, length: number): string => text.slice(start, start + length);

  const at = (
    year: number,
    month: number,
    day: number,
    time: TimeOfDay | null,
  ): Date =>
    zonedDate(year, month, day, time?.hour ?? hour, time?.minute ?? minute, 0, timezone);

  // -- 1. explicit numeric date: DD/MM/YYYY, DD-MM-YY, DD.MM.YYYY ----------
  {
    const re = /\b(\d{1,2})([/\-.])(\d{1,2})\2(\d{4}|\d{2})\b/;
    const m = re.exec(haystack);
    if (m !== null) {
      const day = Number.parseInt(m[1] as string, 10);
      const month = Number.parseInt(m[3] as string, 10);
      const rawYear = m[4] as string;
      const year = rawYear.length === 2 ? 2000 + Number.parseInt(rawYear, 10) : Number.parseInt(rawYear, 10);
      const matchedText = original(m.index, m[0].length);
      if (month < 1 || month > 12 || day < 1 || day > daysInMonth(year, month)) {
        return { date: null, ambiguity: AMBIGUITIES.INVALID_DATE, matchedText };
      }
      const time = extractTime(haystack, m.index, m.index + m[0].length);
      return { date: at(year, month, day, time), matchedText };
    }
  }

  // -- 2. "el 3 d'octubre", "3 de octubre de 2027" -------------------------
  {
    const re = new RegExp(
      String.raw`\b(\d{1,2})\s*(?:d'|de\s+|del\s+)?(${MONTH_ALT})\b(?:\s+(?:de|del)\s+(\d{4}))?`,
    );
    const m = re.exec(haystack);
    if (m !== null) {
      const day = Number.parseInt(m[1] as string, 10);
      const month = MONTHS.get(m[2] as string) as number;
      const matchedText = original(m.index, m[0].length);
      const explicitYear = m[3] === undefined ? null : Number.parseInt(m[3], 10);
      if (day < 1 || day > 31) {
        return { date: null, ambiguity: AMBIGUITIES.INVALID_DATE, matchedText };
      }
      const time = extractTime(haystack, m.index, m.index + m[0].length);
      if (explicitYear !== null) {
        if (day > daysInMonth(explicitYear, month)) {
          return { date: null, ambiguity: AMBIGUITIES.INVALID_DATE, matchedText };
        }
        return { date: at(explicitYear, month, day, time), matchedText };
      }
      let year = todayParts.year;
      if (day > daysInMonth(year, month)) year += 1;
      let candidate = at(year, month, day, time);
      if (candidate.getTime() < today.getTime()) {
        year += 1;
        if (day > daysInMonth(year, month)) {
          return { date: null, ambiguity: AMBIGUITIES.INVALID_DATE, matchedText };
        }
        candidate = at(year, month, day, time);
      }
      return { date: candidate, matchedText };
    }
  }

  // -- 3. "a principis / mitjans / finals de <mes>" ------------------------
  {
    const re = new RegExp(
      String.raw`\ba\s+(principis|principios|mitjans|mediados|finals|finales)\s+(?:d'|de\s+|del\s+)?(${MONTH_ALT})\b`,
    );
    const m = re.exec(haystack);
    if (m !== null) {
      const word = m[1] as string;
      const day =
        word.startsWith('princip')
          ? MONTH_PART_DAYS.principis
          : word.startsWith('mit') || word.startsWith('med')
            ? MONTH_PART_DAYS.mitjans
            : MONTH_PART_DAYS.finals;
      const month = MONTHS.get(m[2] as string) as number;
      const matchedText = original(m.index, m[0].length);
      const time = extractTime(haystack, m.index, m.index + m[0].length);
      let year = todayParts.year;
      let candidate = at(year, month, day, time);
      if (candidate.getTime() < today.getTime()) {
        year += 1;
        candidate = at(year, month, day, time);
      }
      return { date: candidate, matchedText };
    }
  }

  // -- 4. "d'aquí a quinze dies", "dentro de 2 semanas", "d'aquí a un mes" --
  {
    // Units are listed longest-first so "meses" is never truncated to "mes".
    const re = new RegExp(
      String.raw`\b(?:d'aqui\s+a|d\s*aqui\s+a|dintre\s+de|dins\s+de|dentro\s+de|en)\s+(\d{1,3}|${NUMBER_WORD_ALT})\s+(setmanes|setmana|semanas|semana|mesos|meses|dies|dias|mes|dia)\b`,
    );
    const m = re.exec(haystack);
    if (m !== null) {
      const raw = m[1] as string;
      const amount = /^\d+$/.test(raw)
        ? Number.parseInt(raw, 10)
        : (NUMBER_WORDS.get(raw) as number);
      const unit = m[2] as string;
      const matchedText = original(m.index, m[0].length);
      const time = extractTime(haystack, m.index, m.index + m[0].length);
      if (unit === 'mesos' || unit === 'meses' || unit === 'mes') {
        const absolute = todayParts.year * 12 + (todayParts.month - 1) + amount;
        const year = Math.floor(absolute / 12);
        const month = (absolute % 12) + 1;
        return {
          date: at(year, month, Math.min(todayParts.day, daysInMonth(year, month)), time),
          matchedText,
        };
      }
      const isWeeks =
        unit === 'setmanes' || unit === 'setmana' || unit === 'semanas' || unit === 'semana';
      const days = isWeeks ? amount * 7 : amount;
      return {
        date: at(todayParts.year, todayParts.month, todayParts.day + days, time),
        matchedText,
      };
    }
  }

  // -- 5. "la setmana que ve" / "el mes que ve" ----------------------------
  {
    const re =
      /\b(?:la\s+|el\s+)?(?:(?:propera|proxima|proper|proxim)\s+(setmana|semana|mes)|(setmana|semana|mes)\s+(?:que\s+ve|que\s+viene|vinent|proxima|proxim|proximo))\b/;
    const m = re.exec(haystack);
    if (m !== null) {
      const unit = (m[1] ?? m[2]) as string;
      const matchedText = original(m.index, m[0].length);
      const time = extractTime(haystack, m.index, m.index + m[0].length);
      if (unit === 'mes') {
        return { date: at(todayParts.year, todayParts.month + 1, 1, time), matchedText };
      }
      // Monday of next week: Monday of this week + 7 days.
      const weekday = zonedWeekday(now, timezone);
      const backToMonday = (weekday + 6) % 7;
      return {
        date: at(todayParts.year, todayParts.month, todayParts.day - backToMonday + 7, time),
        matchedText,
      };
    }
  }

  // -- 6. weekday names ----------------------------------------------------
  {
    const re = new RegExp(String.raw`\b(?:el\s+|els\s+|aquest\s+|este\s+)?(${WEEKDAY_ALT})\b`);
    const m = re.exec(haystack);
    if (m !== null) {
      const target = WEEKDAYS.get(m[1] as string) as number;
      const matchedText = original(m.index, m[0].length);
      const time = extractTime(haystack, m.index, m.index + m[0].length);
      const current = zonedWeekday(now, timezone);
      // Strictly the NEXT occurrence: naming today's weekday means next week.
      let delta = (target - current + 7) % 7;
      if (delta === 0) delta = 7;
      return {
        date: at(todayParts.year, todayParts.month, todayParts.day + delta, time),
        matchedText,
      };
    }
  }

  // -- 7. "demà passat" / "pasado mañana" ----------------------------------
  {
    const re = /\b(?:dema\s+passat|passat\s+dema|pasado\s+manana|manana\s+pasado)\b/;
    const m = re.exec(haystack);
    if (m !== null) {
      const matchedText = original(m.index, m[0].length);
      const time = extractTime(haystack, m.index, m.index + m[0].length);
      return {
        date: at(todayParts.year, todayParts.month, todayParts.day + 2, time),
        matchedText,
      };
    }
  }

  // -- 8. "demà" / "mañana" ------------------------------------------------
  {
    const re = /\b(?:dema|manana)\b/;
    const m = re.exec(haystack);
    if (m !== null) {
      const matchedText = original(m.index, m[0].length);
      const time = extractTime(haystack, m.index, m.index + m[0].length);
      return {
        date: at(todayParts.year, todayParts.month, todayParts.day + 1, time),
        matchedText,
      };
    }
  }

  // -- 9. "avui" / "hoy" ---------------------------------------------------
  {
    const re = /\b(?:avui|hoy)\b/;
    const m = re.exec(haystack);
    if (m !== null) {
      const matchedText = original(m.index, m[0].length);
      const time = extractTime(haystack, m.index, m.index + m[0].length);
      return {
        date: at(todayParts.year, todayParts.month, todayParts.day, time),
        matchedText,
      };
    }
  }

  // -- 10. things we refuse to guess ---------------------------------------
  {
    const verema = /\b(?:despres\s+de\s+(?:la\s+)?)?(?:veremes|verema|vendimias|vendimia)\b/.exec(
      haystack,
    );
    if (verema !== null) {
      return {
        date: null,
        ambiguity: AMBIGUITIES.VEREMA,
        matchedText: original(verema.index, verema[0].length),
      };
    }

    const monthPart = /\ba\s+(?:principis|principios|mitjans|mediados|finals|finales)\b/.exec(
      haystack,
    );
    if (monthPart !== null) {
      return {
        date: null,
        ambiguity: AMBIGUITIES.MONTH_PART_WITHOUT_MONTH,
        matchedText: original(monthPart.index, monthPart[0].length),
      };
    }

    const vague =
      /\b(?:mes\s+endavant|mas\s+adelante|quan\s+pugui|quan\s+puguem|cuando\s+pueda|cuando\s+puedan|aviat|pronto|properament|proximamente|un\s+altre\s+dia|otro\s+dia)\b/.exec(
        haystack,
      );
    if (vague !== null) {
      return {
        date: null,
        ambiguity: AMBIGUITIES.VAGUE,
        matchedText: original(vague.index, vague[0].length),
      };
    }
  }

  // No temporal expression at all: not an ambiguity, simply nothing to say.
  return { date: null, matchedText: '' };
}
