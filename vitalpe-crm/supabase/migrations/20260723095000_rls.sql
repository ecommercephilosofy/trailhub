-- ============================================================================
-- VITALPE CRM — 0006 ROW LEVEL SECURITY
--
-- Every table that the API can reach has RLS enabled. Roles are permission
-- presets evaluated in the database, not in the UI: hiding a button is not a
-- permission. The service_role key (server only) bypasses RLS by design and is
-- never shipped to a browser or a phone.
-- ============================================================================

alter table public.workspaces                     enable row level security;
alter table public.profiles                       enable row level security;
alter table public.workspace_memberships          enable row level security;
alter table public.workspace_invitations          enable row level security;
alter table public.audit_log                      enable row level security;
alter table public.client_types                   enable row level security;
alter table public.clients                        enable row level security;
alter table public.client_aliases                 enable row level security;
alter table public.contacts                       enable row level security;
alter table public.client_locations               enable row level security;
alter table public.client_assignments             enable row level security;
alter table public.client_verifications           enable row level security;
alter table public.products                       enable row level security;
alter table public.product_aliases                enable row level security;
alter table public.campaigns                      enable row level security;
alter table public.opportunities                  enable row level security;
alter table public.opportunity_deliveries         enable row level security;
alter table public.activities                     enable row level security;
alter table public.tasks                          enable row level security;
alter table public.visits                         enable row level security;
alter table public.google_calendar_connections    enable row level security;
alter table public.calendar_event_links           enable row level security;
alter table public.calendar_watch_channels        enable row level security;
alter table public.calendar_sync_events           enable row level security;
alter table public.voice_notes                    enable row level security;
alter table public.voice_interpretation_proposals enable row level security;
alter table public.device_installations           enable row level security;
alter table public.geofence_registrations         enable row level security;
alter table public.geofence_events                enable row level security;
alter table public.notification_settings          enable row level security;
alter table public.sync_queue_entries             enable row level security;
alter table public.imports                        enable row level security;
alter table public.import_files                   enable row level security;
alter table public.import_sheets                  enable row level security;
alter table public.import_mappings                enable row level security;
alter table public.import_rows                    enable row level security;
alter table public.field_provenance               enable row level security;
alter table public.duplicate_candidates           enable row level security;
alter table public.client_merges                  enable row level security;
alter table public.excluded_records               enable row level security;
alter table public.unmapped_values                enable row level security;

-- ---------------------------------------------------------------------------
-- Workspace, profiles, memberships
-- ---------------------------------------------------------------------------
create policy workspaces_select on public.workspaces
  for select using (app.is_member(id));
create policy workspaces_update on public.workspaces
  for update using (app.is_admin(id)) with check (app.is_admin(id));

create policy profiles_select_self on public.profiles
  for select using (
    id = auth.uid()
    or exists (
      select 1 from public.workspace_memberships m1
      join public.workspace_memberships m2 on m2.workspace_id = m1.workspace_id
      where m1.user_id = auth.uid() and m1.status = 'ACTIU'
        and m2.user_id = public.profiles.id
    )
  );
create policy profiles_update_self on public.profiles
  for update using (id = auth.uid()) with check (id = auth.uid());

create policy memberships_select on public.workspace_memberships
  for select using (user_id = auth.uid() or app.is_member(workspace_id));
-- Only an ADMIN grants, changes or removes a role. A COMERCIAL cannot raise
-- their own: the WITH CHECK is evaluated against the *new* row too.
create policy memberships_admin_write on public.workspace_memberships
  for all using (app.is_admin(workspace_id)) with check (app.is_admin(workspace_id));

create policy invitations_admin_all on public.workspace_invitations
  for all using (app.is_admin(workspace_id)) with check (app.is_admin(workspace_id));
create policy invitations_manager_read on public.workspace_invitations
  for select using (app.is_manager(workspace_id));

-- Audit log is read-only for managers and has no write policy at all:
-- rows arrive exclusively through the SECURITY DEFINER audit trigger.
create policy audit_select on public.audit_log
  for select using (workspace_id is not null and app.is_manager(workspace_id));

-- ---------------------------------------------------------------------------
-- Shared catalogues (workspace-independent master data)
-- ---------------------------------------------------------------------------
create policy client_types_read on public.client_types
  for select using (auth.uid() is not null);
create policy products_read on public.products
  for select using (auth.uid() is not null);
create policy product_aliases_read on public.product_aliases
  for select using (auth.uid() is not null);
create policy campaigns_read on public.campaigns
  for select using (auth.uid() is not null);

-- ---------------------------------------------------------------------------
-- Clients and satellites
--
-- SELECT: any active member of the workspace.
-- WRITE : ADMIN/GERENT anywhere; COMERCIAL only on clients assigned to them.
-- ---------------------------------------------------------------------------
create or replace function app.can_edit_client(p_client_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1
    from public.clients c
    where c.id = p_client_id
      and (
        app.is_manager(c.workspace_id)
        or (
          app.role_in(c.workspace_id) = 'COMERCIAL'
          and (
            c.owner_id = auth.uid()
            or exists (
              select 1 from public.client_assignments a
              where a.client_id = c.id and a.user_id = auth.uid() and a.is_active
            )
          )
        )
      )
  )
$$;

create policy clients_select on public.clients
  for select using (app.is_member(workspace_id));
create policy clients_insert on public.clients
  for insert with check (app.is_member(workspace_id));
create policy clients_update on public.clients
  for update using (app.can_edit_client(id)) with check (app.can_edit_client(id));
-- Hard DELETE is never granted; the app soft-deletes (deleted_at + reason).
create policy clients_delete_admin on public.clients
  for delete using (app.is_admin(workspace_id));

create policy client_aliases_select on public.client_aliases
  for select using (app.is_member(workspace_id));
create policy client_aliases_write on public.client_aliases
  for all using (app.can_edit_client(client_id)) with check (app.can_edit_client(client_id));

create policy contacts_select on public.contacts
  for select using (app.is_member(workspace_id));
create policy contacts_write on public.contacts
  for all using (app.can_edit_client(client_id)) with check (app.can_edit_client(client_id));

create policy client_locations_select on public.client_locations
  for select using (app.is_member(workspace_id));
create policy client_locations_write on public.client_locations
  for all using (app.can_edit_client(client_id)) with check (app.can_edit_client(client_id));

create policy client_assignments_select on public.client_assignments
  for select using (app.is_member(workspace_id));
-- Reassigning a client is a manager action (a COMERCIAL cannot grab clients).
create policy client_assignments_write on public.client_assignments
  for all using (app.is_manager(workspace_id)) with check (app.is_manager(workspace_id));

create policy client_verifications_select on public.client_verifications
  for select using (app.is_member(workspace_id));
create policy client_verifications_insert on public.client_verifications
  for insert with check (app.is_member(workspace_id) and app.can_edit_client(client_id));

-- ---------------------------------------------------------------------------
-- Opportunities and history
-- ---------------------------------------------------------------------------
create policy opportunities_select on public.opportunities
  for select using (app.is_member(workspace_id));
create policy opportunities_write on public.opportunities
  for all using (app.can_edit_client(client_id)) with check (app.can_edit_client(client_id));

create policy opportunity_deliveries_select on public.opportunity_deliveries
  for select using (app.is_member(workspace_id));
create policy opportunity_deliveries_write on public.opportunity_deliveries
  for all using (app.is_manager(workspace_id)) with check (app.is_manager(workspace_id));

create policy activities_select on public.activities
  for select using (app.is_member(workspace_id));
create policy activities_insert on public.activities
  for insert with check (app.is_member(workspace_id));
-- History is corrected, not rewritten: only a manager may edit an existing
-- activity, and the audit trigger records the before/after.
create policy activities_update_manager on public.activities
  for update using (app.is_manager(workspace_id)) with check (app.is_manager(workspace_id));
-- No DELETE policy: activities are never removed through the API.

-- ---------------------------------------------------------------------------
-- Tasks and visits
-- ---------------------------------------------------------------------------
create policy tasks_select on public.tasks
  for select using (app.is_member(workspace_id));
create policy tasks_insert on public.tasks
  for insert with check (app.is_member(workspace_id));
create policy tasks_update on public.tasks
  for update using (
    app.is_manager(workspace_id)
    or assigned_to = auth.uid()
    or created_by = auth.uid()
  ) with check (
    app.is_manager(workspace_id)
    or assigned_to = auth.uid()
    or created_by = auth.uid()
  );

create policy visits_select on public.visits
  for select using (app.is_member(workspace_id));
create policy visits_insert on public.visits
  for insert with check (app.is_member(workspace_id));
create policy visits_update on public.visits
  for update using (app.is_manager(workspace_id) or user_id = auth.uid())
  with check (app.is_manager(workspace_id) or user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Google Calendar. A connection is strictly personal: a GERENT sees a
-- colleague's CRM visits, never their calendar account or tokens.
-- ---------------------------------------------------------------------------
create policy gcal_connections_own on public.google_calendar_connections
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Tokens must not be readable or writable through the API, not even by their
-- owner: they are handled server-side with the service role.
--
-- A column-level REVOKE cannot subtract from a table-level GRANT, so the table
-- grant is withdrawn first and then re-granted column by column, deliberately
-- omitting access_token_enc, refresh_token_enc and sync_token.
revoke select, insert, update on public.google_calendar_connections from anon, authenticated;
grant select (
  id, workspace_id, user_id, provider, google_account_email, calendar_id,
  calendar_name, status, scopes, token_expires_at, last_sync_at, last_error,
  disconnected_at, created_at, updated_at
) on public.google_calendar_connections to authenticated;
grant insert (
  id, workspace_id, user_id, provider, google_account_email, calendar_id,
  calendar_name, status, scopes
) on public.google_calendar_connections to authenticated;
grant update (
  google_account_email, calendar_id, calendar_name, status, disconnected_at
) on public.google_calendar_connections to authenticated;

create policy calendar_links_select on public.calendar_event_links
  for select using (app.is_member(workspace_id));
create policy calendar_links_write on public.calendar_event_links
  for all using (
    exists (select 1 from public.visits v where v.id = visit_id and (v.user_id = auth.uid() or app.is_manager(v.workspace_id)))
  ) with check (
    exists (select 1 from public.visits v where v.id = visit_id and (v.user_id = auth.uid() or app.is_manager(v.workspace_id)))
  );

create policy calendar_watch_own on public.calendar_watch_channels
  for select using (
    exists (select 1 from public.google_calendar_connections c
            where c.id = connection_id and c.user_id = auth.uid())
  );
-- calendar_sync_events has no policy: webhook bookkeeping is server-only.

-- ---------------------------------------------------------------------------
-- Voice
-- ---------------------------------------------------------------------------
create policy voice_notes_own on public.voice_notes
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy voice_notes_manager_read on public.voice_notes
  for select using (app.is_manager(workspace_id));

create policy voice_proposals_own on public.voice_interpretation_proposals
  for all using (
    exists (select 1 from public.voice_notes v where v.id = voice_note_id and v.user_id = auth.uid())
  ) with check (
    exists (select 1 from public.voice_notes v where v.id = voice_note_id and v.user_id = auth.uid())
  );

-- ---------------------------------------------------------------------------
-- Mobile, geofencing, notifications, offline queue — all strictly personal.
-- ---------------------------------------------------------------------------
create policy devices_own on public.device_installations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy geofence_reg_own on public.geofence_registrations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy geofence_events_own on public.geofence_events
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy notification_settings_own on public.notification_settings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy sync_queue_own on public.sync_queue_entries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---------------------------------------------------------------------------
-- Imports. Reading a report is a manager action; running an import is ADMIN.
-- ---------------------------------------------------------------------------
create policy imports_read on public.imports
  for select using (app.is_manager(workspace_id));
create policy imports_admin_write on public.imports
  for all using (app.is_admin(workspace_id)) with check (app.is_admin(workspace_id));

create policy import_files_read on public.import_files
  for select using (exists (select 1 from public.imports i where i.id = import_id and app.is_manager(i.workspace_id)));
create policy import_sheets_read on public.import_sheets
  for select using (exists (
    select 1 from public.import_files f join public.imports i on i.id = f.import_id
    where f.id = import_file_id and app.is_manager(i.workspace_id)));
create policy import_rows_read on public.import_rows
  for select using (exists (select 1 from public.imports i where i.id = import_id and app.is_manager(i.workspace_id)));

create policy import_mappings_rw on public.import_mappings
  for all using (app.is_admin(workspace_id)) with check (app.is_admin(workspace_id));

create policy field_provenance_read on public.field_provenance
  for select using (app.is_member(workspace_id));

create policy duplicate_candidates_read on public.duplicate_candidates
  for select using (app.is_manager(workspace_id));
create policy duplicate_candidates_decide on public.duplicate_candidates
  for update using (app.is_admin(workspace_id)) with check (app.is_admin(workspace_id));

create policy client_merges_read on public.client_merges
  for select using (app.is_manager(workspace_id));
create policy excluded_records_read on public.excluded_records
  for select using (app.is_manager(workspace_id));

create policy unmapped_values_read on public.unmapped_values
  for select using (app.is_member(workspace_id));
create policy unmapped_values_resolve on public.unmapped_values
  for update using (app.is_admin(workspace_id)) with check (app.is_admin(workspace_id));

-- ---------------------------------------------------------------------------
-- Function-level hardening
-- ---------------------------------------------------------------------------
revoke all on function app.merge_clients(uuid, uuid, text, boolean, jsonb) from public, anon, authenticated;
revoke all on function app.audit_trigger() from public, anon, authenticated;
revoke all on function app.handle_new_user() from public, anon, authenticated;

grant execute on function app.complete_task(uuid, app.activity_result, text) to authenticated;
grant execute on function app.postpone_task(uuid, timestamptz, text) to authenticated;
grant execute on function app.schedule_undated_task(uuid, timestamptz) to authenticated;
grant execute on function app.create_visit_with_task(uuid, uuid, uuid, timestamptz, timestamptz, uuid, text, text, app.task_priority, boolean, boolean) to authenticated;
grant execute on function app.cancel_visit(uuid, text, app.change_origin) to authenticated;
grant execute on function app.confirm_classification(uuid, app.classification, text) to authenticated;
grant execute on function app.record_verification(uuid, app.verification_status, text, text) to authenticated;
grant execute on function app.nearby_clients(uuid, double precision, double precision, double precision, int) to authenticated;
grant usage on schema app to authenticated;
