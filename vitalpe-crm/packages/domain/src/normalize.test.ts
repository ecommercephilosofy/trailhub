import { describe, expect, it } from 'vitest';
import {
  btrimSpaces,
  domainOfEmail,
  isGenericEmailDomain,
  normalizeCompany,
  normalizeDomain,
  normalizeEmail,
  normalizePhone,
  normalizeText,
  unaccentCa,
} from './normalize.js';

/**
 * Every expectation in this file was verified against the real SQL functions
 * running in PostgreSQL (PGlite) — see the note in normalize.ts. If one of these
 * ever fails, the TypeScript twin has drifted from `app.normalize_*` and the
 * generated columns will disagree with the client.
 */

describe('btrimSpaces', () => {
  it('removes spaces only, like PostgreSQL btrim with no character set', () => {
    expect(btrimSpaces('  a b  ')).toBe('a b');
    expect(btrimSpaces('\ta\t')).toBe('\ta\t');
    expect(btrimSpaces('   ')).toBe('');
  });
});

describe('unaccentCa', () => {
  it('folds every character in the translate() table', () => {
    expect(unaccentCa('àáâäãåÀÁÂÄÃÅ')).toBe('aaaaaaAAAAAA');
    expect(unaccentCa('èéêëÈÉÊË')).toBe('eeeeEEEE');
    expect(unaccentCa('ìíîïÌÍÎÏ')).toBe('iiiiIIII');
    expect(unaccentCa('òóôöõÒÓÔÖÕ')).toBe('oooooOOOOO');
    expect(unaccentCa('ùúûüÙÚÛÜ')).toBe('uuuuUUUU');
    expect(unaccentCa('çÇñÑýÿÝŸ')).toBe('cCnNyyYY');
  });

  it('coalesces null to the empty string, as the SQL does', () => {
    expect(unaccentCa(null)).toBe('');
    expect(unaccentCa(undefined)).toBe('');
  });

  it('leaves characters outside the table untouched', () => {
    expect(unaccentCa('ß Œ 123')).toBe('ß Œ 123');
  });
});

describe('normalizeText', () => {
  it('lowercases, folds accents and collapses non-alphanumerics to one space', () => {
    expect(normalizeText('Sant Sadurní d’Anoia')).toBe('sant sadurni d anoia');
    expect(normalizeText('Peñíscola  ---  Ñandú')).toBe('peniscola nandu');
    expect(normalizeText('  Vinya   del   Mar  ')).toBe('vinya del mar');
  });

  it('returns null for empty results', () => {
    expect(normalizeText(null)).toBeNull();
    expect(normalizeText('')).toBeNull();
    expect(normalizeText('   ')).toBeNull();
    expect(normalizeText('!!!')).toBeNull();
  });
});

describe('normalizeCompany', () => {
  it('collapses the same company written with and without its legal form', () => {
    expect(normalizeCompany('MASIA ROMAGOSA S.L.')).toBe('masia romagosa');
    expect(normalizeCompany('Masia Romagosa SL')).toBe('masia romagosa');
    expect(normalizeCompany('masia romagosa, s.l.u.')).toBe('masia romagosa');
    expect(normalizeCompany('MASIA ROMAGOSA SLU')).toBe('masia romagosa');
  });

  it('handles the whole legal-form list', () => {
    expect(normalizeCompany('Caves Torelló S.A.')).toBe('caves torello');
    expect(normalizeCompany('Celler Bodegues S.A.U.')).toBe('celler bodegues');
    expect(normalizeCompany('Cooperativa Agrícola de Vilafranca SCCL')).toBe(
      'cooperativa agricola de vilafranca',
    );
    expect(normalizeCompany('Vins i Caves S.C.P.')).toBe('vins i caves');
    expect(normalizeCompany('Germans Puig C.B.')).toBe('germans puig');
    expect(normalizeCompany('Exemple Societat Limitada')).toBe('exemple');
    expect(normalizeCompany('Exemple Sociedad Anonima')).toBe('exemple');
  });

  it('uses POSIX longest-match on the alternation, exactly like PostgreSQL', () => {
    // "sl" appears earlier in the SQL list than "sl unipersonal", yet Postgres
    // consumes the longer alternative. Verified against PGlite.
    expect(normalizeCompany('Bodegas SL Unipersonal')).toBe('bodegas');
    expect(normalizeCompany('sl unipersonal')).toBeNull();
  });

  it('does not strip a second legal form that lost its leading space to the first', () => {
    // " sl " consumes the space that " sa " would have needed. Postgres behaves
    // the same way, so both end up as "masia sa".
    expect(normalizeCompany('masia sl sa')).toBe('masia sa');
  });

  it('returns null when nothing but a legal form is left', () => {
    expect(normalizeCompany('S.L.')).toBeNull();
    expect(normalizeCompany('SL')).toBeNull();
    expect(normalizeCompany('sa')).toBeNull();
    expect(normalizeCompany(null)).toBeNull();
  });
});

describe('normalizePhone', () => {
  it('adds +34 to a bare 9-digit Spanish number', () => {
    expect(normalizePhone('938 91 23 45')).toBe('+34938912345');
    expect(normalizePhone('638912345')).toBe('+34638912345');
    expect(normalizePhone('  938912345  ')).toBe('+34938912345');
  });

  it('keeps an existing international prefix', () => {
    expect(normalizePhone('+34 938 912 345')).toBe('+34938912345');
    expect(normalizePhone('+33 1 42 68 53 00')).toBe('+33142685300');
  });

  it('turns a 00 prefix into +', () => {
    expect(normalizePhone('0034938912345')).toBe('+34938912345');
  });

  it('drops a + that is not in first position', () => {
    expect(normalizePhone('++34938912345')).toBe('+34938912345');
    expect(normalizePhone('(+34) 938912345')).toBe('+34938912345');
  });

  it('leaves anything it does not recognise as plain digits', () => {
    expect(normalizePhone('12345')).toBe('12345');
    expect(normalizePhone('34938912345')).toBe('34938912345');
    expect(normalizePhone('938912345 ext 12')).toBe('93891234512');
  });

  it('returns null for nothing usable', () => {
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('+')).toBeNull();
    expect(normalizePhone('abc')).toBeNull();
  });
});

describe('normalizeEmail', () => {
  it('lowercases and trims spaces', () => {
    expect(normalizeEmail('  Info@Celler.CAT ')).toBe('info@celler.cat');
  });

  it('returns null for empty input', () => {
    expect(normalizeEmail(null)).toBeNull();
    expect(normalizeEmail('   ')).toBeNull();
  });
});

describe('normalizeDomain', () => {
  it('strips the protocol and a leading www.', () => {
    expect(normalizeDomain('https://www.celler.cat')).toBe('celler.cat');
    expect(normalizeDomain('www.celler.cat')).toBe('celler.cat');
    expect(normalizeDomain('ftp://files.celler.cat')).toBe('files.celler.cat');
  });

  it('keeps the path, because the SQL body does (its comment lies)', () => {
    expect(normalizeDomain('HTTP://CELLER.CAT/contacte')).toBe('celler.cat/contacte');
  });

  it('returns null for empty input', () => {
    expect(normalizeDomain(null)).toBeNull();
    expect(normalizeDomain('  ')).toBeNull();
  });
});

describe('domainOfEmail', () => {
  it('takes the part after the first @', () => {
    expect(domainOfEmail('Info@Celler.CAT')).toBe('celler.cat');
    expect(domainOfEmail('a@b@c.com')).toBe('b');
  });

  it('returns null when there is no domain', () => {
    expect(domainOfEmail('noatsign')).toBeNull();
    expect(domainOfEmail('x@')).toBeNull();
    expect(domainOfEmail(null)).toBeNull();
  });
});

describe('isGenericEmailDomain', () => {
  it('recognises the free providers listed in the SQL', () => {
    expect(isGenericEmailDomain('gmail.com')).toBe(true);
    expect(isGenericEmailDomain('me.com')).toBe(true);
    expect(isGenericEmailDomain('movistar.es')).toBe(true);
  });

  it('treats a company domain as an identity signal', () => {
    expect(isGenericEmailDomain('celler.cat')).toBe(false);
    expect(isGenericEmailDomain(null)).toBe(false);
    expect(isGenericEmailDomain('')).toBe(false);
  });

  it('is case sensitive because the SQL compares raw text', () => {
    expect(isGenericEmailDomain('GMAIL.COM')).toBe(false);
  });
});
