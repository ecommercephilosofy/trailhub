/**
 * SQL ↔ TypeScript parity for the classification engine.
 *
 * The rule lives twice — `app.propose_classification` in PL/pgSQL (so triggers
 * and imports get it) and `proposeClassification` in `@vitalpe/domain` (so the
 * UI and the voice preview get it without a round trip). Two implementations
 * of one rule is a standing invitation to drift, so this suite materialises the
 * shared fixture table as REAL rows and asserts both engines agree, case by
 * case. Adding a fixture adds it to both suites at once.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { CLASSIFICATION_FIXTURES } from '../../packages/domain/src/classification.fixtures.js';
import { proposeClassification } from '../../packages/domain/src/classification.js';
import type { ClassificationFacts } from '../../packages/domain/src/classification.js';
import { asService, setup, type Fixture } from './helpers.js';

let f: Fixture;
let counter = 0;

beforeAll(async () => {
  f = await setup();
}, 120_000);

afterAll(async () => {
  await f?.db.close();
});

const run = <T = Record<string, unknown>>(sql: string, params: unknown[] = []) =>
  asService(f.db, async () => (await f.db.query<T>(sql, params)).rows);

/**
 * Turns a fact set into actual rows, following the recipe documented at the top
 * of classification.fixtures.ts. Every fact is expressed the way the product
 * would really record it — no shortcuts that would let SQL and TS agree for the
 * wrong reason.
 */
async function materialise(facts: ClassificationFacts): Promise<string> {
  counter += 1;
  const name = `PARITAT ${String(counter).padStart(3, '0')}`;

  const [client] = await run<{ id: string }>(
    `insert into public.clients (workspace_id, name, client_type_code, other_client_type)
     values ($1, $2, $3, $4) returning id`,
    [
      f.ws, name, facts.clientTypeCode,
      facts.clientTypeCode === 'ALTRES' ? 'EXPLICACIO DE PROVA' : null,
    ],
  );
  const id = client!.id;

  if (facts.hasRecentPurchase || facts.hasOldPurchase) {
    const [opp] = await run<{ id: string }>(
      `insert into public.opportunities
         (workspace_id, client_id, product_id, campaign_id, data_type, volume_liters, status)
       values ($1,$2,$3,$4,'COMPRA REAL',25000,'GUANYADA') returning id`,
      [f.ws, id, f.productId, f.campaignId],
    );
    // A recent purchase needs a delivery note inside the 18-month window; an
    // old one is proved by the opportunity alone (or a much older note).
    const monthsAgo = facts.hasRecentPurchase ? 3 : 30;
    await run(
      `insert into public.opportunity_deliveries
         (workspace_id, opportunity_id, guide_number, guide_date, volume_liters)
       values ($1,$2,$3,(current_date - ($4 || ' months')::interval)::date,25000)`,
      [f.ws, opp!.id, `PAR-${counter}`, monthsAgo],
    );
  }

  if (facts.hasConfirmedForecast) {
    await run(
      `insert into public.opportunities
         (workspace_id, client_id, product_id, campaign_id, data_type, volume_liters, status)
       values ($1,$2,$3,$4,'PREVISIO CONFIRMADA',10000,'OBERTA')`,
      [f.ws, id, f.productId, f.campaignId],
    );
  }

  // An activity, not an opportunity: an opportunity would need a data_type and
  // 'POSSIBLE COMPRA' would silently turn hasConcreteInterest on too.
  if (facts.hasRepeatSignal) {
    await run(
      `insert into public.activities (workspace_id, client_id, activity_type, result, notes)
       values ($1,$2,'TRUCADA','REPETIRA COMANDA','paritat')`,
      [f.ws, id],
    );
  }

  if (facts.hasConcreteInterest) {
    await run(
      `insert into public.activities (workspace_id, client_id, activity_type, result, notes)
       values ($1,$2,'TRUCADA','DEMANA PREUS','paritat')`,
      [f.ws, id],
    );
  }

  if (facts.hasOtherSupplier) {
    await run(
      `insert into public.activities (workspace_id, client_id, activity_type, result, notes)
       values ($1,$2,'TRUCADA','TE UN ALTRE PROVEIDOR','paritat')`,
      [f.ws, id],
    );
  }

  if (facts.hasRecentNegative) {
    await run(
      `insert into public.activities
         (workspace_id, client_id, occurred_on, activity_type, result, notes)
       values ($1,$2,current_date - interval '10 days','TRUCADA','NO COMPRA VI A GRANEL','paritat')`,
      [f.ws, id],
    );
  }

  if (facts.verificationStatus !== 'PENDENT DE VERIFICAR') {
    await run(
      `update public.clients set verification_status = $2::app.verification_status where id = $1`,
      [id, facts.verificationStatus],
    );
  }

  return id;
}

describe('el motor de classificació dona el mateix resultat a SQL i a TypeScript', () => {
  it.each(CLASSIFICATION_FIXTURES.map((fx) => [fx.name, fx] as const))(
    '%s',
    async (_name, fx) => {
      const clientId = await materialise(fx.facts);

      // Triggers recompute on write, but verification_status is set with a
      // plain UPDATE, so force one recomputation to cover every path.
      await run(`select app.refresh_proposed_classification($1)`, [clientId]);

      const [row] = await run<{ proposed: string | null }>(
        `select proposed_classification::text as proposed from public.clients where id = $1`,
        [clientId],
      );

      const fromSql = row?.proposed ?? null;
      const fromTs = proposeClassification(fx.facts);

      expect(fromTs, `TypeScript · ${fx.because}`).toBe(fx.expected);
      expect(fromSql, `PL/pgSQL · ${fx.because}`).toBe(fx.expected);
      expect(fromSql, 'SQL i TypeScript han de coincidir').toBe(fromTs);
    },
  );

  it('la finestra de recència és la mateixa a totes dues implementacions', async () => {
    const [row] = await run<{ months: number }>(`select app.recent_purchase_months() as months`);
    const { RECENT_PURCHASE_MONTHS } = await import('../../packages/domain/src/classification.js');
    expect(Number(row?.months)).toBe(RECENT_PURCHASE_MONTHS);
  });

  it('la finestra de verificació caducada és la mateixa', async () => {
    const [row] = await run<{ months: number }>(`select app.verification_stale_months() as months`);
    const { VERIFICATION_STALE_MONTHS } = await import('../../packages/domain/src/classification.js');
    expect(Number(row?.months)).toBe(VERIFICATION_STALE_MONTHS);
  });
});
