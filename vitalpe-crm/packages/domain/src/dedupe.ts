/**
 * Duplicate detection for companies.
 *
 * Two very different questions are answered here, and keeping them apart is the
 * whole point:
 *
 *   score            "how alike are these two rows?"  — a hint for a human.
 *   isDeterministic  "may the importer merge them WITHOUT asking?" — almost
 *                    never true. Anything that is not deterministic lands in
 *                    `public.duplicate_candidates` with decision = 'PENDENT'
 *                    and waits for a person.
 *
 * All comparisons run on the same normalised keys the database generates
 * (`app.normalize_company`, `app.normalize_phone`, `app.normalize_email`,
 * `app.normalize_domain`), so a candidate scored here and a row stored there
 * always agree.
 */

import {
  domainOfEmail,
  isGenericEmailDomain,
  normalizeCompany,
  normalizeDomain,
  normalizeEmail,
  normalizePhone,
  normalizeText,
} from './normalize.js';
import { trigramSimilarity } from './similarity.js';

export interface DedupeCandidate {
  name: string;
  /** Every other spelling ever seen (`public.client_aliases`). */
  aliases?: readonly (string | null | undefined)[];
  taxId?: string | null;
  phones?: readonly (string | null | undefined)[];
  emails?: readonly (string | null | undefined)[];
  website?: string | null;
  municipality?: string | null;
  province?: string | null;
  /** Street line; compared normalised, never raw. */
  street?: string | null;
  /** Contact people, "Nom Cognom". Shared people are a strong signal. */
  contactNames?: readonly (string | null | undefined)[];
}

export interface DuplicateScore {
  /** 0..1, rounded to 3 decimals to fit `duplicate_candidates.score numeric(4,3)`. */
  score: number;
  signals: Record<string, boolean>;
  /** True only for the three deterministic rules below, and only with no conflict. */
  isDeterministic: boolean;
}

/** Weight of every positive signal. Exported so the UI can explain a score. */
export const DEDUPE_WEIGHTS = Object.freeze({
  taxIdMatch: 0.6,
  nameExact: 0.3,
  /** Multiplied by the trigram similarity when the names are not identical. */
  nameSimilar: 0.3,
  aliasMatch: 0.2,
  phoneMatch: 0.2,
  corporateEmailMatch: 0.2,
  genericEmailMatch: 0.05,
  emailDomainMatch: 0.1,
  webDomainMatch: 0.2,
  addressMatch: 0.1,
  sharedContact: 0.1,
  municipalityMatch: 0.05,
  provinceMatch: 0.03,
});

/** Penalty applied when a hard identity field is populated on both sides and differs. */
export const DEDUPE_PENALTIES = Object.freeze({
  taxIdConflict: 0.5,
  webDomainConflict: 0.15,
  municipalityConflict: 0.1,
  provinceConflict: 0.1,
});

/** Below this trigram similarity the names contribute nothing at all. */
export const NAME_SIMILARITY_THRESHOLD = 0.5;

/** Scores at or above this land in the review queue; below it we do not bother a human. */
export const DEDUPE_REVIEW_THRESHOLD = 0.45;

function normalizedSet(
  values: readonly (string | null | undefined)[] | undefined,
  normalize: (v: string | null | undefined) => string | null,
): Set<string> {
  const out = new Set<string>();
  for (const value of values ?? []) {
    const normalized = normalize(value);
    if (normalized !== null) out.add(normalized);
  }
  return out;
}

function intersects(a: ReadonlySet<string>, b: ReadonlySet<string>): boolean {
  for (const value of a) {
    if (b.has(value)) return true;
  }
  return false;
}

/**
 * Both sides have a value and the values differ. A missing value is NEVER a
 * conflict — half our imported rows have no tax id and no province.
 */
function conflicts(a: string | null, b: string | null): boolean {
  return a !== null && b !== null && a !== b;
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Compares two companies and returns a score, the signals behind it, and
 * whether an automatic merge is allowed.
 *
 * AUTO-MERGE (isDeterministic) is permitted for exactly three fact patterns,
 * and in every case only when no hard identity field conflicts:
 *
 *   1. identical normalised tax id;
 *   2. identical CORPORATE email address (a free provider such as gmail.com is
 *      never an identity signal) plus identical normalised company name;
 *   3. identical normalised phone plus identical normalised company name.
 *
 * Everything else — however high the score — goes to the review queue.
 */
export function duplicateScore(a: DedupeCandidate, b: DedupeCandidate): DuplicateScore {
  const nameA = normalizeCompany(a.name);
  const nameB = normalizeCompany(b.name);
  const nameExact = nameA !== null && nameA === nameB;
  const nameSimilarity = nameExact ? 1 : trigramSimilarity(a.name, b.name);

  const aliasesA = normalizedSet([a.name, ...(a.aliases ?? [])], normalizeCompany);
  const aliasesB = normalizedSet([b.name, ...(b.aliases ?? [])], normalizeCompany);
  const aliasMatch = !nameExact && intersects(aliasesA, aliasesB);

  const taxA = normalizeText(a.taxId);
  const taxB = normalizeText(b.taxId);
  const taxIdMatch = taxA !== null && taxA === taxB;
  const taxIdConflict = conflicts(taxA, taxB);

  const phonesA = normalizedSet(a.phones, normalizePhone);
  const phonesB = normalizedSet(b.phones, normalizePhone);
  const phoneMatch = intersects(phonesA, phonesB);

  const emailsA = normalizedSet(a.emails, normalizeEmail);
  const emailsB = normalizedSet(b.emails, normalizeEmail);
  const emailMatch = intersects(emailsA, emailsB);

  let corporateEmailMatch = false;
  for (const email of emailsA) {
    if (!emailsB.has(email)) continue;
    if (!isGenericEmailDomain(domainOfEmail(email))) {
      corporateEmailMatch = true;
      break;
    }
  }

  const emailDomainsA = new Set<string>();
  for (const email of emailsA) {
    const domain = domainOfEmail(email);
    if (domain !== null && !isGenericEmailDomain(domain)) emailDomainsA.add(domain);
  }
  const emailDomainsB = new Set<string>();
  for (const email of emailsB) {
    const domain = domainOfEmail(email);
    if (domain !== null && !isGenericEmailDomain(domain)) emailDomainsB.add(domain);
  }
  const emailDomainMatch = !corporateEmailMatch && intersects(emailDomainsA, emailDomainsB);

  const webA = normalizeDomain(a.website);
  const webB = normalizeDomain(b.website);
  const webDomainMatch = webA !== null && webA === webB;
  const webDomainConflict = conflicts(webA, webB);

  const municipalityA = normalizeText(a.municipality);
  const municipalityB = normalizeText(b.municipality);
  const municipalityMatch = municipalityA !== null && municipalityA === municipalityB;
  const municipalityConflict = conflicts(municipalityA, municipalityB);

  const provinceA = normalizeText(a.province);
  const provinceB = normalizeText(b.province);
  const provinceMatch = provinceA !== null && provinceA === provinceB;
  const provinceConflict = conflicts(provinceA, provinceB);

  const streetA = normalizeText(a.street);
  const streetB = normalizeText(b.street);
  const addressMatch = streetA !== null && streetA === streetB;

  const contactsA = normalizedSet(a.contactNames, normalizeText);
  const contactsB = normalizedSet(b.contactNames, normalizeText);
  const sharedContact = intersects(contactsA, contactsB);

  const nameSimilar = !nameExact && nameSimilarity >= NAME_SIMILARITY_THRESHOLD;

  const signals: Record<string, boolean> = {
    taxIdMatch,
    nameExact,
    nameSimilar,
    aliasMatch,
    phoneMatch,
    emailMatch,
    corporateEmailMatch,
    emailDomainMatch,
    webDomainMatch,
    addressMatch,
    sharedContact,
    municipalityMatch,
    provinceMatch,
    taxIdConflict,
    webDomainConflict,
    municipalityConflict,
    provinceConflict,
  };

  let score = 0;
  if (taxIdMatch) score += DEDUPE_WEIGHTS.taxIdMatch;
  if (nameExact) score += DEDUPE_WEIGHTS.nameExact;
  else if (nameSimilar) score += DEDUPE_WEIGHTS.nameSimilar * nameSimilarity;
  if (aliasMatch) score += DEDUPE_WEIGHTS.aliasMatch;
  if (phoneMatch) score += DEDUPE_WEIGHTS.phoneMatch;
  if (corporateEmailMatch) score += DEDUPE_WEIGHTS.corporateEmailMatch;
  else if (emailMatch) score += DEDUPE_WEIGHTS.genericEmailMatch;
  if (emailDomainMatch) score += DEDUPE_WEIGHTS.emailDomainMatch;
  if (webDomainMatch) score += DEDUPE_WEIGHTS.webDomainMatch;
  if (addressMatch) score += DEDUPE_WEIGHTS.addressMatch;
  if (sharedContact) score += DEDUPE_WEIGHTS.sharedContact;
  if (municipalityMatch) score += DEDUPE_WEIGHTS.municipalityMatch;
  if (provinceMatch) score += DEDUPE_WEIGHTS.provinceMatch;

  if (taxIdConflict) score -= DEDUPE_PENALTIES.taxIdConflict;
  if (webDomainConflict) score -= DEDUPE_PENALTIES.webDomainConflict;
  if (municipalityConflict) score -= DEDUPE_PENALTIES.municipalityConflict;
  if (provinceConflict) score -= DEDUPE_PENALTIES.provinceConflict;

  const hasConflict =
    taxIdConflict || webDomainConflict || municipalityConflict || provinceConflict;

  const isDeterministic =
    !hasConflict &&
    (taxIdMatch || (corporateEmailMatch && nameExact) || (phoneMatch && nameExact));

  return {
    score: round3(Math.min(1, Math.max(0, score))),
    signals,
    isDeterministic,
  };
}

/** Worth putting in front of a human? Deterministic pairs always are not — they merge. */
export function isReviewCandidate(
  result: DuplicateScore,
  threshold: number = DEDUPE_REVIEW_THRESHOLD,
): boolean {
  return !result.isDeterministic && result.score >= threshold;
}
