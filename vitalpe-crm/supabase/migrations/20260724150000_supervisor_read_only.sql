-- ============================================================================
-- VITALPE CRM — 0008 THE SUPERVISOR IS READ-ONLY
--
-- The product is one commercial's personal working tool. Vitalpe has exactly
-- one salesperson, Carlos; the CRM exists so his day is fast. His manager
-- needs to SEE what he does — visits made, what was said in them, tasks and
-- outcomes — and nothing else. She is a reader, not a co-editor.
--
-- Until now GERENT could edit any company, reassign portfolios, change
-- opportunities and even amend commercial history. That is a different product
-- (a sales team with a supervising manager) and it is not this one. Handing
-- someone edit rights they never intend to use is how history quietly gets
-- rewritten by a misclick.
--
-- After this migration:
--   ADMIN    — the owner of the CRM (Carlos). Everything.
--   GERENT   — supervision. SELECT on the commercial record; no writes at all.
--   COMERCIAL— works their own assigned portfolio.
--
-- Reads are unchanged: app.is_manager still gates SELECT for both tiers. Only
-- the write paths move from is_manager to is_admin.
-- ============================================================================

comment on function app.is_manager(uuid) is
  'Read tier: ADMIN or GERENT. Gates SELECT only — never a write. Writes use app.is_admin.';

-- ---------------------------------------------------------------------------
-- Companies. A supervisor does not edit a company; the owner or the assigned
-- commercial does.
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
        app.is_admin(c.workspace_id)
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

-- A supervisor must not create companies either: the portfolio is the
-- commercial's, and an import or the owner puts things in it.
drop policy if exists clients_insert on public.clients;
create policy clients_insert on public.clients
  for insert with check (
    app.is_admin(workspace_id) or app.role_in(workspace_id) = 'COMERCIAL'
  );

-- ---------------------------------------------------------------------------
-- Assignments: who works which company is an owner decision.
-- ---------------------------------------------------------------------------
drop policy if exists client_assignments_write on public.client_assignments;
create policy client_assignments_write on public.client_assignments
  for all using (app.is_admin(workspace_id)) with check (app.is_admin(workspace_id));

-- ---------------------------------------------------------------------------
-- Delivery notes back a real purchase. Only the owner records them.
-- ---------------------------------------------------------------------------
drop policy if exists opportunity_deliveries_write on public.opportunity_deliveries;
create policy opportunity_deliveries_write on public.opportunity_deliveries
  for all using (app.is_admin(workspace_id)) with check (app.is_admin(workspace_id));

-- ---------------------------------------------------------------------------
-- Commercial history. Amending a recorded action was the sharpest edge here:
-- the supervisor could silently change what the commercial reported. Now only
-- the owner may amend, and the audit trigger still records before/after.
-- ---------------------------------------------------------------------------
drop policy if exists activities_update_manager on public.activities;
create policy activities_update_admin on public.activities
  for update using (app.is_admin(workspace_id)) with check (app.is_admin(workspace_id));

drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities
  for insert with check (
    (app.is_admin(workspace_id) or app.role_in(workspace_id) = 'COMERCIAL')
    and (user_id = auth.uid() or app.is_admin(workspace_id))
  );

-- ---------------------------------------------------------------------------
-- Tasks and visits: the commercial's own work. A supervisor watches it.
-- ---------------------------------------------------------------------------
drop policy if exists tasks_insert on public.tasks;
create policy tasks_insert on public.tasks
  for insert with check (
    app.is_admin(workspace_id) or app.role_in(workspace_id) = 'COMERCIAL'
  );

drop policy if exists tasks_update on public.tasks;
create policy tasks_update on public.tasks
  for update using (
    app.is_admin(workspace_id) or assigned_to = auth.uid() or created_by = auth.uid()
  ) with check (
    app.is_admin(workspace_id) or assigned_to = auth.uid() or created_by = auth.uid()
  );

drop policy if exists visits_insert on public.visits;
create policy visits_insert on public.visits
  for insert with check (
    app.is_admin(workspace_id) or app.role_in(workspace_id) = 'COMERCIAL'
  );

drop policy if exists visits_update on public.visits;
create policy visits_update on public.visits
  for update using (app.is_admin(workspace_id) or user_id = auth.uid())
  with check (app.is_admin(workspace_id) or user_id = auth.uid());

drop policy if exists calendar_links_write on public.calendar_event_links;
create policy calendar_links_write on public.calendar_event_links
  for all using (
    exists (select 1 from public.visits v
             where v.id = visit_id
               and (v.user_id = auth.uid() or app.is_admin(v.workspace_id)))
  ) with check (
    exists (select 1 from public.visits v
             where v.id = visit_id
               and (v.user_id = auth.uid() or app.is_admin(v.workspace_id)))
  );

-- ---------------------------------------------------------------------------
-- Satellites of a company follow can_edit_client, which no longer includes
-- GERENT — nothing to change there. Verifications, however, were gated on
-- membership alone.
-- ---------------------------------------------------------------------------
drop policy if exists client_verifications_insert on public.client_verifications;
create policy client_verifications_insert on public.client_verifications
  for insert with check (app.is_member(workspace_id) and app.can_edit_client(client_id));

-- ---------------------------------------------------------------------------
-- Opportunities already follow can_edit_client. Restated so the intent is
-- visible in one migration rather than inferred across two.
-- ---------------------------------------------------------------------------
drop policy if exists opportunities_write on public.opportunities;
create policy opportunities_write on public.opportunities
  for all using (app.can_edit_client(client_id)) with check (app.can_edit_client(client_id));
