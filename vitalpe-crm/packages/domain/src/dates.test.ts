import { describe, expect, it } from 'vitest';
import {
  addZonedDays,
  addZonedMonths,
  AMBIGUITIES,
  DEFAULT_DUE_HOUR,
  formatDateEs,
  formatTime24,
  isSameZonedDay,
  parseRelativeDate,
  startOfZonedDay,
  zonedParts,
  zonedWeekday,
} from './dates.js';

/** Reference instant: Thursday 23 July 2026, 12:00 Europe/Madrid (CEST, UTC+2). */
const NOW = new Date('2026-07-23T10:00:00Z');

const on = (text: string) => parseRelativeDate(text, NOW);
const day = (text: string): string | null => {
  const parsed = on(text);
  return parsed.date === null ? null : formatDateEs(parsed.date);
};

describe('time-zone primitives', () => {
  it('reads the wall clock in Europe/Madrid, not UTC', () => {
    expect(zonedParts(NOW)).toMatchObject({ year: 2026, month: 7, day: 23, hour: 12 });
  });

  it('knows the reference day is a Thursday', () => {
    expect(zonedWeekday(NOW)).toBe(4);
  });

  it('starts the day at local midnight', () => {
    expect(startOfZonedDay(NOW).toISOString()).toBe('2026-07-22T22:00:00.000Z');
  });

  it('adds days across a DST boundary without shifting the wall clock', () => {
    // 25 October 2026 is the CEST -> CET switch in Spain.
    const before = new Date('2026-10-24T08:00:00Z'); // 10:00 local
    const after = addZonedDays(before, 2);
    expect(formatTime24(after)).toBe('10:00');
    expect(formatDateEs(after)).toBe('26/10/2026');
  });

  it('clamps the day when adding months, like a PostgreSQL interval', () => {
    expect(formatDateEs(addZonedMonths(new Date('2026-01-31T10:00:00Z'), 1))).toBe('28/02/2026');
    expect(formatDateEs(addZonedMonths(new Date('2026-03-15T10:00:00Z'), -18))).toBe('15/09/2024');
  });

  it('compares calendar days in the zone, not in UTC', () => {
    const lateNight = new Date('2026-07-23T22:30:00Z'); // 00:30 on the 24th, local
    expect(isSameZonedDay(NOW, lateNight)).toBe(false);
  });
});

describe('formatting', () => {
  it('formats DD/MM/YYYY and HH:MM in Europe/Madrid', () => {
    expect(formatDateEs(NOW)).toBe('23/07/2026');
    expect(formatTime24(NOW)).toBe('12:00');
  });

  it('zero-pads', () => {
    const d = new Date('2026-01-05T07:05:00Z');
    expect(formatDateEs(d)).toBe('05/01/2026');
    expect(formatTime24(d)).toBe('08:05');
  });
});

describe('parseRelativeDate — explicit dates', () => {
  it('reads DD/MM/YYYY', () => {
    const parsed = on('Enviar preus el 15/03/2027');
    expect(formatDateEs(parsed.date as Date)).toBe('15/03/2027');
    expect(parsed.matchedText).toBe('15/03/2027');
    expect(parsed.ambiguity).toBeUndefined();
  });

  it('reads DD-MM-YY as 20YY', () => {
    expect(day('quedem el 15-03-27')).toBe('15/03/2027');
  });

  it('reads a past explicit date literally — it does not "helpfully" roll it forward', () => {
    expect(day('la comanda de 04/02/2024')).toBe('04/02/2024');
  });

  it('refuses a date that does not exist', () => {
    const parsed = on('el 31/02/2026');
    expect(parsed.date).toBeNull();
    expect(parsed.ambiguity).toBe(AMBIGUITIES.INVALID_DATE);
    expect(parsed.matchedText).toBe('31/02/2026');
  });

  it('applies the default hour when no time is given', () => {
    const parsed = on('15/03/2027');
    expect(zonedParts(parsed.date as Date).hour).toBe(DEFAULT_DUE_HOUR);
  });

  it('picks up an explicit time', () => {
    expect(formatTime24(on('15/03/2027 a les 16:30').date as Date)).toBe('16:30');
    expect(formatTime24(on('demà a les 18h').date as Date)).toBe('18:00');
  });
});

describe('parseRelativeDate — day and month names', () => {
  it('reads "el 3 d’octubre"', () => {
    expect(day('trucar el 3 d’octubre')).toBe('03/10/2026');
  });

  it('reads the Spanish form', () => {
    expect(day('llamar el 3 de octubre')).toBe('03/10/2026');
  });

  it('rolls to next year when the day has already passed this year', () => {
    expect(day('el 3 de gener')).toBe('03/01/2027');
  });

  it('honours an explicit year', () => {
    expect(day('15 de març de 2029')).toBe('15/03/2029');
  });

  it('folds the accent in "març"', () => {
    expect(day('1 de març')).toBe('01/03/2027');
  });
});

describe('parseRelativeDate — "a principis / mitjans / finals de <mes>"', () => {
  it('resolves to day 5, 15 and 25', () => {
    expect(day('a principis d’octubre')).toBe('05/10/2026');
    expect(day('a mitjans d’octubre')).toBe('15/10/2026');
    expect(day('a finals d’octubre')).toBe('25/10/2026');
  });

  it('accepts the Spanish forms', () => {
    expect(day('a principios de octubre')).toBe('05/10/2026');
    expect(day('a mediados de octubre')).toBe('15/10/2026');
    expect(day('a finales de octubre')).toBe('25/10/2026');
  });

  it('rolls to next year for a month already past', () => {
    expect(day('a principis de febrer')).toBe('05/02/2027');
  });

  it('refuses to guess when the month is missing', () => {
    const parsed = on('ho farem a principis');
    expect(parsed.date).toBeNull();
    expect(parsed.ambiguity).toBe(AMBIGUITIES.MONTH_PART_WITHOUT_MONTH);
  });
});

describe('parseRelativeDate — relative offsets', () => {
  it('reads "d’aquí a quinze dies"', () => {
    const parsed = on('d’aquí a quinze dies');
    expect(formatDateEs(parsed.date as Date)).toBe('07/08/2026');
    expect(parsed.matchedText).toBe('d’aquí a quinze dies');
  });

  it('reads digits as well as words', () => {
    expect(day('d’aquí a 15 dies')).toBe('07/08/2026');
  });

  it('reads weeks and months, in both languages', () => {
    expect(day('dentro de 2 semanas')).toBe('06/08/2026');
    expect(day('d’aquí a dues setmanes')).toBe('06/08/2026');
    expect(day('d’aquí a un mes')).toBe('23/08/2026');
    expect(day('dentro de 3 meses')).toBe('23/10/2026');
  });
});

describe('parseRelativeDate — "la setmana que ve"', () => {
  it('resolves to the Monday of next week', () => {
    expect(day('la setmana que ve')).toBe('27/07/2026');
    expect(day('la semana que viene')).toBe('27/07/2026');
    expect(day('la propera setmana')).toBe('27/07/2026');
    expect(day('la próxima semana')).toBe('27/07/2026');
  });

  it('resolves "el mes que ve" to the first of next month', () => {
    expect(day('el mes que ve')).toBe('01/08/2026');
    expect(day('el mes que viene')).toBe('01/08/2026');
  });
});

describe('parseRelativeDate — weekday names', () => {
  it('resolves to the next occurrence, in both languages', () => {
    expect(day('dilluns')).toBe('27/07/2026');
    expect(day('el lunes')).toBe('27/07/2026');
    expect(day('divendres')).toBe('24/07/2026');
    expect(day('el viernes')).toBe('24/07/2026');
    expect(day('dissabte')).toBe('25/07/2026');
    expect(day('diumenge')).toBe('26/07/2026');
  });

  it('naming today’s weekday means next week, never today', () => {
    expect(day('dijous')).toBe('30/07/2026');
    expect(day('el jueves')).toBe('30/07/2026');
  });

  it('accepts a "que ve" modifier', () => {
    expect(day('dimarts que ve')).toBe('28/07/2026');
  });

  it('folds accents in Spanish weekday names', () => {
    expect(day('el miércoles')).toBe('29/07/2026');
    expect(day('el sábado')).toBe('25/07/2026');
  });
});

describe('parseRelativeDate — demà / avui', () => {
  it('reads demà and mañana', () => {
    expect(day('demà')).toBe('24/07/2026');
    expect(day('mañana')).toBe('24/07/2026');
  });

  it('reads demà passat and pasado mañana', () => {
    expect(day('demà passat')).toBe('25/07/2026');
    expect(day('pasado mañana')).toBe('25/07/2026');
  });

  it('reads avui and hoy', () => {
    expect(day('avui')).toBe('23/07/2026');
    expect(day('hoy')).toBe('23/07/2026');
  });

  it('does not fire on a word that merely starts with "dema"', () => {
    const parsed = on('demanar preus');
    expect(parsed.date).toBeNull();
    expect(parsed.ambiguity).toBeUndefined();
  });
});

describe('parseRelativeDate — things it refuses to guess', () => {
  it('never turns "verema" into a date', () => {
    for (const text of ['després de verema', 'després de la verema', 'VEREMA', 'después de la vendimia']) {
      const parsed = parseRelativeDate(text, NOW);
      expect(parsed.date, text).toBeNull();
      expect(parsed.ambiguity, text).toBe(AMBIGUITIES.VEREMA);
      expect(parsed.matchedText.length, text).toBeGreaterThan(0);
    }
  });

  it('flags vague expressions instead of inventing a day', () => {
    for (const text of ['ja ho veurem més endavant', 'lo vemos más adelante', 'quan pugui', 'cuando pueda', 'aviat', 'pronto']) {
      const parsed = parseRelativeDate(text, NOW);
      expect(parsed.date, text).toBeNull();
      expect(parsed.ambiguity, text).toBe(AMBIGUITIES.VAGUE);
    }
  });

  it('prefers a concrete date over a vague expression in the same sentence', () => {
    const parsed = on('després de verema, però mirem-ho el 3/10/2026');
    expect(formatDateEs(parsed.date as Date)).toBe('03/10/2026');
    expect(parsed.ambiguity).toBeUndefined();
  });

  it('says nothing at all when there is no temporal expression', () => {
    expect(on('Trucar a la Masia Romagosa')).toEqual({ date: null, matchedText: '' });
    expect(on('')).toEqual({ date: null, matchedText: '' });
  });
});

describe('parseRelativeDate — matchedText', () => {
  it('returns the ORIGINAL substring, accents and all', () => {
    expect(on('quedem dimecres a la tarda').matchedText).toBe('dimecres');
    expect(on('parlem la setmana que ve').matchedText).toBe('la setmana que ve');
    expect(on('a principis d’octubre').matchedText).toBe('a principis d’octubre');
    expect(on('el sábado').matchedText).toBe('el sábado');
  });
});

describe('parseRelativeDate — time zone', () => {
  it('honours a different zone for the same instant', () => {
    // 23:30 UTC on the 23rd is still the 23rd in Madrid? No: 01:30 on the 24th.
    const lateNight = new Date('2026-07-23T23:30:00Z');
    expect(formatDateEs(parseRelativeDate('avui', lateNight).date as Date)).toBe('24/07/2026');
    expect(
      formatDateEs(
        parseRelativeDate('avui', lateNight, 'UTC').date as Date,
        'UTC',
      ),
    ).toBe('23/07/2026');
  });

  it('accepts a custom default hour', () => {
    const parsed = parseRelativeDate('demà', NOW, 'Europe/Madrid', { defaultHour: 8, defaultMinute: 30 });
    expect(formatTime24(parsed.date as Date)).toBe('08:30');
  });
});
