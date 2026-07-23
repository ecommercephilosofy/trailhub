# TESTING

**636 pruebas, 27 ficheros, todas en verde.**

```bash
pnpm test                  # todo (usa --pool=forks internamente si hace falta)
pnpm vitest run --pool=forks               # equivalente explícito
pnpm vitest run supabase/tests/rls.test.ts # una suite
pnpm vitest                                # modo watch
pnpm db:local              # aplica migraciones + seed y verifica RLS en todas las tablas
pnpm lint                  # eslint (0 errores, 1 aviso conocido)
pnpm typecheck             # tsc sobre packages, scripts y pruebas SQL
```

> **`--pool=forks`**: el *pool* de hilos por defecto de Vitest a veces mata el
> servicio de esbuild en esta máquina (`Error: The service was stopped`).
> Con procesos no ocurre.

---

## Qué se prueba y a qué nivel

| Suite | Ficheros | Pruebas | Qué demuestra |
| --- | ---: | ---: | --- |
| Dominio puro | `packages/domain/src/*.test.ts` | ~140 | Clasificación, deduplicación, reglas de tareas, geovallas, fechas, captura rápida |
| Validación | `packages/validation/src/*.test.ts` | 90 | Los esquemas zod rechazan lo mismo que las restricciones SQL |
| Tipos | `packages/types/src/enums.test.ts` | 33 | Los enums de TypeScript coinciden carácter a carácter con los de SQL |
| Configuración | `packages/config/src/*.test.ts` | 28 | Carga de entorno, cifrado AES-256-GCM, detección de manipulación |
| Integraciones | `packages/integrations/src/**/*.test.ts` | 155 | Google Calendar, voz, geocodificación, reintentos, redacción de secretos |
| **RLS** | `supabase/tests/rls.test.ts` | **21** | Las políticas, contra PostgreSQL real |
| **Dominio en SQL** | `supabase/tests/domain.test.ts` | **58** | Restricciones, *triggers* y funciones transaccionales |
| **Paridad SQL ↔ TS** | `supabase/tests/parity.test.ts` | **27** | Los dos motores de clasificación coinciden |

---

## Las pruebas de base de datos son reales

No hay *mocks* de PostgreSQL. `supabase/tests/helpers.ts` crea una base
**PGlite** (PostgreSQL 17 compilado a WASM), aplica **las migraciones de
producción** y el *seed*, y monta un mínimo de la plataforma Supabase: esquema
`auth`, tabla `auth.users`, `auth.uid()` y los roles `anon`, `authenticated` y
`service_role`.

`asUser(db, userId, fn)` abre una transacción y hace:

```sql
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', '<id>', true);
```

Es el mismo contexto que establece PostgREST. Si una política está mal, la
prueba falla.

> **Por qué la transacción no es opcional:** `SET LOCAL` y
> `set_config(..., true)` tienen alcance de transacción. Fuera de una, no hacen
> nada — y una suite que "pasa" porque el rol nunca cambió no demuestra nada.
> Fue exactamente el primer fallo de esta suite: 18 de 21 pruebas pasaban en
> falso.

---

## Dos defectos reales encontrados por las pruebas

Se listan porque son la justificación de la suite:

1. **`app.complete_task` escribía historial aunque la RLS bloqueara el cierre.**
   Un comercial no podía cerrar la tarea de otro, pero la función seguía
   insertando la acción histórica. Ahora comprueba que el `UPDATE` afectó a una
   fila y lanza `SENSE_PERMIS_PER_TANCAR_TASCA`. La prueba también verifica que
   no queda ninguna actividad fantasma.

2. **Los tokens OAuth seguían siendo legibles.** Un `REVOKE` de columna no puede
   restar de un `GRANT` de tabla. Corregido retirando el permiso de tabla y
   concediéndolo columna a columna.

---

## La prueba de paridad

La regla de clasificación existe **dos veces**: en PL/pgSQL
(`app.propose_classification`, para *triggers* e importación) y en TypeScript
(`packages/domain/src/classification.ts`, para la interfaz y la previsualización
de voz sin ida y vuelta al servidor).

Dos implementaciones de una regla son una invitación a que diverjan.
`supabase/tests/parity.test.ts` toma la tabla compartida
`classification.fixtures.ts`, **materializa cada caso como filas reales**
(oportunidades, albaranes, actividades, estado de verificación) y compara los dos
motores caso por caso. Añadir un caso a la tabla lo añade a las dos suites a la
vez.

También verifica que las ventanas temporales (18 meses de compra reciente, 12 de
verificación caducada) son idénticas en ambos lados.

---

## Cobertura por área del encargo (sección 41)

| Área | Estado |
| --- | --- |
| Empresas: crear, nombre vacío, duplicado, alias, contacto principal, borrado y restauración | ✅ |
| Clasificación: las 4 propuestas, prioridad, motivo obligatorio, la IA no confirma, discrepancia | ✅ |
| Oportunidades: crear, compra histórica, previsión, volumen vacío/negativo, ALTRES, grano | ✅ |
| Historial: registrar, último contacto/resultado, conservar anterior, auditar modificación | ✅ |
| Tareas: con y sin fecha, fuera del tablero, completar, resultado obligatorio, aplazar, cancelar | ✅ |
| Visitas: visita+tarea transaccional, cancelar, próxima visita, validar fechas | ✅ |
| Usuarios: invitar, roles, acceso entre espacios denegado, no elevarse el rol, calendario personal | ✅ |
| Google Calendar: conectar, crear, actualizar, webhook, sync incremental, sin bucle, ETag, 410, cancelación | ✅ |
| Voz: audio válido/inválido, transcribir, interpretar, esquema, fecha ambigua, doble aplicación, retención | ✅ |
| Geofencing (lógica): registro dinámico, tope de regiones, prioridad, cooldown, confianza, deep link | ✅ |
| Importación | ⚠️ Verificada por ejecución real y reconciliación, no por pruebas unitarias |

---

## Lo que deliberadamente **no** está cubierto

Dicho sin rodeos:

- **No hay E2E de Playwright.** Los cinco flujos críticos del encargo se han
  verificado **manualmente en el navegador** contra los datos reales (ver
  `PROGRESS.md`), y sus reglas están cubiertas por las pruebas de SQL y dominio,
  pero no hay una suite automatizada de navegador. `pnpm test:e2e` está declarado
  sin configuración detrás.
- **No hay pruebas de componentes React.** La lógica no vive en los componentes,
  así que el retorno sería bajo; aun así, es una carencia.
- **El geofencing no está probado en dispositivo.** La lógica de selección,
  cooldown y confianza sí lo está (29 pruebas). Registrar regiones de verdad
  exige una *Development Build* y un móvil físico:
  ver `MANUAL_TEST_CHECKLIST.md`.
- **Las integraciones reales no se han ejercitado con credenciales.** Google
  Calendar, Whisper y Anthropic están probados contra un `fetch` inyectado que
  reproduce sus respuestas, incluidos los errores. Nadie ha conectado todavía una
  cuenta real.
- **La importación no tiene pruebas unitarias propias.** Se ha verificado
  ejecutándola sobre las 8 fuentes reales y comprobando que la identidad de
  reconciliación cuadra al registro.

---

## Convenciones al escribir pruebas

- Los nombres van en catalán y describen la **regla**, no la función:
  `una tasca sense data no és vençuda ni surt al tauler diari`.
- Las pruebas de SQL usan `asService` para preparar y `asUser` para el acto que
  se está probando. Preparar con privilegios y actuar sin ellos es lo que hace
  que la asersión signifique algo.
- `expectRejected()` afirma que una sentencia se rechaza sin atarse al texto
  exacto del error.
- Nada depende de la fecha real del sistema: las fechas relativas se construyen
  con `current_date - interval`, y el dominio recibe el reloj como argumento.
