import { describe, expect, it } from 'vitest';
import {
  classificationPriority,
  hasClassificationDiscrepancy,
  proposeClassification,
  recentPurchaseCutoff,
  RECENT_PURCHASE_MONTHS,
  verificationIsStale,
  VERIFICATION_STALE_MONTHS,
  type ClassificationFacts,
} from './classification';
import { CLASSIFICATION_FIXTURES, NO_FACTS } from './classification.fixtures';

const facts = (overrides: Partial<ClassificationFacts>): ClassificationFacts => ({
  ...NO_FACTS,
  ...overrides,
});

describe('proposeClassification — shared fixture table', () => {
  it.each(CLASSIFICATION_FIXTURES.map((f) => [f.name, f] as const))(
    '%s',
    (_name, fixture) => {
      expect(proposeClassification(fixture.facts), fixture.because).toBe(fixture.expected);
    },
  );

  it('covers all four classifications plus the null case', () => {
    const produced = new Set(CLASSIFICATION_FIXTURES.map((f) => f.expected));
    expect(produced).toContain('ACTIU SEGUR');
    expect(produced).toContain('POTENCIAL INTERESSAT');
    expect(produced).toContain('POTENCIAL AMB UN ALTRE PROVEIDOR');
    expect(produced).toContain('NO POTENCIAL');
    expect(produced).toContain(null);
  });
});

describe('proposeClassification — rule order', () => {
  it('rule 1 (negative / INACTIVA) beats every positive fact', () => {
    const everything = facts({
      hasRecentNegative: true,
      hasRecentPurchase: true,
      hasConfirmedForecast: true,
      hasRepeatSignal: true,
      hasConcreteInterest: true,
      hasOtherSupplier: true,
      hasOldPurchase: true,
      clientTypeCode: 'ELABORADOR',
    });
    expect(proposeClassification(everything)).toBe('NO POTENCIAL');
  });

  it('rule 2 beats rules 3 and 4', () => {
    expect(
      proposeClassification(
        facts({ hasConfirmedForecast: true, hasConcreteInterest: true, hasOtherSupplier: true }),
      ),
    ).toBe('ACTIU SEGUR');
  });

  it('rule 3 beats rule 4', () => {
    expect(
      proposeClassification(
        facts({ hasConcreteInterest: true, hasOtherSupplier: true, hasOldPurchase: true }),
      ),
    ).toBe('POTENCIAL INTERESSAT');
  });

  it('each of the three rule-2 facts fires on its own', () => {
    expect(proposeClassification(facts({ hasRecentPurchase: true }))).toBe('ACTIU SEGUR');
    expect(proposeClassification(facts({ hasConfirmedForecast: true }))).toBe('ACTIU SEGUR');
    expect(proposeClassification(facts({ hasRepeatSignal: true }))).toBe('ACTIU SEGUR');
  });

  it('each of the three rule-4 facts fires on its own', () => {
    expect(proposeClassification(facts({ hasOtherSupplier: true }))).toBe(
      'POTENCIAL AMB UN ALTRE PROVEIDOR',
    );
    expect(proposeClassification(facts({ hasOldPurchase: true }))).toBe(
      'POTENCIAL AMB UN ALTRE PROVEIDOR',
    );
    expect(proposeClassification(facts({ clientTypeCode: 'COOPERATIVA' }))).toBe(
      'POTENCIAL AMB UN ALTRE PROVEIDOR',
    );
  });

  it('never invents evidence: no facts means no proposal', () => {
    expect(proposeClassification(facts({}))).toBeNull();
  });

  it('is pure — it does not mutate the facts it is given', () => {
    const input = facts({ hasConcreteInterest: true });
    const snapshot = JSON.stringify(input);
    proposeClassification(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });
});

describe('classificationPriority', () => {
  it('matches the order the SQL evaluates its rules in', () => {
    expect(classificationPriority['NO POTENCIAL']).toBe(1);
    expect(classificationPriority['ACTIU SEGUR']).toBe(2);
    expect(classificationPriority['POTENCIAL INTERESSAT']).toBe(3);
    expect(classificationPriority['POTENCIAL AMB UN ALTRE PROVEIDOR']).toBe(4);
  });

  it('ranks the winner of a conflict below the loser', () => {
    const winner = proposeClassification(
      facts({ hasRecentNegative: true, hasRecentPurchase: true }),
    );
    expect(winner).not.toBeNull();
    expect(classificationPriority[winner as 'NO POTENCIAL']).toBeLessThan(
      classificationPriority['ACTIU SEGUR'],
    );
  });
});

describe('hasClassificationDiscrepancy', () => {
  it('flags a confirmed value that differs from the proposal', () => {
    expect(hasClassificationDiscrepancy('ACTIU SEGUR', 'NO POTENCIAL')).toBe(true);
  });

  it('does not flag agreement', () => {
    expect(hasClassificationDiscrepancy('ACTIU SEGUR', 'ACTIU SEGUR')).toBe(false);
  });

  it('needs BOTH sides — a missing one is never a discrepancy', () => {
    expect(hasClassificationDiscrepancy(null, 'ACTIU SEGUR')).toBe(false);
    expect(hasClassificationDiscrepancy('ACTIU SEGUR', null)).toBe(false);
    expect(hasClassificationDiscrepancy(null, null)).toBe(false);
    expect(hasClassificationDiscrepancy(undefined, undefined)).toBe(false);
  });
});

describe('recency windows', () => {
  it('uses the same constants as app.recent_purchase_months / verification_stale_months', () => {
    expect(RECENT_PURCHASE_MONTHS).toBe(18);
    expect(VERIFICATION_STALE_MONTHS).toBe(12);
  });

  it('walks back exactly 18 months, clamping the day like PostgreSQL intervals', () => {
    const cutoff = recentPurchaseCutoff(new Date('2026-07-23T10:00:00Z'));
    expect(cutoff.toISOString().slice(0, 10)).toBe('2025-01-23');
    const endOfMonth = recentPurchaseCutoff(new Date('2026-08-31T10:00:00Z'), 6);
    expect(endOfMonth.toISOString().slice(0, 10)).toBe('2026-02-28');
  });

  it('treats a never-verified company as stale', () => {
    const now = new Date('2026-07-23T10:00:00Z');
    expect(verificationIsStale(null, now)).toBe(true);
    expect(verificationIsStale('2026-01-01T00:00:00Z', now)).toBe(false);
    expect(verificationIsStale('2024-01-01T00:00:00Z', now)).toBe(true);
  });
});
