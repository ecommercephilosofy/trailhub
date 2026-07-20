-- ============================================================================
-- CreativeOS × ads-agent — schema Supabase (Fase 2, jul-2026)
-- Pegar COMPLETO en el SQL Editor de Supabase (idempotente razonable).
-- El pipeline Python escribe con la SERVICE KEY (bypassa RLS).
-- La app escribe/lee con la ANON KEY + sesión de usuario (RLS por rol).
-- REGLA #-1: un EDITOR nunca lee cmo_verdicts ni performance global — solo
-- las filas de SUS propios ads (atribución QB) para su progreso de bonus.
-- ============================================================================

-- ── Roles y perfiles ─────────────────────────────────────────────────────────
create table if not exists profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  name text not null default '',
  email text,
  custom_role text not null default 'VIEWER'
    check (custom_role in ('ADMIN','MANAGER','EDITOR','VIEWER')),
  skills_tags text[] default '{}',
  avatar_url text,
  created_at timestamptz default now()
);

-- Helper: rol del usuario logueado. SECURITY DEFINER para poder usarse dentro
-- de policies sin recursión de RLS.
create or replace function get_my_role() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select custom_role from profiles where user_id = auth.uid()), 'VIEWER');
$$;

-- ── Tablas publicadas por el pipeline ────────────────────────────────────────
create table if not exists weekly_reports (
  week_date date primary key,
  week_label text,
  headline text,
  key_findings jsonb default '[]',
  synthesis jsonb default '{}',
  structures_observed jsonb default '{}',
  framings_observed jsonb default '{}',
  status_cmo text,
  kpis jsonb default '[]',
  published_at timestamptz default now()
);

create table if not exists briefs (
  tracking_code text primary key,
  week_date date not null,
  kind text not null check (kind in ('video','image')),
  title text,
  source_code text,
  suggested_ad_name text,
  payload jsonb not null default '{}',
  published_at timestamptz default now()
);
create index if not exists briefs_week_idx on briefs(week_date desc);

create table if not exists ads_weekly (
  week_date date not null,
  ad_code text not null,
  account_id text not null default 'unknown',
  ad_name text,
  geo text,
  spend numeric,
  revenue numeric,
  roas numeric,
  purchases int,
  ctr numeric,
  frequency numeric,
  mature boolean default false,
  currency text default 'EUR',
  qb_code_detected text,
  why text, claim text, thumb_path text,
  primary key (week_date, ad_code, account_id)
);
create index if not exists ads_weekly_qb_idx on ads_weekly(qb_code_detected);

create table if not exists ad_lifecycle (
  code text primary key,
  status text,
  weeks_as_winner int default 0,
  best_roas numeric,
  best_roas_date date,
  lifetime_spend numeric default 0,
  lifetime_revenue numeric default 0,
  lifetime_purchases int default 0,
  currency text,
  stale boolean default false,
  first_seen date,
  last_seen date
);

create table if not exists metrics_snapshots (
  week_date date primary key,
  spend numeric,
  blended_roas numeric,
  purchases int,
  avg_ctr_pct numeric,
  by_geo jsonb default '{}'
);

create table if not exists mechanisms (
  id bigint generated always as identity primary key,
  week_date date not null,
  brand text not null default '',
  kind text,
  library_id text not null default '',
  structure text,
  framing text,
  mechanism_type text,
  visual_evidence text,     -- qué se VE en los frames (demo/acción/formato)
  what_works text,
  extrapolation text,
  days_running int,
  unique (week_date, brand, library_id)
);

-- Análisis de estrategia creativa para EDITORES (ROAS sí, dinero jamás — el
-- pipeline lo scrubbea al publicar). Visible para todos los roles.
create table if not exists editor_weekly (
  week_date date primary key,
  winners jsonb default '[]',
  angles jsonb default '[]',
  structures jsonb default '{}',
  framings jsonb default '{}',
  ad_model_video text,
  ad_model_image text,
  image_insights jsonb default '[]',
  published_at timestamptz default now()
);

create table if not exists cmo_verdicts (
  week_date date primary key,
  scale jsonb default '[]',
  kill jsonb default '[]',
  fatigue jsonb default '[]',
  meta_vote jsonb default '{}',
  media_buying jsonb default '{}',          -- completo (contribution, funnel_allocation)
  action_plan jsonb default '{}',
  executive_summary jsonb default '{}',
  dashboard jsonb default '{}',
  account_performance jsonb default '{}',
  creative_report jsonb default '{}',
  industry jsonb default '{}',
  data_caveats jsonb default '[]'
);

-- Review script+visual de cada creativo rubricado (galería en Performance).
-- Solo dirección (lleva ROAS/métricas). thumb_path → bucket `creatives`.
create table if not exists creative_reviews (
  week_date date not null,
  ad_name text not null,
  ad_code text, role text, format text, structure text, framing text,
  awareness text, mass_desire text, hook_type text, duration_s numeric,
  metric_story text, script_review text, visual_review text, fix text,
  thumb_path text,
  primary key (week_date, ad_name)
);
alter table creative_reviews enable row level security;
drop policy if exists cr_read on creative_reviews;
create policy cr_read on creative_reviews for select to authenticated
  using (get_my_role() in ('ADMIN','MANAGER'));

create table if not exists chat_context (
  id text primary key default 'main',
  week_date date,
  digest text,
  updated_at timestamptz default now()
);

-- ── Tablas del equipo ────────────────────────────────────────────────────────
create table if not exists cards (
  id uuid primary key default gen_random_uuid(),
  brief_tracking_code text references briefs(tracking_code) on delete set null,
  title text not null default '',
  status text not null default 'TODO'
    check (status in ('SCRIPT_DRAFT','TODO','IN_PROGRESS','REVIEW','APPROVED','PUBLISHED','ARCHIVED')),
  assigned_editor uuid references profiles(user_id) on delete set null,
  due_date date,
  drive_url text,
  launched_ad_name text,
  format text,
  product text,
  matched_ad_code text,     -- sync al aprobar: código del ad real (Performance/análisis)
  approved_at timestamptz,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);
create index if not exists cards_editor_idx on cards(assigned_editor);
create index if not exists cards_brief_idx on cards(brief_tracking_code);

-- Helper: códigos de ad atribuidos al usuario (QB del ad → brief → card asignada).
-- Definido AQUÍ porque referencia ads_weekly + cards (deben existir antes).
create or replace function my_attributed_codes() returns setof text
language sql stable security definer set search_path = public as $$
  select aw.ad_code
  from ads_weekly aw
  join cards c on c.brief_tracking_code = aw.qb_code_detected
  where c.assigned_editor = auth.uid() and aw.qb_code_detected is not null;
$$;

create table if not exists annotations (
  id uuid primary key default gen_random_uuid(),
  card_id uuid not null references cards(id) on delete cascade,
  timestamp_sec numeric,
  severity text default 'INFO' check (severity in ('BLOCKING','IMPORTANT','INFO')),
  text text not null,
  author uuid references profiles(user_id) on delete set null,
  created_at timestamptz default now()
);

create table if not exists bonus_rules (
  id bigint generated always as identity primary key,
  rule_key text unique not null,
  name text not null,
  amount_eur numeric not null,
  min_lifetime_spend numeric not null,
  min_lifetime_roas numeric not null,
  currency_thresholds jsonb default '{"EUR":1500,"USD":1650}',
  is_active boolean default true
);
insert into bonus_rules (rule_key, name, amount_eur, min_lifetime_spend, min_lifetime_roas)
values ('PER_WINNER_LIFETIME', 'Winner: >1500€ gasto total con ROAS total >2.0', 50, 1500, 2.0)
on conflict (rule_key) do nothing;

create table if not exists bonus_ledger (
  id bigint generated always as identity primary key,
  editor_user_id uuid references profiles(user_id) on delete set null,
  ad_code text not null,
  rule_key text not null default 'PER_WINNER_LIFETIME',
  amount_eur numeric not null default 50,
  status text not null default 'PENDING' check (status in ('PENDING','APPROVED','PAID','REJECTED')),
  evidence jsonb default '{}',
  created_at timestamptz default now(),
  unique (editor_user_id, ad_code, rule_key)
);

create table if not exists notifications (
  id bigint generated always as identity primary key,
  target_user_id uuid references profiles(user_id) on delete cascade,
  type text,
  title text,
  body text,
  read boolean default false,
  created_at timestamptz default now()
);

create table if not exists settings (
  id text primary key default 'main',
  data jsonb not null default '{}'
);
insert into settings (id, data) values ('main', '{}') on conflict (id) do nothing;

create table if not exists chat_messages (
  id bigint generated always as identity primary key,
  user_id uuid not null references profiles(user_id) on delete cascade,
  role text not null check (role in ('user','assistant')),
  content text not null,
  created_at timestamptz default now()
);

-- updated_at automático en cards
create or replace function touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at = now(); return new; end; $$;
drop trigger if exists cards_touch on cards;
create trigger cards_touch before update on cards
for each row execute function touch_updated_at();

-- ── RLS ──────────────────────────────────────────────────────────────────────
alter table profiles          enable row level security;
alter table weekly_reports    enable row level security;
alter table briefs            enable row level security;
alter table ads_weekly        enable row level security;
alter table ad_lifecycle      enable row level security;
alter table metrics_snapshots enable row level security;
alter table mechanisms        enable row level security;
alter table cmo_verdicts      enable row level security;
alter table chat_context      enable row level security;
alter table cards             enable row level security;
alter table annotations       enable row level security;
alter table bonus_rules       enable row level security;
alter table bonus_ledger      enable row level security;
alter table notifications     enable row level security;
alter table settings          enable row level security;
alter table chat_messages     enable row level security;

-- profiles: cada uno el suyo; ADMIN/MANAGER ven todos (asignaciones); ADMIN gestiona
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select to authenticated
  using (user_id = auth.uid() or get_my_role() in ('ADMIN','MANAGER'));
drop policy if exists profiles_admin_all on profiles;
create policy profiles_admin_all on profiles for all to authenticated
  using (get_my_role() = 'ADMIN') with check (get_my_role() = 'ADMIN');

-- Publicadas por pipeline: solo dirección (REGLA #-1), salvo briefs/mechanisms (todos)
drop policy if exists mgmt_read_weekly on weekly_reports;
create policy mgmt_read_weekly on weekly_reports for select to authenticated
  using (get_my_role() in ('ADMIN','MANAGER'));
drop policy if exists mgmt_read_metrics on metrics_snapshots;
create policy mgmt_read_metrics on metrics_snapshots for select to authenticated
  using (get_my_role() in ('ADMIN','MANAGER'));
drop policy if exists mgmt_read_cmo on cmo_verdicts;
create policy mgmt_read_cmo on cmo_verdicts for select to authenticated
  using (get_my_role() in ('ADMIN','MANAGER'));
drop policy if exists mgmt_read_chatctx on chat_context;
create policy mgmt_read_chatctx on chat_context for select to authenticated
  using (get_my_role() in ('ADMIN','MANAGER'));

drop policy if exists all_read_briefs on briefs;
create policy all_read_briefs on briefs for select to authenticated using (true);
drop policy if exists all_read_mechanisms on mechanisms;
create policy all_read_mechanisms on mechanisms for select to authenticated using (true);

-- ads_weekly / ad_lifecycle: SOLO dirección. El editor NUNCA ve gasto de ningún
-- ad (regla de Marc, jul-2026): su progreso de bonus va por my_bonus_progress()
-- (rpc security definer que devuelve ROAS + etapa cualitativa, sin cifras).
drop policy if exists ads_weekly_read on ads_weekly;
create policy ads_weekly_read on ads_weekly for select to authenticated
  using (get_my_role() in ('ADMIN','MANAGER'));
drop policy if exists lifecycle_read on ad_lifecycle;
create policy lifecycle_read on ad_lifecycle for select to authenticated
  using (get_my_role() in ('ADMIN','MANAGER'));

alter table editor_weekly enable row level security;
drop policy if exists editor_weekly_read on editor_weekly;
create policy editor_weekly_read on editor_weekly for select to authenticated using (true);

-- Progreso de bonus del editor SIN dinero: ROAS total + etapa cualitativa
create or replace function my_bonus_progress()
returns table(ad_code text, qb_code text, lifetime_roas numeric, weeks_as_winner int,
              is_winner boolean, stage text, bonus_status text)
language sql stable security definer set search_path = public as $$
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
$$;

-- Ledger del editor sin evidencia (la evidencia lleva gasto): vista definer
create or replace view my_bonus_ledger with (security_invoker = false) as
  select id, ad_code, rule_key, amount_eur, status, created_at, editor_user_id
  from bonus_ledger where editor_user_id = auth.uid();
grant select on my_bonus_ledger to authenticated;

-- cards: todos leen el tablero; dirección crea/edita todo; editor actualiza SUS tarjetas
drop policy if exists cards_read on cards;
create policy cards_read on cards for select to authenticated using (true);
drop policy if exists cards_mgmt_write on cards;
create policy cards_mgmt_write on cards for all to authenticated
  using (get_my_role() in ('ADMIN','MANAGER')) with check (get_my_role() in ('ADMIN','MANAGER'));
drop policy if exists cards_editor_update on cards;
create policy cards_editor_update on cards for update to authenticated
  using (assigned_editor = auth.uid()) with check (assigned_editor = auth.uid());

-- annotations: todos leen; autenticados crean las suyas
drop policy if exists annotations_read on annotations;
create policy annotations_read on annotations for select to authenticated using (true);
drop policy if exists annotations_insert on annotations;
create policy annotations_insert on annotations for insert to authenticated
  with check (author = auth.uid());

-- bonus: reglas visibles para todos (transparencia); ledger directo solo dirección
-- (el editor usa la vista my_bonus_ledger, sin columna evidence)
drop policy if exists bonus_rules_read on bonus_rules;
create policy bonus_rules_read on bonus_rules for select to authenticated using (true);
drop policy if exists bonus_rules_admin on bonus_rules;
create policy bonus_rules_admin on bonus_rules for all to authenticated
  using (get_my_role() = 'ADMIN') with check (get_my_role() = 'ADMIN');
drop policy if exists ledger_read on bonus_ledger;
create policy ledger_read on bonus_ledger for select to authenticated
  using (get_my_role() in ('ADMIN','MANAGER'));
drop policy if exists ledger_admin_update on bonus_ledger;
create policy ledger_admin_update on bonus_ledger for update to authenticated
  using (get_my_role() = 'ADMIN') with check (get_my_role() = 'ADMIN');

-- notifications: cada uno las suyas
-- Dirección también LEE todas (necesario: insert().select() con RETURNING falla
-- y rollbackea si quien inserta no puede leer la fila que acaba de crear)
drop policy if exists notif_own on notifications;
create policy notif_own on notifications for select to authenticated
  using (target_user_id = auth.uid() or target_user_id is null
         or get_my_role() in ('ADMIN','MANAGER'));
drop policy if exists notif_own_update on notifications;
create policy notif_own_update on notifications for update to authenticated
  using (target_user_id = auth.uid()) with check (target_user_id = auth.uid());
drop policy if exists notif_mgmt_insert on notifications;
create policy notif_mgmt_insert on notifications for insert to authenticated
  with check (get_my_role() in ('ADMIN','MANAGER'));

-- settings: dirección lee, ADMIN escribe
drop policy if exists settings_read on settings;
create policy settings_read on settings for select to authenticated
  using (get_my_role() in ('ADMIN','MANAGER'));
drop policy if exists settings_admin on settings;
create policy settings_admin on settings for update to authenticated
  using (get_my_role() = 'ADMIN') with check (get_my_role() = 'ADMIN');

-- chat: cada usuario su hilo (y solo dirección puede chatear con el cerebro)
drop policy if exists chat_own on chat_messages;
create policy chat_own on chat_messages for select to authenticated
  using (user_id = auth.uid());
drop policy if exists chat_own_insert on chat_messages;
create policy chat_own_insert on chat_messages for insert to authenticated
  with check (user_id = auth.uid() and get_my_role() in ('ADMIN','MANAGER'));

-- ── Realtime ─────────────────────────────────────────────────────────────────
do $$ begin
  alter publication supabase_realtime add table cards;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table notifications;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table bonus_ledger;
exception when duplicate_object then null; end $$;
do $$ begin
  alter publication supabase_realtime add table briefs;
exception when duplicate_object then null; end $$;

-- ── Primer ADMIN ─────────────────────────────────────────────────────────────
-- Tras crear tu usuario en Authentication → Users, ejecuta (con tu email):
-- insert into profiles (user_id, name, custom_role)
-- select id, 'Marc', 'ADMIN' from auth.users where email = 'mdelgadolinde@gmail.com'
-- on conflict (user_id) do update set custom_role = 'ADMIN';

-- ── Tracking de migraciones (update.sh del cerebro las aplica y registra) ────
create table if not exists schema_migrations (
  name text primary key,
  applied_at timestamptz default now()
);
alter table schema_migrations enable row level security;

-- ── Alta de usuario → profile automático (rol mínimo VIEWER) ─────────────────
-- Garantiza que todo usuario de auth tenga fila en profiles (visible en /Admin);
-- la invitación del admin fija luego el rol real. Con el signup cerrado, los
-- usuarios llegan por invitación o alta manual desde el dashboard.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (user_id, email, custom_role)
  values (new.id, new.email, 'VIEWER')
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
