import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
const DIR = '/private/tmp/claude-501/-Users-marc-Desktop-Escritorio-Claude-Code/625500fd-ef85-4a2a-bc82-a9d6cba1d8a6/scratchpad/crmcopy';
const db = new PGlite(DIR, { extensions: { pg_trgm } });
await db.waitReady;
const ADMIN = '20b5d17e-2096-4347-b55c-d5773328320c';
const COM = '766d9156-ac43-4961-90b3-0f807949655e';
async function asUser(uid: string, label: string, sql: string, params: unknown[] = []) {
  await db.exec('begin');
  try {
    await db.exec('set local role authenticated');
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    await db.query(`select set_config('request.jwt.claim.role','authenticated', true)`, []);
    const r = await db.query(sql, params);
    console.log(`OK   ${label}: ${JSON.stringify(r.rows).slice(0,200)}`);
  } catch (e) { console.log(`FAIL ${label}: ${(e as Error).message}`); }
  await db.exec('rollback');
}
await asUser(ADMIN, 'admin select products', `select count(*) from public.products`);
await asUser(ADMIN, 'admin update product', `update public.products set is_active=false where sort_order=10 returning id`);
await asUser(ADMIN, 'admin insert product_alias', `insert into public.product_aliases (product_id, alias, source) select id,'ZZTEST','x' from public.products limit 1 returning id`);
await asUser(ADMIN, 'admin update dup decision', `update public.duplicate_candidates set decision='IGNORAR', decided_by=auth.uid(), decided_at=now() where decision='PENDENT' returning id limit 1`);
await asUser(ADMIN, 'admin call merge_clients', `select app.merge_clients((select id from public.clients limit 1), (select id from public.clients offset 1 limit 1), 'test', false, '{}'::jsonb)`);
await asUser(ADMIN, 'admin insert invitation', `insert into public.workspace_invitations (workspace_id,email,role,token_hash,expires_at,invited_by) values ('00000000-0000-4000-8000-000000000001','x@y.z','COMERCIAL','h',now()+interval '7 days', auth.uid()) returning id`);
await asUser(ADMIN, 'admin update membership role', `update public.workspace_memberships set role='GERENT' where user_id=$1 returning id`, [COM]);
await asUser(ADMIN, 'admin insert import', `insert into public.imports (workspace_id,label,status,created_by) values ('00000000-0000-4000-8000-000000000001','t','BORRADOR',auth.uid()) returning id`);
await asUser(ADMIN, 'admin insert import_file', `insert into public.import_files (import_id, filename, byte_size, sha256) select id,'a',1,'b' from public.imports limit 1 returning id`);
await asUser(ADMIN, 'admin update unmapped', `update public.unmapped_values set resolved_to='x', resolved_at=now(), resolved_by=auth.uid() where kind='PRODUCTE' returning id`);
await asUser(ADMIN, 'admin select audit', `select count(*) from public.audit_log`);
await asUser(COM, 'comercial select audit', `select count(*) from public.audit_log`);
await asUser(COM, 'comercial select imports', `select count(*) from public.imports`);
await asUser(COM, 'comercial select duplicates', `select count(*) from public.duplicate_candidates`);
await asUser(COM, 'comercial raise own role', `update public.workspace_memberships set role='ADMIN' where user_id=$1 returning id`, [COM]);
await asUser(COM, 'comercial select clients', `select count(*) from public.clients`);
await asUser(COM, 'comercial select excluded', `select count(*) from public.excluded_records`);
await asUser(COM, 'comercial select unmapped', `select count(*) from public.unmapped_values`);
await db.close();
