/**
 * Value normalisation for the import.
 *
 * Two hard rules apply to everything in this file:
 *  1. A value is either read from the source or left empty. Nothing is guessed.
 *  2. Every transformation returns the rule it applied, so `field_provenance`
 *     can record *why* a stored value differs from the original cell.
 */

export interface Normalized<T> {
  value: T | null;
  rule: string;
  /** Set when the source value could not be mapped and needs human review. */
  unmapped?: { kind: 'PRODUCTE' | 'CAMPANYA' | 'TIPUS EMPRESA' | 'RESULTAT' | 'ACCIO' | 'ALTRES'; raw: string };
}

const ok = <T>(value: T | null, rule: string): Normalized<T> => ({ value, rule });

export function clean(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  const trimmed = input.replace(/\s+/g, ' ').trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * Volumes arrive as "25780", "25780.0", "  23.590   " and "1.080".
 * `23.590` is 23 590 litres written with a Spanish thousands separator, not
 * 23.59 — the pattern `\d{1,3}(\.\d{3})+` is unambiguous, so it is handled
 * explicitly and every other shape goes through a plain float parse.
 */
export function parseLiters(input: string | null | undefined): Normalized<number> {
  const raw = clean(input);
  if (raw === null) return ok(null, 'buit');
  const compact = raw.replace(/\s/g, '');
  if (/^\d{1,3}(\.\d{3})+$/.test(compact)) {
    return ok(Number(compact.replace(/\./g, '')), 'separador de milers ES');
  }
  if (/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(compact)) {
    return ok(Number(compact.replace(/,/g, '')), 'separador de milers EN');
  }
  const n = Number(compact.replace(/,/g, '.'));
  if (!Number.isFinite(n) || n <= 0) {
    return { value: null, rule: 'no numèric', unmapped: { kind: 'ALTRES', raw } };
  }
  return ok(Math.round(n * 100) / 100, 'numèric');
}

/** ISO timestamps (from real Excel dates), DD/MM/YYYY and D/M/YYYY text. */
export function parseDate(input: string | null | undefined): Normalized<string> {
  const raw = clean(input);
  if (raw === null) return ok(null, 'buit');

  const iso = /^(\d{4})-(\d{2})-(\d{2})([T ]|$)/.exec(raw);
  if (iso) return ok(`${iso[1]}-${iso[2]}-${iso[3]}`, 'ISO');

  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/.exec(raw);
  if (dmy) {
    const d = Number(dmy[1]);
    const m = Number(dmy[2]);
    let y = Number(dmy[3]);
    if (y < 100) y += y < 70 ? 2000 : 1900;
    if (d >= 1 && d <= 31 && m >= 1 && m <= 12) {
      return ok(`${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`, 'DD/MM/YYYY');
    }
  }
  // "VEREMA" and similar are real content, not dates: they become an undated
  // task carrying the original text.
  return { value: null, rule: 'no és una data', unmapped: { kind: 'ALTRES', raw } };
}

/** Harvest-to-harvest campaign: 1 August .. 31 July. */
export function campaignForDate(isoDate: string): string {
  const [y, m] = isoDate.split('-').map(Number);
  const year = y as number;
  const month = m as number;
  return month >= 8 ? `${year}-${year + 1}` : `${year - 1}-${year}`;
}

export function parsePriority(input: string | null | undefined): Normalized<'ALTA' | 'MITJANA' | 'BAIXA'> {
  const raw = clean(input)?.toUpperCase();
  if (!raw) return ok(null, 'buit');
  if (raw === 'A' || raw === 'ALTA') return ok('ALTA', 'prioritat A');
  if (raw === 'B' || raw === 'MITJANA' || raw === 'MEDIA') return ok('MITJANA', 'prioritat B');
  if (raw === 'C' || raw === 'BAIXA' || raw === 'BAJA') return ok('BAIXA', 'prioritat C');
  return { value: null, rule: 'prioritat desconeguda', unmapped: { kind: 'ALTRES', raw } };
}

export function parseYesNo(input: string | null | undefined): boolean | null {
  const raw = clean(input)?.toUpperCase();
  if (!raw) return null;
  if (['SI', 'SÍ', 'S', 'YES', 'X', 'TRUE'].includes(raw)) return true;
  if (['NO', 'N', 'FALSE'].includes(raw)) return false;
  return null;
}

/**
 * "Próxima acción" wording from the two working CRM sheets.
 * Anything not listed becomes ALTRES with the original text preserved in
 * `other_action`, plus an unmapped_values entry so an admin can promote it to a
 * first-class action later.
 */
export function parseAction(
  input: string | null | undefined,
): Normalized<{ action: string; other?: string }> {
  const raw = clean(input);
  if (!raw) return ok(null, 'buit');
  const key = raw.toLowerCase();
  const table: Record<string, string> = {
    llamar: 'TRUCAR',
    trucar: 'TRUCAR',
    'enviar e-mail': 'ENVIAR CORREU',
    'enviar email': 'ENVIAR CORREU',
    'enviar correu': 'ENVIAR CORREU',
    visitar: 'VISITA',
    visita: 'VISITA',
    'enviar precios': 'ENVIAR PREUS',
    'enviar preus': 'ENVIAR PREUS',
    'enviar oferta': 'ENVIAR OFERTA',
    mostres: 'MOSTRES',
    muestras: 'MOSTRES',
  };
  const mapped = table[key];
  if (mapped) return ok({ action: mapped }, `acció «${raw}»`);
  return {
    value: { action: 'ALTRES', other: raw.toUpperCase() },
    rule: 'acció no catalogada -> ALTRES amb text original',
    unmapped: { kind: 'ACCIO', raw },
  };
}

/**
 * Free-text call outcomes ("PASSAR A PRESENTAR", "VACANCES FINS EL 10/07",
 * "COMPREN AL PINYOL"…) are deliberately NOT force-fitted onto the closed
 * result list. Only phrases whose meaning is unambiguous are mapped; the rest
 * become NO DETERMINAT with the original text kept verbatim in the notes and
 * queued for review.
 */
export function parseResult(input: string | null | undefined): Normalized<string> {
  const raw = clean(input);
  if (!raw) return ok(null, 'buit');
  const key = raw.toUpperCase().replace(/\s+/g, ' ');

  const exact: Record<string, string> = {
    VISITAT: 'NO DETERMINAT',
    PRESENTAT: 'NO DETERMINAT',
    'ESPERAR CAMPANYA': 'NO DETERMINAT',
  };
  if (exact[key]) {
    return {
      value: exact[key] as string,
      rule: 'resultat descriu una acció feta, no un resultat comercial -> NO DETERMINAT',
      unmapped: { kind: 'RESULTAT', raw },
    };
  }
  return {
    value: 'NO DETERMINAT',
    rule: 'resultat lliure no catalogat -> NO DETERMINAT, text original conservat',
    unmapped: { kind: 'RESULTAT', raw },
  };
}

/** "Estado" from the active-clients sheet -> the activity type it implies. */
export function activityTypeForState(state: string | null | undefined): Normalized<string> {
  const raw = clean(state);
  if (!raw) return ok(null, 'buit');
  const key = raw.toLowerCase();
  if (key === 'visita realizada') return ok('VISITA', 'estat «Visita realizada»');
  if (key === 'contactado') {
    // "Contactado" does not say by which channel, so the type stays ALTRES with
    // the original wording rather than assuming a phone call.
    return ok('ALTRES', 'estat «Contactado» sense canal -> ALTRES');
  }
  if (key === 'seguimiento') return ok('ALTRES', 'estat «Seguimiento» -> ALTRES');
  if (key === 'pendiente' || key === 'visita concertada') return ok(null, 'estat sense contacte registrat');
  if (key === 'sin interés' || key === 'sin interes') return ok('ALTRES', 'estat «Sin interés» -> ALTRES');
  return { value: null, rule: 'estat desconegut', unmapped: { kind: 'ALTRES', raw } };
}

const DO_PATTERNS: { re: RegExp; field: 'do_cava' | 'do_penedes' | 'do_catalunya' | 'do_altres' }[] = [
  { re: /do\s*cava/i, field: 'do_cava' },
  { re: /do\s*pened[eè]s/i, field: 'do_penedes' },
  { re: /do\s*catalunya/i, field: 'do_catalunya' },
];

export function parseDoFlags(...inputs: (string | null | undefined)[]): {
  do_cava: boolean;
  do_penedes: boolean;
  do_catalunya: boolean;
  do_altres: boolean;
} {
  const text = inputs.filter(Boolean).join(' ; ');
  const flags = { do_cava: false, do_penedes: false, do_catalunya: false, do_altres: false };
  for (const { re, field } of DO_PATTERNS) {
    if (re.test(text)) flags[field] = true;
  }
  // "DO Cava Catalunya" is the Cava denomination, not DO Catalunya. Remove the
  // false positive the two patterns above would otherwise create together.
  if (/do\s*cava\s*catalunya/i.test(text) && !/(^|;)\s*do\s*catalunya/i.test(text)) {
    flags.do_catalunya = false;
  }
  return flags;
}

/**
 * Company type read from the legal form actually present in the name.
 * SCCL / "cooperativ" / "agrícola i secció de crèdit" are unambiguous markers of
 * a cooperative in this sector. Anything else is left NULL rather than being
 * pushed into ALTRES, which would require an explanation we do not have.
 */
export function inferClientType(
  name: string,
  sheetHint: string | null,
  bottlerFlag: boolean | null,
): Normalized<string> {
  if (bottlerFlag === true) return ok('EMBOTELLADOR', 'columna EMBOTELLADOR = SI');
  if (sheetHint === 'EMBOTELLADOR') return ok('EMBOTELLADOR', 'full «CRM CLIENTS EMBOTELLADORS»');
  if (/\b(sccl|s\.c\.c\.l|scoop|s\.coop|cooperatiu|cooperativa|coop\.)\b/i.test(name)) {
    return ok('COOPERATIVA', 'forma jurídica cooperativa al nom');
  }
  if (/^agr[ií]cola\b|secci[óo] de cr[èe]dit/i.test(name)) {
    return ok('COOPERATIVA', 'denominació de cooperativa agrícola al nom');
  }
  return ok(null, 'sense evidència del tipus');
}

/** Country names as they appear in the export sheet. */
const COUNTRIES: Record<string, string> = {
  españa: 'ES', espanya: 'ES', spain: 'ES',
  francia: 'FR', france: 'FR', frança: 'FR',
  alemania: 'DE', germany: 'DE', alemanya: 'DE',
  italia: 'IT', italy: 'IT',
  portugal: 'PT',
  'reino unido': 'GB', 'united kingdom': 'GB', uk: 'GB',
  'estados unidos': 'US', usa: 'US', 'ee.uu.': 'US',
  bélgica: 'BE', belgica: 'BE', belgium: 'BE',
  'países bajos': 'NL', 'paises bajos': 'NL', holanda: 'NL', netherlands: 'NL',
  dinamarca: 'DK', denmark: 'DK',
  suiza: 'CH', switzerland: 'CH',
  austria: 'AT', luxemburgo: 'LU', luxembourg: 'LU',
  japón: 'JP', japon: 'JP', japan: 'JP',
  china: 'CN', canadá: 'CA', canada: 'CA',
  méxico: 'MX', mexico: 'MX', brasil: 'BR', brazil: 'BR',
  polonia: 'PL', poland: 'PL', suecia: 'SE', sweden: 'SE',
  noruega: 'NO', norway: 'NO', finlandia: 'FI', finland: 'FI',
  chequia: 'CZ', 'república checa': 'CZ', hungría: 'HU', hungria: 'HU',
  rumanía: 'RO', rumania: 'RO', grecia: 'GR', greece: 'GR',
  moldavia: 'MD', ucrania: 'UA', rusia: 'RU',
};

/**
 * "Saumur, Francia" -> { municipality: 'Saumur', country: 'FR' }.
 * "Alemania / España" -> country null (two countries, genuinely ambiguous).
 */
export function parseLocation(input: string | null | undefined): {
  municipality: string | null;
  country: string | null;
  rule: string;
} {
  const raw = clean(input);
  if (!raw) return { municipality: null, country: null, rule: 'buit' };

  if (raw.includes('/')) {
    return { municipality: null, country: null, rule: 'diversos països -> no determinat' };
  }
  const parts = raw.split(',').map((p) => p.trim()).filter(Boolean);
  const last = parts[parts.length - 1]?.toLowerCase() ?? '';
  const code = COUNTRIES[last] ?? null;
  if (code && parts.length > 1) {
    return { municipality: parts.slice(0, -1).join(', '), country: code, rule: 'població, país' };
  }
  if (code) return { municipality: null, country: code, rule: 'només país' };
  return { municipality: raw, country: null, rule: 'text no reconegut com a país' };
}

/** Spanish postcode -> province, using the official two-digit prefix. */
const PROVINCE_BY_PREFIX: Record<string, string> = {
  '08': 'Barcelona', '17': 'Girona', '25': 'Lleida', '43': 'Tarragona',
  '01': 'Álava', '06': 'Badajoz', '09': 'Burgos', '26': 'La Rioja',
  '31': 'Navarra', '46': 'Valencia',
};

export function provinceFromPostalCode(cp: string | null | undefined): Normalized<string> {
  const raw = clean(cp);
  if (!raw) return ok(null, 'buit');
  // Excel drops the leading zero: "8770" is really "08770".
  const digits = raw.replace(/\D/g, '').replace(/\.0$/, '');
  if (digits.length < 4) return ok(null, 'CP massa curt');
  const padded = digits.padStart(5, '0').slice(0, 5);
  const province = PROVINCE_BY_PREFIX[padded.slice(0, 2)];
  return province ? ok(province, `prefix CP ${padded.slice(0, 2)}`) : ok(null, 'prefix CP no catalogat');
}

export function normalizePostalCode(cp: string | null | undefined): string | null {
  const raw = clean(cp);
  if (!raw) return null;
  const digits = raw.replace(/\D/g, '').replace(/0$/, (m, offset: number) =>
    raw.endsWith('.0') && offset === raw.replace(/\D/g, '').length - 1 ? '' : m,
  );
  const cleaned = raw.replace(/\.0+$/, '').replace(/\D/g, '');
  const source = cleaned || digits;
  if (source.length < 4 || source.length > 5) return raw;
  return source.padStart(5, '0');
}

/** Several e-mails in one cell: "a@x.com / b@x.com", "a@x.com; b@x.com". */
export function splitEmails(input: string | null | undefined): string[] {
  const raw = clean(input);
  if (!raw) return [];
  return raw
    .split(/[;,/]|\s+i\s+|\s+y\s+/)
    .map((e) => e.trim())
    .filter((e) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e));
}

/** Several phones in one cell: "93 416 13 87 / 618 753 066". */
export function splitPhones(input: string | null | undefined): string[] {
  const raw = clean(input);
  if (!raw) return [];
  return raw
    .split(/[;,/]|\s+i\s+|\s+y\s+/)
    .map((p) => p.trim())
    .filter((p) => (p.replace(/\D/g, '').length >= 9));
}

/** "David Ribas" -> first/last. A single token stays as the first name. */
export function splitPersonName(input: string | null | undefined): {
  firstName: string | null;
  lastName: string | null;
} {
  const raw = clean(input);
  if (!raw) return { firstName: null, lastName: null };
  const parts = raw.split(' ').filter(Boolean);
  if (parts.length === 1) return { firstName: parts[0] ?? null, lastName: null };
  return { firstName: parts[0] ?? null, lastName: parts.slice(1).join(' ') };
}
