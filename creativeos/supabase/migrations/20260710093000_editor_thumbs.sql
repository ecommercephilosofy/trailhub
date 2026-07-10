-- ============================================================================
-- Miniaturas de winners visibles para EDITORES. APLICADO EN PROD 2026-07-10.
--
-- ads_weekly sigue siendo solo dirección (lleva gasto/revenue). La vista
-- definer ad_thumbs expone SOLO ad_code/qb/thumb_path — sin dinero — y el
-- bucket `creatives` pasa a lectura para cualquier usuario autenticado
-- (las imágenes son los propios ads, públicos en la Ad Library de FB).
-- ============================================================================

create or replace view ad_thumbs with (security_invoker = false) as
  select distinct on (ad_code) ad_code, qb_code_detected, thumb_path
  from ads_weekly
  where thumb_path is not null
  order by ad_code, week_date desc;
grant select on ad_thumbs to authenticated;

drop policy if exists creatives_read on storage.objects;
create policy creatives_read on storage.objects for select to authenticated
  using (bucket_id = 'creatives');

-- ── FIX DE SEGURIDAD (detectado al crear ad_thumbs) ─────────────────────────
-- Supabase concede por defecto TODOS los privilegios a authenticated sobre
-- objetos nuevos de public. my_bonus_ledger es una vista definer simple
-- (auto-actualizable) sobre bonus_ledger: con INSERT/UPDATE concedidos, un
-- EDITOR podía escribir en bonus_ledger SALTÁNDOSE RLS (falsificar bonuses).
-- Las vistas definer deben ser SELECT-only siempre.
revoke insert, update, delete, truncate, references, trigger on my_bonus_ledger from authenticated, anon;
revoke insert, update, delete, truncate, references, trigger on ad_thumbs from authenticated, anon;
revoke all on my_bonus_ledger from anon;
revoke all on ad_thumbs from anon;
