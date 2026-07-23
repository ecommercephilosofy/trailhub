/**
 * Domain rules, exercised against the real schema.
 *
 * Covers the checklist in section 41 of the brief: companies, classification,
 * opportunities, history, tasks and visits — plus the integrity constraints
 * that are supposed to make bad states unrepresentable.
 */
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest';
import { asService, asUser, expectRejected, makeClient, setup, type Fixture } from './helpers.js';

let f: Fixture;

beforeAll(async () => {
  f = await setup();
}, 120_000);

afterAll(async () => {
  await f?.db.close();
});

/** Everything in this suite runs with full privileges; RLS has its own file. */
const sql = <T = Record<string, unknown>>(text: string, params: unknown[] = []) =>
  asService(f.db, async () => (await f.db.query<T>(text, params)).rows);

const one = async <T = Record<string, unknown>>(text: string, params: unknown[] = []): Promise<T> => {
  const rows = await sql<T>(text, params);
  if (!rows[0]) throw new Error(`Cap fila per: ${text}`);
  return rows[0];
};

async function classificationOf(clientId: string): Promise<string | null> {
  const row = await one<{ c: string | null }>(
    `select proposed_classification::text as c from public.clients where id = $1`,
    [clientId],
  );
  return row.c;
}

async function addActivity(
  clientId: string,
  result: string,
  options: { daysAgo?: number; type?: string; notes?: string } = {},
): Promise<void> {
  await sql(
    `insert into public.activities (workspace_id, client_id, occurred_on, activity_type, result, notes)
     values ($1, $2, current_date - ($3 || ' days')::interval, $4::app.activity_type,
             $5::app.activity_result, $6)`,
    [f.ws, clientId, options.daysAgo ?? 1, options.type ?? 'TRUCADA', result, options.notes ?? 'nota'],
  );
}

async function addPurchase(clientId: string, monthsAgo: number, liters = 25000): Promise<string> {
  const opp = await one<{ id: string }>(
    `insert into public.opportunities
       (workspace_id, client_id, product_id, campaign_id, data_type, volume_liters, status)
     values ($1,$2,$3,$4,'COMPRA REAL',$5,'GUANYADA')
     on conflict do nothing
     returning id`,
    [f.ws, clientId, f.productId, f.campaignId, liters],
  );
  await sql(
    `insert into public.opportunity_deliveries
       (workspace_id, opportunity_id, guide_number, guide_date, volume_liters)
     values ($1,$2,$3, (current_date - ($4 || ' months')::interval)::date, $5)`,
    [f.ws, opp.id, `G-${Math.random().toString(36).slice(2, 8)}`, monthsAgo, liters],
  );
  return opp.id;
}

// ---------------------------------------------------------------------------
describe('empreses', () => {
  it('rebutja un nom buit', async () => {
    await expectRejected(() =>
      sql(`insert into public.clients (workspace_id, name) values ($1, '   ')`, [f.ws]),
    );
  });

  it('col·lapsa la forma jurídica en comparar noms', async () => {
    const rows = await sql<{ a: string; b: string; equal: boolean }>(
      `select app.normalize_company('MASIA ROMAGOSA S.L.') as a,
              app.normalize_company('Masia Romagosa SL') as b,
              app.normalize_company('MASIA ROMAGOSA S.L.') = app.normalize_company('Masia Romagosa SL') as equal`,
    );
    expect(rows[0]?.equal).toBe(true);
  });

  it('impedeix duplicar el nom canònic dins l\'espai', async () => {
    await makeClient(f, 'CELLER ÚNIC SL');
    await expectRejected(() =>
      sql(`insert into public.clients (workspace_id, name) values ($1, 'Celler Únic, S.L.')`, [f.ws]),
    );
  });

  it('permet el mateix nom en un altre espai de treball', async () => {
    await makeClient(f, 'NOM COMPARTIT');
    const rows = await sql<{ id: string }>(
      `insert into public.clients (workspace_id, name) values ($1, 'NOM COMPARTIT') returning id`,
      [f.wsOther],
    );
    expect(rows).toHaveLength(1);
  });

  it('conserva els àlies i hi permet cercar', async () => {
    const id = await makeClient(f, 'BODEGUES SUMARROCA');
    await sql(
      `insert into public.client_aliases (workspace_id, client_id, alias, source)
       values ($1, $2, 'Sumarroca, S.L.', 'importació')`,
      [f.ws, id],
    );
    const hit = await sql<{ client_id: string }>(
      `select client_id from public.client_aliases
        where workspace_id = $1 and alias_norm = app.normalize_company('SUMARROCA SL')`,
      [f.ws],
    );
    expect(hit[0]?.client_id).toBe(id);
  });

  it('ALTRES com a tipus d\'empresa exigeix explicació', async () => {
    await expectRejected(() =>
      sql(
        `insert into public.clients (workspace_id, name, client_type_code)
         values ($1, 'SENSE EXPLICACIO', 'ALTRES')`,
        [f.ws],
      ),
    );
    const ok = await sql(
      `insert into public.clients (workspace_id, name, client_type_code, other_client_type)
       values ($1, 'AMB EXPLICACIO', 'ALTRES', 'RESTAURANT') returning id`,
      [f.ws],
    );
    expect(ok).toHaveLength(1);
  });

  it('el borrat és lògic i restaurable', async () => {
    const id = await makeClient(f, 'EMPRESA A DONAR DE BAIXA');
    await sql(
      `update public.clients set deleted_at = now(), deleted_reason = 'prova' where id = $1`,
      [id],
    );
    const hidden = await sql(
      `select id from public.clients where id = $1 and deleted_at is null`, [id],
    );
    expect(hidden).toHaveLength(0);

    await sql(`update public.clients set deleted_at = null, deleted_reason = null where id = $1`, [id]);
    const back = await sql(`select id from public.clients where id = $1 and deleted_at is null`, [id]);
    expect(back).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
describe('contactes', () => {
  it('només un contacte principal actiu per empresa', async () => {
    const id = await makeClient(f, 'EMPRESA CONTACTES');
    await sql(
      `insert into public.contacts (workspace_id, client_id, first_name, is_primary)
       values ($1,$2,'Primer', true)`,
      [f.ws, id],
    );
    await expectRejected(() =>
      sql(
        `insert into public.contacts (workspace_id, client_id, first_name, is_primary)
         values ($1,$2,'Segon', true)`,
        [f.ws, id],
      ),
    );
  });

  it('canviar de contacte principal no perd l\'anterior', async () => {
    const id = await makeClient(f, 'EMPRESA CANVI CONTACTE');
    await sql(
      `insert into public.contacts (workspace_id, client_id, first_name, is_primary)
       values ($1,$2,'Antic', true)`,
      [f.ws, id],
    );
    await sql(`update public.contacts set is_primary = false where client_id = $1`, [id]);
    await sql(
      `insert into public.contacts (workspace_id, client_id, first_name, is_primary)
       values ($1,$2,'Nou', true)`,
      [f.ws, id],
    );
    const all = await sql<{ first_name: string }>(
      `select first_name from public.contacts where client_id = $1 order by created_at`, [id],
    );
    expect(all.map((c) => c.first_name)).toEqual(['Antic', 'Nou']);
  });

  it('un contacte necessita alguna dada identificativa', async () => {
    const id = await makeClient(f, 'EMPRESA CONTACTE BUIT');
    await expectRejected(() =>
      sql(`insert into public.contacts (workspace_id, client_id) values ($1,$2)`, [f.ws, id]),
    );
  });
});

// ---------------------------------------------------------------------------
describe('classificació proposada', () => {
  let client: string;

  beforeEach(async () => {
    client = await makeClient(f, `EMPRESA CLASSIFICACIO ${Math.random().toString(36).slice(2, 9)}`);
  });

  it('sense evidència no proposa res', async () => {
    expect(await classificationOf(client)).toBeNull();
  });

  it('una compra recent proposa ACTIU SEGUR', async () => {
    await addPurchase(client, 3);
    await sql(`select app.refresh_proposed_classification($1)`, [client]);
    expect(await classificationOf(client)).toBe('ACTIU SEGUR');
  });

  it('una previsió confirmada proposa ACTIU SEGUR', async () => {
    await sql(
      `insert into public.opportunities
         (workspace_id, client_id, product_id, campaign_id, data_type, volume_liters, status)
       values ($1,$2,$3,$4,'PREVISIO CONFIRMADA',10000,'OBERTA')`,
      [f.ws, client, f.productId, f.campaignId],
    );
    expect(await classificationOf(client)).toBe('ACTIU SEGUR');
  });

  it('REPETIRÀ COMANDA proposa ACTIU SEGUR', async () => {
    await addActivity(client, 'REPETIRA COMANDA');
    expect(await classificationOf(client)).toBe('ACTIU SEGUR');
  });

  it('demanar preus proposa POTENCIAL INTERESSAT', async () => {
    await addActivity(client, 'DEMANA PREUS');
    expect(await classificationOf(client)).toBe('POTENCIAL INTERESSAT');
  });

  it('demanar mostres o acordar visita també proposen POTENCIAL INTERESSAT', async () => {
    await addActivity(client, 'DEMANA MOSTRES');
    expect(await classificationOf(client)).toBe('POTENCIAL INTERESSAT');
    await addActivity(client, 'ACORDAR VISITA');
    expect(await classificationOf(client)).toBe('POTENCIAL INTERESSAT');
  });

  it('tenir un altre proveïdor proposa POTENCIAL AMB UN ALTRE PROVEIDOR', async () => {
    await addActivity(client, 'TE UN ALTRE PROVEIDOR');
    expect(await classificationOf(client)).toBe('POTENCIAL AMB UN ALTRE PROVEIDOR');
  });

  it('una compra antiga sense relació viva proposa POTENCIAL AMB UN ALTRE PROVEIDOR', async () => {
    await addPurchase(client, 30);
    await sql(`select app.refresh_proposed_classification($1)`, [client]);
    expect(await classificationOf(client)).toBe('POTENCIAL AMB UN ALTRE PROVEIDOR');
  });

  it('«no compra vi a granel» proposa NO POTENCIAL', async () => {
    await addActivity(client, 'NO COMPRA VI A GRANEL');
    expect(await classificationOf(client)).toBe('NO POTENCIAL');
  });

  it('NO POTENCIAL preval sobre una compra recent quan el tancament és recent', async () => {
    await addPurchase(client, 2);
    await sql(`select app.refresh_proposed_classification($1)`, [client]);
    expect(await classificationOf(client)).toBe('ACTIU SEGUR');

    await addActivity(client, 'TANCAT / INACTIU', { daysAgo: 5 });
    expect(await classificationOf(client)).toBe('NO POTENCIAL');
  });

  it('ACTIU SEGUR preval sobre INTERESSAT quan hi ha les dues evidències', async () => {
    await addActivity(client, 'DEMANA PREUS');
    expect(await classificationOf(client)).toBe('POTENCIAL INTERESSAT');
    await addPurchase(client, 1);
    await sql(`select app.refresh_proposed_classification($1)`, [client]);
    expect(await classificationOf(client)).toBe('ACTIU SEGUR');
  });

  it('una empresa marcada INACTIVA és NO POTENCIAL', async () => {
    await sql(`select app.record_verification($1, 'INACTIVA', 'trucada', 'ha tancat')`, [client]);
    expect(await classificationOf(client)).toBe('NO POTENCIAL');
  });

  it('la classificació confirmada no la canvia mai el motor', async () => {
    await addActivity(client, 'DEMANA PREUS');
    await sql(`update public.clients set confirmed_classification = 'ACTIU SEGUR' where id = $1`, [client]);
    await addActivity(client, 'TE UN ALTRE PROVEIDOR');
    const row = await one<{ confirmed: string; proposed: string }>(
      `select confirmed_classification::text as confirmed, proposed_classification::text as proposed
         from public.clients where id = $1`,
      [client],
    );
    expect(row.confirmed).toBe('ACTIU SEGUR');
    expect(row.proposed).toBe('POTENCIAL INTERESSAT');
  });

  it('la discrepància entre proposada i confirmada es fa visible', async () => {
    await addActivity(client, 'DEMANA PREUS');
    await sql(`update public.clients set confirmed_classification = 'NO POTENCIAL',
                 not_potential_reason = 'motiu' where id = $1`, [client]);
    const row = await one<{ has_classification_discrepancy: boolean }>(
      `select has_classification_discrepancy from public.v_client_derived where client_id = $1`,
      [client],
    );
    expect(row.has_classification_discrepancy).toBe(true);
  });

  it('NO POTENCIAL exigeix un motiu', async () => {
    await expectRejected(() =>
      sql(`update public.clients set confirmed_classification = 'NO POTENCIAL' where id = $1`, [client]),
    );
  });

  it('confirmar exigeix un usuari: la IA no pot', async () => {
    const error = await expectRejected(() =>
      sql(`select app.confirm_classification($1, 'ACTIU SEGUR')`, [client]),
    );
    expect(error.message).toContain('CONFIRMACIO_REQUEREIX_USUARI');
  });

  it('un usuari sí que pot confirmar', async () => {
    const owned = await makeClient(f, 'EMPRESA CONFIRMABLE', { owner: f.comercial });
    await asUser(f.db, f.comercial, () =>
      f.db.query(`select app.confirm_classification($1, 'POTENCIAL INTERESSAT')`, [owned]),
    );
    const row = await one<{ c: string; by: string }>(
      `select confirmed_classification::text as c, classification_confirmed_by::text as by
         from public.clients where id = $1`,
      [owned],
    );
    expect(row.c).toBe('POTENCIAL INTERESSAT');
    expect(row.by).toBe(f.comercial);
  });
});

// ---------------------------------------------------------------------------
describe('verificació', () => {
  it('no sobreescriu verificacions anteriors', async () => {
    const id = await makeClient(f, 'EMPRESA VERIFICACIONS');
    await sql(`select app.record_verification($1, 'ACTIVA', 'web', 'primera')`, [id]);
    await sql(`select app.record_verification($1, 'DUBTOSA', 'trucada', 'segona')`, [id]);
    const history = await sql<{ status: string }>(
      `select status::text as status from public.client_verifications
        where client_id = $1 order by verified_at`,
      [id],
    );
    expect(history.map((h) => h.status)).toEqual(['ACTIVA', 'DUBTOSA']);
  });

  it('marca com a caducada una verificació de fa més d\'un any', async () => {
    const id = await makeClient(f, 'EMPRESA VERIFICACIO ANTIGA');
    await sql(`update public.clients set last_verified_at = now() - interval '13 months' where id = $1`, [id]);
    const row = await one<{ verification_is_stale: boolean }>(
      `select verification_is_stale from public.v_client_derived where client_id = $1`, [id],
    );
    expect(row.verification_is_stale).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe('oportunitats', () => {
  let client: string;
  beforeEach(async () => {
    client = await makeClient(f, `EMPRESA OPORTUNITATS ${Math.random().toString(36).slice(2, 9)}`);
  });

  it('accepta un volum buit', async () => {
    const rows = await sql(
      `insert into public.opportunities
         (workspace_id, client_id, product_id, campaign_id, data_type)
       values ($1,$2,$3,$4,'POSSIBLE COMPRA') returning id`,
      [f.ws, client, f.productId, f.campaignId],
    );
    expect(rows).toHaveLength(1);
  });

  it('rebutja un volum negatiu o zero', async () => {
    for (const volume of [-1, 0]) {
      await expectRejected(() =>
        sql(
          `insert into public.opportunities
             (workspace_id, client_id, product_id, campaign_id, data_type, volume_liters)
           values ($1,$2,$3,$4,'COMPRA REAL',$5)`,
          [f.ws, client, f.productId, f.campaignId, volume],
        ),
      );
    }
  });

  it('ALTRES a la previsió exigeix observacions', async () => {
    await expectRejected(() =>
      sql(
        `insert into public.opportunities
           (workspace_id, client_id, product_id, campaign_id, data_type, forecast_next)
         values ($1,$2,$3,$4,'POSSIBLE COMPRA','ALTRES')`,
        [f.ws, client, f.productId, f.campaignId],
      ),
    );
  });

  it('el gra és empresa + producte + campanya + tipus de dada', async () => {
    await sql(
      `insert into public.opportunities
         (workspace_id, client_id, product_id, campaign_id, data_type, volume_liters)
       values ($1,$2,$3,$4,'COMPRA REAL',1000)`,
      [f.ws, client, f.productId, f.campaignId],
    );
    // Same grain -> rejected.
    await expectRejected(() =>
      sql(
        `insert into public.opportunities
           (workspace_id, client_id, product_id, campaign_id, data_type, volume_liters)
         values ($1,$2,$3,$4,'COMPRA REAL',2000)`,
        [f.ws, client, f.productId, f.campaignId],
      ),
    );
    // Different data type on the same product+campaign -> allowed.
    const ok = await sql(
      `insert into public.opportunities
         (workspace_id, client_id, product_id, campaign_id, data_type, volume_liters)
       values ($1,$2,$3,$4,'PREVISIO CONFIRMADA',2000) returning id`,
      [f.ws, client, f.productId, f.campaignId],
    );
    expect(ok).toHaveLength(1);
  });

  it('conserva compres de campanyes diferents sense sobreescriure', async () => {
    const older = await one<{ id: string }>(
      `select id from public.campaigns where name = '2024-2025'`,
    );
    await sql(
      `insert into public.opportunities
         (workspace_id, client_id, product_id, campaign_id, data_type, volume_liters)
       values ($1,$2,$3,$4,'COMPRA REAL',5000)`,
      [f.ws, client, f.productId, older.id],
    );
    await sql(
      `insert into public.opportunities
         (workspace_id, client_id, product_id, campaign_id, data_type, volume_liters)
       values ($1,$2,$3,$4,'COMPRA REAL',7000)`,
      [f.ws, client, f.productId, f.campaignId],
    );
    const rows = await sql<{ volume_liters: string }>(
      `select volume_liters from public.opportunities where client_id = $1 order by volume_liters`,
      [client],
    );
    expect(rows).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
describe('historial i dades derivades', () => {
  it('ALTRES com a resultat exigeix observacions', async () => {
    const id = await makeClient(f, 'EMPRESA RESULTAT ALTRES');
    await expectRejected(() =>
      sql(
        `insert into public.activities (workspace_id, client_id, activity_type, result)
         values ($1,$2,'TRUCADA','ALTRES')`,
        [f.ws, id],
      ),
    );
  });

  it('actualitza últim contacte i últim resultat', async () => {
    const id = await makeClient(f, 'EMPRESA DERIVATS');
    await addActivity(id, 'DEMANA PREUS', { daysAgo: 10 });
    await addActivity(id, 'ACORDAR VISITA', { daysAgo: 2 });
    const row = await one<{ last_result: string; last_contact_on: string }>(
      `select last_result::text as last_result, last_contact_on::text as last_contact_on
         from public.v_client_derived where client_id = $1`,
      [id],
    );
    expect(row.last_result).toBe('ACORDAR VISITA');
  });

  it('una acció històrica no es pot esborrar sense motiu', async () => {
    const id = await makeClient(f, 'EMPRESA HISTORIAL PROTEGIT');
    await addActivity(id, 'DEMANA PREUS');
    await expectRejected(() =>
      sql(`update public.activities set deleted_at = now() where client_id = $1`, [id]),
    );
  });
});

// ---------------------------------------------------------------------------
describe('tasques', () => {
  let client: string;
  beforeEach(async () => {
    client = await makeClient(f, `EMPRESA TASQUES ${Math.random().toString(36).slice(2, 9)}`, {
      owner: f.comercial,
    });
  });

  const newTask = async (due: string | null, priority = 'MITJANA'): Promise<string> => {
    const row = await one<{ id: string }>(
      `insert into public.tasks
         (workspace_id, kind, action, client_id, due_at, priority, assigned_to, created_by)
       values ($1,'TASCA','TRUCAR',$2,
               case when $3::text is null then null else $3::timestamptz end,
               $4::app.task_priority,$5,$5)
       returning id`,
      [f.ws, client, due, priority, f.comercial],
    );
    return row.id;
  };

  it('una tasca sense data no és vençuda ni surt al tauler diari', async () => {
    await newTask(null);
    const dashboard = await sql(
      `select id from public.tasks
        where client_id = $1 and status = 'PENDENT' and due_at is not null`,
      [client],
    );
    expect(dashboard).toHaveLength(0);

    const derived = await one<{ undated_tasks: string; overdue_tasks: string }>(
      `select undated_tasks::text, overdue_tasks::text from public.v_client_derived where client_id = $1`,
      [client],
    );
    expect(Number(derived.undated_tasks)).toBe(1);
    expect(Number(derived.overdue_tasks)).toBe(0);
  });

  it('programar una tasca sense data no en duplica el registre', async () => {
    const id = await newTask(null);
    await sql(`select app.schedule_undated_task($1, now() + interval '2 days')`, [id]);
    const rows = await sql<{ id: string; due_at: string }>(
      `select id, due_at from public.tasks where client_id = $1`, [client],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(id);
    expect(rows[0]?.due_at).not.toBeNull();
  });

  it('programar una tasca que ja tenia data falla', async () => {
    const id = await newTask('2026-08-01T09:00:00Z');
    const error = await expectRejected(() =>
      sql(`select app.schedule_undated_task($1, now())`, [id]),
    );
    expect(error.message).toContain('TASCA_NO_ES_SENSE_DATA');
  });

  it('no es pot marcar FET sense resultat', async () => {
    const id = await newTask('2026-08-01T09:00:00Z');
    await expectRejected(() =>
      sql(`update public.tasks set status = 'FET', completed_at = now() where id = $1`, [id]),
    );
  });

  it('completar crea l\'acció històrica i vincula l\'origen', async () => {
    const id = await newTask('2026-08-01T09:00:00Z');
    await asUser(f.db, f.comercial, () =>
      f.db.query(`select app.complete_task($1, 'DEMANA PREUS'::app.activity_result, 'trucada feta')`, [id]),
    );
    const activity = await one<{ activity_type: string; source_task_id: string; result: string }>(
      `select activity_type::text as activity_type, source_task_id::text as source_task_id,
              result::text as result
         from public.activities where source_task_id = $1`,
      [id],
    );
    expect(activity.activity_type).toBe('TRUCADA');
    expect(activity.result).toBe('DEMANA PREUS');
  });

  it('completar amb resultat ALTRES exigeix observacions', async () => {
    const id = await newTask('2026-08-01T09:00:00Z');
    const error = await expectRejected(() =>
      asUser(f.db, f.comercial, () =>
        f.db.query(`select app.complete_task($1, 'ALTRES'::app.activity_result, null)`, [id]),
      ),
    );
    expect(error.message).toContain('OBSERVACIONS_OBLIGATORIES_ALTRES');
  });

  it('no es pot completar dues vegades', async () => {
    const id = await newTask('2026-08-01T09:00:00Z');
    await asUser(f.db, f.comercial, () =>
      f.db.query(`select app.complete_task($1, 'NO DETERMINAT'::app.activity_result, null)`, [id]),
    );
    const error = await expectRejected(() =>
      asUser(f.db, f.comercial, () =>
        f.db.query(`select app.complete_task($1, 'NO DETERMINAT'::app.activity_result, null)`, [id]),
      ),
    );
    expect(error.message).toContain('TASCA_JA_FETA');
  });

  it('ajornar exigeix una data nova i manté la mateixa tasca', async () => {
    const id = await newTask('2026-08-01T09:00:00Z');
    const error = await expectRejected(() => sql(`select app.postpone_task($1, null)`, [id]));
    expect(error.message).toContain('NOVA_DATA_OBLIGATORIA');

    await sql(`select app.postpone_task($1, '2026-09-15T10:00:00Z'::timestamptz, 'de vacances')`, [id]);
    const rows = await sql<{ id: string; status: string }>(
      `select id, status::text as status from public.tasks where client_id = $1`, [client],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('PENDENT');
  });

  it('les tasques tancades surten de les vistes actives però queden a l\'històric', async () => {
    const id = await newTask('2026-08-01T09:00:00Z');
    await asUser(f.db, f.comercial, () =>
      f.db.query(`select app.complete_task($1, 'NO DETERMINAT'::app.activity_result, null)`, [id]),
    );
    const active = await sql(
      `select id from public.tasks where client_id = $1 and status = 'PENDENT'`, [client],
    );
    expect(active).toHaveLength(0);
    const all = await sql(`select id from public.tasks where client_id = $1`, [client]);
    expect(all).toHaveLength(1);
  });

  it('cada canvi de data queda auditat', async () => {
    const id = await newTask('2026-08-01T09:00:00Z');
    await sql(`select app.postpone_task($1, '2026-09-01T09:00:00Z'::timestamptz)`, [id]);
    const audit = await sql(
      `select id from public.audit_log where entity = 'tasks' and entity_id = $1 and action = 'UPDATE'`,
      [id],
    );
    expect(audit.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
describe('visites', () => {
  it('crear una visita crea la tasca vinculada en una sola transacció', async () => {
    const client = await makeClient(f, 'EMPRESA VISITES', { owner: f.comercial });
    const row = await one<{ visit_id: string; task_id: string }>(
      `select * from app.create_visit_with_task(
         $1, $2, $3, '2026-08-10T09:00:00Z'::timestamptz, '2026-08-10T10:30:00Z'::timestamptz)`,
      [f.ws, client, f.comercial],
    );
    const task = await one<{ action: string; visit_id: string; duration_minutes: number }>(
      `select action::text as action, visit_id::text as visit_id, duration_minutes
         from public.tasks where id = $1`,
      [row.task_id],
    );
    expect(task.action).toBe('VISITA');
    expect(task.visit_id).toBe(row.visit_id);
    expect(Number(task.duration_minutes)).toBe(90);

    const derived = await one<{ next_visit_id: string }>(
      `select next_visit_id::text as next_visit_id from public.v_client_derived where client_id = $1`,
      [client],
    );
    expect(derived.next_visit_id).toBe(row.visit_id);
  });

  it('rebutja una visita amb hora de fi anterior a l\'inici', async () => {
    const client = await makeClient(f, 'EMPRESA VISITA INVALIDA');
    const error = await expectRejected(() =>
      sql(
        `select * from app.create_visit_with_task(
           $1, $2, $3, '2026-08-10T12:00:00Z'::timestamptz, '2026-08-10T09:00:00Z'::timestamptz)`,
        [f.ws, client, f.comercial],
      ),
    );
    expect(error.message).toContain('HORA_FI_ANTERIOR_A_INICI');
  });

  it('cancel·lar des de Google no esborra res: marca i conserva', async () => {
    const client = await makeClient(f, 'EMPRESA VISITA CANCELADA');
    const created = await one<{ visit_id: string; task_id: string }>(
      `select * from app.create_visit_with_task(
         $1, $2, $3, '2026-08-11T09:00:00Z'::timestamptz, '2026-08-11T10:00:00Z'::timestamptz)`,
      [f.ws, client, f.comercial],
    );
    await sql(`select app.cancel_visit($1, 'esborrada a Google', 'GOOGLE CALENDAR')`, [created.visit_id]);

    const visit = await one<{ status: string; origin: string; deleted_at: string | null }>(
      `select status::text as status, cancellation_origin::text as origin, deleted_at
         from public.visits where id = $1`,
      [created.visit_id],
    );
    expect(visit.status).toBe('CANCEL·LADA');
    expect(visit.origin).toBe('GOOGLE CALENDAR');
    expect(visit.deleted_at).toBeNull();

    const task = await one<{ status: string }>(
      `select status::text as status from public.tasks where id = $1`, [created.task_id],
    );
    expect(task.status).toBe('CANCEL·LAT');
  });
});

// ---------------------------------------------------------------------------
describe('fusió d\'empreses', () => {
  it('conserva l\'origen, els contactes i l\'historial, i deixa desfer', async () => {
    const survivor = await makeClient(f, 'CELLER SUPERVIVENT');
    const merged = await makeClient(f, 'CELLER FUSIONAT');
    await sql(
      `insert into public.contacts (workspace_id, client_id, first_name) values ($1,$2,'Contacte fusionat')`,
      [f.ws, merged],
    );
    await addActivity(merged, 'DEMANA PREUS');

    const mergeId = await one<{ merge_clients: string }>(
      `select app.merge_clients($1, $2, 'mateix NIF', false)`, [survivor, merged],
    );
    expect(mergeId.merge_clients).toBeTruthy();

    const contacts = await sql(`select id from public.contacts where client_id = $1`, [survivor]);
    expect(contacts.length).toBeGreaterThan(0);

    const activities = await sql(`select id from public.activities where client_id = $1`, [survivor]);
    expect(activities.length).toBeGreaterThan(0);

    const alias = await sql(
      `select id from public.client_aliases
        where client_id = $1 and alias_norm = app.normalize_company('CELLER FUSIONAT')`,
      [survivor],
    );
    expect(alias).toHaveLength(1);

    const loser = await one<{ deleted_at: string | null }>(
      `select deleted_at from public.clients where id = $1`, [merged],
    );
    expect(loser.deleted_at).not.toBeNull();

    const snapshot = await one<{ snapshot: { client: { name: string } } }>(
      `select snapshot from public.client_merges where merged_client_id = $1`, [merged],
    );
    expect(snapshot.snapshot.client.name).toBe('CELLER FUSIONAT');
  });

  it('no es pot fusionar una empresa amb ella mateixa', async () => {
    const id = await makeClient(f, 'CELLER SOL');
    const error = await expectRejected(() =>
      sql(`select app.merge_clients($1, $1, 'prova')`, [id]),
    );
    expect(error.message).toContain('FUSIO_MATEIXA_EMPRESA');
  });
});

// ---------------------------------------------------------------------------
describe('geolocalització', () => {
  it('no accepta mitja coordenada', async () => {
    const id = await makeClient(f, 'EMPRESA COORDENADES');
    await expectRejected(() =>
      sql(
        `insert into public.client_locations (workspace_id, client_id, latitude)
         values ($1,$2,41.4)`,
        [f.ws, id],
      ),
    );
  });

  it('una empresa sense coordenades queda PENDENT DE GEOLOCALITZAR', async () => {
    const id = await makeClient(f, 'EMPRESA SENSE COORDENADES');
    await sql(
      `insert into public.client_locations (workspace_id, client_id, street, municipality)
       values ($1,$2,'Carrer Major 1','Subirats')`,
      [f.ws, id],
    );
    const row = await one<{ geo_status: string }>(
      `select geo_status from public.v_client_geo_status where client_id = $1`, [id],
    );
    expect(row.geo_status).toBe('PENDENT DE GEOLOCALITZAR');
  });

  it('calcula distàncies i ordena els clients propers', async () => {
    const near = await makeClient(f, 'CELLER PROP DE LAVERN');
    const far = await makeClient(f, 'CELLER DE GIRONA');
    // Lavern (Subirats) ~41.3800, 1.7300
    await sql(
      `insert into public.client_locations (workspace_id, client_id, latitude, longitude, municipality)
       values ($1,$2,41.3810,1.7320,'Subirats'), ($1,$3,41.9800,2.8200,'Girona')`,
      [f.ws, near, far],
    );
    const rows = await sql<{ client_name: string; distance_m: number }>(
      `select client_name, distance_m from app.nearby_clients($1, 41.3800, 1.7300, 25000)`,
      [f.ws],
    );
    expect(rows[0]?.client_name).toBe('CELLER PROP DE LAVERN');
    expect(rows.map((r) => r.client_name)).not.toContain('CELLER DE GIRONA');
    expect(Number(rows[0]?.distance_m)).toBeLessThan(500);
  });
});

// ---------------------------------------------------------------------------
describe('normalització', () => {
  it('normalitza telèfons espanyols a E.164', async () => {
    const row = await one<{ a: string; b: string; c: string }>(
      `select app.normalize_phone('669 46 00 79') as a,
              app.normalize_phone('+34 669 460 079') as b,
              app.normalize_phone('0034669460079') as c`,
    );
    expect(row.a).toBe('+34669460079');
    expect(row.b).toBe('+34669460079');
    expect(row.c).toBe('+34669460079');
  });

  it('reconeix els dominis genèrics per no fusionar-hi mai', async () => {
    const row = await one<{ generic: boolean; corporate: boolean }>(
      `select app.is_generic_email_domain(app.domain_of_email('algu@gmail.com')) as generic,
              app.is_generic_email_domain(app.domain_of_email('info@albetinoya.cat')) as corporate`,
    );
    expect(row.generic).toBe(true);
    expect(row.corporate).toBe(false);
  });

  it('neteja protocol i www dels dominis web', async () => {
    const row = await one<{ a: string; b: string }>(
      `select app.normalize_domain('https://www.Albetinoya.cat') as a,
              app.normalize_domain('albetinoya.cat') as b`,
    );
    expect(row.a).toBe('albetinoya.cat');
    expect(row.b).toBe('albetinoya.cat');
  });
});
