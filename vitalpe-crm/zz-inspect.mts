import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
const db = new PGlite('/private/tmp/claude-501/-Users-marc-Desktop-Escritorio-Claude-Code/625500fd-ef85-4a2a-bc82-a9d6cba1d8a6/scratchpad/crmcopy', { extensions: { pg_trgm } });
await db.waitReady;
const q = async (label: string, sql: string) => {
  try { const r = await db.query(sql); console.log(`\n### ${label}`); console.log(JSON.stringify(r.rows, null, 1).slice(0, 4000)); }
  catch (e) { console.log(`\n### ${label} ERROR: ${(e as Error).message}`); }
};
await q('imports', `select id, label, status::text, started_at, finished_at, jsonb_pretty(stats) as stats, notes, undone_at from public.imports`);
await q('counts', `select
 (select count(*) from public.clients where deleted_at is null) as clients,
 (select count(*) from public.duplicate_candidates) as dupes,
 (select count(*) from public.duplicate_candidates where decision='PENDENT') as dupes_pend,
 (select count(*) from public.excluded_records) as excluded,
 (select count(*) from public.unmapped_values) as unmapped,
 (select count(*) from public.import_rows) as import_rows,
 (select count(*) from public.import_files) as files,
 (select count(*) from public.import_sheets) as sheets,
 (select count(*) from public.field_provenance) as prov,
 (select count(*) from public.audit_log) as audit,
 (select count(*) from public.products) as products,
 (select count(*) from public.product_aliases) as prod_aliases,
 (select count(*) from public.campaigns) as campaigns,
 (select count(*) from public.opportunities) as opps,
 (select count(*) from public.contacts) as contacts,
 (select count(*) from public.tasks) as tasks,
 (select count(*) from public.visits) as visits,
 (select count(*) from public.activities) as acts,
 (select count(*) from public.opportunity_deliveries) as deliveries,
 (select count(*) from public.workspace_invitations) as invitations,
 (select count(*) from public.import_mappings) as mappings,
 (select count(*) from public.client_merges) as merges`);
await q('import_rows outcomes', `select outcome, count(*) from public.import_rows group by outcome order by 2 desc`);
await q('excluded by module', `select module, count(*) from public.excluded_records group by module`);
await q('unmapped', `select kind, raw_value, occurrences, resolved_to from public.unmapped_values order by occurrences desc limit 40`);
await q('products', `select id, name, category, is_organic, is_active, sort_order from public.products order by sort_order, name limit 60`);
await q('members', `select m.user_id, p.email, p.first_name, p.last_name, m.role::text, m.status::text, p.is_active from public.workspace_memberships m join public.profiles p on p.id=m.user_id`);
await q('workspaces', `select * from public.workspaces`);
await q('dupe sample', `select id, candidate_name, score, jsonb_pretty(signals) as signals, decision::text, is_deterministic from public.duplicate_candidates limit 3`);
await q('audit sample', `select entity, action, count(*) from public.audit_log group by 1,2 order by 3 desc limit 20`);
await db.close();
