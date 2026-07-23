/**
 * SQL runner used by the import pipeline.
 *
 * The same pipeline runs against a real Supabase/Postgres instance
 * (`DATABASE_URL` set) and against local PGlite (no Docker, no network).
 * All normalisation and dedupe scoring is done *by the database*, using the
 * `app.normalize_*` functions the schema already defines — so the importer can
 * never disagree with the constraints and triggers it is writing through.
 */
import type { PGlite } from '@electric-sql/pglite';

export interface SqlRunner {
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  exec(sql: string): Promise<void>;
  begin(): Promise<void>;
  commit(): Promise<void>;
  rollback(): Promise<void>;
  close(): Promise<void>;
  readonly kind: 'pglite' | 'postgres';
}

export class PGliteRunner implements SqlRunner {
  readonly kind = 'pglite' as const;
  constructor(private readonly db: PGlite) {}

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.db.query<T>(sql, params);
    return result.rows;
  }
  async exec(sql: string): Promise<void> {
    await this.db.exec(sql);
  }
  async begin(): Promise<void> {
    await this.db.exec('begin');
  }
  async commit(): Promise<void> {
    await this.db.exec('commit');
  }
  async rollback(): Promise<void> {
    await this.db.exec('rollback');
  }
  async close(): Promise<void> {
    await this.db.close();
  }
}

/**
 * postgres.js adapter. Loaded dynamically so the dependency is only required
 * when actually importing into a hosted database.
 */
export class PostgresRunner implements SqlRunner {
  readonly kind = 'postgres' as const;
  private constructor(private readonly sql: (s: string, p?: unknown[]) => Promise<unknown[]>,
                      private readonly end: () => Promise<void>) {}

  static async connect(connectionString: string): Promise<PostgresRunner> {
    const mod = (await import('postgres').catch(() => {
      throw new Error(
        'DATABASE_URL is set but the "postgres" package is not installed. Run: pnpm add -D postgres',
      );
    })) as unknown as { default: (url: string, opts?: Record<string, unknown>) => any };
    const client = mod.default(connectionString, { max: 1, prepare: false });
    return new PostgresRunner(
      (s: string, p: unknown[] = []) => client.unsafe(s, p as never[]),
      () => client.end({ timeout: 5 }),
    );
  }

  async query<T = Record<string, unknown>>(sql: string, params: unknown[] = []): Promise<T[]> {
    return (await this.sql(sql, params)) as T[];
  }
  async exec(sql: string): Promise<void> {
    await this.sql(sql);
  }
  async begin(): Promise<void> {
    await this.sql('begin');
  }
  async commit(): Promise<void> {
    await this.sql('commit');
  }
  async rollback(): Promise<void> {
    await this.sql('rollback');
  }
  async close(): Promise<void> {
    await this.end();
  }
}

export interface OpenDbOptions {
  /** Persist the PGlite database here instead of using memory. */
  dataDir?: string;
  /** Apply migrations + seed before returning (PGlite only). */
  fresh?: boolean;
}

export async function openDatabase(options: OpenDbOptions = {}): Promise<SqlRunner> {
  const url = process.env.DATABASE_URL;
  if (url) {
    return PostgresRunner.connect(url);
  }
  const { createDatabase } = await import('../maintenance/pglite.js');
  const db = await createDatabase({
    seed: true,
    ...(options.dataDir ? { dataDir: options.dataDir } : {}),
  });
  return new PGliteRunner(db);
}

/** Convenience: single row or null. */
export async function one<T = Record<string, unknown>>(
  db: SqlRunner,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  const rows = await db.query<T>(sql, params);
  return rows[0] ?? null;
}

/** Convenience: scalar of the first column of the first row. */
export async function scalar<T>(db: SqlRunner, sql: string, params: unknown[] = []): Promise<T | null> {
  const row = await one<Record<string, T>>(db, sql, params);
  if (!row) return null;
  const first = Object.values(row)[0];
  return (first ?? null) as T | null;
}
