import 'server-only';
import { withServiceRole, type Query } from '@/lib/db';
import type { Session } from '@/lib/auth';

/**
 * Elevated writes for the administration section.
 *
 * Most of this section writes through the caller's own RLS context, exactly
 * like the rest of the app. Three groups of tables cannot:
 *
 *  · `products`, `product_aliases` and `campaigns` are shared master data with
 *    a SELECT policy and no write policy at all. An UPDATE from `authenticated`
 *    does not fail — it matches zero rows, which is worse than an error.
 *  · the import staging tables (`import_files`, `import_sheets`, `import_rows`,
 *    `excluded_records`, `field_provenance`) and INSERTs into
 *    `duplicate_candidates` have no write policy: the schema treats running an
 *    import as the server's job, not the browser's.
 *  · `app.merge_clients()` and `client_merges` are revoked from `authenticated`
 *    outright.
 *
 * See supabase/migrations/20260723095000_rls.sql. Those tables are not going to
 * be edited, so the catalogue editor, the importer and FUSIONAR go through the
 * service role — and the ADMIN check below is then the *only* gate, which is
 * why it is made explicitly, once, here.
 *
 * The two session GUCs PostgREST would set are re-established inside the
 * transaction, so `auth.uid()` still resolves and every statement still lands
 * in `audit_log` attributed to the real person.
 */

export const ONLY_ADMIN = 'NOMES_ADMIN';

export type Origin = 'CRM' | 'IMPORTACIO' | 'SISTEMA';

export async function elevated<T>(
  session: Session,
  origin: Origin,
  fn: (q: Query) => Promise<T>,
): Promise<T> {
  if (session.role !== 'ADMIN') throw new Error(ONLY_ADMIN);
  return withServiceRole(async (q) => {
    await q.run(`select set_config('request.jwt.claim.sub', $1, true)`, [session.userId]);
    await q.run(`select set_config('app.origin', $1, true)`, [origin]);
    return fn(q);
  });
}

export interface ActionResult<T = undefined> {
  ok: boolean;
  error?: string;
  data?: T;
}

export const denied: ActionResult<never> = {
  ok: false,
  error: 'Només un ADMIN pot fer aquesta acció. La base de dades també ho impedeix.',
};

/** Reads a trimmed string field from a form, or null when it is empty. */
export function field(formData: FormData, name: string): string | null {
  const raw = formData.get(name);
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  return value === '' ? null : value;
}

export function requiredField(formData: FormData, name: string): string {
  return field(formData, name) ?? '';
}
