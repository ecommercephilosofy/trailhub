/**
 * The shared classification truth table.
 *
 * This file is the CONTRACT between the two implementations of the engine:
 *   - `packages/domain/src/classification.ts` (TypeScript), and
 *   - `app.propose_classification` (PL/pgSQL, migration 20260723094000).
 *
 * `packages/domain/src/classification.test.ts` runs the table against the
 * TypeScript function; the SQL suite under `supabase/tests` imports this exact
 * table, materialises each fact set as real rows (activities, opportunities,
 * deliveries, verification status, client type) and asserts the database
 * proposes the same value. Adding a case here therefore adds it to both suites,
 * which is the only way to keep them from drifting.
 *
 * Fact -> row recipe, for whoever writes the SQL harness:
 *   hasRecentPurchase    COMPRA REAL opportunity + delivery, guide_date within
 *                        `app.recent_purchase_months()` (18) months
 *   hasOldPurchase       COMPRA REAL opportunity (delivery older / absent)
 *   hasConfirmedForecast PREVISIO CONFIRMADA opportunity, status OBERTA
 *   hasRepeatSignal      opportunity.forecast_next = 'REPETIR COMANDA'
 *                        or activity.result = 'REPETIRA COMANDA'
 *   hasConcreteInterest  activity.result in (INTERES CONCRET, DEMANA PREUS,
 *                        DEMANA MOSTRES, ACORDAR VISITA)
 *                        or a POSSIBLE COMPRA opportunity
 *   hasOtherSupplier     activity.result = 'TE UN ALTRE PROVEIDOR'
 *   hasRecentNegative    activity.result in (NO COMPRA VI A GRANEL,
 *                        TANCAT / INACTIU, NO COMPRARA), occurred_on within 18 months
 */

import type { Classification } from '@vitalpe/types';
import type { ClassificationFacts } from './classification.js';

export interface ClassificationFixture {
  /** Stable identifier, also used as the vitest / pgTAP case name. */
  name: string;
  facts: ClassificationFacts;
  expected: Classification | null;
  /** Why this case exists — shown in failure output. */
  because: string;
}

/** No evidence at all. Every fixture spreads this and overrides what it needs. */
export const NO_FACTS: ClassificationFacts = Object.freeze({
  hasRecentPurchase: false,
  hasConfirmedForecast: false,
  hasRepeatSignal: false,
  hasConcreteInterest: false,
  hasOtherSupplier: false,
  hasOldPurchase: false,
  hasRecentNegative: false,
  verificationStatus: 'PENDENT DE VERIFICAR',
  clientTypeCode: null,
});

function facts(overrides: Partial<ClassificationFacts>): ClassificationFacts {
  return { ...NO_FACTS, ...overrides };
}

export const CLASSIFICATION_FIXTURES: readonly ClassificationFixture[] = Object.freeze([
  // -- 1. no evidence ------------------------------------------------------
  {
    name: 'sense cap evidencia',
    facts: facts({}),
    expected: null,
    because: 'A company with no history and no known type stays PENDENT DE REVISAR.',
  },

  // -- 2. ACTIU SEGUR ------------------------------------------------------
  {
    name: 'compra real recent',
    facts: facts({ hasRecentPurchase: true }),
    expected: 'ACTIU SEGUR',
    because: 'A delivery note inside the 18-month window is the strongest positive fact.',
  },
  {
    name: 'previsio confirmada oberta',
    facts: facts({ hasConfirmedForecast: true }),
    expected: 'ACTIU SEGUR',
    because: 'An open PREVISIO CONFIRMADA counts as an active relationship.',
  },
  {
    name: 'senyal de repeticio',
    facts: facts({ hasRepeatSignal: true }),
    expected: 'ACTIU SEGUR',
    because: 'REPETIR COMANDA / REPETIRA COMANDA carries no recency window in the SQL.',
  },
  {
    name: 'compra recent amb tipus conegut',
    facts: facts({ hasRecentPurchase: true, clientTypeCode: 'ELABORADOR' }),
    expected: 'ACTIU SEGUR',
    because: 'A known company type never downgrades a positive fact.',
  },

  // -- 3. POTENCIAL INTERESSAT --------------------------------------------
  {
    name: 'interes concret',
    facts: facts({ hasConcreteInterest: true }),
    expected: 'POTENCIAL INTERESSAT',
    because: 'INTERES CONCRET / DEMANA PREUS / DEMANA MOSTRES / ACORDAR VISITA.',
  },
  {
    name: 'interes concret amb tipus conegut',
    facts: facts({ hasConcreteInterest: true, clientTypeCode: 'COOPERATIVA' }),
    expected: 'POTENCIAL INTERESSAT',
    because: 'Interest is checked before the company-type fallback.',
  },

  // -- 4. POTENCIAL AMB UN ALTRE PROVEIDOR --------------------------------
  {
    name: 'te un altre proveidor',
    facts: facts({ hasOtherSupplier: true }),
    expected: 'POTENCIAL AMB UN ALTRE PROVEIDOR',
    because: 'An explicit "works with someone else" is compatible activity, not a refusal.',
  },
  {
    name: 'compra antiga sense relacio viva',
    facts: facts({ hasOldPurchase: true }),
    expected: 'POTENCIAL AMB UN ALTRE PROVEIDOR',
    because: 'An old customer with nothing live is a potential, not an active client.',
  },
  {
    name: 'nomes tipus empresa conegut',
    facts: facts({ clientTypeCode: 'EMBOTELLADOR' }),
    expected: 'POTENCIAL AMB UN ALTRE PROVEIDOR',
    because: 'A known company type alone is enough for the weakest positive bucket.',
  },
  {
    name: 'tipus ALTRES tambe compta',
    facts: facts({ clientTypeCode: 'ALTRES' }),
    expected: 'POTENCIAL AMB UN ALTRE PROVEIDOR',
    because: 'The SQL tests `client_type_code is not null`, not a specific code.',
  },

  // -- 5. NO POTENCIAL ----------------------------------------------------
  {
    name: 'negatiu recent',
    facts: facts({ hasRecentNegative: true }),
    expected: 'NO POTENCIAL',
    because: 'NO COMPRA VI A GRANEL / TANCAT / INACTIU / NO COMPRARA inside 18 months.',
  },
  {
    name: 'verificacio INACTIVA',
    facts: facts({ verificationStatus: 'INACTIVA' }),
    expected: 'NO POTENCIAL',
    because: 'A company verified as inactive cannot buy.',
  },
  {
    name: 'verificacio INACTIVA amb tipus conegut',
    facts: facts({ verificationStatus: 'INACTIVA', clientTypeCode: 'ELABORADOR' }),
    expected: 'NO POTENCIAL',
    because: 'The INACTIVA short-circuit fires before any positive bucket.',
  },

  // -- 6. rule priority ---------------------------------------------------
  {
    name: 'prioritat: negatiu recent guanya a compra recent',
    facts: facts({ hasRecentNegative: true, hasRecentPurchase: true }),
    expected: 'NO POTENCIAL',
    because: 'Rule 1 short-circuits before rule 2: a recent refusal beats a recent purchase.',
  },
  {
    name: 'prioritat: negatiu recent guanya a senyal de repeticio',
    facts: facts({ hasRecentNegative: true, hasRepeatSignal: true }),
    expected: 'NO POTENCIAL',
    because: 'Same short-circuit, with the un-windowed repeat signal.',
  },
  {
    name: 'prioritat: INACTIVA guanya a previsio confirmada',
    facts: facts({ verificationStatus: 'INACTIVA', hasConfirmedForecast: true }),
    expected: 'NO POTENCIAL',
    because: 'verification_status is part of rule 1.',
  },
  {
    name: 'prioritat: compra recent guanya a interes concret',
    facts: facts({ hasRecentPurchase: true, hasConcreteInterest: true }),
    expected: 'ACTIU SEGUR',
    because: 'Rule 2 fires before rule 3.',
  },
  {
    name: 'prioritat: previsio confirmada guanya a altre proveidor',
    facts: facts({ hasConfirmedForecast: true, hasOtherSupplier: true }),
    expected: 'ACTIU SEGUR',
    because: 'Rule 2 fires before rule 4 even with a competitor on record.',
  },
  {
    name: 'prioritat: interes concret guanya a altre proveidor',
    facts: facts({ hasConcreteInterest: true, hasOtherSupplier: true }),
    expected: 'POTENCIAL INTERESSAT',
    because: 'Rule 3 fires before rule 4: asking for prices outranks "has a supplier".',
  },
  {
    name: 'prioritat: interes concret guanya a compra antiga',
    facts: facts({ hasConcreteInterest: true, hasOldPurchase: true }),
    expected: 'POTENCIAL INTERESSAT',
    because: 'Rule 3 before rule 4.',
  },
  {
    name: 'prioritat: senyal de repeticio guanya a interes concret',
    facts: facts({ hasRepeatSignal: true, hasConcreteInterest: true }),
    expected: 'ACTIU SEGUR',
    because: 'Rule 2 before rule 3.',
  },

  // -- 7. facts that must NOT change the outcome --------------------------
  {
    name: 'verificacio DUBTOSA no penalitza',
    facts: facts({ verificationStatus: 'DUBTOSA', hasConcreteInterest: true }),
    expected: 'POTENCIAL INTERESSAT',
    because: 'Only INACTIVA short-circuits; DUBTOSA is not a negative fact.',
  },
  {
    name: 'verificacio ACTIVA sense res mes',
    facts: facts({ verificationStatus: 'ACTIVA' }),
    expected: null,
    because: 'A live company with no commercial history is still PENDENT DE REVISAR.',
  },
  {
    name: 'verificacio DUBTOSA sense res mes',
    facts: facts({ verificationStatus: 'DUBTOSA' }),
    expected: null,
    because: 'DUBTOSA on its own proves nothing either way.',
  },
]);

export default CLASSIFICATION_FIXTURES;
