-- ============================================================================
-- VITALPE CRM — 0002 CRM ENTITIES
-- Master lists, clients, aliases, contacts, locations, assignments,
-- verifications, products, campaigns, opportunities, activities.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Company types. Deliberately a table and not an enum: the brief says start
-- with four values and allow growth without a schema rewrite.
-- ---------------------------------------------------------------------------
create table if not exists public.client_types (
  code        text primary key check (code = upper(code)),
  label       text not null,
  sort_order  int not null default 100,
  is_active   boolean not null default true,
  requires_explanation boolean not null default false
);

insert into public.client_types (code, label, sort_order, requires_explanation) values
  ('EMBOTELLADOR', 'EMBOTELLADOR', 10, false),
  ('ELABORADOR',   'ELABORADOR',   20, false),
  ('COOPERATIVA',  'COOPERATIVA',  30, false),
  ('ALTRES',       'ALTRES',       90, true)
on conflict (code) do nothing;

-- ---------------------------------------------------------------------------
-- Clients (companies). One canonical row per company.
-- ---------------------------------------------------------------------------
create table if not exists public.clients (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,

  name              text not null check (btrim(name) <> ''),
  name_norm         text generated always as (app.normalize_company(name)) stored,
  legal_name        text,
  tax_id            text,
  tax_id_norm       text generated always as (app.normalize_text(tax_id)) stored,

  municipality      text,
  comarca           text,
  province          text,
  country           text not null default 'ES',
  website           text,
  website_domain    text generated always as (app.normalize_domain(website)) stored,

  client_type_code  text references public.client_types(code),
  other_client_type text,

  do_cava           boolean not null default false,
  do_penedes        boolean not null default false,
  do_catalunya      boolean not null default false,
  do_altres         boolean not null default false,

  proposed_classification  app.classification,
  confirmed_classification app.classification,
  classification_confirmed_at timestamptz,
  classification_confirmed_by uuid references public.profiles(id) on delete set null,
  not_potential_reason     text,

  verification_status      app.verification_status not null default 'PENDENT DE VERIFICAR',
  last_verified_at         timestamptz,
  verification_source      text,
  verification_note        text,

  general_notes     text,
  owner_id          uuid references public.profiles(id) on delete set null,

  external_account_code text, -- accounting account (Comptes Vitalpe / 43xxxxx)
  is_demo           boolean not null default false,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  updated_by        uuid references public.profiles(id) on delete set null,
  deleted_at        timestamptz,
  deleted_reason    text,

  -- ALTRES always needs an explanation (integrity rule 34).
  constraint clients_other_type_needs_explanation
    check (client_type_code is distinct from 'ALTRES' or nullif(btrim(coalesce(other_client_type, '')), '') is not null),
  -- NO POTENCIAL always needs a reason.
  constraint clients_not_potential_needs_reason
    check (confirmed_classification is distinct from 'NO POTENCIAL'
           or nullif(btrim(coalesce(not_potential_reason, '')), '') is not null)
);

-- Canonical name is unique per workspace among live rows. Duplicates that
-- differ only by legal form collapse via name_norm and are rejected here;
-- the importer routes them to the review queue instead.
create unique index if not exists clients_name_norm_uq
  on public.clients (workspace_id, name_norm)
  where deleted_at is null;
create unique index if not exists clients_tax_id_uq
  on public.clients (workspace_id, tax_id_norm)
  where deleted_at is null and tax_id_norm is not null;
create index if not exists clients_ws_idx on public.clients (workspace_id) where deleted_at is null;
create index if not exists clients_owner_idx on public.clients (workspace_id, owner_id) where deleted_at is null;
create index if not exists clients_confirmed_class_idx on public.clients (workspace_id, confirmed_classification) where deleted_at is null;
create index if not exists clients_proposed_class_idx on public.clients (workspace_id, proposed_classification) where deleted_at is null;
create index if not exists clients_municipality_idx on public.clients (workspace_id, municipality) where deleted_at is null;
create index if not exists clients_name_trgm_idx on public.clients using gin (name gin_trgm_ops);
create index if not exists clients_domain_idx on public.clients (workspace_id, website_domain) where website_domain is not null;

-- ---------------------------------------------------------------------------
-- Aliases: every original spelling ever seen for a company is kept.
-- ---------------------------------------------------------------------------
create table if not exists public.client_aliases (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  client_id     uuid not null references public.clients(id) on delete cascade,
  alias         text not null,
  alias_norm    text generated always as (app.normalize_company(alias)) stored,
  source        text,
  is_visible    boolean not null default true,
  created_at    timestamptz not null default now()
);
create unique index if not exists client_aliases_uq
  on public.client_aliases (client_id, alias_norm);
create index if not exists client_aliases_norm_idx
  on public.client_aliases (workspace_id, alias_norm);
create index if not exists client_aliases_trgm_idx
  on public.client_aliases using gin (alias gin_trgm_ops);

-- ---------------------------------------------------------------------------
-- Contacts. Several per company; only one primary among the active ones.
-- ---------------------------------------------------------------------------
create table if not exists public.contacts (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  client_id      uuid not null references public.clients(id) on delete cascade,
  first_name     text,
  last_name      text,
  role_title     text,
  phone_original text,
  phone          text generated always as (app.normalize_phone(phone_original)) stored,
  email_original text,
  email          text generated always as (app.normalize_email(email_original)) stored,
  contact_type   app.contact_type not null default 'GENERAL',
  is_primary     boolean not null default false,
  is_active      boolean not null default true,
  notes          text,
  source         text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  constraint contacts_needs_identity check (
    nullif(btrim(coalesce(first_name, '')), '') is not null
    or nullif(btrim(coalesce(last_name, '')), '') is not null
    or nullif(btrim(coalesce(email_original, '')), '') is not null
    or nullif(btrim(coalesce(phone_original, '')), '') is not null
  )
);
create unique index if not exists contacts_single_primary_uq
  on public.contacts (client_id)
  where is_primary and is_active and deleted_at is null;
create index if not exists contacts_client_idx on public.contacts (client_id) where deleted_at is null;
create index if not exists contacts_email_idx on public.contacts (workspace_id, email) where email is not null;
create index if not exists contacts_phone_idx on public.contacts (workspace_id, phone) where phone is not null;

-- ---------------------------------------------------------------------------
-- Locations. Full address is stored only because visits, navigation and
-- geofencing need it (see SECURITY.md, section "Ubicació").
-- ---------------------------------------------------------------------------
create table if not exists public.client_locations (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  client_id         uuid not null references public.clients(id) on delete cascade,
  name              text,
  location_type     app.location_type not null default 'SEU',
  street            text,
  postal_code       text,
  municipality      text,
  comarca           text,
  province          text,
  country           text not null default 'ES',
  formatted_address text,
  latitude          double precision check (latitude between -90 and 90),
  longitude         double precision check (longitude between -180 and 180),
  accuracy_meters   double precision,
  geocode_source    text,
  geocoded_at       timestamptz,
  verified_by_user  boolean not null default false,
  is_primary        boolean not null default false,
  geofence_enabled  boolean not null default true,
  geofence_radius_m int not null default 120 check (geofence_radius_m between 50 and 2000),
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  -- Coordinates come as a pair or not at all. Never half-geocoded.
  constraint client_locations_coords_pair
    check ((latitude is null) = (longitude is null))
);
create unique index if not exists client_locations_single_primary_uq
  on public.client_locations (client_id)
  where is_primary and deleted_at is null;
create index if not exists client_locations_client_idx on public.client_locations (client_id) where deleted_at is null;
create index if not exists client_locations_geo_idx
  on public.client_locations (latitude, longitude)
  where deleted_at is null and latitude is not null and geofence_enabled;

-- Derived flag used by the "PENDENT DE GEOLOCALITZAR" view/filter.
create or replace view public.v_client_geo_status as
  select c.id as client_id,
         c.workspace_id,
         count(l.id) filter (where l.deleted_at is null) as locations_count,
         count(l.id) filter (where l.deleted_at is null and l.latitude is not null) as geocoded_count,
         case
           when count(l.id) filter (where l.deleted_at is null and l.latitude is not null) > 0 then 'GEOLOCALITZAT'
           else 'PENDENT DE GEOLOCALITZAR'
         end as geo_status
  from public.clients c
  left join public.client_locations l on l.client_id = c.id
  where c.deleted_at is null
  group by c.id, c.workspace_id;

-- ---------------------------------------------------------------------------
-- Assignments (owner + collaborators)
-- ---------------------------------------------------------------------------
create table if not exists public.client_assignments (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  client_id     uuid not null references public.clients(id) on delete cascade,
  user_id       uuid not null references public.profiles(id) on delete cascade,
  is_owner      boolean not null default false,
  assigned_at   timestamptz not null default now(),
  assigned_by   uuid references public.profiles(id) on delete set null,
  is_active     boolean not null default true,
  unique (client_id, user_id)
);
create unique index if not exists client_assignments_single_owner_uq
  on public.client_assignments (client_id) where is_owner and is_active;
create index if not exists client_assignments_user_idx on public.client_assignments (workspace_id, user_id) where is_active;

-- ---------------------------------------------------------------------------
-- Verification history. Append-only: never overwrite a previous verification.
-- ---------------------------------------------------------------------------
create table if not exists public.client_verifications (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  client_id     uuid not null references public.clients(id) on delete cascade,
  status        app.verification_status not null,
  verified_at   timestamptz not null default now(),
  source        text not null,
  note          text,
  user_id       uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now()
);
create index if not exists client_verifications_client_idx
  on public.client_verifications (client_id, verified_at desc);

-- ---------------------------------------------------------------------------
-- Product catalogue (bulk wine module only — Bag in Box is out of scope)
-- ---------------------------------------------------------------------------
create table if not exists public.products (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  name_norm     text generated always as (app.normalize_text(name)) stored,
  category      text not null check (category in ('BASE CAVA', 'DO PENEDES', 'DO CATALUNYA', 'ALTRES / SENSE DO')),
  is_organic    boolean not null default false,
  is_active     boolean not null default true,
  sort_order    int not null default 100,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  deleted_at    timestamptz
);
create unique index if not exists products_name_uq on public.products (name_norm) where deleted_at is null;

-- Import-time only: maps messy spreadsheet product strings onto the catalogue.
create table if not exists public.product_aliases (
  id          uuid primary key default gen_random_uuid(),
  product_id  uuid not null references public.products(id) on delete cascade,
  alias       text not null,
  alias_norm  text generated always as (app.normalize_text(alias)) stored,
  source      text,
  created_at  timestamptz not null default now()
);
create unique index if not exists product_aliases_uq on public.product_aliases (alias_norm);

create table if not exists public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  name_norm   text generated always as (app.normalize_text(name)) stored,
  year_start  int not null check (year_start between 1990 and 2100),
  year_end    int check (year_end between 1990 and 2100),
  status      text not null default 'OBERTA' check (status in ('OBERTA', 'TANCADA', 'FUTURA')),
  starts_on   date,
  ends_on     date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint campaigns_year_order check (year_end is null or year_end >= year_start)
);
create unique index if not exists campaigns_name_uq on public.campaigns (name_norm);

-- ---------------------------------------------------------------------------
-- Opportunities: one row per EMPRESA + PRODUCTE + CAMPANYA + TIPUS DE DADA
-- ---------------------------------------------------------------------------
create table if not exists public.opportunities (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  client_id      uuid not null references public.clients(id) on delete cascade,
  product_id     uuid not null references public.products(id),
  campaign_id    uuid not null references public.campaigns(id),
  data_type      app.opportunity_data_type not null,
  volume_liters  numeric(12, 2) check (volume_liters is null or volume_liters > 0),
  forecast_next  app.forecast_next,
  status         app.opportunity_status not null default 'OBERTA',
  probability    int check (probability between 0 and 100),
  notes          text,
  source         text,
  owner_id       uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  deleted_at     timestamptz,
  -- ALTRES forecast always needs an explanation (integrity rule 34).
  constraint opportunities_forecast_altres_needs_note
    check (forecast_next is distinct from 'ALTRES'
           or nullif(btrim(coalesce(notes, '')), '') is not null)
);
create unique index if not exists opportunities_grain_uq
  on public.opportunities (client_id, product_id, campaign_id, data_type)
  where deleted_at is null;
create index if not exists opportunities_client_idx on public.opportunities (client_id) where deleted_at is null;
create index if not exists opportunities_campaign_idx on public.opportunities (workspace_id, campaign_id) where deleted_at is null;
create index if not exists opportunities_product_idx on public.opportunities (workspace_id, product_id) where deleted_at is null;

-- A real purchase must be traceable to a delivery note when it came from the
-- sales ledger. Several notes can back one opportunity row.
create table if not exists public.opportunity_deliveries (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  opportunity_id  uuid not null references public.opportunities(id) on delete cascade,
  guide_number    text,
  guide_date      date,
  volume_liters   numeric(12, 2) check (volume_liters is null or volume_liters > 0),
  raw_product     text,
  source          text,
  created_at      timestamptz not null default now()
);
create unique index if not exists opportunity_deliveries_uq
  on public.opportunity_deliveries (opportunity_id, guide_number, raw_product, volume_liters);

-- ---------------------------------------------------------------------------
-- Activities: the immutable commercial history.
-- ---------------------------------------------------------------------------
create table if not exists public.activities (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  client_id         uuid not null references public.clients(id) on delete cascade,
  occurred_on       date not null default (now() at time zone 'Europe/Madrid')::date,
  activity_type     app.activity_type not null,
  product_id        uuid references public.products(id),
  campaign_id       uuid references public.campaigns(id),
  result            app.activity_result,
  notes             text,
  user_id           uuid references public.profiles(id) on delete set null,
  source_task_id    uuid,
  source_visit_id   uuid,
  source_voice_note_id uuid,
  corrects_activity_id uuid references public.activities(id) on delete set null,
  origin            app.change_origin not null default 'CRM',
  created_at        timestamptz not null default now(),
  deleted_at        timestamptz,
  deleted_reason    text,
  -- ALTRES result always needs an explanation.
  constraint activities_result_altres_needs_note
    check (result is distinct from 'ALTRES'
           or nullif(btrim(coalesce(notes, '')), '') is not null),
  -- Soft delete is restricted: it must carry a reason.
  constraint activities_delete_needs_reason
    check (deleted_at is null or nullif(btrim(coalesce(deleted_reason, '')), '') is not null)
);
create index if not exists activities_client_idx
  on public.activities (client_id, occurred_on desc, created_at desc)
  where deleted_at is null;
create index if not exists activities_ws_idx
  on public.activities (workspace_id, occurred_on desc) where deleted_at is null;
create index if not exists activities_user_idx
  on public.activities (workspace_id, user_id, occurred_on desc) where deleted_at is null;

create trigger clients_touch before update on public.clients
  for each row execute function app.touch_updated_at();
create trigger contacts_touch before update on public.contacts
  for each row execute function app.touch_updated_at();
create trigger client_locations_touch before update on public.client_locations
  for each row execute function app.touch_updated_at();
create trigger products_touch before update on public.products
  for each row execute function app.touch_updated_at();
create trigger campaigns_touch before update on public.campaigns
  for each row execute function app.touch_updated_at();
create trigger opportunities_touch before update on public.opportunities
  for each row execute function app.touch_updated_at();

create trigger clients_audit after insert or update or delete on public.clients
  for each row execute function app.audit_trigger();
create trigger contacts_audit after insert or update or delete on public.contacts
  for each row execute function app.audit_trigger();
create trigger client_locations_audit after insert or update or delete on public.client_locations
  for each row execute function app.audit_trigger();
create trigger opportunities_audit after insert or update or delete on public.opportunities
  for each row execute function app.audit_trigger();
create trigger activities_audit after insert or update or delete on public.activities
  for each row execute function app.audit_trigger();
create trigger client_assignments_audit after insert or update or delete on public.client_assignments
  for each row execute function app.audit_trigger();
