-- ============================================================================
-- VITALPE CRM — 0003 OPERATIONS
-- Tasks, visits, Google Calendar links, voice notes, devices, geofencing,
-- notification settings.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Tasks. One entity covers tasks, reminders and "next actions".
-- A task with due_at = NULL is a next action attached to the company: it never
-- appears on the daily dashboard and is never overdue.
-- ---------------------------------------------------------------------------
create table if not exists public.tasks (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  kind              app.task_kind not null default 'TASCA',
  action            app.commercial_action not null,
  other_action      text,
  sample_subtype    app.sample_subtype,
  client_id         uuid references public.clients(id) on delete cascade,
  product_id        uuid references public.products(id),
  campaign_id       uuid references public.campaigns(id),
  title             text,
  due_at            timestamptz,
  duration_minutes  int check (duration_minutes is null or duration_minutes between 5 and 1440),
  priority          app.task_priority not null default 'MITJANA',
  status            app.task_status not null default 'PENDENT',
  result            app.activity_result,
  notes             text,
  postponed_to      timestamptz,
  created_by        uuid references public.profiles(id) on delete set null,
  assigned_to       uuid references public.profiles(id) on delete set null,
  visit_id          uuid,
  source_task_id    uuid references public.tasks(id) on delete set null,
  source_voice_note_id uuid,
  sync_to_google    boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  completed_at      timestamptz,
  deleted_at        timestamptz,

  constraint tasks_other_action_needs_explanation
    check (action is distinct from 'ALTRES'
           or nullif(btrim(coalesce(other_action, '')), '') is not null),
  -- Completing a commercial task requires a result (integrity rule 34).
  -- NOTA INTERNA-like bookkeeping actions are not exempt: every action in the
  -- enum is commercial, so the rule applies to all of them.
  constraint tasks_done_needs_result
    check (status <> 'FET' or result is not null),
  -- Postponing requires a new date.
  constraint tasks_postponed_needs_new_date
    check (status <> 'AJORNAT' or postponed_to is not null),
  constraint tasks_completed_at_consistency
    check ((status = 'FET') = (completed_at is not null))
);
create index if not exists tasks_due_idx
  on public.tasks (workspace_id, assigned_to, due_at)
  where deleted_at is null and status = 'PENDENT' and due_at is not null;
create index if not exists tasks_client_idx
  on public.tasks (client_id, status, due_at) where deleted_at is null;
create index if not exists tasks_undated_idx
  on public.tasks (workspace_id, client_id)
  where deleted_at is null and status = 'PENDENT' and due_at is null;
create index if not exists tasks_assignee_idx
  on public.tasks (workspace_id, assigned_to, status) where deleted_at is null;

-- ---------------------------------------------------------------------------
-- Visits. Always paired with a task of action = VISITA (created in one
-- transaction by app.create_visit_with_task).
-- ---------------------------------------------------------------------------
create table if not exists public.visits (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  client_id          uuid not null references public.clients(id) on delete cascade,
  location_id        uuid references public.client_locations(id) on delete set null,
  user_id            uuid references public.profiles(id) on delete set null,
  title              text,
  objective          text,
  important_info     text,
  starts_at          timestamptz not null,
  ends_at            timestamptz not null,
  status             app.visit_status not null default 'PLANIFICADA',
  result             app.activity_result,
  task_id            uuid references public.tasks(id) on delete set null,
  reminders_minutes  int[] not null default '{60}',
  notes_before       text,
  notes_after        text,
  created_from_voice boolean not null default false,
  created_from_google boolean not null default false,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  cancelled_at       timestamptz,
  cancellation_reason text,
  cancellation_origin app.change_origin,
  deleted_at         timestamptz,
  constraint visits_time_order check (ends_at > starts_at),
  constraint visits_cancel_consistency
    check (status <> 'CANCEL·LADA' or cancelled_at is not null)
);
create index if not exists visits_day_idx
  on public.visits (workspace_id, user_id, starts_at)
  where deleted_at is null and status <> 'CANCEL·LADA';
create index if not exists visits_client_idx on public.visits (client_id, starts_at desc) where deleted_at is null;

alter table public.tasks
  drop constraint if exists tasks_visit_fk;
alter table public.tasks
  add constraint tasks_visit_fk foreign key (visit_id) references public.visits(id) on delete set null;

alter table public.activities
  drop constraint if exists activities_source_task_fk;
alter table public.activities
  add constraint activities_source_task_fk foreign key (source_task_id) references public.tasks(id) on delete set null;
alter table public.activities
  drop constraint if exists activities_source_visit_fk;
alter table public.activities
  add constraint activities_source_visit_fk foreign key (source_visit_id) references public.visits(id) on delete set null;

-- ---------------------------------------------------------------------------
-- Google Calendar
-- ---------------------------------------------------------------------------
create table if not exists public.google_calendar_connections (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  user_id           uuid not null references public.profiles(id) on delete cascade,
  provider          text not null default 'google',
  google_account_email text,
  calendar_id       text,
  calendar_name     text,
  status            text not null default 'CONNECTAT'
                    check (status in ('CONNECTAT', 'DESCONNECTAT', 'ERROR', 'TOKEN INVALID')),
  scopes            text[] not null default '{}',
  -- Tokens are encrypted at the application boundary (AES-256-GCM,
  -- APP_ENCRYPTION_KEY) and are NEVER selectable by the client role: see the
  -- column-level revoke in the RLS migration.
  access_token_enc  text,
  refresh_token_enc text,
  token_expires_at  timestamptz,
  sync_token        text,
  last_sync_at      timestamptz,
  last_error        text,
  disconnected_at   timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, provider)
);

create table if not exists public.calendar_event_links (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  connection_id     uuid references public.google_calendar_connections(id) on delete set null,
  visit_id          uuid not null references public.visits(id) on delete cascade,
  task_id           uuid references public.tasks(id) on delete set null,
  calendar_id       text not null,
  google_event_id   text not null,
  etag              text,
  google_updated_at timestamptz,
  -- Hash of the payload last pushed/pulled. Equal hash => no echo back.
  content_hash      text,
  last_change_origin app.change_origin not null default 'CRM',
  last_synced_at    timestamptz,
  status            app.sync_status not null default 'PENDENT',
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
create unique index if not exists calendar_event_links_google_uq
  on public.calendar_event_links (calendar_id, google_event_id);
create unique index if not exists calendar_event_links_visit_uq
  on public.calendar_event_links (visit_id);

create table if not exists public.calendar_watch_channels (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  connection_id     uuid not null references public.google_calendar_connections(id) on delete cascade,
  channel_id        text not null unique,
  resource_id       text not null,
  verification_token text not null,
  created_at        timestamptz not null default now(),
  expires_at        timestamptz not null,
  status            text not null default 'ACTIU' check (status in ('ACTIU', 'CADUCAT', 'TANCAT', 'ERROR')),
  last_message_at   timestamptz,
  last_message_number bigint
);
create index if not exists calendar_watch_expiry_idx
  on public.calendar_watch_channels (expires_at) where status = 'ACTIU';

-- Every webhook hit is recorded so replays are idempotent.
create table if not exists public.calendar_sync_events (
  id            bigserial primary key,
  channel_id    text,
  resource_id   text,
  message_number bigint,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  outcome       text,
  error         text
);
create unique index if not exists calendar_sync_events_idem_uq
  on public.calendar_sync_events (channel_id, message_number)
  where message_number is not null;

-- ---------------------------------------------------------------------------
-- Voice notes
-- ---------------------------------------------------------------------------
create table if not exists public.voice_notes (
  id                  uuid primary key default gen_random_uuid(),
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  user_id             uuid not null references public.profiles(id) on delete cascade,
  client_id           uuid references public.clients(id) on delete set null,
  origin_context      text,
  audio_path          text,
  audio_duration_s    numeric(8, 2),
  audio_format        text,
  audio_bytes         bigint,
  detected_language   text,
  transcript          text,
  transcription_status app.voice_stage_status not null default 'PENDENT',
  transcription_provider text,
  summary             text,
  interpretation_status app.voice_stage_status not null default 'PENDENT',
  interpretation_provider text,
  model_version       text,
  confidence          numeric(4, 3) check (confidence is null or confidence between 0 and 1),
  retention_policy    text not null default 'DELETE_AFTER_CONFIRM'
                      check (retention_policy in ('KEEP', 'DELETE_AFTER_TRANSCRIPTION', 'DELETE_AFTER_CONFIRM', 'KEEP_DAYS')),
  retention_days      int,
  audio_deleted_at    timestamptz,
  confirmed_at        timestamptz,
  error               text,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create index if not exists voice_notes_user_idx on public.voice_notes (workspace_id, user_id, created_at desc);
create index if not exists voice_notes_client_idx on public.voice_notes (client_id, created_at desc);

alter table public.tasks
  drop constraint if exists tasks_source_voice_fk;
alter table public.tasks
  add constraint tasks_source_voice_fk foreign key (source_voice_note_id) references public.voice_notes(id) on delete set null;
alter table public.activities
  drop constraint if exists activities_source_voice_fk;
alter table public.activities
  add constraint activities_source_voice_fk foreign key (source_voice_note_id) references public.voice_notes(id) on delete set null;

create table if not exists public.voice_interpretation_proposals (
  id                uuid primary key default gen_random_uuid(),
  workspace_id      uuid not null references public.workspaces(id) on delete cascade,
  voice_note_id     uuid not null references public.voice_notes(id) on delete cascade,
  transcript_original text,
  proposal_original jsonb not null,
  proposal_edited   jsonb,
  confirmed_actions jsonb,
  discarded_actions jsonb,
  ambiguities       jsonb not null default '[]'::jsonb,
  confidence        numeric(4, 3) check (confidence is null or confidence between 0 and 1),
  confirmed_by      uuid references public.profiles(id) on delete set null,
  confirmed_at      timestamptz,
  -- A proposal can never be applied twice (integrity rule 34).
  idempotency_key   text not null,
  applied_at        timestamptz,
  created_at        timestamptz not null default now()
);
create unique index if not exists voice_proposals_idem_uq
  on public.voice_interpretation_proposals (workspace_id, idempotency_key);
create unique index if not exists voice_proposals_single_applied_uq
  on public.voice_interpretation_proposals (voice_note_id)
  where applied_at is not null;

-- ---------------------------------------------------------------------------
-- Mobile devices, geofencing, notifications
-- ---------------------------------------------------------------------------
create table if not exists public.device_installations (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  user_id            uuid not null references public.profiles(id) on delete cascade,
  platform           text not null check (platform in ('ios', 'android', 'web')),
  device_key         text not null,
  push_token         text,
  app_version        text,
  notifications_permission text
    check (notifications_permission in ('GRANTED', 'DENIED', 'UNDETERMINED')),
  location_permission text
    check (location_permission in ('ALWAYS', 'WHEN_IN_USE', 'DENIED', 'UNDETERMINED')),
  last_seen_at       timestamptz,
  is_active          boolean not null default true,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, device_key)
);

create table if not exists public.geofence_registrations (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  device_id      uuid references public.device_installations(id) on delete cascade,
  client_id      uuid not null references public.clients(id) on delete cascade,
  location_id    uuid not null references public.client_locations(id) on delete cascade,
  region_id      text not null,
  radius_m       int not null,
  priority       int not null default 100,
  selection_reason text not null,
  registered_at  timestamptz not null default now(),
  expires_at     timestamptz,
  status         text not null default 'ACTIVA' check (status in ('ACTIVA', 'RETIRADA', 'CADUCADA')),
  unique (device_id, region_id)
);
create index if not exists geofence_reg_active_idx
  on public.geofence_registrations (user_id, device_id, status);

-- Only arrival/exit facts are kept. No continuous movement trail (SECURITY.md).
create table if not exists public.geofence_events (
  id                 uuid primary key default gen_random_uuid(),
  workspace_id       uuid not null references public.workspaces(id) on delete cascade,
  user_id            uuid not null references public.profiles(id) on delete cascade,
  client_id          uuid references public.clients(id) on delete set null,
  location_id        uuid references public.client_locations(id) on delete set null,
  event_type         app.geofence_event_type not null,
  occurred_at        timestamptz not null default now(),
  notification_shown boolean not null default false,
  client_opened      boolean not null default false,
  rejected_by_user   boolean not null default false,
  confidence         text not null default 'MITJANA' check (confidence in ('ALTA', 'MITJANA', 'BAIXA', 'AMBIGUA')),
  created_at         timestamptz not null default now()
);
create index if not exists geofence_events_cooldown_idx
  on public.geofence_events (user_id, client_id, occurred_at desc);

create table if not exists public.notification_settings (
  user_id             uuid primary key references public.profiles(id) on delete cascade,
  workspace_id        uuid not null references public.workspaces(id) on delete cascade,
  visit_reminder_minutes int not null default 60,
  notify_visit_reminder  boolean not null default true,
  notify_overdue_tasks   boolean not null default true,
  notify_assigned_tasks  boolean not null default true,
  notify_visit_changed   boolean not null default true,
  notify_sync_errors     boolean not null default true,
  notify_client_arrival  boolean not null default true,
  -- When Google already fires a reminder for a synced visit we do not add ours.
  suppress_duplicate_google_reminders boolean not null default true,
  hide_client_name_on_lockscreen boolean not null default false,
  geofence_cooldown_hours int not null default 6 check (geofence_cooldown_hours between 1 and 48),
  geofence_default_radius_m int not null default 120 check (geofence_default_radius_m between 50 and 2000),
  max_geofence_regions   int not null default 20 check (max_geofence_regions between 1 and 100),
  updated_at          timestamptz not null default now()
);

-- Offline queue: mobile posts operations with a client-generated key so a
-- retried upload can never apply twice.
create table if not exists public.sync_queue_entries (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references public.workspaces(id) on delete cascade,
  user_id        uuid not null references public.profiles(id) on delete cascade,
  idempotency_key text not null,
  operation      text not null,
  payload        jsonb not null,
  status         text not null default 'PENDENT' check (status in ('PENDENT', 'APLICAT', 'ERROR', 'CONFLICTE')),
  attempts       int not null default 0,
  last_error     text,
  applied_at     timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (workspace_id, idempotency_key)
);

create trigger tasks_touch before update on public.tasks
  for each row execute function app.touch_updated_at();
create trigger visits_touch before update on public.visits
  for each row execute function app.touch_updated_at();
create trigger gcal_conn_touch before update on public.google_calendar_connections
  for each row execute function app.touch_updated_at();
create trigger cal_links_touch before update on public.calendar_event_links
  for each row execute function app.touch_updated_at();
create trigger voice_notes_touch before update on public.voice_notes
  for each row execute function app.touch_updated_at();
create trigger devices_touch before update on public.device_installations
  for each row execute function app.touch_updated_at();
create trigger sync_queue_touch before update on public.sync_queue_entries
  for each row execute function app.touch_updated_at();

create trigger tasks_audit after insert or update or delete on public.tasks
  for each row execute function app.audit_trigger();
create trigger visits_audit after insert or update or delete on public.visits
  for each row execute function app.audit_trigger();
create trigger cal_links_audit after insert or update or delete on public.calendar_event_links
  for each row execute function app.audit_trigger();
create trigger voice_proposals_audit after insert or update or delete on public.voice_interpretation_proposals
  for each row execute function app.audit_trigger();
