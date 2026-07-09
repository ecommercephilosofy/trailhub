-- ============================================================================
-- RLS fixes — auditoría jul-2026.
-- Ejecutar en el SQL Editor de Supabase (idempotente). Cubre:
--   1) cards: el EDITOR puede crear su tarjeta desde un brief y reclamar
--      tarjetas sin asignar ("Enviar a Video Ops" estaba bloqueado por RLS).
--   2) annotations: faltaba la policy de DELETE (el botón de borrar comentario
--      no borraba nada para nadie).
--   3) Tablas que la app usa pero no estaban en schema.sql: run_requests,
--      brands, brand_profiles, learned_patterns → RLS explícito y auditable.
--      run_requests es la crítica: dispara el pipeline (~1-2h de cómputo);
--      solo ADMIN debe poder insertar.
--
-- NOTA: esto NO sincroniza columnas (profiles.email, weekly_reports.*_pdf_path,
-- mechanisms.is_active ya existen en prod). Para versionar el schema real:
--   supabase login && supabase link --project-ref <ref> && supabase db pull
-- ============================================================================

-- ── 1) cards ─────────────────────────────────────────────────────────────────
-- El editor crea tarjetas asignadas a sí mismo (flujo "Enviar a Video Ops").
drop policy if exists cards_editor_insert on cards;
create policy cards_editor_insert on cards for insert to authenticated
  with check (assigned_editor = auth.uid());

-- El editor reclama una tarjeta sin asignar (pasa a ser suya).
drop policy if exists cards_editor_claim on cards;
create policy cards_editor_claim on cards for update to authenticated
  using (assigned_editor is null)
  with check (assigned_editor = auth.uid());

-- ── 2) annotations ───────────────────────────────────────────────────────────
-- Borrar: el autor su comentario; dirección cualquiera (igual que la UI).
drop policy if exists annotations_delete on annotations;
create policy annotations_delete on annotations for delete to authenticated
  using (author = auth.uid() or get_my_role() in ('ADMIN','MANAGER'));

-- ── 3) Tablas del pipeline no versionadas en schema.sql ──────────────────────
-- Guardadas en DO blocks por si algún entorno aún no las tiene.

-- run_requests: SOLO ADMIN lanza; dirección ve el estado. El bot del Mac
-- lee/actualiza con la service key (bypassa RLS).
do $$ begin
  if to_regclass('public.run_requests') is not null then
    execute 'alter table run_requests enable row level security';
    execute 'drop policy if exists run_requests_admin_insert on run_requests';
    execute $p$create policy run_requests_admin_insert on run_requests
      for insert to authenticated with check (get_my_role() = 'ADMIN')$p$;
    execute 'drop policy if exists run_requests_mgmt_read on run_requests';
    execute $p$create policy run_requests_mgmt_read on run_requests
      for select to authenticated using (get_my_role() in ('ADMIN','MANAGER'))$p$;
  end if;
end $$;

-- brands: todos leen (panel de Competencia); solo ADMIN gestiona.
do $$ begin
  if to_regclass('public.brands') is not null then
    execute 'alter table brands enable row level security';
    execute 'drop policy if exists brands_read on brands';
    execute 'create policy brands_read on brands for select to authenticated using (true)';
    execute 'drop policy if exists brands_admin_write on brands';
    execute $p$create policy brands_admin_write on brands for all to authenticated
      using (get_my_role() = 'ADMIN') with check (get_my_role() = 'ADMIN')$p$;
  end if;
end $$;

-- brand_profiles: lectura para todos (drawer de perfil de marca).
do $$ begin
  if to_regclass('public.brand_profiles') is not null then
    execute 'alter table brand_profiles enable row level security';
    execute 'drop policy if exists brand_profiles_read on brand_profiles';
    execute 'create policy brand_profiles_read on brand_profiles for select to authenticated using (true)';
  end if;
end $$;

-- learned_patterns: solo dirección (se muestra en Dashboard, ruta mgmt).
do $$ begin
  if to_regclass('public.learned_patterns') is not null then
    execute 'alter table learned_patterns enable row level security';
    execute 'drop policy if exists learned_patterns_mgmt_read on learned_patterns';
    execute $p$create policy learned_patterns_mgmt_read on learned_patterns
      for select to authenticated using (get_my_role() in ('ADMIN','MANAGER'))$p$;
  end if;
end $$;

-- ── Verificación (ejecutar como cada rol con un JWT real) ────────────────────
-- EDITOR:  insert into run_requests default values;            → debe FALLAR
-- EDITOR:  insert into cards (title, status, assigned_editor)
--          values ('test', 'TODO', auth.uid());                → debe FUNCIONAR
-- EDITOR:  delete from annotations where author = auth.uid();  → debe FUNCIONAR
