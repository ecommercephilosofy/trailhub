import 'server-only';
import path from 'node:path';

/**
 * Server-side data access.
 *
 * Every request runs its queries as the Postgres role `authenticated` with
 * `request.jwt.claim.sub` set to the signed-in user, which is exactly the
 * context PostgREST would establish. Row Level Security is therefore the single
 * security boundary for both backends:
 *
 *   DATABASE_URL set    -> Postgres / Supabase over postgres.js
 *   DATABASE_URL unset  -> the local PGlite database in .data/crm
 *
 * There is no code path that reaches the database with RLS bypassed except
 * `withServiceRole`, which is used only by the import and OAuth-token flows and
 * never by a page or a form action.
 */

// Next runs with cwd = apps/web; the monorepo root is two levels up.
// `DATA_DIR` is only used by the local PGlite backend.
const DATA_DIR = process.env.PGLITE_DATA_DIR ?? path.resolve(process.cwd(), '../../.data/crm');

export type Params = readonly unknown[];

interface Backend {
  query<T>(sql: string, params: Params): Promise<T[]>;
  kind: 'pglite' | 'postgres';
}

let backendPromise: Promise<Backend> | null = null;

async function createBackend(): Promise<Backend> {
  const url = process.env.DATABASE_URL;
  if (url) {
    const { default: postgres } = await import('postgres');
    const sql = postgres(url, { max: 5, prepare: false });
    return {
      kind: 'postgres',
      async query<T>(text: string, params: Params): Promise<T[]> {
        return (await sql.unsafe(text, params as never[])) as unknown as T[];
      },
    };
  }

  const { PGlite } = await import('@electric-sql/pglite');
  const { pg_trgm } = await import('@electric-sql/pglite/contrib/pg_trgm');
  const db = new PGlite(DATA_DIR, { extensions: { pg_trgm } });
  await db.waitReady;
  return {
    kind: 'pglite',
    async query<T>(text: string, params: Params): Promise<T[]> {
      const result = await db.query<T>(text, params as unknown[]);
      return result.rows;
    },
  };
}

function backend(): Promise<Backend> {
  backendPromise ??= createBackend();
  return backendPromise;
}

export async function backendKind(): Promise<'pglite' | 'postgres'> {
  return (await backend()).kind;
}

/**
 * Runs `fn` inside a transaction bound to `userId`, with RLS enforced.
 * Nothing outside this function may talk to the database on behalf of a user.
 */
export async function withUser<T>(
  userId: string,
  fn: (q: Query) => Promise<T>,
  options: { origin?: string; device?: string; correlationId?: string } = {},
): Promise<T> {
  const be = await backend();
  await be.query('begin', []);
  try {
    await be.query('set local role authenticated', []);
    await be.query(`select set_config('request.jwt.claim.sub', $1, true)`, [userId]);
    await be.query(`select set_config('request.jwt.claim.role', 'authenticated', true)`, []);
    if (options.origin) await be.query(`select set_config('app.origin', $1, true)`, [options.origin]);
    if (options.device) await be.query(`select set_config('app.device', $1, true)`, [options.device]);
    if (options.correlationId) {
      await be.query(`select set_config('app.correlation_id', $1, true)`, [options.correlationId]);
    }
    const query: Query = {
      async many<T2>(sql: string, params: Params = []) {
        return be.query<T2>(sql, params);
      },
      async one<T2>(sql: string, params: Params = []) {
        const rows = await be.query<T2>(sql, params);
        return rows[0] ?? null;
      },
      async run(sql: string, params: Params = []) {
        await be.query(sql, params);
      },
    };
    const result = await fn(query);
    await be.query('commit', []);
    return result;
  } catch (error) {
    await be.query('rollback', []).catch(() => undefined);
    throw error;
  }
}

/**
 * Bypasses RLS. Server-only, and only for operations that are not performed on
 * behalf of a signed-in user: reading encrypted OAuth tokens, processing a
 * Google webhook, running an import. Never call this from a page.
 */
export async function withServiceRole<T>(fn: (q: Query) => Promise<T>): Promise<T> {
  const be = await backend();
  await be.query('begin', []);
  try {
    await be.query('reset role', []);
    const query: Query = {
      async many<T2>(sql: string, params: Params = []) {
        return be.query<T2>(sql, params);
      },
      async one<T2>(sql: string, params: Params = []) {
        const rows = await be.query<T2>(sql, params);
        return rows[0] ?? null;
      },
      async run(sql: string, params: Params = []) {
        await be.query(sql, params);
      },
    };
    const result = await fn(query);
    await be.query('commit', []);
    return result;
  } catch (error) {
    await be.query('rollback', []).catch(() => undefined);
    throw error;
  }
}

export interface Query {
  many<T>(sql: string, params?: Params): Promise<T[]>;
  one<T>(sql: string, params?: Params): Promise<T | null>;
  run(sql: string, params?: Params): Promise<void>;
}

/**
 * Postgres errors raised by our own domain functions carry a Catalan code.
 * They are user-facing messages, not stack traces.
 */
const DOMAIN_MESSAGES: Record<string, string> = {
  TASCA_NO_TROBADA: 'La tasca ja no existeix.',
  TASCA_JA_FETA: 'Aquesta tasca ja estava marcada com a feta.',
  RESULTAT_OBLIGATORI: 'Cal indicar un resultat per tancar una tasca comercial.',
  OBSERVACIONS_OBLIGATORIES_ALTRES: 'El resultat ALTRES exigeix una observació.',
  NOVA_DATA_OBLIGATORIA: 'Per ajornar una tasca cal indicar una data nova.',
  DATA_OBLIGATORIA: 'Cal indicar una data.',
  TASCA_NO_ES_SENSE_DATA: 'Aquesta tasca ja tenia data.',
  HORA_FI_ANTERIOR_A_INICI: "L'hora de fi ha de ser posterior a la d'inici.",
  MOTIU_NO_POTENCIAL_OBLIGATORI: 'Cal indicar el motiu per classificar com a NO POTENCIAL.',
  EMPRESA_NO_TROBADA: 'No hem trobat aquesta empresa.',
  FUSIO_MATEIXA_EMPRESA: 'No es pot fusionar una empresa amb ella mateixa.',
  CONFIRMACIO_REQUEREIX_USUARI: 'Cal iniciar sessió per confirmar una classificació.',
};

export function friendlyError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  for (const [code, text] of Object.entries(DOMAIN_MESSAGES)) {
    if (message.includes(code)) return text;
  }
  if (message.includes('clients_not_potential_needs_reason')) {
    return 'Cal indicar el motiu per classificar com a NO POTENCIAL.';
  }
  if (message.includes('clients_other_type_needs_explanation')) {
    return "El tipus d'empresa ALTRES exigeix una explicació.";
  }
  if (message.includes('contacts_single_primary_uq')) {
    return 'Ja hi ha un contacte principal actiu per a aquesta empresa.';
  }
  if (message.includes('opportunities_grain_uq')) {
    return 'Ja existeix una oportunitat per a aquesta empresa, producte, campanya i tipus de dada.';
  }
  if (message.includes('clients_name_norm_uq')) {
    return 'Ja existeix una empresa amb aquest nom.';
  }
  if (message.includes('violates row-level security') || message.includes('permission denied')) {
    return 'No tens permisos per fer aquesta acció.';
  }
  // Never surface a raw database error to the user.
  console.error('[db]', message);
  return "S'ha produït un error en desar. Torna-ho a provar.";
}
