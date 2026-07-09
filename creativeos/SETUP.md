# CreativeOS — puesta en marcha (Fase 2, jul-2026)

CreativeOS es ahora la CARA del sistema: el pipeline de `~/ads-agent` piensa y
publica cada lunes; aquí el equipo ve briefs, produce en el kanban, cobra
bonuses automáticos y dirección tiene dashboard + chat con el cerebro.

## Pasos de conexión (una sola vez, ~15 min)

### 1. Base de datos
En [supabase.com](https://supabase.com) → tu proyecto → **SQL Editor** →
pegar y ejecutar TODO el contenido de `supabase/schema.sql`, y después
**cada fichero de `supabase/migrations/` en orden** (incluye los fixes de RLS:
run_requests solo ADMIN, insert de cards para editores, delete de annotations).

⚠️ `schema.sql` es el schema base; el schema real de prod tiene columnas/tablas
añadidas después (ver nota en README). En un proyecto NUEVO, tras schema.sql +
migrations, verifica con la app que no falten columnas (`profiles.email`,
`weekly_reports.editor_pdf_path/cmo_pdf_path`, `mechanisms.is_active`, tablas
`brands`, `brand_profiles`, `run_requests`, `learned_patterns`).

### 2. Tu usuario ADMIN
Dashboard → **Authentication → Users → Add user** (tu email + contraseña).
Luego en SQL Editor:
```sql
insert into profiles (user_id, name, custom_role)
select id, 'Marc', 'ADMIN' from auth.users where email = 'mdelgadolinde@gmail.com'
on conflict (user_id) do update set custom_role = 'ADMIN';
```

### 3. Keys — app (este repo)
Dashboard → **Settings → API**. Crear `.env` en la raíz de este repo:
```
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```
(Y las mismas 2 vars en Vercel → Project → Environment Variables para el deploy.)

### 4. Keys — pipeline (repo ads-agent)
```bash
echo 'https://TU-PROYECTO.supabase.co' > ~/ads-agent/config/.supabase_url
echo '<service_role key>' > ~/ads-agent/config/.supabase_service_key
```
⚠️ La service key SOLO ahí (gitignored). Nunca en este repo ni en Vercel.
Verifica: `cd ~/ads-agent && .venv/bin/python scripts/weekly/pipeline.py doctor`
(check "Supabase (CreativeOS)" debe salir ✅ conectado).

### 5. Primer publish (datos reales ya, sin esperar al lunes)
```bash
cd ~/ads-agent && .venv/bin/python scripts/weekly/publish.py output/weekly/2026-07-03
```

### 6. Chat (Edge Function)
Con [supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase`):
```bash
cd "este repo"
supabase login && supabase link --project-ref TU-PROYECTO
supabase secrets set ANTHROPIC_API_KEY=sk-ant-...   # tu key de console.anthropic.com
supabase functions deploy chat
```

### 7. Equipo
Authentication → Invite user (email de cada editor). Cuando entren la primera
vez, en la página **Admin** les asignas rol EDITOR.

## Desarrollo local
```bash
npm install && npm run dev
```

## El loop completo
lunes 8AM pipeline → publica briefs/performance/lifecycle →
Briefs: asignas brief a editor (tarjeta kanban + notificación) →
editor produce y lanza el ad con el nombre sugerido (lleva su código QB) →
lunes siguiente el pipeline cruza el QB → la tarjeta muestra ROAS real →
cuando el ad acumula >1.500€ con ROAS total >2.0 → bonus PENDING automático →
Admin aprueba con 1 clic.
