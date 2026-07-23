# PROGRESS

Estado real del proyecto. Este documento es el mapa honesto de lo que hay:
distingue **hecho y verificado**, **parcial** y **no empezado**. No describe
intenciones como si fueran hechos.

Última actualización: 23/07/2026.

---

## Resumen en una línea

El núcleo — modelo de datos, seguridad, importación real, CRM diario, calendario
y voz — está construido y verificado contra los datos reales. La aplicación móvil
está a medias (configuración y lógica probada, sin pantallas). No hay E2E de
Playwright.

**636 pruebas pasan** (`pnpm test`). La importación reconcilia exactamente.

---

## Por fases del encargo

| Fase | Estado | Detalle |
| --- | --- | --- |
| 0 — Inspección | ✅ Hecho | 8 fuentes inventariadas con SHA-256, todas las hojas inspeccionadas |
| 1 — Fundamentos | ✅ Hecho | Monorepo, 41 tablas, 65 políticas RLS, roles, auth |
| 2 — Datos e importación | ✅ Hecho | 2.491 filas leídas, reconciliación exacta, procedencia por campo |
| 3 — CRM básico | ✅ Hecho | Empresas, contactos, ubicaciones, productos, campañas, oportunidades, historial, tareas, clasificación |
| 4 — UX diaria | ✅ Hecho | INICI, LLISTAT MARE, ficha, REGISTRE RÀPID, búsqueda global, vistas automáticas |
| 5 — Calendario | ✅ Hecho | Calendario interno, visitas, OAuth, sync bidireccional, webhooks, reconciliación |
| 6 — Voz | ✅ Hecho | Grabación, storage, transcripción, interpretación, previsualización, confirmación |
| 7 — Móvil | ⚠️ **Parcial** | Config Expo + EAS + lógica de núcleo probada. **Sin pantallas.** |
| 8 — Administración | ✅ Hecho | Usuarios, invitaciones, productos, importaciones, exportaciones, auditoría, integraciones, duplicados |
| 9 — Calidad | ⚠️ **Parcial** | 636 pruebas verdes, lint y RLS probados. **Sin E2E de Playwright.** |
| 10 — Entrega | ⚠️ **Parcial** | Documentación en curso |

---

## Verificado en el navegador contra datos reales

No son afirmaciones teóricas: se ejecutaron sobre la base de datos importada.

- ✅ Inicio de sesión y sesión persistente
- ✅ **INICI** con 9 tareas atrasadas reales, ordenadas por fecha e importancia
- ✅ **CLIENTS**: 802 empresas, filtros, 17 páginas, pestañas de vistas automáticas, exportación CSV
- ✅ **Ficha de empresa** con las 9 pestañas y las acciones rápidas
- ✅ **Confirmar una clasificación persiste**: CAN QUETU SL → ACTIU SEGUR, con usuario y fecha
- ✅ **CALENDARI** en vistas DIA / SETMANA / MES / AGENDA, con aviso de Google no configurado
- ✅ **ADMINISTRACIÓ** con cifras reales: 3 usuarios, 59 valores sin mapear, 1 importación, 174 duplicados
- ✅ **RLS efectiva en la interfaz**: un COMERCIAL es redirigido fuera de administración
- ✅ **REGISTRE RÀPID**: interpretación local determinista produce previsualización con ambigüedades

---

## Datos importados

| Concepto | Cifra |
| --- | ---: |
| Ficheros fuente | 8 |
| Filas leídas | 2.491 |
| Importadas | 2.367 |
| Ignoradas | 36 |
| Rechazadas | 22 |
| Excluidas (conservadas) | 66 |
| **Reconciliación** | **2.367 + 36 + 22 + 66 = 2.491 ✅** |
| Empresas canónicas | 802 |
| Contactos | 479 |
| Oportunidades | 177 |
| Actividades | 36 |
| Tareas | 76 |
| Duplicados en cola de revisión | 174 |
| Fusiones automáticas ejecutadas | 0 |

Excluidos y **conservados** en `excluded_records`: 2 Bag in Box, 40 subproductos
(BRISA / MARES), 24 líneas de albarán cuyo producto no está en el catálogo.

---

## Defectos reales encontrados por las pruebas

Ambos corregidos. Se listan porque son la prueba de que la suite sirve:

1. **`app.complete_task` escribía historial comercial aunque la RLS bloqueara el
   cierre de la tarea.** Un comercial no podía cerrar la tarea de otro, pero sí
   generaba la acción histórica. Ahora la función comprueba que el `UPDATE`
   afectó a una fila y, si no, lanza `SENSE_PERMIS_PER_TANCAR_TASCA`.
2. **Los tokens OAuth seguían siendo legibles.** Un `REVOKE` a nivel de columna
   no puede restar de un `GRANT` a nivel de tabla. Se retira el permiso de tabla
   y se vuelve a conceder columna a columna, omitiendo `access_token_enc`,
   `refresh_token_enc` y `sync_token`.

---

## Lo que falta, sin adornos

### Aplicación móvil — parcial

Existe: `app.config.ts` con permisos de iOS/Android y deep links, `eas.json` con
perfiles, y `src/core` con la lógica probada (deep links). **No existen las
pantallas** (INICI, CLIENTS, CALENDARI, REGISTRE, MÉS), ni el registro real de
geovallas en el dispositivo, ni la cola offline.

La lógica de negocio que consumirían **sí está construida y probada** en
`packages/domain/src/geofence.ts`: selección dinámica de regiones con el tope de
20 de iOS, prioridad por agenda, `arrivalConfidence()` y cooldown (29 pruebas).

Lo que falta es la capa de React Native que la invoca.

### Sin pruebas E2E de Playwright

Los cinco flujos críticos del encargo se han verificado **manualmente en el
navegador** (ver arriba) y sus reglas están cubiertas por las pruebas de SQL y de
dominio, pero no hay una suite automatizada de navegador. `pnpm test:e2e` está
declarado y no tiene configuración detrás.

### Scripts declarados sin implementar

`db:seed`, `import:inspect`, `import:verify`, `export:data`, `typecheck`.
Están en `package.json` pero no tienen fichero. El que sí funciona y hace el
trabajo real es `import:run`.

### Pendiente de credenciales externas

Nada de esto bloquea el uso diario; todo tiene proveedor local funcional:

| Integración | Sin credenciales | Para activarla |
| --- | --- | --- |
| Google Calendar | Proveedor local en memoria, sincronización completa simulada | `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_CALENDAR_WEBHOOK_URL` |
| Transcripción | Se pega la transcripción a mano | `TRANSCRIPTION_PROVIDER=openai`, `OPENAI_API_KEY` |
| Interpretación IA | Intérprete determinista local | `ANTHROPIC_API_KEY` |
| Geocodificación | `PENDENT DE GEOLOCALITZAR`, nunca inventa coordenadas | `GEOCODING_PROVIDER`, `GOOGLE_MAPS_API_KEY` |

---

## Próximos pasos por prioridad

1. **Pantallas de la app móvil** sobre la lógica ya probada, y Development Build
   para ejercitar el geofencing real en dispositivo.
2. **E2E de Playwright** para los cinco flujos del encargo.
3. **Resolver los 59 valores sin mapear** desde ADMINISTRACIÓ → PRODUCTES: eso
   recupera las 24 líneas de albarán aparcadas.
4. **Revisar los 174 duplicados** en la cola. Ninguno se fusionará solo.
5. **Confirmar clasificaciones**: hoy las 802 son propuestas del sistema; la
   confirmación es siempre humana y ninguna está confirmada todavía.
6. Implementar los scripts declarados que faltan.
