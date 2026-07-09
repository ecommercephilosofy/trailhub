# 🧠 CreativeOS

Cara del sistema creativo semanal de Quies. El pipeline de `~/ads-agent` (repo
aparte) analiza y publica cada lunes en Supabase; aquí el equipo ve briefs,
produce en el kanban, cobra bonuses automáticos y dirección tiene dashboard,
informe CMO y chat con el cerebro.

## Arranque

```bash
npm install
npm run dev        # http://localhost:5173 (necesita .env — ver SETUP.md)
npm test           # tests del camino del dinero (atribución QB → bonus)
npm run lint       # ESLint
npm run build      # build de producción
```

Primera puesta en marcha (Supabase, usuarios, edge functions): **[SETUP.md](SETUP.md)**.

## Stack

React 18 · Vite · Tailwind · Radix (shadcn-style) · TanStack Query ·
Supabase (Postgres + RLS + Auth + Realtime + Storage + Edge Functions) · Vercel.

## Arquitectura

```
src/
  api/
    supabaseClient.js  ← cliente único (env: VITE_SUPABASE_URL/ANON_KEY)
    supabaseStore.js   ← SDK de entidades: list/filter/get/create/update/delete/subscribe
    entities.js        ← entidades = tablas Supabase
    functions.js       ← invokeFn(): helper para Edge Functions
  hooks/useData.js     ← useEntityList: React Query + invalidación por Realtime
  context/AuthContext.jsx ← Supabase Auth + rol (profiles.custom_role) + "Ver como"
  lib/
    attribution.js     ← extractAdCode + atribución QB→editor (CON TESTS: mueve dinero)
    briefScript.js     ← normalización de guiones del pipeline
    constants.js       ← semáforo CMO, cuentas publicitarias
  components/ui|shared|layout
  pages/               ← Dashboard, Direccion, Briefs, VideoOps, Performance,
                         Competencia, Bonuses, Chat, Admin
supabase/
  schema.sql           ← schema base (Fase 2) — ver nota abajo
  migrations/          ← cambios posteriores (RLS fixes…)
  functions/chat       ← Q&A con Claude sobre el contexto semanal (solo dirección)
  functions/admin-users← alta/baja de usuarios (solo ADMIN)
```

**Flujo de datos:** el pipeline escribe con la service key (bypassa RLS); la app
lee/escribe con la anon key + sesión. La seguridad real es RLS por rol
(ADMIN/MANAGER/EDITOR/VIEWER) + checks de rol en las edge functions — el guard
de rutas del cliente es solo UX.

**Regla de privacidad:** el EDITOR nunca ve cifras de gasto/dinero. Se aplica a
nivel de base de datos (policies + rpc `my_bonus_progress` + vista
`my_bonus_ledger`), no de UI.

## El loop completo

lunes 8AM pipeline → publica briefs/performance/lifecycle →
Briefs: brief asignado a editor (tarjeta kanban + notificación) →
editor produce y lanza el ad con el nombre sugerido (lleva su código QB) →
lunes siguiente el pipeline cruza el QB → la tarjeta muestra ROAS real →
ad acumula >1.500€ con ROAS total >2.0 → bonus PENDING automático →
Admin aprueba con 1 clic.

## Schema: fuente de verdad

**`supabase/schema_prod.sql`** — snapshot del schema real de prod (2026-07-10),
generado desde el catálogo de Postgres: tablas, RLS, policies, funciones,
vistas, realtime y storage. `schema.sql` es el histórico de la Fase 2
(solo referencia). Cambios nuevos → fichero en `supabase/migrations/` +
ejecutar en el SQL Editor + regenerar el snapshot.
