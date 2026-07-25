# MOBILE_SETUP

> ⚠️ **Estado: parcial.** Están la configuración de Expo, los perfiles de EAS y
> **la lógica de núcleo con pruebas** (`apps/mobile/src/core`, 18 pruebas).
> **Las pantallas no están construidas.** Este documento explica cómo montar el
> entorno y continuar, y es honesto sobre lo que el sistema operativo permite.

---

## Qué hay hoy

| Fichero | Qué hace | Probado |
| --- | --- | :---: |
| `app.config.ts` | Permisos iOS/Android, `UIBackgroundModes`, deep links (esquema + Universal Links + App Links) | — |
| `eas.json` | Perfiles `development`, `development-simulator`, `preview`, `production` | — |
| `src/core/deepLinks.ts` | Analiza `vitalpe://` y `https://…`; **rechaza** hosts no permitidos y `http` | ✅ 18 |
| `src/core/regionPlan.ts` | Qué geovallas registrar, con el tope de la plataforma | ✅ |
| `src/core/arrival.ts` | Confianza de llegada y *cooldown* | ✅ |
| `src/core/notificationPayload.ts` | Carga de la notificación: solo identificadores y ruta | ✅ |
| `src/core/syncQueue.ts` | Cola offline con idempotencia | ✅ |
| `src/core/cache.ts`, `localData.ts` | Caché de visitas, clientes y tareas; borrado al cerrar sesión | ✅ |
| `src/core/voiceNotes.ts` | Grabación pendiente de subida | ✅ |
| `src/core/theme.ts` | Los mismos tokens que la web (papel, borgoña, carbón) | — |
| `src/runtime/geofencing.ts` | Tarea de fondo (`TaskManager.defineTask` en ámbito de módulo), registro y retirada de regiones, permisos | — |
| `src/runtime/notifications.ts` | Permiso, canal Android y presentación del aviso | — |
| `src/runtime/storage.ts` | Caché, regiones y *cooldowns* en disco, para que la tarea de fondo pueda decidir sin sesión | — |
| `src/runtime/session.tsx` | Sesión Supabase en el enclave seguro; al cerrar sesión **primero** desarma las geovallas | — |
| `src/runtime/api.ts` | Lee el conjunto de trabajo con el JWT del usuario (RLS aplica; nunca hay clave de servicio) | — |
| `app/*` | 9 pantallas expo-router (ver abajo) | — |

La lógica de negocio **ya existía y está probada** en
`packages/domain/src/geofence.ts` (29 pruebas) y `src/core/` (24 pruebas):
selección dinámica con el tope de 20 de iOS, prioridad por agenda,
`arrivalConfidence()` y `isInCooldown()`. Las pantallas no deciden nada: piden
la decisión y la ejecutan.

### Las pantallas

| Ruta | Pantalla |
| --- | --- |
| `/entrar` | Acceso con correo y contraseña |
| `/` | AVUI: visitas de hoy, vencidas, estado de la vigilancia |
| `/clients/[id]` | **La ficha — lo que abre la notificación de llegada** |
| `/clients/[id]/visits/[visitId]` | Visita (destino del enlace de Google Calendar) |
| `/arribada` | Elegir empresa cuando la llegada es ambigua |
| `/clients` | CLIENTS PROPERS, ordenados por distancia real |
| `/permisos-ubicacio` | Explicación antes de pedir «Sempre» |
| `/registre` | Nota de voz o texto → previsualización → confirmar |

### Estado real

Compila y empaqueta en las dos plataformas (iOS 3,4 MB, Android 3,7 MB de
*bytecode* Hermes) — evidencia en
`test-artifacts/critical-features/mobile-build.log`.

**Nada se ha probado todavía en un teléfono físico.** Un *bundle* demuestra que
el código carga, no que iOS entregue una entrada de geovalla una hora después
dentro de una bodega. El listado de lo que hay que comprobar a mano está al
final de este documento.

### Arrancar

```bash
pnpm --filter @vitalpe/mobile install
# Variables que la app necesita (van al bundle: solo claves públicas)
export EXPO_PUBLIC_SUPABASE_URL="https://<proyecto>.supabase.co"
export EXPO_PUBLIC_SUPABASE_ANON_KEY="<anon key>"
export EXPO_PUBLIC_API_URL="https://vitalpe-crm-web-tau.vercel.app"
pnpm --filter @vitalpe/mobile build:dev:ios     # o build:dev:android
```

Nunca pongas aquí `SUPABASE_SERVICE_ROLE_KEY`: cualquier cosa que entre en el
*bundle* es legible por quien tenga el `.ipa`.

---

## Requisitos

- Node ≥ 20.11, pnpm 10
- Cuenta de Expo (`pnpm dlx eas-cli login`)
- **iOS**: macOS con Xcode; cuenta de Apple Developer para dispositivo real
- **Android**: Android Studio, o solo EAS

```bash
pnpm install
pnpm dev:mobile      # servidor de Metro
```

Variables:

```bash
EXPO_PUBLIC_API_URL=https://<dominio>       # o http://<ip-lan>:3004 en local
EXPO_PUBLIC_SUPABASE_URL=…
EXPO_PUBLIC_SUPABASE_ANON_KEY=…             # anónima, nunca la de servicio
EXPO_PUBLIC_APP_HOST=crm.vitalpe.cat
EXPO_PROJECT_ID=…
```

`localhost` no existe para el móvil: use la IP LAN del ordenador.

---

## Expo Go no sirve

**El geofencing en segundo plano necesita una Development Build.** Expo Go no
incluye los módulos nativos de ubicación en segundo plano ni las tareas de fondo.
Probar geovallas en Expo Go da falsos negativos.

```bash
cd apps/mobile
eas build:configure

# dispositivo real (lo que hace falta para geofencing de verdad)
eas build --profile development --platform ios
eas build --profile development --platform android

# simulador (útil para interfaz, NO para segundo plano)
eas build --profile development-simulator --platform ios
```

Instalar el resultado y arrancar Metro con `pnpm dev:mobile`.

---

## Permisos, en el orden correcto

La secuencia es deliberada y **no debe reordenarse**:

1. **Primer plano primero.** Al abrir la app no se pide nada durante el primer
   segundo ni sin contexto.
2. **Antes del segundo plano, una pantalla que explique**: para qué sirve, que
   **no se guarda ningún recorrido**, y con un botón para continuar sin
   activarlo.
3. **Solo entonces** se solicita `ACCESS_BACKGROUND_LOCATION` (Android) o
   *Always* (iOS).
4. Desactivable en cualquier momento desde ajustes.

Declarado en `app.config.ts`:

- iOS: `NSLocationWhenInUseUsageDescription`,
  `NSLocationAlwaysAndWhenInUseUsageDescription`, `UIBackgroundModes: ['location']`
- Android: `ACCESS_FINE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`, `POST_NOTIFICATIONS`

---

## Deep links

Dos rutas, declaradas tres veces (esquema propio, Universal Links, App Links):

```
vitalpe://clients/<clientId>
vitalpe://clients/<clientId>/visits/<visitId>
https://crm.vitalpe.cat/clients/<clientId>
https://crm.vitalpe.cat/clients/<clientId>/visits/<visitId>
vitalpe://arribada?candidats=<clientId>.<locationId>,…
```

Para que los `https://` abran la app, el dominio web debe servir:

- `/.well-known/apple-app-site-association` — sin extensión,
  `Content-Type: application/json`, con el App ID
- `/.well-known/assetlinks.json` — con el SHA-256 del certificado de firma

Sin eso, el enlace abre la ficha web: el respaldo correcto, no un error.

`parseDeepLink()` **rechaza** `http://` y cualquier host fuera de la lista
permitida. Un enlace es un dato de entrada no fiable, y se trata como tal.

---

## Geofencing: qué se puede prometer y qué no

**La detección de llegada es *best effort*. No es infalible, y no debe
presentarse como tal.** El sistema operativo decide cuándo despierta la app.

### Límites reales

| Plataforma | Límite | Consecuencia |
| --- | --- | --- |
| iOS | **20 regiones** por app, impuesto por el sistema | Selección dinámica obligatoria |
| iOS | App cerrada por deslizamiento | iOS **no garantiza** la entrega hasta que se reabre |
| Android | ~100 geovallas | Menos presión, pero conviene el mismo tope |
| Android | Fabricantes (Xiaomi, Huawei, Samsung…) | Matan procesos de forma agresiva; puede no dispararse |
| Ambas | Ahorro de batería | Retrasa o suprime avisos |
| Ambas | GPS desactivado o permiso solo "mientras se usa" | No hay detección en segundo plano |

### Cómo se eligen las 20

`selectRegions()` (probado) prioriza por este orden, con niveles **exclusivos**
—cada candidato ocupa el nivel más alto al que pertenece y aparece una sola vez:

1. visitas de hoy → 2. visitas próximas → 3. clientes asignados →
4. tareas de importancia alta → 5. cerca de la última posición conocida →
6. visitados recientemente → 7. fijados a mano

Se recalcula cuando cambia la agenda, se abre la app en otra zona, se crea o
modifica una visita, se completa una visita, o se fuerza una sincronización.

### Falsos positivos

- Radio configurable, por defecto **120 m** (rango razonable 100–150).
- *Cooldown* configurable, por defecto **6 h**.
- `arrivalConfidence()` devuelve `ALTA` / `MITJANA` / `BAIXA` / `AMBIGUA`.
  **`AMBIGUA` se comprueba antes que `ALTA`**: tener una visita agendada no
  autoriza a afirmar en cuál de tres bodegas de un polígono has entrado. El paso
  rápido (`BAIXA`) se comprueba antes que ambas: pasar en coche no es llegar.
- Botón **"NO ÉS AQUEST CLIENT"**, y selector cuando hay varios candidatos.

### La notificación

Solo identificadores y una ruta interna. Ningún dato personal:

```json
{ "type": "client_arrival", "clientId": "…", "locationId": "…", "route": "/clients/…" }
```

Con `hide_client_name_on_lockscreen` el nombre no aparece en pantalla bloqueada.

---

## Simular una geovalla

**iOS Simulator** — *Features → Location → Custom Location* con las coordenadas
del cliente. Sirve para el primer plano; **no** reproduce el comportamiento con
la app cerrada.

**Android Emulator** — *Extended controls (…) → Location*: punto fijo o ruta GPX.

**Dispositivo real** — la única forma de comprobar app cerrada, ahorro de batería
y restricciones del fabricante. Ver `MANUAL_TEST_CHECKLIST.md`, secciones A y B.

---

## Offline

- Se cachean visitas de hoy, clientes recientes y tareas del usuario.
- Las escrituras van a una cola con **clave de idempotencia generada en el
  cliente**: reintentar nunca duplica.
- Indicador visible de pendientes, reintento con espera creciente y detección de
  conflicto.
- El audio grabado sin red se guarda **cifrado en el dispositivo**, se marca
  pendiente y sube al recuperar conexión. **No se pierde** si la app se cierra.
- Al cerrar sesión se borra todo el dato local y se retiran las geovallas.

---

## Pruebas

```bash
pnpm --filter @vitalpe/mobile test        # 24 pruebas
pnpm --filter @vitalpe/mobile typecheck
npx expo export --platform ios            # prueba de que empaqueta
```

Cubren el análisis de deep links (incluido el rechazo de `http` y de hosts
ajenos), la carga de la notificación, la cola offline y el borrado local.

> Un fallo real que encontraron: `vitalpe://arribada?candidats=…` no se
> analizaba, porque la autoridad de la URL se cortaba solo por `/` y se tragaba
> la *query*. El selector de llegada con varios candidatos nunca se habría
> abierto.

La lógica de geovallas se prueba en `packages/domain/src/geofence.test.ts`
(29 pruebas), junto al resto del dominio.


---

## Lo que solo se puede comprobar en un teléfono

Ninguna de estas casillas se puede marcar con una prueba automática, un
simulador ni un *bundle*. Hasta que estén hechas, la detección de llegada es
**implementada pero no probada**.

| # | Comprobación | Cómo | ✓ |
| --- | --- | --- | :---: |
| 1 | El permiso «Sempre» se concede tras la pantalla explicativa | Instalar la *dev build*, abrir `/permisos-ubicacio` | ☐ |
| 2 | Se arman las regiones | AVUI muestra «N clients vigilats» > 0 | ☐ |
| 3 | Llegada con la app **abierta** | Ir a un cliente con coordenadas; llega el aviso | ☐ |
| 4 | Llegada con la app **en segundo plano** | Enviar al fondo, entrar en la geovalla | ☐ |
| 5 | Llegada con la app **cerrada (arranque en frío)** | Cerrar la app (no forzar), entrar; el aviso debe abrir la ficha correcta | ☐ |
| 6 | Tras **forzar el cierre** | iOS reanuda las regiones; Android puede no hacerlo hasta reabrir. Documentar lo observado | ☐ |
| 7 | Reinicio del teléfono | Comprobar si sigue vigilando | ☐ |
| 8 | Dos empresas juntas | Debe abrir el **selector**, nunca una ficha al azar | ☐ |
| 9 | *Cooldown* | Entrar y salir varias veces: un solo aviso | ☐ |
| 10 | Pantalla bloqueada con el nombre oculto | El aviso no debe nombrar la empresa | ☐ |
| 11 | Permiso denegado | El CRM sigue funcionando; solo se pierden los avisos | ☐ |
| 12 | Batería | Un día de uso normal sin consumo anómalo | ☐ |

**Precisión honesta:** una geovalla de iOS puede tardar minutos en dispararse y
tiene un margen de decenas de metros; Android varía mucho según el fabricante y
sus optimizaciones de batería. El geofencing **no es infalible** y no debe
venderse como tal: es una ayuda, y el comercial siempre puede abrir la ficha a
mano desde CLIENTS PROPERS.
