/**
 * String similarity helpers used by the dedupe engine and by REGISTRE RÀPID.
 *
 * `trigramSimilarity` reproduces pg_trgm's `similarity()` — the same extension
 * the schema installs and indexes with (`clients_name_trgm_idx`) — so a
 * candidate scored in the browser gets the same number the database would give
 * it. pg_trgm tokenises on alphanumerics, pads each word with two leading and
 * one trailing space, and returns |A ∩ B| / |A ∪ B| over the distinct trigrams.
 */

import { normalizeText } from './normalize.js';

/** Trigram set of a string, using pg_trgm's padding rules. */
export function trigrams(input: string | null | undefined): Set<string> {
  const out = new Set<string>();
  const normalized = normalizeText(input);
  if (normalized === null) return out;
  for (const word of normalized.split(' ')) {
    if (word === '') continue;
    const padded = `  ${word} `;
    for (let i = 0; i + 3 <= padded.length; i += 1) {
      out.add(padded.slice(i, i + 3));
    }
  }
  return out;
}

/**
 * pg_trgm `similarity(a, b)` — Jaccard index over trigram sets, in 0..1.
 * Two empty strings are 0 (pg_trgm returns 0, not 1, for no shared trigrams).
 */
export function trigramSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const setA = trigrams(a);
  const setB = trigrams(b);
  if (setA.size === 0 || setB.size === 0) return 0;
  let intersection = 0;
  for (const t of setA) {
    if (setB.has(t)) intersection += 1;
  }
  const union = setA.size + setB.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

/** Classic Levenshtein edit distance (two-row dynamic programming). */
export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let previous = new Array<number>(b.length + 1);
  let current = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j += 1) previous[j] = j;

  for (let i = 1; i <= a.length; i += 1) {
    current[0] = i;
    const ca = a.charCodeAt(i - 1);
    for (let j = 1; j <= b.length; j += 1) {
      const cost = ca === b.charCodeAt(j - 1) ? 0 : 1;
      current[j] = Math.min(
        (current[j - 1] as number) + 1,
        (previous[j] as number) + 1,
        (previous[j - 1] as number) + cost,
      );
    }
    const swap = previous;
    previous = current;
    current = swap;
  }
  return previous[b.length] as number;
}

/** Levenshtein distance rescaled to a 0..1 similarity. */
export function levenshteinSimilarity(a: string, b: string): number {
  const longest = Math.max(a.length, b.length);
  if (longest === 0) return 1;
  return 1 - levenshtein(a, b) / longest;
}
