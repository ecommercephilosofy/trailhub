/**
 * CLASSIFICACIÓ PROPOSADA — the TypeScript twin of `app.propose_classification`
 * in `supabase/migrations/20260723094000_domain.sql`.
 *
 * The engine only ever derives a PROPOSAL from facts already recorded. It never
 * invents evidence and it never touches `confirmed_classification`: confirming
 * is a human-only act (`app.confirm_classification` refuses without a user).
 *
 * The SQL gathers the facts with SQL queries; here they arrive pre-computed in a
 * plain object so the function stays pure. The RULE ORDER below is identical to
 * the SQL, and `classification.fixtures.ts` is imported by both the vitest suite
 * and the SQL test suite so the two can never drift.
 */

import type { Classification, VerificationStatus } from '@vitalpe/types';
import { addZonedMonths } from './dates.js';

/** `app.recent_purchase_months()` — the recency window for purchases/negatives. */
export const RECENT_PURCHASE_MONTHS = 18;

/** `app.verification_stale_months()` — when a verification stops counting as fresh. */
export const VERIFICATION_STALE_MONTHS = 12;

/**
 * The facts `app.propose_classification` gathers before branching. Each field
 * corresponds one-to-one with a `select exists (...)` in the SQL body.
 */
export interface ClassificationFacts {
  /**
   * COMPRA REAL opportunity with a delivery note dated within the last
   * {@link RECENT_PURCHASE_MONTHS} months.
   */
  hasRecentPurchase: boolean;
  /** An OBERTA opportunity whose data_type is 'PREVISIO CONFIRMADA'. */
  hasConfirmedForecast: boolean;
  /**
   * forecast_next = 'REPETIR COMANDA' on any live opportunity, OR an activity
   * with result 'REPETIRA COMANDA'. No recency window in the SQL.
   */
  hasRepeatSignal: boolean;
  /**
   * An activity with result in (INTERES CONCRET, DEMANA PREUS, DEMANA MOSTRES,
   * ACORDAR VISITA) or a POSSIBLE COMPRA opportunity. "Could buy wine" is never
   * enough.
   */
  hasConcreteInterest: boolean;
  /** An activity with result 'TE UN ALTRE PROVEIDOR'. */
  hasOtherSupplier: boolean;
  /** A COMPRA REAL opportunity of any age. */
  hasOldPurchase: boolean;
  /**
   * An activity with result in (NO COMPRA VI A GRANEL, TANCAT / INACTIU,
   * NO COMPRARA) within the last {@link RECENT_PURCHASE_MONTHS} months.
   */
  hasRecentNegative: boolean;
  /** `clients.verification_status`. */
  verificationStatus: VerificationStatus;
  /** `clients.client_type_code` — NULL when the company type is unknown. */
  clientTypeCode: string | null;
}

/**
 * `app.propose_classification(uuid) -> app.classification`
 *
 * Rule order, identical to the SQL:
 *   1. recent negative OR verification INACTIVA         -> NO POTENCIAL
 *   2. recent purchase OR confirmed forecast OR repeat  -> ACTIU SEGUR
 *   3. concrete interest                                -> POTENCIAL INTERESSAT
 *   4. other supplier OR old purchase OR known type     -> POTENCIAL AMB UN ALTRE PROVEIDOR
 *   5. otherwise                                        -> null (PENDENT DE REVISAR)
 */
export function proposeClassification(facts: ClassificationFacts): Classification | null {
  if (facts.hasRecentNegative || facts.verificationStatus === 'INACTIVA') {
    return 'NO POTENCIAL';
  }

  if (facts.hasRecentPurchase || facts.hasConfirmedForecast || facts.hasRepeatSignal) {
    return 'ACTIU SEGUR';
  }

  if (facts.hasConcreteInterest) {
    return 'POTENCIAL INTERESSAT';
  }

  if (facts.hasOtherSupplier || facts.hasOldPurchase || facts.clientTypeCode !== null) {
    return 'POTENCIAL AMB UN ALTRE PROVEIDOR';
  }

  return null; // not enough evidence: stays PENDENT DE REVISAR
}

/**
 * The order in which the rules fire, 1 = evaluated first and therefore wins.
 *
 * This is NOT a "commercial value" ranking: it is the engine's precedence, so a
 * company that is both a recent NO COMPRARA and an old customer classifies as
 * NO POTENCIAL. Used by the UI to explain "why this proposal and not that one".
 */
export const classificationPriority: Readonly<Record<Classification, number>> = Object.freeze({
  'NO POTENCIAL': 1,
  'ACTIU SEGUR': 2,
  'POTENCIAL INTERESSAT': 3,
  'POTENCIAL AMB UN ALTRE PROVEIDOR': 4,
});

/**
 * `v_client_derived.has_classification_discrepancy`:
 * both sides present AND different. A missing side is never a discrepancy.
 */
export function hasClassificationDiscrepancy(
  proposed: Classification | null | undefined,
  confirmed: Classification | null | undefined,
): boolean {
  if (proposed === null || proposed === undefined) return false;
  if (confirmed === null || confirmed === undefined) return false;
  return proposed !== confirmed;
}

/**
 * The cutoff date `app.propose_classification` compares purchases and negative
 * results against: today (Europe/Madrid) minus {@link RECENT_PURCHASE_MONTHS}.
 *
 * Exposed so callers building a `ClassificationFacts` object use exactly the
 * same window the database uses.
 */
export function recentPurchaseCutoff(now: Date, months: number = RECENT_PURCHASE_MONTHS): Date {
  return addZonedMonths(now, -months);
}

/**
 * `v_client_derived.verification_is_stale`: never verified, or verified longer
 * ago than {@link VERIFICATION_STALE_MONTHS}.
 */
export function verificationIsStale(
  lastVerifiedAt: Date | string | null | undefined,
  now: Date,
  months: number = VERIFICATION_STALE_MONTHS,
): boolean {
  if (lastVerifiedAt === null || lastVerifiedAt === undefined) return true;
  const verified = lastVerifiedAt instanceof Date ? lastVerifiedAt : new Date(lastVerifiedAt);
  if (Number.isNaN(verified.getTime())) return true;
  return verified.getTime() < addZonedMonths(now, -months).getTime();
}
