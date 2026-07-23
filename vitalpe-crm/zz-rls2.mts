import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
const DIR = '/private/tmp/claude-501/-Users-marc-Desktop-Escritorio-Claude-Code/625500fd-ef85-4a2a-bc82-a9d6cba1d8a6/scratchpad/crmcopy';
const db = new PGlite(DIR, { extensions: { pg_trgm } });
await db.waitReady;
const ADMIN='20b5d17e-2096-4347-b55c-d5773328320c', GER='0c4cab92-a7a6-48ea-ba21-9e75ea11df8b', COM='766d9156-ac43-4961-90b3-0f807949655e';
async function asUser(uid: string, label: string, sql: string, params: unknown[] = []) {
  await db.exec('begin');
  try { await db.exec('set local role authenticated');
    await db.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid]);
    await db.query(`select set_config('request.jwt.claim.role','authenticated', true)`, []);
    const r = await db.query(sql, params);
    console.log(`OK   ${label}: ${JSON.stringify(r.rows).slice(0,220)}`);
  } catch (e) { console.log(`FAIL ${label}: ${(e as Error).message}`); }
  await db.exec('rollback');
}
await asUser(ADMIN,'dup decision (param actor)',`update public.duplicate_candidates set decision='IGNORAR', decided_by=$1, decided_at=now(), decision_note='x' where id=(select id from public.duplicate_candidates where decision='PENDENT' limit 1) returning id, decision::text`,[ADMIN]);
await asUser(GER,'GERENT dup decision',`update public.duplicate_candidates set decision='IGNORAR', decided_by=$1 where id=(select id from public.duplicate_candidates where decision='PENDENT' limit 1) returning id`,[GER]);
await asUser(ADMIN,'invitation (param actor)',`insert into public.workspace_invitations (workspace_id,email,role,token_hash,expires_at,invited_by) values ('00000000-0000-4000-8000-000000000001','x@y.z','COMERCIAL','h',now()+interval '7 days',$1) returning id, status::text`,[ADMIN]);
await asUser(ADMIN,'imports insert (param actor)',`insert into public.imports (workspace_id,label,status,created_by) values ('00000000-0000-4000-8000-000000000001','t','BORRADOR',$1) returning id`,[ADMIN]);
await asUser(ADMIN,'unmapped resolve (param actor)',`update public.unmapped_values set resolved_to='x', resolved_at=now(), resolved_by=$1 where kind='PRODUCTE' returning id`,[ADMIN]);
await asUser(ADMIN,'import_mappings insert',`insert into public.import_mappings (workspace_id,name,mapping,created_by) values ('00000000-0000-4000-8000-000000000001','t','{}'::jsonb,$1) returning id`,[ADMIN]);
await asUser(GER,'GERENT import_mappings insert',`insert into public.import_mappings (workspace_id,name,mapping,created_by) values ('00000000-0000-4000-8000-000000000001','t2','{}'::jsonb,$1) returning id`,[GER]);
await asUser(COM,'COMERCIAL invitation read',`select count(*) from public.workspace_invitations`);
await asUser(GER,'GERENT invitation read',`select count(*) from public.workspace_invitations`);
await asUser(COM,'COMERCIAL memberships read',`select count(*) from public.workspace_memberships`);
await asUser(ADMIN,'membership status deactivate',`update public.workspace_memberships set status='DESACTIVAT' where user_id=$1 returning id, status::text`,[COM]);
await asUser(ADMIN,'profiles update other',`update public.profiles set is_active=false where id=$1 returning id`,[COM]);
await asUser(ADMIN,'audit filters',`select entity, action, actor_id, created_at from public.audit_log order by created_at desc limit 2`);
await asUser(COM,'COMERCIAL products read',`select count(*) from public.products`);
await asUser(ADMIN,'campaigns insert',`insert into public.campaigns (name, year_start) values ('ZZ',2030) returning id`);
await db.close();
