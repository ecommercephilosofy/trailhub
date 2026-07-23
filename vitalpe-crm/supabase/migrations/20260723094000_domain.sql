-- ============================================================================
-- VITALPE CRM — 0005 DOMAIN RULES
-- Classification engine, derived client view, transactional operations
-- (complete task, create visit + task, apply voice proposal, merge clients).
--
-- These rules live here — and are mirrored 1:1 by packages/domain, which is
-- covered by the same fixture table — so they can never drift into a React
-- component.
-- ============================================================================

-- Recency windows. Changing these changes proposals everywhere at once.
create or replace function app.recent_purchase_months() returns int
  language sql immutable as $$ select 18 $$;
create or replace function app.verification_stale_months() returns int
  language sql immutable as $$ select 12 $$;

-- ---------------------------------------------------------------------------
-- CLASSIFICACIÓ PROPOSADA
-- Derived only from facts already recorded. Never invents evidence, and never
-- touches confirmed_classification (that needs a human).
-- ---------------------------------------------------------------------------
create or replace function app.propose_classification(p_client_id uuid)
returns app.classification
language plpgsql
stable
as $$
declare
  v_client public.clients%rowtype;
  v_has_recent_purchase boolean;
  v_has_confirmed_forecast boolean;
  v_has_repeat_signal boolean;
  v_has_interest boolean;
  v_has_other_supplier boolean;
  v_recent_negative boolean;
  v_has_old_purchase boolean;
  v_cutoff date;
begin
  select * into v_client from public.clients where id = p_client_id;
  if not found then return null; end if;

  v_cutoff := (now() at time zone 'Europe/Madrid')::date - (app.recent_purchase_months() || ' months')::interval;

  -- NO POTENCIAL wins only when there is a *recent* confirmation that the
  -- company cannot buy: closure, inactivity or an explicit refusal.
  select exists (
    select 1 from public.activities a
    where a.client_id = p_client_id
      and a.deleted_at is null
      and a.result in ('NO COMPRA VI A GRANEL', 'TANCAT / INACTIU', 'NO COMPRARA')
      and a.occurred_on >= v_cutoff
  ) into v_recent_negative;

  if v_recent_negative or v_client.verification_status = 'INACTIVA' then
    return 'NO POTENCIAL';
  end if;

  select exists (
    select 1 from public.opportunities o
    join public.opportunity_deliveries d on d.opportunity_id = o.id
    where o.client_id = p_client_id
      and o.deleted_at is null
      and o.data_type = 'COMPRA REAL'
      and d.guide_date >= v_cutoff
  ) into v_has_recent_purchase;

  select exists (
    select 1 from public.opportunities o
    where o.client_id = p_client_id
      and o.deleted_at is null
      and o.data_type = 'PREVISIO CONFIRMADA'
      and o.status = 'OBERTA'
  ) into v_has_confirmed_forecast;

  select exists (
    select 1 from public.opportunities o
    where o.client_id = p_client_id and o.deleted_at is null
      and o.forecast_next = 'REPETIR COMANDA'
  ) or exists (
    select 1 from public.activities a
    where a.client_id = p_client_id and a.deleted_at is null
      and a.result = 'REPETIRA COMANDA'
  ) into v_has_repeat_signal;

  if v_has_recent_purchase or v_has_confirmed_forecast or v_has_repeat_signal then
    return 'ACTIU SEGUR';
  end if;

  -- Concrete interest only. "Could buy wine" is never enough.
  select exists (
    select 1 from public.activities a
    where a.client_id = p_client_id and a.deleted_at is null
      and a.result in ('INTERES CONCRET', 'DEMANA PREUS', 'DEMANA MOSTRES', 'ACORDAR VISITA')
  ) or exists (
    select 1 from public.opportunities o
    where o.client_id = p_client_id and o.deleted_at is null
      and o.data_type = 'POSSIBLE COMPRA'
  ) into v_has_interest;

  if v_has_interest then
    return 'POTENCIAL INTERESSAT';
  end if;

  select exists (
    select 1 from public.activities a
    where a.client_id = p_client_id and a.deleted_at is null
      and a.result = 'TE UN ALTRE PROVEIDOR'
  ) into v_has_other_supplier;

  select exists (
    select 1 from public.opportunities o
    where o.client_id = p_client_id and o.deleted_at is null
      and o.data_type = 'COMPRA REAL'
  ) into v_has_old_purchase;

  -- Compatible activity but no interest shown yet, an old customer with no
  -- live relationship, or an explicit "works with someone else".
  if v_has_other_supplier or v_has_old_purchase or v_client.client_type_code is not null then
    return 'POTENCIAL AMB UN ALTRE PROVEIDOR';
  end if;

  return null; -- not enough evidence: stays PENDENT DE REVISAR
end
$$;

create or replace function app.refresh_proposed_classification(p_client_id uuid)
returns void
language plpgsql
as $$
declare
  v_new app.classification;
begin
  v_new := app.propose_classification(p_client_id);
  update public.clients
     set proposed_classification = v_new
   where id = p_client_id
     and proposed_classification is distinct from v_new;
end
$$;

create or replace function app.trg_refresh_classification()
returns trigger
language plpgsql
as $$
declare
  v_client uuid;
begin
  v_client := coalesce(
    case when tg_op = 'DELETE' then (to_jsonb(old) ->> 'client_id') else (to_jsonb(new) ->> 'client_id') end,
    ''
  )::uuid;
  if v_client is not null then
    perform app.refresh_proposed_classification(v_client);
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create trigger activities_refresh_classification
  after insert or update or delete on public.activities
  for each row execute function app.trg_refresh_classification();
create trigger opportunities_refresh_classification
  after insert or update or delete on public.opportunities
  for each row execute function app.trg_refresh_classification();

-- ---------------------------------------------------------------------------
-- Derived client facts. A view, not stored columns: it can never go stale.
-- ---------------------------------------------------------------------------
create or replace view public.v_client_derived as
select
  c.id as client_id,
  c.workspace_id,
  la.last_contact_on,
  la.last_result,
  coalesce(t.pending_tasks, 0) as pending_tasks,
  coalesce(t.overdue_tasks, 0) as overdue_tasks,
  coalesce(t.undated_tasks, 0) as undated_tasks,
  nt.next_task_at,
  nv.next_visit_at,
  nv.next_visit_id,
  coalesce(o.opportunities_count, 0) as opportunities_count,
  pc.primary_contact_id,
  pc.primary_contact_name,
  pc.primary_contact_phone,
  pc.primary_contact_email,
  (c.confirmed_classification is not null
    and c.proposed_classification is not null
    and c.confirmed_classification <> c.proposed_classification) as has_classification_discrepancy,
  (c.last_verified_at is null
    or c.last_verified_at < now() - (app.verification_stale_months() || ' months')::interval) as verification_is_stale
from public.clients c
left join lateral (
  select a.occurred_on as last_contact_on, a.result as last_result
  from public.activities a
  where a.client_id = c.id and a.deleted_at is null
  order by a.occurred_on desc, a.created_at desc
  limit 1
) la on true
left join lateral (
  select
    count(*) filter (where tk.status = 'PENDENT') as pending_tasks,
    count(*) filter (where tk.status = 'PENDENT' and tk.due_at is not null and tk.due_at < now()) as overdue_tasks,
    count(*) filter (where tk.status = 'PENDENT' and tk.due_at is null) as undated_tasks
  from public.tasks tk
  where tk.client_id = c.id and tk.deleted_at is null
) t on true
left join lateral (
  select min(tk.due_at) as next_task_at
  from public.tasks tk
  where tk.client_id = c.id and tk.deleted_at is null
    and tk.status = 'PENDENT' and tk.due_at >= now()
) nt on true
left join lateral (
  select v.starts_at as next_visit_at, v.id as next_visit_id
  from public.visits v
  where v.client_id = c.id and v.deleted_at is null
    and v.status in ('PLANIFICADA', 'CONFIRMADA') and v.starts_at >= now()
  order by v.starts_at
  limit 1
) nv on true
left join lateral (
  select count(*) as opportunities_count
  from public.opportunities o
  where o.client_id = c.id and o.deleted_at is null
) o on true
left join lateral (
  select ct.id as primary_contact_id,
         btrim(coalesce(ct.first_name, '') || ' ' || coalesce(ct.last_name, '')) as primary_contact_name,
         ct.phone as primary_contact_phone,
         ct.email as primary_contact_email
  from public.contacts ct
  where ct.client_id = c.id and ct.deleted_at is null and ct.is_active
  order by ct.is_primary desc, ct.created_at
  limit 1
) pc on true
where c.deleted_at is null;

-- ---------------------------------------------------------------------------
-- Transactional operations
-- ---------------------------------------------------------------------------

-- Completing a commercial task always writes history. Never one without the other.
create or replace function app.complete_task(
  p_task_id uuid,
  p_result app.activity_result,
  p_notes text default null
)
returns uuid
language plpgsql
security invoker
as $$
declare
  v_task public.tasks%rowtype;
  v_activity_id uuid;
  v_type app.activity_type;
begin
  select * into v_task from public.tasks where id = p_task_id and deleted_at is null for update;
  if not found then
    raise exception 'TASCA_NO_TROBADA' using errcode = 'P0002';
  end if;
  if v_task.status = 'FET' then
    raise exception 'TASCA_JA_FETA' using errcode = 'P0001';
  end if;
  if p_result is null then
    raise exception 'RESULTAT_OBLIGATORI' using errcode = 'P0001';
  end if;
  if p_result = 'ALTRES' and nullif(btrim(coalesce(p_notes, '')), '') is null then
    raise exception 'OBSERVACIONS_OBLIGATORIES_ALTRES' using errcode = 'P0001';
  end if;

  v_type := case v_task.action
    when 'TRUCAR' then 'TRUCADA'
    when 'VISITA' then 'VISITA'
    when 'MOSTRES' then 'MOSTRES'
    when 'ENVIAR CORREU' then 'CORREU'
    when 'ENVIAR PREUS' then 'OFERTA'
    when 'ENVIAR OFERTA' then 'OFERTA'
    when 'VERIFICAR EMPRESA' then 'NOTA INTERNA'
    else 'ALTRES'
  end::app.activity_type;

  update public.tasks
     set status = 'FET',
         result = p_result,
         notes = coalesce(p_notes, notes),
         completed_at = now()
   where id = p_task_id;

  if v_task.client_id is not null then
    insert into public.activities (
      workspace_id, client_id, activity_type, product_id, campaign_id,
      result, notes, user_id, source_task_id, source_visit_id, origin
    ) values (
      v_task.workspace_id, v_task.client_id, v_type, v_task.product_id, v_task.campaign_id,
      p_result, p_notes, coalesce(v_task.assigned_to, auth.uid()), v_task.id, v_task.visit_id,
      app.session_origin()
    )
    returning id into v_activity_id;
  end if;

  if v_task.visit_id is not null then
    update public.visits
       set status = 'FETA', result = p_result, notes_after = coalesce(p_notes, notes_after)
     where id = v_task.visit_id and deleted_at is null;
  end if;

  return v_activity_id;
end
$$;

-- Postponing keeps the same task row (identity + history preserved).
create or replace function app.postpone_task(p_task_id uuid, p_new_due timestamptz, p_note text default null)
returns void
language plpgsql
as $$
begin
  if p_new_due is null then
    raise exception 'NOVA_DATA_OBLIGATORIA' using errcode = 'P0001';
  end if;
  update public.tasks
     set status = 'AJORNAT', postponed_to = p_new_due, notes = coalesce(p_note, notes)
   where id = p_task_id and deleted_at is null;
  -- An AJORNAT task returns to PENDENT on its new date; keeping one row means
  -- the dashboard shows it once and the audit trail stays linear.
  update public.tasks
     set status = 'PENDENT', due_at = p_new_due, postponed_to = null
   where id = p_task_id and deleted_at is null;
end
$$;

-- Giving a date to an undated "next action" must not clone it.
create or replace function app.schedule_undated_task(p_task_id uuid, p_due timestamptz)
returns void
language plpgsql
as $$
begin
  if p_due is null then
    raise exception 'DATA_OBLIGATORIA' using errcode = 'P0001';
  end if;
  update public.tasks
     set due_at = p_due
   where id = p_task_id and deleted_at is null and due_at is null and status = 'PENDENT';
  if not found then
    raise exception 'TASCA_NO_ES_SENSE_DATA' using errcode = 'P0001';
  end if;
end
$$;

-- Visit + task are born together, in one transaction.
create or replace function app.create_visit_with_task(
  p_workspace_id uuid,
  p_client_id uuid,
  p_user_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_location_id uuid default null,
  p_title text default null,
  p_objective text default null,
  p_priority app.task_priority default 'MITJANA',
  p_sync_to_google boolean default true,
  p_from_voice boolean default false
)
returns table (visit_id uuid, task_id uuid)
language plpgsql
as $$
declare
  v_visit uuid;
  v_task uuid;
begin
  if p_ends_at <= p_starts_at then
    raise exception 'HORA_FI_ANTERIOR_A_INICI' using errcode = 'P0001';
  end if;

  insert into public.visits (
    workspace_id, client_id, location_id, user_id, title, objective,
    starts_at, ends_at, created_from_voice
  ) values (
    p_workspace_id, p_client_id, p_location_id, p_user_id,
    coalesce(p_title, 'VISITA'), p_objective, p_starts_at, p_ends_at, p_from_voice
  ) returning id into v_visit;

  insert into public.tasks (
    workspace_id, kind, action, client_id, title, due_at,
    duration_minutes, priority, assigned_to, created_by, visit_id, sync_to_google
  ) values (
    p_workspace_id, 'TASCA', 'VISITA', p_client_id, coalesce(p_title, 'VISITA'), p_starts_at,
    greatest(5, least(1440, (extract(epoch from (p_ends_at - p_starts_at)) / 60)::int)),
    p_priority, p_user_id, coalesce(auth.uid(), p_user_id), v_visit, p_sync_to_google
  ) returning id into v_task;

  update public.visits set task_id = v_task where id = v_visit;

  visit_id := v_visit;
  task_id := v_task;
  return next;
end
$$;

-- Cancelling from Google must never destroy CRM history.
create or replace function app.cancel_visit(
  p_visit_id uuid,
  p_reason text,
  p_origin app.change_origin default 'CRM'
)
returns void
language plpgsql
as $$
declare
  v_task uuid;
begin
  update public.visits
     set status = 'CANCEL·LADA',
         cancelled_at = now(),
         cancellation_reason = p_reason,
         cancellation_origin = p_origin
   where id = p_visit_id and deleted_at is null
  returning task_id into v_task;

  if v_task is not null then
    update public.tasks
       set status = 'CANCEL·LAT', notes = coalesce(notes || E'\n', '') || coalesce(p_reason, '')
     where id = v_task and deleted_at is null and status <> 'FET';
  end if;
end
$$;

-- Merge: the losing row is soft-deleted but kept, with a full snapshot so the
-- operation can be reversed.
create or replace function app.merge_clients(
  p_surviving uuid,
  p_merged uuid,
  p_reason text,
  p_automatic boolean default false,
  p_signals jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
as $$
declare
  v_ws uuid;
  v_snapshot jsonb;
  v_merge_id uuid;
  v_merged_name text;
begin
  if p_surviving = p_merged then
    raise exception 'FUSIO_MATEIXA_EMPRESA' using errcode = 'P0001';
  end if;

  select workspace_id, name into v_ws, v_merged_name from public.clients where id = p_merged;
  if v_ws is null then
    raise exception 'EMPRESA_NO_TROBADA' using errcode = 'P0002';
  end if;

  select jsonb_build_object(
    'client', to_jsonb(c),
    'contacts', coalesce((select jsonb_agg(to_jsonb(x)) from public.contacts x where x.client_id = p_merged), '[]'::jsonb),
    'locations', coalesce((select jsonb_agg(to_jsonb(x)) from public.client_locations x where x.client_id = p_merged), '[]'::jsonb),
    'aliases', coalesce((select jsonb_agg(to_jsonb(x)) from public.client_aliases x where x.client_id = p_merged), '[]'::jsonb)
  ) into v_snapshot
  from public.clients c where c.id = p_merged;

  -- The losing name survives as an alias so search still finds it.
  insert into public.client_aliases (workspace_id, client_id, alias, source)
  values (v_ws, p_surviving, v_merged_name, 'FUSIO')
  on conflict do nothing;

  insert into public.client_aliases (workspace_id, client_id, alias, source)
  select v_ws, p_surviving, a.alias, coalesce(a.source, 'FUSIO')
  from public.client_aliases a where a.client_id = p_merged
  on conflict do nothing;

  update public.contacts set client_id = p_surviving, is_primary = false where client_id = p_merged;
  update public.client_locations set client_id = p_surviving, is_primary = false where client_id = p_merged;
  update public.activities set client_id = p_surviving where client_id = p_merged;
  update public.tasks set client_id = p_surviving where client_id = p_merged;
  update public.visits set client_id = p_surviving where client_id = p_merged;
  update public.client_verifications set client_id = p_surviving where client_id = p_merged;
  update public.voice_notes set client_id = p_surviving where client_id = p_merged;
  -- Opportunities can collide on the (client, product, campaign, type) grain.
  -- Colliding rows are soft-deleted rather than dropped.
  update public.opportunities o set client_id = p_surviving
   where o.client_id = p_merged
     and not exists (
       select 1 from public.opportunities s
       where s.client_id = p_surviving and s.product_id = o.product_id
         and s.campaign_id = o.campaign_id and s.data_type = o.data_type
         and s.deleted_at is null
     );
  update public.opportunities set deleted_at = now() where client_id = p_merged and deleted_at is null;

  update public.clients
     set deleted_at = now(), deleted_reason = 'FUSIONADA amb ' || p_surviving::text
   where id = p_merged;

  insert into public.client_merges (
    workspace_id, surviving_client_id, merged_client_id, was_automatic, reason, signals, snapshot, merged_by
  ) values (
    v_ws, p_surviving, p_merged, p_automatic, p_reason, p_signals, v_snapshot, auth.uid()
  ) returning id into v_merge_id;

  perform app.refresh_proposed_classification(p_surviving);
  return v_merge_id;
end
$$;

-- Recording a verification appends to history and updates the shown status.
create or replace function app.record_verification(
  p_client_id uuid,
  p_status app.verification_status,
  p_source text,
  p_note text default null
)
returns uuid
language plpgsql
as $$
declare
  v_ws uuid;
  v_id uuid;
begin
  select workspace_id into v_ws from public.clients where id = p_client_id;
  if v_ws is null then
    raise exception 'EMPRESA_NO_TROBADA' using errcode = 'P0002';
  end if;

  insert into public.client_verifications (workspace_id, client_id, status, source, note, user_id)
  values (v_ws, p_client_id, p_status, p_source, p_note, auth.uid())
  returning id into v_id;

  update public.clients
     set verification_status = p_status,
         last_verified_at = now(),
         verification_source = p_source,
         verification_note = p_note
   where id = p_client_id;

  perform app.refresh_proposed_classification(p_client_id);
  return v_id;
end
$$;

-- Only a human confirms a classification. The AI may only propose.
create or replace function app.confirm_classification(
  p_client_id uuid,
  p_classification app.classification,
  p_not_potential_reason text default null
)
returns void
language plpgsql
as $$
begin
  if auth.uid() is null then
    raise exception 'CONFIRMACIO_REQUEREIX_USUARI' using errcode = '42501';
  end if;
  if p_classification = 'NO POTENCIAL'
     and nullif(btrim(coalesce(p_not_potential_reason, '')), '') is null then
    raise exception 'MOTIU_NO_POTENCIAL_OBLIGATORI' using errcode = 'P0001';
  end if;

  update public.clients
     set confirmed_classification = p_classification,
         not_potential_reason = case when p_classification = 'NO POTENCIAL'
                                     then p_not_potential_reason else not_potential_reason end,
         classification_confirmed_at = now(),
         classification_confirmed_by = auth.uid()
   where id = p_client_id and deleted_at is null;
end
$$;

-- Distance in metres between two WGS84 points (haversine). Avoids a hard
-- PostGIS dependency; see DECISIONS.md for the PostGIS upgrade path.
create or replace function app.distance_meters(
  lat1 double precision, lon1 double precision,
  lat2 double precision, lon2 double precision
)
returns double precision
language sql
immutable
parallel safe
as $$
  select 2 * 6371000 * asin(sqrt(
    power(sin(radians(lat2 - lat1) / 2), 2) +
    cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lon2 - lon1) / 2), 2)
  ))
$$;

-- CLIENTS PROPERS. Bounding box first so the index is usable, then exact.
create or replace function app.nearby_clients(
  p_workspace_id uuid,
  p_lat double precision,
  p_lon double precision,
  p_radius_m double precision default 25000,
  p_limit int default 25
)
returns table (
  client_id uuid,
  client_name text,
  location_id uuid,
  municipality text,
  distance_m double precision
)
language sql
stable
as $$
  with box as (
    select p_radius_m / 111320.0 as dlat,
           p_radius_m / (111320.0 * greatest(cos(radians(p_lat)), 0.01)) as dlon
  )
  select c.id, c.name, l.id, l.municipality,
         app.distance_meters(p_lat, p_lon, l.latitude, l.longitude) as distance_m
  from public.client_locations l
  join public.clients c on c.id = l.client_id and c.deleted_at is null
  cross join box b
  where l.workspace_id = p_workspace_id
    and l.deleted_at is null
    and l.latitude is not null
    and l.latitude between p_lat - b.dlat and p_lat + b.dlat
    and l.longitude between p_lon - b.dlon and p_lon + b.dlon
    and app.distance_meters(p_lat, p_lon, l.latitude, l.longitude) <= p_radius_m
  order by distance_m
  limit greatest(1, least(p_limit, 200))
$$;
