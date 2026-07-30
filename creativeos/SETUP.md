# CreativeOS — puesta en marcha (Fase 2, jul-2026)

CreativeOS es ahora la CARA del sistema: el pipeline de `~/creativeos-agent` piensa y
publica cada lunes; aquí el equipo ve briefs, produce en el kanban, cobra
bonuses automáticos y dirección tiene dashboard + chat con el cerebro.

## Pasos de conexión (una sola vez, ~15 min)

### 1. Base de datos
En [supabase.com](https://supabase.com) → tu proyecto → **SQL Editor** →
pegar y ejecutar TODO el contenido de **`supabase/schema_prod.sql`** (snapshot
del schema real de prod, 2026-07-10: tablas, RLS, policies, funciones, vistas,
realtime y policies de storage). Después crear los buckets privados
`creatives`, `reports` y `reports-cmo` en Storage.

`schema.sql` es el schema histórico de la Fase 2 (referencia, no usar);
`migrations/` contiene los cambios aplicados a prod después del snapshot.

### 2. Tu usuario ADMIN
Dashboard → **Authentication → Users → Add user** (tu email + contraseña).
Luego en SQL Editor:
```sql
insert into profiles (user_id, name, custom_role)
select id, 'Tu Nombre', 'ADMIN' from auth.users where email = 'tu-email@ejemplo.com'
on conflict (user_id) do update set custom_role = 'ADMIN';
```

### 3. Keys — app (este repo)
Dashboard → **Settings → API**. Crear `.env` en la raíz de este repo:
```
VITE_SUPABASE_URL=https://TU-PROYECTO.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```
(Y las mismas 2 vars en Vercel → Project → Environment Variables para el deploy.)

### 4. Keys — pipeline (repo creativeos-agent)
```bash
echo 'https://TU-PROYECTO.supabase.co' > ~/creativeos-agent/config/.supabase_url
echo '<service_role key>' > ~/creativeos-agent/config/.supabase_service_key
```
⚠️ La service key SOLO ahí (gitignored). Nunca en este repo ni en Vercel.
Verifica: `cd ~/creativeos-agent && .venv/bin/python scripts/weekly/pipeline.py doctor`
(check "Supabase (CreativeOS)" debe salir ✅ conectado).

### 5. Primer publish (datos reales ya, sin esperar al lunes)
```bash
cd ~/creativeos-agent && .venv/bin/python scripts/weekly/publish.py output/weekly/2026-07-03
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
