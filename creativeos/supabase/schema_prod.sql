-- ============================================================================
-- SNAPSHOT del schema REAL de prod (kcuycyupkrtbcfsftoql) — generado 2026-07-10
-- vía Management API (catálogo pg). Fuente de verdad para un proyecto nuevo:
-- ejecutar este fichero completo en el SQL Editor. Sustituye a schema.sql.
-- ============================================================================

create table if not exists ad_lifecycle (
  code text not null,
  status text,
  weeks_as_winner integer default 0,
  best_roas numeric,
  best_roas_date date,
  lifetime_spend numeric default 0,
  lifetime_revenue numeric default 0,
  lifetime_purchases integer default 0,
  currency text,
  stale boolean default false,
  first_seen date,
  last_seen date,
  constraint ad_lifecycle_pkey PRIMARY KEY (code)
);

create table if not exists ads_weekly (
  week_date date not null,
  ad_code text not null,
  account_id text default 'unknown'::text not null,
  ad_name text,
  geo text,
  spend numeric,
  revenue numeric,
  roas numeric,
  purchases integer,
  ctr numeric,
  frequency numeric,
  mature boolean default false,
  currency text default 'EUR'::text,
  qb_code_detected text,
  why text,
  claim text,
  thumb_path text,
  constraint ads_weekly_pkey PRIMARY KEY (week_date, ad_code, account_id)
);

create table if not exists annotations (
  id uuid default gen_random_uuid() not null,
  card_id uuid not null,
  timestamp_sec numeric,
  severity text default 'INFO'::text,
  text text not null,
  author uuid,
  created_at timestamp with time zone default now(),
  constraint annotations_pkey PRIMARY KEY (id),
  constraint annotations_author_fkey FOREIGN KEY (author) REFERENCES profiles(user_id),
  constraint annotations_card_id_fkey FOREIGN KEY (card_id) REFERENCES cards(id) ON DELETE CASCADE,
  constraint annotations_severity_check CHECK ((severity = ANY (ARRAY['BLOCKING'::text, 'IMPORTANT'::text, 'INFO'::text])))
);

create table if not exists bonus_ledger (
  id bigint not null,
  editor_user_id uuid not null,
  ad_code text not null,
  rule_key text default 'PER_WINNER_LIFETIME'::text not null,
  amount_eur numeric default 50 not null,
  status text default 'PENDING'::text not null,
  evidence jsonb default '{}'::jsonb,
  created_at timestamp with time zone default now(),
  constraint bonus_ledger_pkey PRIMARY KEY (id),
  constraint bonus_ledger_editor_user_id_ad_code_rule_key_key UNIQUE (editor_user_id, ad_code, rule_key),
  constraint bonus_ledger_editor_user_id_fkey FOREIGN KEY (editor_user_id) REFERENCES profiles(user_id),
  constraint bonus_ledger_status_check CHECK ((status = ANY (ARRAY['PENDING'::text, 'APPROVED'::text, 'PAID'::text, 'REJECTED'::text])))
);

create table if not exists bonus_rules (
  id bigint not null,
  rule_key text not null,
  name text not null,
  amount_eur numeric not null,
  min_lifetime_spend numeric not null,
  min_lifetime_roas numeric not null,
  currency_thresholds jsonb default '{"EUR": 1500, "USD": 1650}'::jsonb,
  is_active boolean default true,
  constraint bonus_rules_pkey PRIMARY KEY (id),
  constraint bonus_rules_rule_key_key UNIQUE (rule_key)
);

create table if not exists brand_profiles (
  brand text not null,
  kind text not null,
  domain text,
  first_seen_week date,
  last_seen_week date,
  weeks_analyzed integer default 0,
  ads_analyzed integer default 0,
  active_ads_analyzed integer default 0,
  what_they_sell text,
  target_avatar text,
  top_angles jsonb default '[]'::jsonb,
  top_offers jsonb default '[]'::jsonb,
  top_hooks jsonb default '[]'::jsonb,
  top_structures jsonb default '[]'::jsonb,
  top_framings jsonb default '[]'::jsonb,
  top_formats jsonb default '[]'::jsonb,
  key_phrases text[] default '{}'::text[],
  language_style text,
  longest_running_ad jsonb,
  updated_at timestamp with time zone default now(),
  constraint brand_profiles_pkey PRIMARY KEY (brand)
);

create table if not exists brands (
  id bigint not null,
  domain text not null,
  name text,
  kind text not null,
  priority integer default 3,
  notes text,
  is_active boolean default true,
  created_at timestamp with time zone default now(),
  constraint brands_pkey PRIMARY KEY (id),
  constraint brands_domain_kind_key UNIQUE (domain, kind),
  constraint brands_kind_check CHECK ((kind = ANY (ARRAY['competitor'::text, 'inspiration'::text])))
);

create table if not exists briefs (
  tracking_code text not null,
  week_date date not null,
  kind text not null,
  title text,
  source_code text,
  suggested_ad_name text,
  payload jsonb default '{}'::jsonb not null,
  published_at timestamp with time zone default now(),
  constraint briefs_pkey PRIMARY KEY (tracking_code),
  constraint briefs_kind_check CHECK ((kind = ANY (ARRAY['video'::text, 'image'::text])))
);

create table if not exists cards (
  id uuid default gen_random_uuid() not null,
  brief_tracking_code text,
  title text default ''::text not null,
  status text default 'TODO'::text not null,
  assigned_editor uuid,
  due_date date,
  drive_url text,
  launched_ad_name text,
  notes text,
  created_at timestamp with time zone default now(),
  updated_at timestamp with time zone default now(),
  format text,
  product text,
  matched_ad_code text,
  approved_at timestamp with time zone,
  constraint cards_pkey PRIMARY KEY (id),
  constraint cards_assigned_editor_fkey FOREIGN KEY (assigned_editor) REFERENCES profiles(user_id) ON DELETE SET NULL,
  constraint cards_brief_tracking_code_fkey FOREIGN KEY (brief_tracking_code) REFERENCES briefs(tracking_code) ON DELETE SET NULL,
  constraint cards_status_check CHECK ((status = ANY (ARRAY['SCRIPT_DRAFT'::text, 'TODO'::text, 'IN_PROGRESS'::text, 'REVIEW'::text, 'APPROVED'::text, 'PUBLISHED'::text, 'ARCHIVED'::text])))
);

create table if not exists chat_context (
  id text default 'main'::text not null,
  week_date date,
  digest text,
  updated_at timestamp with time zone default now(),
  constraint chat_context_pkey PRIMARY KEY (id)
);

create table if not exists chat_messages (
  id bigint not null,
  user_id uuid not null,
  role text not null,
  content text not null,
  created_at timestamp with time zone default now(),
  constraint chat_messages_pkey PRIMARY KEY (id),
  constraint chat_messages_user_id_fkey FOREIGN KEY (user_id) REFERENCES profiles(user_id) ON DELETE CASCADE,
  constraint chat_messages_role_check CHECK ((role = ANY (ARRAY['user'::text, 'assistant'::text])))
);

create table if not exists cmo_verdicts (
  week_date date not null,
  scale jsonb default '[]'::jsonb,
  kill jsonb default '[]'::jsonb,
  fatigue jsonb default '[]'::jsonb,
  meta_vote jsonb default '{}'::jsonb,
  action_plan jsonb default '{}'::jsonb,
  executive_summary jsonb default '{}'::jsonb,
  dashboard jsonb default '{}'::jsonb,
  account_performance jsonb default '{}'::jsonb,
  creative_report jsonb default '{}'::jsonb,
  industry jsonb default '{}'::jsonb,
  data_caveats jsonb default '[]'::jsonb,
  media_buying jsonb default '{}'::jsonb,
  constraint cmo_verdicts_pkey PRIMARY KEY (week_date)
);

create table if not exists creative_reviews (
  week_date date not null,
  ad_name text not null,
  ad_code text,
  role text,
  format text,
  structure text,
  framing text,
  awareness text,
  mass_desire text,
  hook_type text,
  duration_s numeric,
  metric_story text,
  script_review text,
  visual_review text,
  fix text,
  thumb_path text,
  constraint creative_reviews_pkey PRIMARY KEY (week_date, ad_name)
);

create table if not exists editor_weekly (
  week_date date not null,
  winners jsonb default '[]'::jsonb,
  angles jsonb default '[]'::jsonb,
  structures jsonb default '{}'::jsonb,
  framings jsonb default '{}'::jsonb,
  ad_model_video text,
  ad_model_image text,
  image_insights jsonb default '[]'::jsonb,
  published_at timestamp with time zone default now(),
  constraint editor_weekly_pkey PRIMARY KEY (week_date)
);

create table if not exists learned_patterns (
  signature text not null,
  wins numeric default 0,
  losses numeric default 0,
  score numeric default 0,
  weeks_seen integer default 0,
  confidence text,
  avg_roas_vs_blended numeric,
  last_seen date,
  constraint learned_patterns_pkey PRIMARY KEY (signature)
);

create table if not exists mechanisms (
  id bigint not null,
  week_date date not null,
  brand text default ''::text not null,
  kind text,
  library_id text default ''::text not null,
  structure text,
  framing text,
  mechanism_type text,
  what_works text,
  extrapolation text,
  days_running integer,
  visual_evidence text,
  is_active boolean,
  hook text,
  offer text,
  avatar text,
  key_phrases text[] default '{}'::text[],
  language_style text,
  ad_format text,
  constraint mechanisms_pkey PRIMARY KEY (id),
  constraint mechanisms_week_date_brand_library_id_key UNIQUE (week_date, brand, library_id)
);

create table if not exists metrics_snapshots (
  week_date date not null,
  spend numeric,
  blended_roas numeric,
  purchases integer,
  avg_ctr_pct numeric,
  by_geo jsonb default '{}'::jsonb,
  constraint metrics_snapshots_pkey PRIMARY KEY (week_date)
);

create table if not exists notifications (
  id bigint not null,
  target_user_id uuid,
  type text,
  title text,
  body text,
  read boolean default false,
  created_at timestamp with time zone default now(),
  constraint notifications_pkey PRIMARY KEY (id),
  constraint notifications_target_user_id_fkey FOREIGN KEY (target_user_id) REFERENCES profiles(user_id) ON DELETE CASCADE
);

create table if not exists profiles (
  user_id uuid not null,
  name text default ''::text not null,
  custom_role text default 'VIEWER'::text not null,
  skills_tags text[] default '{}'::text[],
  avatar_url text,
  created_at timestamp with time zone default now(),
  email text,
  constraint profiles_pkey PRIMARY KEY (user_id),
  constraint profiles_user_id_fkey FOREIGN KEY (user_id) REFERENCES auth.users(id) ON DELETE CASCADE,
  constraint profiles_custom_role_check CHECK ((custom_role = ANY (ARRAY['ADMIN'::text, 'MANAGER'::text, 'EDITOR'::text, 'VIEWER'::text])))
);

create table if not exists run_requests (
  id bigint not null,
  requested_by uuid,
  status text default 'pending'::text not null,
  detail text,
  requested_at timestamp with time zone default now(),
  started_at timestamp with time zone,
  finished_at timestamp with time zone,
  constraint run_requests_pkey PRIMARY KEY (id),
  constraint run_requests_requested_by_fkey FOREIGN KEY (requested_by) REFERENCES profiles(user_id),
  constraint run_requests_status_check CHECK ((status = ANY (ARRAY['pending'::text, 'running'::text, 'done'::text, 'error'::text])))
);

create table if not exists settings (
  id text default 'main'::text not null,
  data jsonb default '{}'::jsonb not null,
  constraint settings_pkey PRIMARY KEY (id)
);

create table if not exists weekly_reports (
  week_date date not null,
  week_label text,
  headline text,
  key_findings jsonb default '[]'::jsonb,
  synthesis jsonb default '{}'::jsonb,
  structures_observed jsonb default '{}'::jsonb,
  framings_observed jsonb default '{}'::jsonb,
  status_cmo text,
  kpis jsonb default '[]'::jsonb,
  published_at timestamp with time zone default now(),
  editor_pdf_path text,
  cmo_pdf_path text,
  constraint weekly_reports_pkey PRIMARY KEY (week_date)
);

-- ── Índices ──
create index if not exists ads_weekly_qb_idx ON public.ads_weekly USING btree (qb_code_detected);
create index if not exists briefs_week_idx ON public.briefs USING btree (week_date DESC);
create index if not exists cards_brief_idx ON public.cards USING btree (brief_tracking_code);
create index if not exists cards_editor_idx ON public.cards USING btree (assigned_editor);

-- ── Funciones ──
CREATE OR REPLACE FUNCTION public.get_my_role()
 RETURNS text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select coalesce((select custom_role from profiles where user_id = auth.uid()), 'VIEWER');
$function$
;

CREATE OR REPLACE FUNCTION public.my_attributed_codes()
 RETURNS SETOF text
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  select aw.ad_code
  from ads_weekly aw
  join cards c on c.brief_tracking_code = aw.qb_code_detected
  where c.assigned_editor = auth.uid() and aw.qb_code_detected is not null;
$function$
;

CREATE OR REPLACE FUNCTION public.my_bonus_progress()
 RETURNS TABLE(ad_code text, qb_code text, lifetime_roas numeric, weeks_as_winner integer, is_winner boolean, stage text, bonus_status text)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  with mine as (
    select aw.ad_code, aw.qb_code_detected as qb
    from ads_weekly aw
    join cards c on c.brief_tracking_code = aw.qb_code_detected
    where c.assigned_editor = auth.uid() and aw.qb_code_detected is not null
    group by 1, 2
  ), thr as (
    select min_lifetime_spend as spend_min, currency_thresholds
    from bonus_rules where rule_key = 'PER_WINNER_LIFETIME' limit 1
  )
  select l.code,
         m.qb,
         case when coalesce(l.lifetime_spend, 0) > 0
              then round((l.lifetime_revenue / l.lifetime_spend)::numeric, 2) end,
         l.weeks_as_winner,
         l.status in ('winner', 'awakened'),
         case
           when coalesce(l.lifetime_spend, 0) >= coalesce((thr.currency_thresholds ->> coalesce(l.currency, 'EUR'))::numeric, thr.spend_min)
             then 'listo'
           when l.lifetime_spend >= 0.66 * coalesce((thr.currency_thresholds ->> coalesce(l.currency, 'EUR'))::numeric, thr.spend_min) then 'cerca'
           when l.lifetime_spend >= 0.33 * coalesce((thr.currency_thresholds ->> coalesce(l.currency, 'EUR'))::numeric, thr.spend_min) then 'en marcha'
           else 'arrancando'
         end,
         (select bl.status from bonus_ledger bl
          where bl.ad_code = l.code and bl.editor_user_id = auth.uid() limit 1)
  from mine m
  join ad_lifecycle l on l.code = m.ad_code
  cross join thr;
$function$
;

CREATE OR REPLACE FUNCTION public.touch_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$ begin new.updated_at = now(); return new; end; $function$
;

-- ── Vistas ──
create or replace view my_bonus_ledger as
 SELECT id,
    ad_code,
    rule_key,
    amount_eur,
    status,
    created_at,
    editor_user_id
   FROM bonus_ledger
  WHERE editor_user_id = auth.uid();

-- ── Triggers ──
CREATE TRIGGER cards_touch BEFORE UPDATE ON public.cards FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ── RLS ──
alter table ad_lifecycle enable row level security;
alter table ads_weekly enable row level security;
alter table annotations enable row level security;
alter table bonus_ledger enable row level security;
alter table bonus_rules enable row level security;
alter table brand_profiles enable row level security;
alter table brands enable row level security;
alter table briefs enable row level security;
alter table cards enable row level security;
alter table chat_context enable row level security;
alter table chat_messages enable row level security;
alter table cmo_verdicts enable row level security;
alter table creative_reviews enable row level security;
alter table editor_weekly enable row level security;
alter table learned_patterns enable row level security;
alter table mechanisms enable row level security;
alter table metrics_snapshots enable row level security;
alter table notifications enable row level security;
alter table profiles enable row level security;
alter table run_requests enable row level security;
alter table settings enable row level security;
alter table weekly_reports enable row level security;

-- ── Policies ──
drop policy if exists lifecycle_read on ad_lifecycle;
create policy lifecycle_read on ad_lifecycle for select to authenticated
  using ((get_my_role() = ANY (ARRAY['ADMIN'::text, 'MANAGER'::text])));

drop policy if exists ads_weekly_read on ads_weekly;
create policy ads_weekly_read on ads_weekly for select to authenticated
  using ((get_my_role() = ANY (ARRAY['ADMIN'::text, 'MANAGER'::text])));

drop policy if exists annotations_delete on annotations;
create policy annotations_delete on annotations for delete to authenticated
  using (((author = auth.uid()) OR (get_my_role() = ANY (ARRAY['ADMIN'::text, 'MANAGER'::text]))));

drop policy if exists annotations_insert on annotations;
create policy annotations_insert on annotations for insert to authenticated
  with check ((author = auth.uid()));

drop policy if exists annotations_read on annotations;
create policy annotations_read on annotations for select to authenticated
  using (true);

drop policy if exists ledger_admin_update on bonus_ledger;
create policy ledger_admin_update on bonus_ledger for update to authenticated
  using ((get_my_role() = 'ADMIN'::text))
  with check ((get_my_role() = 'ADMIN'::text));

drop policy if exists ledger_read on bonus_ledger;
create policy ledger_read on bonus_ledger for select to authenticated
  using ((get_my_role() = ANY (ARRAY['ADMIN'::text, 'MANAGER'::text])));

drop policy if exists bonus_rules_admin on bonus_rules;
create policy bonus_rules_admin on bonus_rules for all to authenticated
  using ((get_my_role() = 'ADMIN'::text))
  with check ((get_my_role() = 'ADMIN'::text));

drop policy if exists bonus_rules_read on bonus_rules;
create policy bonus_rules_read on bonus_rules for select to authenticated
  using (true);

drop policy if exists brand_profiles_read on brand_profiles;
create policy brand_profiles_read on brand_profiles for select to authenticated
  using (true);

drop policy if exists brands_admin_write on brands;
create policy brands_admin_write on brands for all to authenticated
  using ((get_my_role() = 'ADMIN'::text))
  with check ((get_my_role() = 'ADMIN'::text));

drop policy if exists brands_read on brands;
create policy brands_read on brands for select to authenticated
  using (true);

drop policy if exists all_read_briefs on briefs;
create policy all_read_briefs on briefs for select to authenticated
  using (true);

drop policy if exists cards_editor_claim on cards;
create policy cards_editor_claim on cards for update to authenticated
  using ((assigned_editor IS NULL))
  with check ((assigned_editor = auth.uid()));

drop policy if exists cards_editor_delete on cards;
create policy cards_editor_delete on cards for delete to authenticated
  using (((assigned_editor = auth.uid()) AND (status <> 'PUBLISHED'::text)));

drop policy if exists cards_editor_insert on cards;
create policy cards_editor_insert on cards for insert to authenticated
  with check ((assigned_editor = auth.uid()));

drop policy if exists cards_editor_update on cards;
create policy cards_editor_update on cards for update to authenticated
  using ((assigned_editor = auth.uid()))
  with check ((assigned_editor = auth.uid()));

drop policy if exists cards_mgmt_write on cards;
create policy cards_mgmt_write on cards for all to authenticated
  using ((get_my_role() = ANY (ARRAY['ADMIN'::text, 'MANAGER'::text])))
  with check ((get_my_role() = ANY (ARRAY['ADMIN'::text, 'MANAGER'::text])));

drop policy if exists cards_read on cards;
create policy cards_read on cards for select to authenticated
  using (true);

drop policy if exists mgmt_read_chatctx on chat_context;
create policy mgmt_read_chatctx on chat_context for select to authenticated
  using ((get_my_role() = ANY (ARRAY['ADMIN'::text, 'MANAGER'::text])));

drop policy if exists chat_own on chat_messages;
create policy chat_own on chat_messages for select to authenticated
  using ((user_id = auth.uid()));

drop policy if exists chat_own_insert on chat_messages;
create policy chat_own_insert on chat_messages for insert to authenticated
  with check (((user_id = auth.uid()) AND (get_my_role() = ANY (ARRAY['ADMIN'::text, 'MANAGER'::text]))));

drop policy if exists mgmt_read_cmo on cmo_verdicts;
create policy mgmt_read_cmo on cmo_verdicts for select to authenticated
  using ((get_my_role() = ANY (ARRAY['ADMIN'::text, 'MANAGER'::text])));

drop policy if exists cr_read on creative_reviews;
create policy cr_read on creative_reviews for select to authenticated
  using ((get_my_role() = ANY (ARRAY['ADMIN'::text, 'MANAGER'::text])));

drop policy if exists editor_weekly_read on editor_weekly;
create policy editor_weekly_read on editor_weekly for select to authenticated
  using (true);

drop policy if exists lp_read on learned_patterns;
create policy lp_read on learned_patterns for select to authenticated
  using ((get_my_role() = ANY (ARRAY['ADMIN'::text, 'MANAGER'::text])));

drop policy if exists all_read_mechanisms on mechanisms;
create policy all_read_mechanisms on mechanisms for select to authenticated
  using (true);

drop policy if exists mgmt_read_metrics on metrics_snapshots;
create policy mgmt_read_metrics on metrics_snapshots for select to authenticated
  using ((get_my_role() = ANY (ARRAY['ADMIN'::text, 'MANAGER'::text])));

drop policy if exists notif_mgmt_insert on notifications;
create policy notif_mgmt_insert on notifications for insert to authenticated
  with check ((get_my_role() = ANY (ARRAY['ADMIN'::text, 'MANAGER'::text])));

drop policy if exists notif_own on notifications;
create policy notif_own on notifications for select to authenticated
  using (((target_user_id = auth.uid()) OR (target_user_id IS NULL) OR (get_my_role() = ANY (ARRAY['ADMIN'::text, 'MANAGER'::text]))));

drop policy if exists notif_own_update on notifications;
create policy notif_own_update on notifications for update to authenticated
  using ((target_user_id = auth.uid()))
  with check ((target_user_id = auth.uid()));

drop policy if exists profiles_admin_all on profiles;
create policy profiles_admin_all on profiles for all to authenticated
  using ((get_my_role() = 'ADMIN'::text))
  with check ((get_my_role() = 'ADMIN'::text));

drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated
  using (((user_id = auth.uid()) OR (get_my_role() = ANY (ARRAY['ADMIN'::text, 'MANAGER'::text]))));

drop policy if exists rr_admin_insert on run_requests;
create policy rr_admin_insert on run_requests for insert to authenticated
  with check (((get_my_role() = 'ADMIN'::text) AND (requested_by = auth.uid())));

drop policy if exists rr_mgmt on run_requests;
create policy rr_mgmt on run_requests for select to authenticated
  using ((get_my_role() = ANY (ARRAY['ADMIN'::text, 'MANAGER'::text])));

drop policy if exists settings_admin on settings;
create policy settings_admin on settings for update to authenticated
  using ((get_my_role() = 'ADMIN'::text))
  with check ((get_my_role() = 'ADMIN'::text));

drop policy if exists settings_read on settings;
create policy settings_read on settings for select to authenticated
  using ((get_my_role() = ANY (ARRAY['ADMIN'::text, 'MANAGER'::text])));

drop policy if exists mgmt_read_weekly on weekly_reports;
create policy mgmt_read_weekly on weekly_reports for select to authenticated
  using ((get_my_role() = ANY (ARRAY['ADMIN'::text, 'MANAGER'::text])));

-- ── Grants clave ──
grant select on my_bonus_ledger to authenticated;

-- ── Realtime ──
do $$ begin
  alter publication supabase_realtime add table bonus_ledger;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table brands;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table briefs;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table cards;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table creative_reviews;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table notifications;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table run_requests;
exception when duplicate_object then null; end $$;

-- ── Storage (bucket policies sobre storage.objects) ──
drop policy if exists creatives_read on storage.objects;
create policy creatives_read on storage.objects for select to authenticated
  using (((bucket_id = 'creatives'::text) AND (get_my_role() = ANY (ARRAY['ADMIN'::text, 'MANAGER'::text]))));

drop policy if exists reports_cmo_read on storage.objects;
create policy reports_cmo_read on storage.objects for select to authenticated
  using (((bucket_id = 'reports-cmo'::text) AND (get_my_role() = ANY (ARRAY['ADMIN'::text, 'MANAGER'::text]))));

drop policy if exists reports_read on storage.objects;
create policy reports_read on storage.objects for select to authenticated
  using ((bucket_id = 'reports'::text));

