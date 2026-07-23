/**
 * Shared fixtures for the database test suites.
 *
 * Each suite gets a fresh in-memory Postgres with the real migrations and the
 * real seed applied, plus two workspaces and one user per role, so cross-tenant
 * and cross-role assertions are always available.
 */
import type { PGlite } from '@electric-sql/pglite';
import { createDatabase, asService, asUser } from '../../scripts/maintenance/pglite.js';

export interface Fixture {
  db: PGlite;
  ws: string;
  wsOther: string;
  admin: string;
  gerent: string;
  comercial: string;
  comercialB: string;
  outsider: string;
  productId: string;
  campaignId: string;
}

async function scalar<T>(db: PGlite, sql: string, params: unknown[] = []): Promise<T> {
  const res = await db.query<Record<string, T>>(sql, params);
  const row = res.rows[0];
  if (!row) throw new Error(`No rows for: ${sql}`);
  return Object.values(row)[0] as T;
}

async function makeUser(db: PGlite, ws: string, email: string, role: string): Promise<string> {
  const id = await scalar<string>(
    db,
    `insert into auth.users (email) values ($1) returning id`,
    [email],
  );
  await db.query(
    `insert into public.workspace_memberships (workspace_id, user_id, role, status, activated_at)
     values ($1, $2, $3::app.user_role, 'ACTIU', now())`,
    [ws, id, role],
  );
  return id;
}

export async function setup(): Promise<Fixture> {
  const db = await createDatabase({ seed: true });

  return asService(db, async () => {
    const ws = await scalar<string>(db, `select id from public.workspaces where slug = 'vitalpe'`);
    const wsOther = await scalar<string>(
      db,
      `insert into public.workspaces (name, slug) values ('ALTRE CELLER', 'altre') returning id`,
    );

    const admin = await makeUser(db, ws, 'admin@test.local', 'ADMIN');
    const gerent = await makeUser(db, ws, 'gerent@test.local', 'GERENT');
    const comercial = await makeUser(db, ws, 'comercial@test.local', 'COMERCIAL');
    const comercialB = await makeUser(db, ws, 'comercial.b@test.local', 'COMERCIAL');
    const outsider = await makeUser(db, wsOther, 'fora@test.local', 'ADMIN');

    const productId = await scalar<string>(
      db,
      `select id from public.products where name = 'VI BLANC CUPATGE BASE CAVA GUARDA'`,
    );
    const campaignId = await scalar<string>(
      db,
      `select id from public.campaigns where name = '2025-2026'`,
    );

    return { db, ws, wsOther, admin, gerent, comercial, comercialB, outsider, productId, campaignId };
  });
}

/** Creates a company owned by `owner`, bypassing RLS. */
export async function makeClient(
  f: Fixture,
  name: string,
  options: { owner?: string; workspace?: string; type?: string } = {},
): Promise<string> {
  return asService(f.db, async () => {
    const id = await scalar<string>(
      f.db,
      `insert into public.clients (workspace_id, name, owner_id, client_type_code)
       values ($1, $2, $3, $4) returning id`,
      [options.workspace ?? f.ws, name, options.owner ?? null, options.type ?? null],
    );
    if (options.owner) {
      await f.db.query(
        `insert into public.client_assignments (workspace_id, client_id, user_id, is_owner)
         values ($1, $2, $3, true)`,
        [options.workspace ?? f.ws, id, options.owner],
      );
    }
    return id;
  });
}

export async function makeTask(
  f: Fixture,
  clientId: string,
  options: { assignee?: string; action?: string; due?: string | null; priority?: string } = {},
): Promise<string> {
  return asService(f.db, () =>
    scalar<string>(
      f.db,
      `insert into public.tasks
         (workspace_id, kind, action, client_id, due_at, priority, assigned_to, created_by)
       values ($1, 'TASCA', $2::app.commercial_action, $3,
               case when $4::text is null then null else $4::timestamptz end,
               $5::app.task_priority, $6, $6)
       returning id`,
      [
        f.ws, options.action ?? 'TRUCAR', clientId, options.due ?? null,
        options.priority ?? 'MITJANA', options.assignee ?? f.comercial,
      ],
    ),
  );
}

export { asService, asUser };

/** Asserts that a statement is rejected, whatever the exact error text. */
export async function expectRejected(fn: () => Promise<unknown>): Promise<Error> {
  try {
    await fn();
  } catch (error) {
    return error as Error;
  }
  throw new Error('S\'esperava que la sentència fos rebutjada, però ha passat.');
}
