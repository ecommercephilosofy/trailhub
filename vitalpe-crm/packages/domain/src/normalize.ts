/**
 * Text normalisation — the TypeScript twin of the IMMUTABLE SQL functions in
 * `supabase/migrations/20260723090000_core.sql`.
 *
 * These back generated columns (`clients.name_norm`, `contacts.phone`, …), so a
 * divergence between the two implementations would silently produce dedupe keys
 * the database disagrees with. Every function below is a line-by-line
 * transcription; `packages/domain/src/normalize.test.ts` pins the behaviour and
 * `scripts` can diff it against a live PostgreSQL instance.
 */

/**
 * PostgreSQL `btrim(string)` with the default character set: it removes SPACES
 * only, not every kind of whitespace (unlike JavaScript's `String.trim`).
 */
export function btrimSpaces(input: string): string {
  let start = 0;
  let end = input.length;
  while (start < end && input.charCodeAt(start) === 32) start += 1;
  while (end > start && input.charCodeAt(end - 1) === 32) end -= 1;
  return input.slice(start, end);
}

// The exact translate() argument pair from app.unaccent_ca. Do not "tidy" these
// strings: their character-by-character alignment IS the mapping.
const UNACCENT_FROM = 'àáâäãåÀÁÂÄÃÅèéêëÈÉÊËìíîïÌÍÎÏòóôöõÒÓÔÖÕùúûüÙÚÛÜçÇñÑýÿÝŸ';
const UNACCENT_TO = 'aaaaaaAAAAAAeeeeEEEEiiiiIIIIooooo' + 'OOOOOuuuuUUUUcCnNyyYY';

const UNACCENT_MAP: ReadonlyMap<string, string> = (() => {
  const map = new Map<string, string>();
  for (let i = 0; i < UNACCENT_FROM.length; i += 1) {
    const from = UNACCENT_FROM[i] as string;
    // PostgreSQL translate(): the FIRST occurrence in `from` wins; a character
    // with no counterpart in `to` is deleted.
    if (map.has(from)) continue;
    map.set(from, i < UNACCENT_TO.length ? (UNACCENT_TO[i] as string) : '');
  }
  return map;
})();

/** `app.unaccent_ca(text) -> text` — NULL is coalesced to '' exactly as in SQL. */
export function unaccentCa(input: string | null | undefined): string {
  const source = input ?? '';
  let out = '';
  for (const ch of source) {
    const mapped = UNACCENT_MAP.get(ch);
    out += mapped === undefined ? ch : mapped;
  }
  return out;
}

/**
 * `app.normalize_text(text) -> text`
 * lower(unaccent) then every run of non `[a-z0-9]` collapses to one space.
 * Returns null for the empty result (SQL `nullif(..., '')`).
 */
export function normalizeText(input: string | null | undefined): string | null {
  const spaced = unaccentCa(input).toLowerCase().replace(/[^a-z0-9]+/g, ' ');
  const trimmed = btrimSpaces(spaced);
  return trimmed === '' ? null : trimmed;
}

/**
 * Legal-form alternatives, transcribed from `app.normalize_company`.
 *
 * ORDER MATTERS. PostgreSQL's regex engine resolves an alternation by the POSIX
 * longest-match rule, while JavaScript resolves it leftmost-first. Listing the
 * alternatives longest-first makes the two engines agree: because every
 * alternative is followed by the same `( |$)`, the longest alternative always
 * yields the longest overall match. (The SQL literal keeps them in a different,
 * human-grouped order; the only input where that order would matter is
 * "sl unipersonal" — see DECISIONS.md.)
 */
const LEGAL_FORMS = [
  's l u',
  's l',
  'sl',
  'slu',
  's a u',
  's a',
  'sa',
  'sau',
  's c p',
  'scp',
  's c c l',
  'sccl',
  's c s',
  'scs',
  's coop',
  'scoop',
  'sat',
  'c b',
  'cb',
  'sl unipersonal',
  'societat limitada',
  'sociedad limitada',
  'sociedad anonima',
  'societat anonima',
] as const;

const LEGAL_FORM_ALTERNATION = [...LEGAL_FORMS]
  .sort((a, b) => b.length - a.length || (a < b ? -1 : a > b ? 1 : 0))
  .join('|');

const LEGAL_FORM_RE = new RegExp(`(^| )(${LEGAL_FORM_ALTERNATION})( |$)`, 'g');

/**
 * `app.normalize_company(text) -> text`
 * Drops legal forms so "MASIA ROMAGOSA S.L." and "Masia Romagosa SL" collapse
 * onto the same key. The original name is never touched.
 */
export function normalizeCompany(input: string | null | undefined): string | null {
  const base = normalizeText(input);
  if (base === null) return null; // regexp_replace(NULL, …) is NULL in SQL
  const stripped = base.replace(LEGAL_FORM_RE, ' ').replace(/ +/g, ' ');
  const trimmed = btrimSpaces(stripped);
  return trimmed === '' ? null : trimmed;
}

/**
 * `app.normalize_phone(text) -> text`
 * Everything but digits and '+' is dropped; a '+' that is not in first position
 * is dropped too; '00' becomes '+'; a bare 9-digit Spanish number gets +34.
 */
export function normalizePhone(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null;
  let digits = input.replace(/[^0-9+]/g, '');
  digits = digits.replace(/(?!^)\+/g, '');
  if (digits === '' || digits === '+') return null;
  if (digits.startsWith('+')) return digits;
  if (digits.startsWith('00')) return '+' + digits.slice(2);
  if (digits.length === 9 && ['6', '7', '8', '9'].includes(digits[0] as string)) {
    return '+34' + digits;
  }
  return digits;
}

/** `app.normalize_email(text) -> text` — lower + btrim, '' becomes NULL. */
export function normalizeEmail(input: string | null | undefined): string | null {
  if (input === null || input === undefined) return null; // lower(NULL) is NULL
  const value = btrimSpaces(input).toLowerCase();
  return value === '' ? null : value;
}

/**
 * `app.normalize_domain(text) -> text` — strips the protocol and a leading
 * "www.".
 *
 * NOTE: the SQL comment claims it also strips a trailing path, but the SQL body
 * does not, and the SQL is the source of truth. Recorded in DECISIONS.md.
 */
export function normalizeDomain(input: string | null | undefined): string | null {
  const lowered = btrimSpaces(input ?? '').toLowerCase();
  const value = lowered.replace(/^[a-z]+:\/\//, '').replace(/^www\./, '');
  return value === '' ? null : value;
}

/** `app.domain_of_email(text) -> text` — split_part(normalize_email(x), '@', 2). */
export function domainOfEmail(input: string | null | undefined): string | null {
  const email = normalizeEmail(input);
  if (email === null) return null; // split_part(NULL, …) is NULL
  const parts = email.split('@');
  const part = parts.length >= 2 ? (parts[1] as string) : '';
  return part === '' ? null : part;
}

/** Free-email providers listed in `app.is_generic_email_domain`. */
export const GENERIC_EMAIL_DOMAINS: readonly string[] = [
  'gmail.com',
  'hotmail.com',
  'hotmail.es',
  'yahoo.es',
  'yahoo.com',
  'outlook.com',
  'outlook.es',
  'telefonica.net',
  'terra.es',
  'icloud.com',
  'live.com',
  'msn.com',
  'me.com',
  'wanadoo.es',
  'ono.com',
  'movistar.es',
];

const GENERIC_EMAIL_DOMAIN_SET = new Set(GENERIC_EMAIL_DOMAINS);

/**
 * `app.is_generic_email_domain(text) -> boolean`
 * A free-provider domain must never be used as a company identity signal.
 */
export function isGenericEmailDomain(domain: string | null | undefined): boolean {
  return GENERIC_EMAIL_DOMAIN_SET.has(domain ?? '');
}
