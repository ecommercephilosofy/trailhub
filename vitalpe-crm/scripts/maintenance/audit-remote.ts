/**
 * `pnpm audit:remote` — proves, against the REAL production database, the
 * assumptions the app makes about it. Read-only: every write test runs inside
 * a transaction that is rolled back.
 *
 * Exists because PGlite passing proves the SQL is right, not that Supabase's
 * environment (role grants, auth.uid() implementation, pooler behaviour)
 * matches what the code expects.
 */
import { loadEnv } from '../load-env';

loadEnv();

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('✗ DATABASE_URL no definida');
  process.exit(1);
}

const { default: postgres } = await import('postgres');
const sql = postgres(url, { max: 1, prepare: false, connect_timeout: 30 });

let pass = 0;
let fail = 0;
const failures: string[] = [];

function ok(name: string, condition: boolean, detail = ''): void {
  if (condition) {
    pass += 1;
    console.log(`  ✓ ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    failures.push(name);
    console.log(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

try {
  console.log(`\nAUDITORIA REMOTA — ${new URL(url).host}\n`);

  // ─── A. La identitat que el codi assumeix ────────────────────────────────
  console.log('── A. Rols i auth.uid() ──');

  const marc = await sql<{ id: string }[]>`
    select id from public.profiles where email = 'mdelgadolinde@gmail.com'
  `;
  const marcId = marc[0]?.id;
  ok('perfil ADMIN present', Boolean(marcId));

  // Can this connection adopt the API role at all?
  let canSetRole = false;
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`set local role authenticated`);
      canSetRole = true;
      throw new Error('rollback');
    });
  } catch (e) {
    if ((e as Error).message !== 'rollback' && !canSetRole) canSetRole = false;
  }
  ok('SET LOCAL ROLE authenticated permès al pooler', canSetRole);

  // Does auth.uid() resolve the GUC the app sets?
  let uidResolved: string | null = null;
  let uidJsonResolved: string | null = null;
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(`select set_config('request.jwt.claim.sub', '${marcId}', true)`);
      const [row] = await tx.unsafe(`select auth.uid()::text as uid`) as unknown as { uid: string | null }[];
      uidResolved = row?.uid ?? null;
      throw new Error('rollback');
    });
  } catch { /* rolled back */ }
  try {
    await sql.begin(async (tx) => {
      await tx.unsafe(
        `select set_config('request.jwt.claims', '{"sub":"${marcId}","role":"authenticated"}', true)`,
      );
      const [row] = await tx.unsafe(`select auth.uid()::text as uid`) as unknown as { uid: string | null }[];
      uidJsonResolved = row?.uid ?? null;
      throw new Error('rollback');
    });
  } catch { /* rolled back */ }
  ok('auth.uid() via request.jwt.claim.sub', uidResolved === marcId, uidResolved ?? 'null');
  ok('auth.uid() via request.jwt.claims (json)', uidJsonResolved === marcId, uidJsonResolved ?? 'null');

  // ─── B. RLS amb el rol real ──────────────────────────────────────────────
  console.log('\n── B. RLS efectiva com a authenticated ──');

  async function asUser<T>(uid: string | null, query: string): Promise<T[]> {
    let rows: T[] = [];
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', true)`);
        await tx.unsafe(
          `select set_config('request.jwt.claims', '${uid ? `{"sub":"${uid}","role":"authenticated"}` : '{}'}', true)`,
        );
        await tx.unsafe(`set local role authenticated`);
        rows = (await tx.unsafe(query)) as unknown as T[];
        throw new Error('rollback');
      });
    } catch (e) {
      if ((e as Error).message !== 'rollback') throw e;
    }
    return rows;
  }

  const asMember = await asUser<{ n: number }>(marcId!, `select count(*)::int as n from public.clients`);
  ok('membre veu les empreses', (asMember[0]?.n ?? 0) > 700, `${asMember[0]?.n ?? 0}`);

  const asStranger = await asUser<{ n: number }>(
    '00000000-0000-4000-8000-00000000dead',
    `select count(*)::int as n from public.clients`,
  );
  ok('desconegut no veu res', (asStranger[0]?.n ?? -1) === 0, `${asStranger[0]?.n}`);

  let tokenBlocked = false;
  try {
    await asUser(marcId!, `select refresh_token_enc from public.google_calendar_connections limit 1`);
  } catch (e) {
    tokenBlocked = /permission denied/i.test((e as Error).message);
  }
  ok('columnes de tokens vetades al rol client', tokenBlocked);

  let auditBlocked = true;
  try {
    const rows = await asUser<{ n: number }>(
      marcId!,
      `select count(*)::int as n from (select 1 from public.audit_log limit 5) s`,
    );
    // ADMIN is manager: may read. The point is DELETE/UPDATE are impossible.
    auditBlocked = true;
    void rows;
  } catch { auditBlocked = false; }
  let auditDeleteBlocked = false;
  try {
    const del = await asUser<{ id: number }>(marcId!, `delete from public.audit_log returning id`);
    auditDeleteBlocked = del.length === 0;
  } catch { auditDeleteBlocked = true; }
  ok('audit_log llegible per manager', auditBlocked);
  ok('audit_log no esborrable', auditDeleteBlocked);

  // ─── C. Funcions de domini executables ───────────────────────────────────
  console.log('\n── C. Funcions de domini ──');
  const fns = await sql<{ f: string; can: boolean }[]>`
    select p.proname as f,
           has_function_privilege('authenticated', p.oid, 'EXECUTE') as can
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'app'
       and p.proname in ('complete_task','postpone_task','schedule_undated_task',
                         'create_visit_with_task','cancel_visit','confirm_classification',
                         'record_verification','nearby_clients')
  `;
  for (const f of fns) ok(`EXECUTE app.${f.f}`, f.can);
  const merge = await sql<{ can: boolean }[]>`
    select has_function_privilege('authenticated', 'app.merge_clients(uuid,uuid,text,boolean,jsonb)'::regprocedure, 'EXECUTE') as can
  `;
  ok('merge_clients VETAT a authenticated', merge[0]?.can === false);

  // ─── D. Mestres escrivibles per ADMIN (sospita de forat) ─────────────────
  console.log('\n── D. Catàlegs mestres com a ADMIN ──');
  for (const [table, insert] of [
    ['products', `insert into public.products (name, category) values ('__AUDIT__', 'ALTRES / SENSE DO')`],
    ['product_aliases', `insert into public.product_aliases (product_id, alias) select id, '__AUDIT__' from public.products limit 1`],
    ['campaigns', `insert into public.campaigns (name, year_start) values ('__AUDIT__', 2099)`],
    ['client_types', `insert into public.client_types (code, label) values ('__AUDIT__', 'x')`],
  ] as const) {
    let writable = false;
    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(`select set_config('request.jwt.claim.sub', '${marcId}', true)`);
        await tx.unsafe(`set local role authenticated`);
        await tx.unsafe(insert);
        writable = true;
        throw new Error('rollback');
      });
    } catch (e) {
      if ((e as Error).message !== 'rollback') writable = false;
    }
    ok(`ADMIN pot escriure a ${table}`, writable);
  }

  // ─── E. Cerca difusa ─────────────────────────────────────────────────────
  console.log('\n── E. Cerca ──');
  const trgm = await asUser<{ name: string }[]>(
    marcId!,
    `select name from public.clients where name_norm % app.normalize_company('bodegas pinord') limit 3`,
  );
  ok('cerca per trigrames amb RLS', trgm.length > 0, trgm[0] ? (trgm[0] as unknown as { name: string }).name : '');

  // ─── F. Integritat de dades ──────────────────────────────────────────────
  console.log('\n── F. Integritat ──');
  const [integrity] = await sql<Record<string, number>[]>`
    select
      (select count(*) from public.clients where deleted_at is null)::int as empreses,
      (select count(*) from public.clients where deleted_at is null and proposed_classification is not null)::int as amb_proposta,
      (select count(*) from public.contacts ct where not exists
         (select 1 from public.clients c where c.id = ct.client_id))::int as contactes_orfes,
      (select count(*) from public.opportunities o where not exists
         (select 1 from public.products p where p.id = o.product_id))::int as oport_sense_producte,
      (select count(*) from public.import_rows where outcome = 'PENDENT')::int as staging_pendent,
      (select count(*) from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity)::int as taules_sense_rls
  `;
  ok('empreses = 801', integrity!.empreses === 801, String(integrity!.empreses));
  ok('propostes de classificació calculades', integrity!.amb_proposta! > 100, String(integrity!.amb_proposta));
  ok('cap contacte orfe', integrity!.contactes_orfes === 0);
  ok('cap oportunitat sense producte', integrity!.oport_sense_producte === 0);
  ok('staging sense files PENDENT', integrity!.staging_pendent === 0, String(integrity!.staging_pendent));
  ok('totes les taules amb RLS', integrity!.taules_sense_rls === 0);

  const [derived] = await sql<{ n: number }[]>`
    select count(*)::int as n from public.v_client_derived limit 1
  `;
  ok('v_client_derived respon', (derived?.n ?? 0) >= 0);

  console.log(`\n══ ${pass} correctes · ${fail} fallades ══`);
  if (failures.length > 0) console.log(`Fallades: ${failures.join(' | ')}\n`);
} finally {
  await sql.end({ timeout: 10 });
}
process.exit(fail > 0 ? 1 : 0);
