-- 001 · Deltas de la semana del 10-jul-2026 (idempotente: en instalaciones
-- nuevas —que ya traen esto en schema.sql— no hace nada).

-- CMO completo en cmo_verdicts
alter table cmo_verdicts add column if not exists dashboard jsonb default '{}';
alter table cmo_verdicts add column if not exists account_performance jsonb default '{}';
alter table cmo_verdicts add column if not exists creative_report jsonb default '{}';
alter table cmo_verdicts add column if not exists industry jsonb default '{}';
alter table cmo_verdicts add column if not exists data_caveats jsonb default '[]';
alter table cmo_verdicts add column if not exists media_buying jsonb default '{}';

-- ads_weekly enriquecido
alter table ads_weekly add column if not exists why text;
alter table ads_weekly add column if not exists claim text;
alter table ads_weekly add column if not exists thumb_path text;

-- profiles.email (paridad con prod)
alter table profiles add column if not exists email text;

-- review de creativos (galería de Performance)
create table if not exists creative_reviews (
  week_date date not null,
  ad_name text not null,
  ad_code text, role text, format text, structure text, framing text,
  awareness text, mass_desire text, hook_type text, duration_s numeric,
  metric_story text, script_review text, visual_review text, fix text,
  thumb_path text,
  primary key (week_date, ad_name)
);
alter table creative_reviews enable row level security;
drop policy if exists cr_read on creative_reviews;
create policy cr_read on creative_reviews for select to authenticated
  using (get_my_role() in ('ADMIN','MANAGER'));

-- bucket de thumbnails + policy de lectura (solo dirección)
insert into storage.buckets (id, name, public, file_size_limit)
values ('creatives', 'creatives', false, 5242880)
on conflict (id) do nothing;
drop policy if exists creatives_read on storage.objects;
create policy creatives_read on storage.objects for select to authenticated
  using (bucket_id = 'creatives' and get_my_role() in ('ADMIN','MANAGER'));
