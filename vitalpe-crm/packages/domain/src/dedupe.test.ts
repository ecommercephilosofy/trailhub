import { describe, expect, it } from 'vitest';
import { duplicateScore, isReviewCandidate, type DedupeCandidate } from './dedupe.js';
import { levenshtein, levenshteinSimilarity, trigramSimilarity, trigrams } from './similarity.js';

const base: DedupeCandidate = { name: 'Masia Romagosa S.L.' };

describe('trigramSimilarity (pg_trgm semantics)', () => {
  it('pads each word with two leading and one trailing space', () => {
    expect([...trigrams('abcd')].sort()).toEqual(['  a', ' ab', 'abc', 'bcd', 'cd ']);
  });

  it('scores identical strings 1', () => {
    expect(trigramSimilarity('Masia Romagosa', 'masia romagosa')).toBe(1);
  });

  it('scores a typo high and an unrelated name low', () => {
    expect(trigramSimilarity('Masia Romagosa', 'Masia Ramagosa')).toBeGreaterThan(0.5);
    expect(trigramSimilarity('Masia Romagosa', 'Caves Torelló')).toBeLessThan(0.1);
  });

  it('returns 0 when either side has no trigrams', () => {
    expect(trigramSimilarity('', 'abc')).toBe(0);
    expect(trigramSimilarity(null, null)).toBe(0);
  });
});

describe('levenshtein', () => {
  it('computes the classic distances', () => {
    expect(levenshtein('', '')).toBe(0);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('abc', '')).toBe(3);
    expect(levenshtein('romagosa', 'ramagosa')).toBe(1);
  });

  it('rescales to a similarity', () => {
    expect(levenshteinSimilarity('abc', 'abc')).toBe(1);
    expect(levenshteinSimilarity('', '')).toBe(1);
    expect(levenshteinSimilarity('abcd', 'abce')).toBeCloseTo(0.75, 5);
  });
});

describe('duplicateScore — deterministic (auto-merge allowed)', () => {
  it('same tax id', () => {
    const result = duplicateScore(
      { ...base, taxId: 'B-12345678' },
      { name: 'Completely Different Name', taxId: 'b12345678' },
    );
    expect(result.isDeterministic).toBe(true);
    expect(result.signals.taxIdMatch).toBe(true);
  });

  it('same corporate e-mail plus same normalised name', () => {
    const result = duplicateScore(
      { ...base, emails: ['Info@Celler.CAT'] },
      { name: 'Masia Romagosa SL', emails: ['info@celler.cat'] },
    );
    expect(result.isDeterministic).toBe(true);
    expect(result.signals.corporateEmailMatch).toBe(true);
  });

  it('same phone plus same normalised name', () => {
    const result = duplicateScore(
      { ...base, phones: ['938 91 23 45'] },
      { name: 'MASIA ROMAGOSA, S.L.U.', phones: ['+34938912345'] },
    );
    expect(result.isDeterministic).toBe(true);
    expect(result.signals.phoneMatch).toBe(true);
    expect(result.signals.nameExact).toBe(true);
  });
});

describe('duplicateScore — NOT deterministic (review queue)', () => {
  it('a free-provider e-mail is never an identity signal', () => {
    const result = duplicateScore(
      { ...base, emails: ['masiaromagosa@gmail.com'] },
      { name: 'Masia Romagosa SL', emails: ['masiaromagosa@gmail.com'] },
    );
    expect(result.signals.emailMatch).toBe(true);
    expect(result.signals.corporateEmailMatch).toBe(false);
    expect(result.isDeterministic).toBe(false);
  });

  it('same corporate e-mail but a different company name', () => {
    const result = duplicateScore(
      { ...base, emails: ['info@grup.cat'] },
      { name: 'Caves Torelló', emails: ['info@grup.cat'] },
    );
    expect(result.isDeterministic).toBe(false);
  });

  it('same phone but a different company name (a shared switchboard)', () => {
    const result = duplicateScore(
      { ...base, phones: ['938912345'] },
      { name: 'Vins del Penedès', phones: ['938912345'] },
    );
    expect(result.isDeterministic).toBe(false);
  });

  it('identical names alone are never enough', () => {
    const result = duplicateScore(base, { name: 'Masia Romagosa SL' });
    expect(result.signals.nameExact).toBe(true);
    expect(result.isDeterministic).toBe(false);
  });

  it('a conflicting field vetoes even a tax-id match', () => {
    const result = duplicateScore(
      { ...base, taxId: 'B12345678', province: 'Barcelona' },
      { name: 'Masia Romagosa SL', taxId: 'B12345678', province: 'Tarragona' },
    );
    expect(result.signals.taxIdMatch).toBe(true);
    expect(result.signals.provinceConflict).toBe(true);
    expect(result.isDeterministic).toBe(false);
  });

  it('a conflicting web domain vetoes a phone + name match', () => {
    const result = duplicateScore(
      { ...base, phones: ['938912345'], website: 'https://www.romagosa.cat' },
      { name: 'Masia Romagosa SL', phones: ['938912345'], website: 'https://altra.cat' },
    );
    expect(result.signals.webDomainConflict).toBe(true);
    expect(result.isDeterministic).toBe(false);
  });

  it('a differing tax id is a conflict, and drags the score down', () => {
    const withConflict = duplicateScore(
      { ...base, taxId: 'B11111111' },
      { name: 'Masia Romagosa SL', taxId: 'B22222222' },
    );
    const without = duplicateScore(base, { name: 'Masia Romagosa SL' });
    expect(withConflict.signals.taxIdConflict).toBe(true);
    expect(withConflict.score).toBeLessThan(without.score);
  });
});

describe('duplicateScore — scoring', () => {
  it('scores an obvious duplicate high', () => {
    const result = duplicateScore(
      {
        ...base,
        taxId: 'B12345678',
        phones: ['938912345'],
        emails: ['info@romagosa.cat'],
        website: 'www.romagosa.cat',
        municipality: 'Vilafranca del Penedès',
        province: 'Barcelona',
      },
      {
        name: 'MASIA ROMAGOSA SL',
        taxId: 'b-12345678',
        phones: ['+34 938 912 345'],
        emails: ['info@romagosa.cat'],
        website: 'https://romagosa.cat',
        municipality: 'VILAFRANCA DEL PENEDES',
        province: 'BARCELONA',
      },
    );
    expect(result.score).toBe(1);
    expect(result.isDeterministic).toBe(true);
  });

  it('scores two unrelated companies at zero', () => {
    const result = duplicateScore(base, { name: 'Bodegas Riojanas' });
    expect(result.score).toBe(0);
    expect(result.isDeterministic).toBe(false);
  });

  it('gives a doubtful pair a middling score and sends it to review', () => {
    const result = duplicateScore(
      { ...base, municipality: 'Vilafranca del Penedès' },
      { name: 'Masia Ramagosa', municipality: 'Vilafranca del Penedes' },
    );
    expect(result.signals.nameExact).toBe(false);
    expect(result.signals.nameSimilar).toBe(true);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(0.5);
    expect(result.isDeterministic).toBe(false);
  });

  it('finds a duplicate through an alias', () => {
    const result = duplicateScore(
      { name: 'Masia Romagosa', aliases: ['Cellers Romagosa'] },
      { name: 'CELLERS ROMAGOSA S.L.' },
    );
    expect(result.signals.aliasMatch).toBe(true);
    expect(result.score).toBeGreaterThan(0);
  });

  it('counts a shared contact person', () => {
    const result = duplicateScore(
      { ...base, contactNames: ['Jordi Ferrer'] },
      { name: 'Masia Romagosa SL', contactNames: ['JORDI FERRER'] },
    );
    expect(result.signals.sharedContact).toBe(true);
  });

  it('always stays inside 0..1 with 3 decimals, matching numeric(4,3)', () => {
    const result = duplicateScore(
      { ...base, taxId: 'B1', phones: ['938912345'], emails: ['a@x.cat'], website: 'x.cat', municipality: 'V', province: 'B', street: 'C/ Major 1', contactNames: ['A B'] },
      { name: 'Masia Romagosa SL', taxId: 'B1', phones: ['938912345'], emails: ['a@x.cat'], website: 'x.cat', municipality: 'V', province: 'B', street: 'c/ major 1', contactNames: ['a b'] },
    );
    expect(result.score).toBeLessThanOrEqual(1);
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result.score * 1000)).toBe(true);
  });

  it('is symmetric', () => {
    const a: DedupeCandidate = { ...base, phones: ['938912345'], municipality: 'Vilafranca' };
    const b: DedupeCandidate = { name: 'Masia Ramagosa', municipality: 'Vilafranca' };
    expect(duplicateScore(a, b).score).toBe(duplicateScore(b, a).score);
  });
});

describe('isReviewCandidate', () => {
  it('sends a doubtful pair to the queue and a deterministic one straight to merge', () => {
    const doubtful = duplicateScore(
      { ...base, municipality: 'Vilafranca' },
      { name: 'Masia Romagosa SLU', municipality: 'Vilafranca' },
    );
    expect(isReviewCandidate(doubtful)).toBe(true);

    const deterministic = duplicateScore(
      { ...base, taxId: 'B12345678' },
      { name: 'Masia Romagosa SL', taxId: 'B12345678' },
    );
    expect(isReviewCandidate(deterministic)).toBe(false);
  });

  it('ignores pairs below the threshold', () => {
    expect(isReviewCandidate(duplicateScore(base, { name: 'Bodegas Riojanas' }))).toBe(false);
  });
});
