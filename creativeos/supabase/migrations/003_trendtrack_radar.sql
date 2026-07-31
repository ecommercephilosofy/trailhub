-- Radar Trendtrack: señales de la API de trendtrack.io publicadas por el
-- pipeline semanal (publish.py). duplicates = nº de copias activas del mismo
-- creativo (señal de scaling válida en US, donde no hay reach DSA).

create table if not exists tt_scaling_ads (
  week_date date not null,
  brand text not null,
  kind text,
  library_id text default ''::text not null,
  tt_ad_id text,
  duplicates integer,
  current_rank integer,
  days_running integer,
  status text,
  headline text,
  body text,
  constraint tt_scaling_ads_pkey PRIMARY KEY (week_date, brand, library_id)
);

create table if not exists tt_brand_snapshots (
  week_date date not null,
  brand text not null,
  kind text,
  brandtracker_id text,
  domain text,
  hooks jsonb default '[]'::jsonb,
  testing jsonb default '[]'::jsonb,
  transcripts_count integer default 0,
  errors jsonb default '[]'::jsonb,
  constraint tt_brand_snapshots_pkey PRIMARY KEY (week_date, brand)
);

-- Sugerencias de marcas nuevas (descubrimiento mensual: similar shops +
-- rising-star). El admin las acepta (→ alta en brands) o descarta desde la web.
create table if not exists tt_brand_suggestions (
  domain text not null,
  name text,
  suggested_kind text default 'inspiration',
  source text,                 -- 'similar_shops' | 'rising_star'
  evidence jsonb default '{}'::jsonb,
  status text default 'pending',
  suggested_at timestamp with time zone default now(),
  resolved_at timestamp with time zone,
  constraint tt_brand_suggestions_pkey PRIMARY KEY (domain),
  constraint tt_brand_suggestions_status_check
    CHECK ((status = ANY (ARRAY['pending'::text, 'accepted'::text, 'dismissed'::text])))
);

alter table tt_scaling_ads enable row level security;
alter table tt_brand_snapshots enable row level security;
alter table tt_brand_suggestions enable row level security;

-- Lectura como mechanisms (todos los autenticados: la página Competencia es
-- compartida). Escritura solo service key (pipeline) salvo resolución de
-- sugerencias, que hace el ADMIN desde la web.
drop policy if exists tt_scaling_read on tt_scaling_ads;
create policy tt_scaling_read on tt_scaling_ads for select to authenticated
  using (true);

drop policy if exists tt_snapshots_read on tt_brand_snapshots;
create policy tt_snapshots_read on tt_brand_snapshots for select to authenticated
  using (true);

drop policy if exists tt_suggestions_read on tt_brand_suggestions;
create policy tt_suggestions_read on tt_brand_suggestions for select to authenticated
  using (true);

drop policy if exists tt_suggestions_admin_update on tt_brand_suggestions;
create policy tt_suggestions_admin_update on tt_brand_suggestions for update to authenticated
  using ((get_my_role() = 'ADMIN'::text))
  with check ((get_my_role() = 'ADMIN'::text));
