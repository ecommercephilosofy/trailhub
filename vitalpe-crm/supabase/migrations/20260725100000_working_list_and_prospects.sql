-- ---------------------------------------------------------------------------
-- The working list, and prospecting.
--
-- Two things this migration deliberately does NOT do:
--
--  1. It does not delete the companies Carlos left out of his cleaned list.
--     507 of the 801 fall outside it, and 29 of those have real purchases
--     totalling 2.6 million litres — Pinord alone is 615.000 L. A "cleanup" of
--     a prospecting sheet is not a statement that those customers stopped
--     existing, and several are the same company under a different spelling.
--     So membership of the working list is a FLAG, not a deletion: the default
--     screens follow Carlos's list, and every litre of history stays.
--
--  2. It does not let a scraped prospect become a client on its own. A
--     prospect is a candidate with a source URL and nothing else; it carries no
--     commercial history, cannot be assigned, and turns into a company only
--     when a person presses a button. Inventing customers is the one thing this
--     system must never do, and an automated discovery feed is exactly where
--     that would creep in.
-- ---------------------------------------------------------------------------

-- --- 1. Working list -------------------------------------------------------

alter table public.clients
  add column if not exists in_working_list boolean not null default true;

comment on column public.clients.in_working_list is
  'True when the company is on the commercial''s current working list. False means "not being worked right now" — never "deleted": the history, purchases and audit trail are untouched.';

-- The external id from the operational workbook (VIT-GR-0001). Kept so a
-- re-import matches on identity instead of on a name that may have been edited.
alter table public.clients
  add column if not exists external_ref text;

comment on column public.clients.external_ref is
  'Stable id from the operational workbook (VIT-GR-nnnn). Identity across re-imports.';

create unique index if not exists clients_external_ref_key
  on public.clients (workspace_id, external_ref)
  where external_ref is not null and deleted_at is null;

create index if not exists clients_working_list_idx
  on public.clients (workspace_id, in_working_list)
  where deleted_at is null;

-- --- 2. Prospects ----------------------------------------------------------

do $$ begin
  create type app.prospect_status as enum ('CANDIDAT', 'DESCARTAT', 'CONVERTIT');
exception when duplicate_object then null; end $$;

create table if not exists public.prospects (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,

  name              text not null,
  name_norm         text generated always as (app.normalize_company(name)) stored,
  municipality      text,
  province          text,
  website           text,
  phone             text,
  email             text,

  -- Where this candidate came from. Both are required by the check below:
  -- a prospect with no traceable origin is indistinguishable from an invented
  -- one, which is precisely what must not enter this table.
  source            text not null,
  source_url        text,
  source_note       text,
  discovered_on     date not null default (now() at time zone 'Europe/Madrid')::date,

  -- Why we think they are worth a call, and for what.
  suggested_product text,
  rationale         text,

  -- Set when the reviewer decides. A prospect never changes itself.
  status            app.prospect_status not null default 'CANDIDAT',
  reviewed_by       uuid references public.profiles(id) on delete set null,
  reviewed_at       timestamptz,
  review_note       text,
  /** The company created from this prospect, once someone accepted it. */
  client_id         uuid references public.clients(id) on delete set null,

  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),

  constraint prospects_name_not_blank check (btrim(name) <> ''),
  constraint prospects_needs_origin check (btrim(source) <> ''),
  -- A decision has to say who took it: an automatically "reviewed" prospect
  -- would defeat the point of the review queue.
  constraint prospects_decision_is_attributed check (
    status = 'CANDIDAT' or (reviewed_by is not null and reviewed_at is not null)
  ),
  constraint prospects_converted_has_client check (
    status <> 'CONVERTIT' or client_id is not null
  )
);

-- One row per company per workspace: re-running discovery updates, never piles up.
create unique index if not exists prospects_name_key
  on public.prospects (workspace_id, name_norm);

create index if not exists prospects_status_idx on public.prospects (workspace_id, status);
create index if not exists prospects_municipality_idx on public.prospects (workspace_id, municipality);
create index if not exists prospects_name_trgm on public.prospects using gin (name_norm gin_trgm_ops);

drop trigger if exists prospects_touch on public.prospects;
create trigger prospects_touch before update on public.prospects
  for each row execute function app.touch_updated_at();

drop trigger if exists prospects_audit on public.prospects;
create trigger prospects_audit after insert or update or delete on public.prospects
  for each row execute function app.audit_trigger();

alter table public.prospects enable row level security;

-- READ: any member. The supervisor sees the pipeline like everything else.
drop policy if exists prospects_read on public.prospects;
create policy prospects_read on public.prospects
  for select using (app.is_member(workspace_id));

-- WRITE: ADMIN only, like the rest of the master data (migration 0008 moved
-- every write off the manager tier — the supervisor reads and nothing else).
drop policy if exists prospects_write on public.prospects;
create policy prospects_write on public.prospects
  for all using (app.is_admin(workspace_id)) with check (app.is_admin(workspace_id));

grant select, insert, update, delete on public.prospects to authenticated;

-- --- 3. Reading the working list ------------------------------------------

comment on table public.prospects is
  'Companies that are NOT customers yet and were found by prospecting. Every row carries its source; a person converts it into a client or discards it. Nothing here is ever auto-promoted.';
