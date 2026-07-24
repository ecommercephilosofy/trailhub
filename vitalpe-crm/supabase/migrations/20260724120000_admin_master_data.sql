-- ============================================================================
-- VITALPE CRM — 0007 ADMIN WRITES ON MASTER DATA + ACTIVITY ATTRIBUTION
--
-- Found by the production audit (scripts/maintenance/audit-remote.ts):
--
--  1. products / product_aliases / campaigns / client_types only had SELECT
--     policies, so the ADMINISTRACIÓ screens could not write them as
--     `authenticated` — resolving the 59 unmapped product values was
--     impossible through the UI.
--  2. activities_insert only checked workspace membership, so any COMERCIAL
--     could insert history attributed to a colleague.
-- ============================================================================

-- Master catalogues are workspace-independent, so app.is_admin(ws) does not
-- apply. "Is an active ADMIN of at least one workspace" is the right bar for
-- a shared catalogue in a single-workspace deployment, and stays safe in a
-- multi-workspace one: catalogue edits are visible to everyone by design.
create or replace function app.is_admin_anywhere()
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1 from public.workspace_memberships m
    where m.user_id = auth.uid() and m.role = 'ADMIN' and m.status = 'ACTIU'
  )
$$;

create policy products_admin_write on public.products
  for all using (app.is_admin_anywhere()) with check (app.is_admin_anywhere());

create policy product_aliases_admin_write on public.product_aliases
  for all using (app.is_admin_anywhere()) with check (app.is_admin_anywhere());

create policy campaigns_admin_write on public.campaigns
  for all using (app.is_admin_anywhere()) with check (app.is_admin_anywhere());

create policy client_types_admin_write on public.client_types
  for all using (app.is_admin_anywhere()) with check (app.is_admin_anywhere());

-- ---------------------------------------------------------------------------
-- Commercial history is signed. A row's user_id is who did the work:
-- a COMERCIAL may only write history as themselves; a manager may record on
-- behalf of someone else (app.complete_task does exactly that when a GERENT
-- closes a task assigned to a commercial).
-- ---------------------------------------------------------------------------
drop policy if exists activities_insert on public.activities;
create policy activities_insert on public.activities
  for insert with check (
    app.is_member(workspace_id)
    and (user_id = auth.uid() or app.is_manager(workspace_id))
  );
