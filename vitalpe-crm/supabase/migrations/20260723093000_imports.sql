-- ============================================================================
-- VITALPE CRM — 0004 IMPORTS, STAGING, PROVENANCE, DEDUPE
-- ============================================================================

create table if not exists public.imports (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  label         text not null,
  status        app.import_status not null default 'BORRADOR',
  started_at    timestamptz not null default now(),
  finished_at   timestamptz,
  created_by    uuid references public.profiles(id) on delete set null,
  stats         jsonb not null default '{}'::jsonb,
  notes         text,
  undone_at     timestamptz,
  undone_by     uuid references public.profiles(id) on delete set null
);

create table if not exists public.import_files (
  id            uuid primary key default gen_random_uuid(),
  import_id     uuid not null references public.imports(id) on delete cascade,
  filename      text not null,
  byte_size     bigint not null,
  sha256        text not null,
  mime_type     text,
  stored_path   text,
  created_at    timestamptz not null default now()
);

create table if not exists public.import_sheets (
  id             uuid primary key default gen_random_uuid(),
  import_file_id uuid not null references public.import_files(id) on delete cascade,
  sheet_name     text not null,
  header_row     int,
  rows_total     int not null default 0,
  rows_read      int not null default 0,
  entity_hint    text,
  is_excluded    boolean not null default false,
  exclusion_reason text
);

-- Reusable column mapping templates, so the next file with the same shape can
-- be imported without redoing the mapping by hand.
create table if not exists public.import_mappings (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  name           text not null,
  sheet_pattern  text,
  mapping        jsonb not null,
  created_by     uuid references public.profiles(id) on delete set null,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, name)
);

-- Raw rows land here first, exactly as read. Nothing is normalised in place.
create table if not exists public.import_rows (
  id              uuid primary key default gen_random_uuid(),
  import_id       uuid not null references public.imports(id) on delete cascade,
  import_sheet_id uuid not null references public.import_sheets(id) on delete cascade,
  row_number      int not null,
  raw             jsonb not null,
  normalized      jsonb,
  outcome         text not null default 'PENDENT'
                  check (outcome in ('PENDENT', 'IMPORTADA', 'IGNORADA', 'REBUTJADA', 'EXCLOSA', 'DUPLICADA')),
  outcome_reason  text,
  entities_created jsonb not null default '{}'::jsonb,
  error           text,
  created_at      timestamptz not null default now()
);
create index if not exists import_rows_import_idx on public.import_rows (import_id, outcome);
create unique index if not exists import_rows_uq on public.import_rows (import_sheet_id, row_number);

-- Field-level provenance: for any imported value we can answer
-- "which file, sheet, row, column and rule produced this?".
create table if not exists public.field_provenance (
  id              bigserial primary key,
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  entity          text not null,
  entity_id       uuid not null,
  field           text not null,
  original_value  text,
  normalized_value text,
  import_id       uuid references public.imports(id) on delete set null,
  import_row_id   uuid references public.import_rows(id) on delete set null,
  source_file     text,
  source_sheet    text,
  source_row      int,
  source_column   text,
  rule_applied    text,
  imported_at     timestamptz not null default now(),
  imported_by     uuid references public.profiles(id) on delete set null
);
create index if not exists field_provenance_entity_idx
  on public.field_provenance (entity, entity_id, field);
create index if not exists field_provenance_import_idx
  on public.field_provenance (import_id);

-- Duplicate review queue. Nothing ambiguous is ever merged silently.
create table if not exists public.duplicate_candidates (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  import_id       uuid references public.imports(id) on delete set null,
  left_client_id  uuid references public.clients(id) on delete cascade,
  right_client_id uuid references public.clients(id) on delete cascade,
  candidate_name  text,
  import_row_id   uuid references public.import_rows(id) on delete set null,
  score           numeric(4, 3) not null check (score between 0 and 1),
  signals         jsonb not null default '{}'::jsonb,
  is_deterministic boolean not null default false,
  decision        app.dedupe_decision not null default 'PENDENT',
  decided_by      uuid references public.profiles(id) on delete set null,
  decided_at      timestamptz,
  decision_note   text,
  created_at      timestamptz not null default now()
);
create index if not exists duplicate_candidates_pending_idx
  on public.duplicate_candidates (workspace_id, decision) where decision = 'PENDENT';

-- Merge journal. Source rows are kept, so a merge can always be undone.
create table if not exists public.client_merges (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  surviving_client_id uuid not null references public.clients(id) on delete cascade,
  merged_client_id    uuid not null references public.clients(id) on delete cascade,
  was_automatic   boolean not null default false,
  reason          text not null,
  signals         jsonb not null default '{}'::jsonb,
  snapshot        jsonb not null,
  merged_by       uuid references public.profiles(id) on delete set null,
  merged_at       timestamptz not null default now(),
  undone_at       timestamptz,
  undone_by       uuid references public.profiles(id) on delete set null
);

-- Rows recognised as out-of-scope (Bag in Box) are never deleted: they are
-- parked here for a future module.
create table if not exists public.excluded_records (
  id              uuid primary key default gen_random_uuid(),
  workspace_id    uuid not null references public.workspaces(id) on delete cascade,
  import_id       uuid references public.imports(id) on delete set null,
  import_row_id   uuid references public.import_rows(id) on delete set null,
  module          text not null default 'BAG_IN_BOX',
  reason          text not null,
  raw             jsonb not null,
  created_at      timestamptz not null default now()
);
create index if not exists excluded_records_module_idx on public.excluded_records (workspace_id, module);

-- Values seen in the sources that could not be mapped to the catalogue.
-- Surfaced in "PENDENTS DE REVISAR", never guessed.
create table if not exists public.unmapped_values (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces(id) on delete cascade,
  import_id     uuid references public.imports(id) on delete set null,
  kind          text not null check (kind in ('PRODUCTE', 'CAMPANYA', 'TIPUS EMPRESA', 'RESULTAT', 'ACCIO', 'ALTRES')),
  raw_value     text not null,
  occurrences   int not null default 1,
  resolved_to   text,
  resolved_at   timestamptz,
  resolved_by   uuid references public.profiles(id) on delete set null,
  created_at    timestamptz not null default now(),
  unique (workspace_id, kind, raw_value)
);

create trigger imports_audit after insert or update or delete on public.imports
  for each row execute function app.audit_trigger();
create trigger duplicate_candidates_audit after insert or update or delete on public.duplicate_candidates
  for each row execute function app.audit_trigger();
create trigger client_merges_audit after insert or update or delete on public.client_merges
  for each row execute function app.audit_trigger();
