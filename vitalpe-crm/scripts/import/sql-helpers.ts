/**
 * The importer's database seam, dependency-free on purpose.
 *
 * `passes.ts` and `pipeline.ts` run in two hosts: the CLI (tsx, connection
 * from `db.ts`) and the web admin importer (Next, connection wrapped from the
 * app's own data layer). This file is what both sides import, so that the web
 * bundle never drags in `db.ts` — whose PGlite branch must not exist inside
 * the web process, where the app already holds the single writer on the local
 * database.
 */

export interface SqlRunner {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
  readonly kind: 'pglite' | 'postgres';
}

/** Single row or null. */
export async function one<T = Record<string, unknown>>(
  db: SqlRunner,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await db.query<T>(sql, params);
  return rows[0] ?? null;
}

/** First column of the first row, or null. */
export async function scalar<T>(
  db: SqlRunner,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const row = await one<Record<string, T>>(db, sql, params);
  if (!row) return null;
  const first = Object.values(row)[0];
  return (first ?? null) as T | null;
}
