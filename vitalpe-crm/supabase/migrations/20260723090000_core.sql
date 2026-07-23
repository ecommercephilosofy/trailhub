-- ============================================================================
-- VITALPE CRM — 0001 CORE
-- Extensions, app helper schema, enums, workspaces, profiles, memberships,
-- invitations, audit log.
-- ============================================================================

-- Only pg_trgm is required (fuzzy company-name search). gen_random_uuid() is
-- core since PG13, and accent folding is done by app.unaccent_ca below rather
-- than the `unaccent` extension: the single-argument unaccent() is STABLE, not
-- IMMUTABLE, so it cannot back a generated column or an index.
create extension if not exists "pg_trgm";

-- `app` holds helper functions used by RLS policies and domain triggers.
-- Never exposed through PostgREST (not in the exposed schema list).
create schema if not exists app;

-- ---------------------------------------------------------------------------
-- Enumerated domains
-- Closed sets that application code branches on. Open/extensible sets
-- (company types, products, campaigns) live in master tables instead.
-- ---------------------------------------------------------------------------
do $$ begin
  create type app.user_role as enum ('ADMIN', 'GERENT', 'COMERCIAL');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.membership_status as enum ('PENDENT', 'ACTIU', 'DESACTIVAT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.invitation_status as enum ('PENDENT', 'ACCEPTADA', 'REVOCADA', 'CADUCADA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.classification as enum (
    'ACTIU SEGUR',
    'POTENCIAL INTERESSAT',
    'POTENCIAL AMB UN ALTRE PROVEIDOR',
    'NO POTENCIAL'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.verification_status as enum ('ACTIVA', 'INACTIVA', 'PENDENT DE VERIFICAR', 'DUBTOSA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.contact_type as enum ('GENERAL', 'DIRECTE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.location_type as enum ('SEU', 'MAGATZEM', 'VISITA', 'ALTRES');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.opportunity_data_type as enum ('COMPRA REAL', 'PREVISIO CONFIRMADA', 'POSSIBLE COMPRA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.forecast_next as enum ('REPETIR COMANDA', 'NO DETERMINAT', 'NO COMPRARAN', 'ALTRES');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.opportunity_status as enum ('OBERTA', 'GUANYADA', 'PERDUDA', 'TANCADA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.activity_type as enum (
    'TRUCADA', 'CORREU', 'VISITA', 'MOSTRES', 'OFERTA', 'NOTA INTERNA', 'ALTRES'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.activity_result as enum (
    'INTERES CONCRET',
    'DEMANA PREUS',
    'DEMANA MOSTRES',
    'ACORDAR VISITA',
    'TE UN ALTRE PROVEIDOR',
    'REPETIRA COMANDA',
    'NO DETERMINAT',
    'NO COMPRARA',
    'NO COMPRA VI A GRANEL',
    'TANCAT / INACTIU',
    'ALTRES'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.task_kind as enum ('TASCA', 'RECORDATORI');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.task_status as enum ('PENDENT', 'FET', 'AJORNAT', 'CANCEL·LAT');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.task_priority as enum ('ALTA', 'MITJANA', 'BAIXA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.commercial_action as enum (
    'TRUCAR', 'VISITA', 'MOSTRES', 'ENVIAR CORREU', 'ENVIAR PREUS',
    'ENVIAR OFERTA', 'VERIFICAR EMPRESA', 'ALTRES'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.sample_subtype as enum (
    'PORTAR MOSTRES AL CLIENT', 'CATA A VITALPE', 'PENDENT DE CONCRETAR'
  );
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.visit_status as enum ('PLANIFICADA', 'CONFIRMADA', 'FETA', 'CANCEL·LADA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.sync_status as enum ('NO SINCRONITZAT', 'PENDENT', 'SINCRONITZAT', 'ERROR');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.change_origin as enum ('CRM', 'GOOGLE CALENDAR', 'IMPORTACIO', 'VEU', 'MOBIL', 'SISTEMA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.voice_stage_status as enum ('PENDENT', 'EN PROCES', 'FET', 'ERROR', 'NO DISPONIBLE');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.geofence_event_type as enum ('ENTRADA', 'SORTIDA');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.import_status as enum ('BORRADOR', 'INSPECCIONAT', 'MAPEJAT', 'NORMALITZAT', 'APLICAT', 'DESFET', 'ERROR');
exception when duplicate_object then null; end $$;

do $$ begin
  create type app.dedupe_decision as enum (
    'CREAR COM A NOVA', 'ACTUALITZAR EXISTENT', 'IGNORAR', 'FUSIONAR', 'MANTENIR SEPARADES', 'PENDENT'
  );
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------------------
-- Text normalisation. Used for dedupe keys, search and alias matching.
-- IMMUTABLE so it can back generated columns and indexes.
-- ---------------------------------------------------------------------------
-- Accent folding for Catalan/Spanish/French source data. Explicit translate()
-- instead of the unaccent extension: deterministic, IMMUTABLE, no dependency on
-- which schema the extension happens to live in.
create or replace function app.unaccent_ca(input text)
returns text
language sql
immutable
parallel safe
as $$
  select translate(
    coalesce(input, ''),
    'àáâäãåÀÁÂÄÃÅèéêëÈÉÊËìíîïÌÍÎÏòóôöõÒÓÔÖÕùúûüÙÚÛÜçÇñÑýÿÝŸ',
    'aaaaaaAAAAAAeeeeEEEEiiiiIIIIooooo' || 'OOOOOuuuuUUUUcCnNyyYY'
  )
$$;

create or replace function app.normalize_text(input text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    btrim(regexp_replace(
      lower(app.unaccent_ca(coalesce(input, ''))),
      '[^a-z0-9]+', ' ', 'g'
    )), ''
  )
$$;

-- Company name normalisation: drops legal forms so "MASIA ROMAGOSA S.L." and
-- "Masia Romagosa SL" collapse to the same key. Original name is never touched.
create or replace function app.normalize_company(input text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(btrim(regexp_replace(
    regexp_replace(
      app.normalize_text(input),
      '(^| )(s l u|s l|sl|slu|s a u|s a|sa|sau|s c p|scp|s c c l|sccl|s c s|scs|s coop|scoop|sat|c b|cb|sl unipersonal|societat limitada|sociedad limitada|sociedad anonima|societat anonima)( |$)',
      ' ', 'g'
    ),
    ' +', ' ', 'g'
  )), '')
$$;

-- Phone normalisation to E.164-ish digits. Spanish national numbers get +34.
create or replace function app.normalize_phone(input text)
returns text
language plpgsql
immutable
parallel safe
as $$
declare
  digits text;
begin
  if input is null then return null; end if;
  digits := regexp_replace(input, '[^0-9+]', '', 'g');
  digits := regexp_replace(digits, '(?!^)\+', '', 'g');
  if digits = '' or digits = '+' then return null; end if;
  if left(digits, 1) = '+' then
    return digits;
  end if;
  if left(digits, 2) = '00' then
    return '+' || substr(digits, 3);
  end if;
  if length(digits) = 9 and left(digits, 1) in ('6', '7', '8', '9') then
    return '+34' || digits;
  end if;
  return digits;
end
$$;

create or replace function app.normalize_email(input text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(lower(btrim(input)), '')
$$;

-- Strips protocol, www and trailing path so web/email domains are comparable.
create or replace function app.normalize_domain(input text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(
    regexp_replace(
      regexp_replace(lower(btrim(coalesce(input, ''))), '^[a-z]+://', ''),
      '^www\.', ''
    ),
    ''
  )
$$;

create or replace function app.domain_of_email(input text)
returns text
language sql
immutable
parallel safe
as $$
  select nullif(split_part(app.normalize_email(input), '@', 2), '')
$$;

-- Free-email providers must never be used as a company identity signal.
create or replace function app.is_generic_email_domain(d text)
returns boolean
language sql
immutable
parallel safe
as $$
  select coalesce(d, '') in (
    'gmail.com','hotmail.com','hotmail.es','yahoo.es','yahoo.com','outlook.com',
    'outlook.es','telefonica.net','terra.es','icloud.com','live.com','msn.com',
    'me.com','wanadoo.es','ono.com','movistar.es'
  )
$$;

-- ---------------------------------------------------------------------------
-- Workspaces
-- ---------------------------------------------------------------------------
create table if not exists public.workspaces (
  id          uuid primary key default gen_random_uuid(),
  name        text not null check (btrim(name) <> ''),
  slug        text not null unique check (slug ~ '^[a-z0-9-]+$'),
  timezone    text not null default 'Europe/Madrid',
  locale      text not null default 'ca-ES',
  settings    jsonb not null default '{}'::jsonb,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.workspaces is 'Tenant boundary. Every commercial entity carries workspace_id.';

-- ---------------------------------------------------------------------------
-- Profiles (1:1 with auth.users)
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  first_name  text,
  last_name   text,
  email       text not null,
  phone       text,
  avatar_url  text,
  locale      text not null default 'ca-ES',
  timezone    text not null default 'Europe/Madrid',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table if not exists public.workspace_memberships (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  role          app.user_role not null default 'COMERCIAL',
  status        app.membership_status not null default 'ACTIU',
  -- Reserved for future granular permissions layered on top of the role preset.
  extra_permissions jsonb not null default '{}'::jsonb,
  invited_by    uuid references public.profiles(id) on delete set null,
  invited_at    timestamptz,
  activated_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (workspace_id, user_id)
);

create table if not exists public.workspace_invitations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  email         text not null,
  email_norm    text generated always as (app.normalize_email(email)) stored,
  role          app.user_role not null default 'COMERCIAL',
  status        app.invitation_status not null default 'PENDENT',
  token_hash    text not null,
  invited_by    uuid references public.profiles(id) on delete set null,
  expires_at    timestamptz not null,
  accepted_at   timestamptz,
  accepted_by   uuid references public.profiles(id) on delete set null,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists workspace_invitations_pending_uq
  on public.workspace_invitations (workspace_id, email_norm)
  where status = 'PENDENT';

-- ---------------------------------------------------------------------------
-- RLS helper functions. SECURITY DEFINER so membership lookups inside a policy
-- do not re-enter RLS on workspace_memberships (infinite recursion).
-- ---------------------------------------------------------------------------
create or replace function app.current_user_id()
returns uuid
language sql
stable
as $$ select auth.uid() $$;

create or replace function app.role_in(ws uuid)
returns app.user_role
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select m.role
  from public.workspace_memberships m
  where m.workspace_id = ws
    and m.user_id = auth.uid()
    and m.status = 'ACTIU'
  limit 1
$$;

create or replace function app.is_member(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$ select app.role_in(ws) is not null $$;

create or replace function app.is_admin(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$ select app.role_in(ws) = 'ADMIN' $$;

-- ADMIN and GERENT share the "can manage other people's commercial data" tier.
create or replace function app.is_manager(ws uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$ select app.role_in(ws) in ('ADMIN', 'GERENT') $$;

-- ---------------------------------------------------------------------------
-- Audit log. Append-only from the application's point of view: no UPDATE or
-- DELETE policy is ever granted, and the table owner writes through triggers.
-- ---------------------------------------------------------------------------
create table if not exists public.audit_log (
  id             bigserial primary key,
  workspace_id   uuid references public.workspaces(id) on delete set null,
  entity         text not null,
  entity_id      text,
  action         text not null check (action in ('INSERT', 'UPDATE', 'DELETE', 'MERGE', 'RESTORE', 'LOGIN', 'SYNC', 'IMPORT')),
  before_value   jsonb,
  after_value    jsonb,
  changed_fields text[],
  actor_id       uuid references public.profiles(id) on delete set null,
  origin         app.change_origin not null default 'CRM',
  device         text,
  correlation_id uuid,
  created_at     timestamptz not null default now()
);
create index if not exists audit_log_entity_idx on public.audit_log (entity, entity_id, created_at desc);
create index if not exists audit_log_ws_idx on public.audit_log (workspace_id, created_at desc);

-- Per-statement session context set by the server layer, so triggers can record
-- who/where a change came from without every table carrying the columns.
create or replace function app.session_origin()
returns app.change_origin
language sql
stable
as $$
  select coalesce(
    nullif(current_setting('app.origin', true), '')::app.change_origin,
    'CRM'::app.change_origin
  )
$$;

create or replace function app.session_correlation_id()
returns uuid
language sql
stable
as $$
  select nullif(current_setting('app.correlation_id', true), '')::uuid
$$;

create or replace function app.session_device()
returns text
language sql
stable
as $$
  select nullif(current_setting('app.device', true), '')
$$;

create or replace function app.audit_trigger()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
declare
  ws uuid;
  before_j jsonb;
  after_j jsonb;
  changed text[];
  ent_id text;
begin
  if tg_op = 'DELETE' then
    before_j := to_jsonb(old);
    after_j := null;
  elsif tg_op = 'INSERT' then
    before_j := null;
    after_j := to_jsonb(new);
  else
    before_j := to_jsonb(old);
    after_j := to_jsonb(new);
    select array_agg(key order by key) into changed
    from jsonb_each(after_j) e(key, value)
    where before_j -> e.key is distinct from e.value;
    -- Nothing actually changed (e.g. a no-op UPDATE): do not log noise.
    if changed is null then
      return new;
    end if;
  end if;

  ws := nullif(coalesce(after_j, before_j) ->> 'workspace_id', '')::uuid;
  ent_id := coalesce(after_j, before_j) ->> 'id';

  insert into public.audit_log (
    workspace_id, entity, entity_id, action, before_value, after_value,
    changed_fields, actor_id, origin, device, correlation_id
  ) values (
    ws, tg_table_name, ent_id, tg_op, before_j, after_j,
    changed, auth.uid(), app.session_origin(), app.session_device(), app.session_correlation_id()
  );

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create trigger workspaces_touch before update on public.workspaces
  for each row execute function app.touch_updated_at();
create trigger profiles_touch before update on public.profiles
  for each row execute function app.touch_updated_at();
create trigger memberships_touch before update on public.workspace_memberships
  for each row execute function app.touch_updated_at();
create trigger invitations_touch before update on public.workspace_invitations
  for each row execute function app.touch_updated_at();

create trigger memberships_audit after insert or update or delete on public.workspace_memberships
  for each row execute function app.audit_trigger();
create trigger invitations_audit after insert or update or delete on public.workspace_invitations
  for each row execute function app.audit_trigger();

-- New auth user -> profile row. Runs as definer because auth.users is not
-- writable by the anon/authenticated roles.
create or replace function app.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public, app, pg_temp
as $$
begin
  insert into public.profiles (id, email, first_name, last_name)
  values (
    new.id,
    coalesce(new.email, ''),
    nullif(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'last_name', '')
  )
  on conflict (id) do update set email = excluded.email;
  return new;
end
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function app.handle_new_user();
