-- 002 · Fixes de la auditoría de backend (idempotente).
-- Aplica sobre instancias existentes; schema.sql ya trae esto para nuevas.

-- ── 1. Borrado de usuario: FKs a profiles con ON DELETE SET NULL ──────────────
-- Antes NO ACTION: borrar un editor con bonus/anotaciones/run_requests fallaba
-- por violación de FK — y la edge `admin-users` ignoraba el error y respondía
-- "ok". SET NULL conserva el histórico (ledger/anotaciones) sin el editor.
alter table bonus_ledger alter column editor_user_id drop not null;

alter table annotations  drop constraint if exists annotations_author_fkey;
alter table annotations  add  constraint annotations_author_fkey
  foreign key (author) references profiles(user_id) on delete set null;

alter table bonus_ledger drop constraint if exists bonus_ledger_editor_user_id_fkey;
alter table bonus_ledger add  constraint bonus_ledger_editor_user_id_fkey
  foreign key (editor_user_id) references profiles(user_id) on delete set null;

alter table run_requests drop constraint if exists run_requests_requested_by_fkey;
alter table run_requests add  constraint run_requests_requested_by_fkey
  foreign key (requested_by) references profiles(user_id) on delete set null;

-- ── 2. Trigger handle_new_user: todo usuario de auth tiene fila en profiles ────
-- Con el signup cerrado los usuarios llegan por invitación del admin (que ya crea
-- el profile). Pero un alta manual desde el dashboard de Supabase quedaría sin
-- profile e invisible en /Admin, y con get_my_role() = 'VIEWER' de facto. Este
-- trigger garantiza el profile (rol mínimo VIEWER); la invitación luego fija el
-- rol real con su upsert.
create or replace function handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  insert into profiles (user_id, email, custom_role)
  values (new.id, new.email, 'VIEWER')
  on conflict (user_id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();
