-- ============================================================================
-- RLS fix — auditoría jul-2026. APLICADO EN PROD el 2026-07-10.
--
-- Verificación previa contra prod (pg_policies) mostró que casi todo lo que la
-- auditoría marcó como "falta en schema.sql" YA existía en prod (el fichero
-- estaba desfasado, no la base de datos):
--   · run_requests: rr_admin_insert (solo ADMIN, y requested_by = auth.uid())
--   · cards: cards_editor_insert, cards_editor_delete
--   · annotations: annotations_delete
--   · brands / brand_profiles / learned_patterns: RLS + policies correctas
--
-- ÚNICO hueco real y aplicado aquí: el editor no podía RECLAMAR una tarjeta
-- sin asignar ("Enviar a Video Ops" sobre card existente sin editor).
--
-- El schema completo y real de prod (tablas, policies, funciones, storage)
-- está en supabase/schema_prod.sql (snapshot 2026-07-10).
-- ============================================================================

drop policy if exists cards_editor_claim on cards;
create policy cards_editor_claim on cards for update to authenticated
  using (assigned_editor is null)
  with check (assigned_editor = auth.uid());
