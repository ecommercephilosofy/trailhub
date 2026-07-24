/**
 * Row Level Security.
 *
 * These run against the real migrations on a real Postgres (PGlite), as the
 * `authenticated` role with `auth.uid()` populated — the same context
 * PostgREST establishes. If a policy is wrong, these fail; a passing suite is
 * the evidence that hiding a button is not what protects the data.
 */
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { asService, asUser, expectRejected, makeClient, makeTask, setup, type Fixture } from './helpers.js';

let f: Fixture;

beforeAll(async () => {
  f = await setup();
}, 120_000);

afterAll(async () => {
  await f?.db.close();
});

describe('aïllament entre espais de treball', () => {
  it('un membre no veu les empreses d\'un altre espai', async () => {
    await makeClient(f, 'CELLER DEL VEÍ', { workspace: f.wsOther });
    await makeClient(f, 'CELLER PROPI');

    const mine = await asUser(f.db, f.admin, () =>
      f.db.query<{ name: string }>(`select name from public.clients`),
    );
    const names = mine.rows.map((r) => r.name);
    expect(names).toContain('CELLER PROPI');
    expect(names).not.toContain('CELLER DEL VEÍ');
  });

  it('un usuari extern no veu res del nostre espai ni tan sols sent ADMIN al seu', async () => {
    const rows = await asUser(f.db, f.outsider, () =>
      f.db.query(`select id from public.clients where workspace_id = $1`, [f.ws]),
    );
    expect(rows.rows).toHaveLength(0);
  });

  it('no es pot inserir una empresa a un espai on no s\'és membre', async () => {
    await expectRejected(() =>
      asUser(f.db, f.comercial, () =>
        f.db.query(
          `insert into public.clients (workspace_id, name) values ($1, 'INTRUS')`,
          [f.wsOther],
        ),
      ),
    );
  });

  it('un usuari sense sessió no llegeix res', async () => {
    const rows = await asUser(f.db, null, () => f.db.query(`select id from public.clients`), 'anon');
    expect(rows.rows).toHaveLength(0);
  });
});

describe('rols com a conjunts de permisos', () => {
  it('un COMERCIAL veu totes les empreses de l\'espai', async () => {
    await makeClient(f, 'EMPRESA VISIBLE PER TOTHOM');
    const rows = await asUser(f.db, f.comercial, () =>
      f.db.query<{ name: string }>(`select name from public.clients where name = 'EMPRESA VISIBLE PER TOTHOM'`),
    );
    expect(rows.rows).toHaveLength(1);
  });

  it('un COMERCIAL només pot editar les empreses que té assignades', async () => {
    const mine = await makeClient(f, 'ASSIGNADA AL COMERCIAL A', { owner: f.comercial });
    const theirs = await makeClient(f, 'ASSIGNADA AL COMERCIAL B', { owner: f.comercialB });

    const okRows = await asUser(f.db, f.comercial, () =>
      f.db.query(`update public.clients set municipality = 'Subirats' where id = $1 returning id`, [mine]),
    );
    expect(okRows.rows).toHaveLength(1);

    // Not an error — RLS filters the row out, so nothing is updated.
    const blocked = await asUser(f.db, f.comercial, () =>
      f.db.query(`update public.clients set municipality = 'Robatori' where id = $1 returning id`, [theirs]),
    );
    expect(blocked.rows).toHaveLength(0);
  });

  it('un GERENT pot editar qualsevol empresa de l\'espai', async () => {
    const theirs = await makeClient(f, 'EMPRESA DEL COMERCIAL B', { owner: f.comercialB });
    const rows = await asUser(f.db, f.gerent, () =>
      f.db.query(`update public.clients set municipality = 'Lavern' where id = $1 returning id`, [theirs]),
    );
    expect(rows.rows).toHaveLength(1);
  });

  it('un COMERCIAL no es pot apujar el rol', async () => {
    const blocked = await asUser(f.db, f.comercial, () =>
      f.db.query(
        `update public.workspace_memberships set role = 'ADMIN'
          where user_id = $1 and workspace_id = $2 returning id`,
        [f.comercial, f.ws],
      ),
    );
    expect(blocked.rows).toHaveLength(0);

    const role = await asService(f.db, () =>
      f.db.query<{ role: string }>(
        `select role::text as role from public.workspace_memberships where user_id = $1`,
        [f.comercial],
      ),
    );
    expect(role.rows[0]?.role).toBe('COMERCIAL');
  });

  it('un GERENT no pot canviar rols ni convidar', async () => {
    const blocked = await asUser(f.db, f.gerent, () =>
      f.db.query(
        `update public.workspace_memberships set role = 'ADMIN' where user_id = $1 returning id`,
        [f.comercial],
      ),
    );
    expect(blocked.rows).toHaveLength(0);

    await expectRejected(() =>
      asUser(f.db, f.gerent, () =>
        f.db.query(
          `insert into public.workspace_invitations (workspace_id, email, role, token_hash, expires_at)
           values ($1, 'nou@test.local', 'COMERCIAL', 'hash', now() + interval '7 days')`,
          [f.ws],
        ),
      ),
    );
  });

  it('un ADMIN sí que pot convidar', async () => {
    const rows = await asUser(f.db, f.admin, () =>
      f.db.query(
        `insert into public.workspace_invitations (workspace_id, email, role, token_hash, expires_at)
         values ($1, 'convidat@test.local', 'COMERCIAL', 'hash', now() + interval '7 days')
         returning id`,
        [f.ws],
      ),
    );
    expect(rows.rows).toHaveLength(1);
  });
});

describe('historial comercial', () => {
  it('un COMERCIAL pot afegir una acció però no esborrar-ne cap', async () => {
    const client = await makeClient(f, 'EMPRESA AMB HISTORIAL', { owner: f.comercial });
    // History is signed: the app always writes user_id = auth.uid().
    await asUser(f.db, f.comercial, () =>
      f.db.query(
        `insert into public.activities (workspace_id, client_id, activity_type, result, notes, user_id)
         values ($1, $2, 'TRUCADA', 'DEMANA PREUS', 'Primera trucada', $3)`,
        [f.ws, client, f.comercial],
      ),
    );

    // No DELETE policy exists on activities, so the delete affects no rows.
    const deleted = await asUser(f.db, f.comercial, () =>
      f.db.query(`delete from public.activities where client_id = $1 returning id`, [client]),
    );
    expect(deleted.rows).toHaveLength(0);

    const still = await asUser(f.db, f.comercial, () =>
      f.db.query(`select id from public.activities where client_id = $1`, [client]),
    );
    expect(still.rows).toHaveLength(1);
  });

  it('un COMERCIAL no pot modificar una acció ja registrada; un GERENT sí, i queda auditat', async () => {
    const client = await makeClient(f, 'EMPRESA HISTORIAL 2', { owner: f.comercial });
    const created = await asUser(f.db, f.comercial, () =>
      f.db.query<{ id: string }>(
        `insert into public.activities (workspace_id, client_id, activity_type, result, notes, user_id)
         values ($1, $2, 'VISITA', 'INTERES CONCRET', 'Text original', $3) returning id`,
        [f.ws, client, f.comercial],
      ),
    );
    const activityId = created.rows[0]!.id;

    const blocked = await asUser(f.db, f.comercial, () =>
      f.db.query(`update public.activities set notes = 'Reescrit' where id = $1 returning id`, [activityId]),
    );
    expect(blocked.rows).toHaveLength(0);

    const allowed = await asUser(f.db, f.gerent, () =>
      f.db.query(`update public.activities set notes = 'Correcció del gerent' where id = $1 returning id`, [activityId]),
    );
    expect(allowed.rows).toHaveLength(1);

    const audit = await asService(f.db, () =>
      f.db.query<{ before_value: { notes: string }; after_value: { notes: string } }>(
        `select before_value, after_value from public.audit_log
          where entity = 'activities' and entity_id = $1 and action = 'UPDATE'`,
        [activityId],
      ),
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0]?.before_value.notes).toBe('Text original');
    expect(audit.rows[0]?.after_value.notes).toBe('Correcció del gerent');
  });
});

describe('auditoria', () => {
  it('un COMERCIAL no llegeix el registre d\'auditoria', async () => {
    const rows = await asUser(f.db, f.comercial, () => f.db.query(`select id from public.audit_log`));
    expect(rows.rows).toHaveLength(0);
  });

  it('un GERENT el llegeix però no el pot alterar', async () => {
    const rows = await asUser(f.db, f.gerent, () => f.db.query(`select id from public.audit_log limit 1`));
    expect(rows.rows.length).toBeGreaterThan(0);

    const updated = await asUser(f.db, f.gerent, () =>
      f.db.query(`update public.audit_log set action = 'INSERT' returning id`),
    );
    expect(updated.rows).toHaveLength(0);

    const deleted = await asUser(f.db, f.gerent, () =>
      f.db.query(`delete from public.audit_log returning id`),
    );
    expect(deleted.rows).toHaveLength(0);
  });
});

describe('dades personals i integracions', () => {
  it('la connexió de Google d\'un usuari no la veu ningú més, ni el gerent', async () => {
    await asService(f.db, () =>
      f.db.query(
        `insert into public.google_calendar_connections (workspace_id, user_id, calendar_id, calendar_name)
         values ($1, $2, 'cal-privat', 'Personal')`,
        [f.ws, f.comercial],
      ),
    );

    const own = await asUser(f.db, f.comercial, () =>
      f.db.query(`select id from public.google_calendar_connections`),
    );
    expect(own.rows).toHaveLength(1);

    const manager = await asUser(f.db, f.gerent, () =>
      f.db.query(`select id from public.google_calendar_connections`),
    );
    expect(manager.rows).toHaveLength(0);
  });

  it('els tokens xifrats no són seleccionables pel rol del client', async () => {
    const error = await expectRejected(() =>
      asUser(f.db, f.comercial, () =>
        f.db.query(`select refresh_token_enc from public.google_calendar_connections`),
      ),
    );
    expect(error.message).toMatch(/permission denied|no permission/i);
  });

  it('les notes de veu són privades de qui les grava (el gerent només les llegeix)', async () => {
    await asService(f.db, () =>
      f.db.query(
        `insert into public.voice_notes (workspace_id, user_id, transcript)
         values ($1, $2, 'Transcripció privada')`,
        [f.ws, f.comercial],
      ),
    );
    const other = await asUser(f.db, f.comercialB, () =>
      f.db.query(`select id from public.voice_notes`),
    );
    expect(other.rows).toHaveLength(0);

    const manager = await asUser(f.db, f.gerent, () =>
      f.db.query(`select id from public.voice_notes`),
    );
    expect(manager.rows.length).toBeGreaterThan(0);
  });

  it('els esdeveniments de geolocalització són estrictament personals', async () => {
    const client = await makeClient(f, 'EMPRESA GEO');
    await asService(f.db, () =>
      f.db.query(
        `insert into public.geofence_events (workspace_id, user_id, client_id, event_type)
         values ($1, $2, $3, 'ENTRADA')`,
        [f.ws, f.comercial, client],
      ),
    );
    for (const user of [f.gerent, f.admin, f.comercialB]) {
      const rows = await asUser(f.db, user, () => f.db.query(`select id from public.geofence_events`));
      expect(rows.rows).toHaveLength(0);
    }
    const own = await asUser(f.db, f.comercial, () => f.db.query(`select id from public.geofence_events`));
    expect(own.rows).toHaveLength(1);
  });
});

describe('importacions i fusions', () => {
  it('un COMERCIAL no veu les importacions ni la cua de duplicats', async () => {
    await asService(f.db, () =>
      f.db.query(
        `insert into public.imports (workspace_id, label, status) values ($1, 'Prova', 'APLICAT')`,
        [f.ws],
      ),
    );
    const imports = await asUser(f.db, f.comercial, () => f.db.query(`select id from public.imports`));
    expect(imports.rows).toHaveLength(0);

    const dupes = await asUser(f.db, f.comercial, () =>
      f.db.query(`select id from public.duplicate_candidates`),
    );
    expect(dupes.rows).toHaveLength(0);
  });

  it('la fusió d\'empreses no és executable des del rol del client', async () => {
    const a = await makeClient(f, 'FUSIO A');
    const b = await makeClient(f, 'FUSIO B');
    const error = await expectRejected(() =>
      asUser(f.db, f.admin, () =>
        f.db.query(`select app.merge_clients($1, $2, 'prova')`, [a, b]),
      ),
    );
    expect(error.message).toMatch(/permission denied|no permission/i);
  });
});

describe('catàlegs mestres', () => {
  it('un ADMIN pot escriure al catàleg de productes; un COMERCIAL no', async () => {
    const created = await asUser(f.db, f.admin, () =>
      f.db.query<{ id: string }>(
        `insert into public.products (name, category) values ('PRODUCTE DE PROVA RLS', 'ALTRES / SENSE DO') returning id`,
      ),
    );
    expect(created.rows).toHaveLength(1);

    await expectRejected(() =>
      asUser(f.db, f.comercial, () =>
        f.db.query(
          `insert into public.products (name, category) values ('INTRUS', 'ALTRES / SENSE DO')`,
        ),
      ),
    );
  });

  it('un ADMIN pot mapar un àlies de producte i crear campanyes', async () => {
    const alias = await asUser(f.db, f.admin, () =>
      f.db.query<{ id: string }>(
        `insert into public.product_aliases (product_id, alias)
         select id, 'ALIES DE PROVA RLS' from public.products limit 1 returning id`,
      ),
    );
    expect(alias.rows).toHaveLength(1);

    const campaign = await asUser(f.db, f.admin, () =>
      f.db.query<{ id: string }>(
        `insert into public.campaigns (name, year_start) values ('2098-2099', 2098) returning id`,
      ),
    );
    expect(campaign.rows).toHaveLength(1);
  });

  it('un GERENT no toca els catàlegs mestres', async () => {
    await expectRejected(() =>
      asUser(f.db, f.gerent, () =>
        f.db.query(`insert into public.campaigns (name, year_start) values ('2097-2098', 2097)`),
      ),
    );
  });
});

describe('signatura de l\'historial', () => {
  it('un COMERCIAL no pot inserir una acció atribuïda a un altre usuari', async () => {
    const client = await makeClient(f, 'EMPRESA SIGNATURA', { owner: f.comercial });
    await expectRejected(() =>
      asUser(f.db, f.comercial, () =>
        f.db.query(
          `insert into public.activities (workspace_id, client_id, activity_type, result, notes, user_id)
           values ($1, $2, 'TRUCADA', 'NO DETERMINAT', 'suplantacio', $3)`,
          [f.ws, client, f.comercialB],
        ),
      ),
    );
  });

  it('un GERENT sí que pot registrar en nom d\'un comercial (tancar la seva tasca)', async () => {
    const client = await makeClient(f, 'EMPRESA SIGNATURA GERENT', { owner: f.comercial });
    const rows = await asUser(f.db, f.gerent, () =>
      f.db.query<{ id: string }>(
        `insert into public.activities (workspace_id, client_id, activity_type, result, notes, user_id)
         values ($1, $2, 'TRUCADA', 'NO DETERMINAT', 'registrat pel gerent', $3) returning id`,
        [f.ws, client, f.comercial],
      ),
    );
    expect(rows.rows).toHaveLength(1);
  });
});

describe('tasques', () => {
  it('un COMERCIAL pot completar la seva tasca però no la d\'un altre', async () => {
    const client = await makeClient(f, 'EMPRESA TASQUES', { owner: f.comercial });
    const mine = await makeTask(f, client, { assignee: f.comercial, due: '2026-07-23T09:00:00Z' });
    const theirs = await makeTask(f, client, { assignee: f.comercialB, due: '2026-07-23T09:00:00Z' });

    await asUser(f.db, f.comercial, () =>
      f.db.query(`select app.complete_task($1, 'DEMANA PREUS'::app.activity_result, 'fet')`, [mine]),
    );
    const done = await asService(f.db, () =>
      f.db.query<{ status: string }>(`select status::text as status from public.tasks where id = $1`, [mine]),
    );
    expect(done.rows[0]?.status).toBe('FET');

    // complete_task runs as the caller, so RLS filters the other commercial's
    // task out of the UPDATE. The function must refuse rather than write an
    // activity for a task it could not close.
    // Postgres applies the UPDATE policy to `SELECT … FOR UPDATE` as well, so
    // the function stops at the lock and never reaches the write. Either guard
    // is acceptable; what matters is that it refuses.
    const error = await expectRejected(() =>
      asUser(f.db, f.comercial, () =>
        f.db.query(`select app.complete_task($1, 'DEMANA PREUS'::app.activity_result, 'intent')`, [theirs]),
      ),
    );
    expect(error.message).toMatch(/TASCA_NO_TROBADA|SENSE_PERMIS_PER_TANCAR_TASCA/);

    const untouched = await asService(f.db, () =>
      f.db.query<{ status: string }>(`select status::text as status from public.tasks where id = $1`, [theirs]),
    );
    expect(untouched.rows[0]?.status).toBe('PENDENT');

    // …and no phantom history was written for it.
    const activities = await asService(f.db, () =>
      f.db.query(`select id from public.activities where source_task_id = $1`, [theirs]),
    );
    expect(activities.rows).toHaveLength(0);
  });
});
