# 🧠 CreativeOS — Sistema de Inteligencia de Creatividades

Plataforma operativa para equipos de performance marketing. Cierra el ciclo completo:
**datos → aprendizaje → script → producción → publicación → resultados**.

## Arranque

```bash
cd creativeos
npm install
npm run dev      # http://localhost:5173
```

La app arranca con **datos demo Quies-style** (12 ads × 14 días, scripts, videos, research, bonos) generados con RNG determinista. Todo persiste en `localStorage`. Reset: dropdown de usuario → "Reset datos demo".

## Stack

React 18 · Vite · Tailwind · shadcn-style UI (Radix) · TanStack Query · @hello-pangea/dnd · Recharts · react-router-dom · lucide-react · sonner

## Arquitectura

```
src/
  api/
    store.js        ← SDK de entidades estilo Base44: list/filter/get/create/update/delete/subscribe
    seed.js         ← Base de datos demo determinista
    entities.js     ← 28 entidades registradas
    functions.js    ← "Backend functions" mock (syncMetaAds, generateScript, notify*, analyzeResearchPDF…)
  lib/
    perf.js         ← Motor de agregación (Breakdown-Effect safe) + labels + motor de fatiga
    naming.js       ← Parser de naming convention de ads
  context/AuthContext.jsx  ← Mock auth + roles + "Ver como"
  components/ui/    ← Primitivas shadcn-style
  components/shared/← StatusBadge, FormatBadge, PriorityBadge, PageGuide, FatigueIndicator…
  features/         ← videoops/, scripts/, ads/ (modales y componentes pesados)
  pages/            ← 20 rutas
```

### Roles (RBAC)

ADMIN · MANAGER · EDITOR · VIEWER. Sidebar y rutas filtradas por rol efectivo. ADMIN simula roles con "Ver como" (persistido en `localStorage('admin_view_as_role')`). EDITOR: financiero oculto en Ads Performance, queries filtradas a sus datos. Cambia de usuario demo desde el dropdown inferior del sidebar (Marc=ADMIN, Claudia=MANAGER, Laura/Pablo=EDITOR).

### Flujos críticos implementados

1. **Script → Producción**: ScriptBuilder → "Crear Tarea en VideoOps" orquesta VideoAsset + Task + EditorQueue + notificación + auto-approve.
2. **Sync → Análisis → Iteración**: Sync Meta (o CSV) → AdsPerformanceDaily → agregación con labels → AdAnalysisDialog → ScriptBuilderDraft → Draft Editor → publicar como GeneratedScript.
3. **PDF → Research → Generación**: Dashboard Import PDF → selección con checkboxes → Research Hub → Generate Scripts usando avatar/ángulo/deseo/problema.

## ⭐ Extras TOP añadidos (más allá del spec)

| Extra | Dónde | Por qué |
|---|---|---|
| **Import CSV de Meta Ads Manager** | Ads Performance → CSV | Sin token de API. Parser tolerante cabeceras ES/EN, detecta delimitador. El workflow real de análisis de exports. |
| **Motor de fatiga creativa** | `lib/perf.js` + Dashboard + tabla | CTR decay (1ª vs 2ª mitad) + rampa de frecuencia + ROAS slide → flag con razones explicables. |
| **Matriz Hook × Formato** | Insights IA | Heatmap de ROAS agregado por combinación. Detecta qué hooks escalar por formato. |
| **Agregación Breakdown-Effect safe** | Todo el sistema | Ratios SIEMPRE suma/suma, nunca media de medias. Tooltips lo explican. |
| **Naming convention parser** | `lib/naming.js` + AdStats | Extrae formato/hook/avatar/versión del nombre del ad → alimenta la matriz sin mapping manual. |
| **Análisis IA basado en reglas** | AdAnalysisDialog | Diagnóstico hook/hold/CTR/fatiga + crea borrador de iteración automáticamente con snapshot de performance. |
| **Creative velocity** | Dashboard | Mediana de días script→published. |
| **AI Router con racional** | /AIRouter | Modelo por tarea (frontier/balanced/fast) con coste-beneficio explicado. Persiste en Settings. |
| **Ownership Review accionable** | /OwnershipReview | Videos/scripts/cola sin owner + asignación inline. |
| **Notificaciones in-app** | Campana del header | NotificationsLog por usuario; las funciones notify* escriben aquí (y a Discord si hay webhook). |
| **Cross-tab real-time** | `store.js` | Eventos `storage` → la UI se actualiza entre pestañas abiertas. |

## Conectar backend real

Sustituye implementaciones en `src/api/`:

- **Entidades** → Supabase/Postgres. Mantén la firma del SDK (`list/filter/create/update/delete/subscribe`) y el resto de la app no cambia. `subscribe` → Supabase Realtime.
- **`syncMetaAds`** → Meta Marketing API `GET /act_{id}/insights` con `level=ad`, `time_increment=1`, fields: spend, impressions, actions, action_values, video_play_actions, video_thruplay_watched_actions, video_p25/p50/p75_watched_actions, frequency. Token con scope `ads_read`. Config ya en Settings → Meta API.
- **`generateScript`** → Claude API (`claude-fable-5` por defecto, configurable en AI Router). El prompt debe inyectar avatar/angle/desire/problem + brand voice + banned_claims de Settings.
- **`notify*`** → POST al webhook Discord (URLs en Settings → Discord). Payload sugerido: `{content: "**título**\ncuerpo"}`.
- **`analyzeResearchPDF`** → subir PDF + Claude con visión/documents.
- **Drive sync** → Google Drive API con folder IDs de Settings.

## Verificado

- `npm run build` limpio (1.1MB bundle, gzip 330KB).
- 0 errores de consola en Dashboard, VideoOps, AdsPerformance, ScriptBuilder, MyWork, AIInsights.
- RBAC probado con usuario EDITOR real (Laura) y simulación "Ver como".
- Responsive móvil sin overflow horizontal.
