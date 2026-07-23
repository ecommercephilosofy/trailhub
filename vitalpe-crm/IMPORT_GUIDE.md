# IMPORT_GUIDE

Cómo funciona la importación, cómo añadir una fuente nueva y cómo resolver lo
que queda pendiente.

```bash
pnpm import:run -- --fresh     # recrea la base local y carga las 8 fuentes
pnpm import:run -- --dry-run   # ejecuta todo y hace rollback
pnpm import:run -- --owner=carlos.escobar@vitalpe.local
```

> **Un solo proceso.** Mientras el servidor de desarrollo esté levantado, es el
> único escritor de `.data/crm`. Párelo antes de importar, o un segundo proceso
> leerá una instantánea desactualizada.

---

## Resultado de la carga real (23/07/2026)

| Concepto | Cifra |
| --- | ---: |
| Ficheros | 8 |
| Hojas | 24 |
| Filas leídas | 2.491 |
| Importadas | 2.367 |
| Ignoradas | 36 |
| Rechazadas | 22 |
| Excluidas (conservadas) | 66 |
| **Reconciliación** | **2.367 + 36 + 22 + 66 = 2.491 ✅** |

Entidades: 802 empresas, 479 contactos, 177 oportunidades, 36 actividades,
76 tareas, 174 candidatos a duplicado, 0 fusiones automáticas.

Los informes generados están en `docs/imports/2026-07-23/`:
`SOURCE_INVENTORY.md`, `COLUMN_MAPPING.md`, `NORMALIZATION_DECISIONS.md`,
`IMPORT_REPORT.md`, `DUPLICATE_CANDIDATES.csv`, `REJECTED_ROWS.csv`.

---

## El recorrido

```
data/sources/*.xlsx ─┐
                     ├─► staging ──► normalización ──► resolución ──► aplicación ──► informes
data/sources/*.pdf ──┘   import_rows   normalize.ts    resolveClient   entidades     docs/imports/
   (parseados a JSON)     (raw jsonb)   products.ts    dedupe           canónicas
```

**1. Staging.** Cada fichero se registra con tamaño y SHA-256. Cada hoja, con su
fila de cabecera detectada. Cada fila entra en `import_rows` con su JSON
**tal cual**, sin normalizar. Nada se pierde antes de decidir nada.

**2. Detección de cabecera.** Las hojas traen títulos encima, filas de totales y
columnas de relleno (`Columna 1..21`). `detectHeaderRow()` puntúa las primeras
15 filas por celdas distintas y textuales. `GUIES AGOST 24 - JULIOL 25` tiene la
cabecera en la fila 7; se detecta sola.

**3. Normalización.** Cada transformación devuelve **la regla que aplicó**, para
que `field_provenance` pueda explicar por qué un valor guardado difiere de la
celda original.

**4. Resolución de empresa.** Por orden: nombre canónico o alias exacto →
identidad determinista → coincidencia difusa. Ver abajo.

**5. Aplicación.** Se crean las entidades canónicas y se marca cada fila de
staging con su resultado y su motivo.

**6. Informes.** Se generan **desde la base de datos**, no desde variables en
memoria, así que las cifras del informe y las de la base no pueden divergir.

---

## Orden de confianza entre fuentes

Una fuente de menor confianza **puede añadir** información, pero **nunca
sobrescribe** lo que ya puso una mejor (`fillIfEmpty`).

| Confianza | Ficheros |
| ---: | --- |
| 1 | `LLISTAT CLIENTS VITALPE + POTENCIALS DO_S.xlsx`, `CRM_clientes_activos_Vitalpe.xlsm`, `VENTES CAVA G I GS.xlsx`, `CLIENTS_ACTIUS.pdf` |
| 2 | `CRM_contactos_exportacion_Vitalpe.xlsm` |
| 3 | `cellers_dopenedes.xlsx`, `cellers_DO_Penedes_ordenats_CORREGIT.xlsx`, registro oficial de cava |

---

## Deduplicación: qué se fusiona solo y qué no

**Se enlaza automáticamente** solo con identidad determinista y nombre
compatible:

- mismo NIF, o
- mismo correo **corporativo** (nunca gmail/hotmail/…) y nombre compatible, o
- mismo teléfono y nombre compatible.

Incluso entonces se conserva el nombre de origen como alias.

**Todo lo demás crea empresa nueva Y una entrada en la cola de revisión.**
No hay fusión silenciosa. En la carga real: **174 candidatos pendientes,
0 fusiones automáticas**.

La clave de comparación (`app.normalize_company`) baja a minúsculas, quita
acentos y signos, y **elimina la forma jurídica**, de modo que
`MASIA ROMAGOSA S.L` y `Masia Romagosa SL` son la misma clave. Las grafías
originales se conservan todas como alias visibles.

### Resolver la cola

`ADMINISTRACIÓ → DUPLICATS`. Comparación lado a lado con las señales y la
puntuación. Decisiones: `CREAR COM A NOVA`, `ACTUALITZAR EXISTENT`, `IGNORAR`,
`FUSIONAR`, `MANTENIR SEPARADES`.

`FUSIONAR` llama a `app.merge_clients`, que traslada contactos, ubicaciones,
historial, tareas y visitas, conserva alias, guarda un **snapshot completo** y es
**reversible**. Solo ADMIN.

---

## Reglas que evitan inventar datos

Estas son las decisiones que más cambian el resultado:

- **Sin fecha en el origen, no hay actividad fechada.** El listado de exportación
  dice que se envió un correo pero no cuándo. Se guarda como nota de empresa con
  procedencia y se crea una tarea **sin fecha**. Inventar la fecha sería inventar
  historia.
- **`VEREMA` no es una fecha.** La tarea se crea sin fecha y el texto original
  queda en observaciones.
- **Los resultados en texto libre no se fuerzan.** `PASSAR A PRESENTAR`,
  `COMPREN AL PINYOL`, `VACANCES FINS EL 10/07` van a `NO DETERMINAT` con el
  texto conservado y una entrada en `unmapped_values`. Interpretar
  `COMPREN AL PINYOL` como `TÉ UN ALTRE PROVEÏDOR` sería verosímil — y sería una
  inferencia.
- **El tipo de empresa solo se deduce si la forma jurídica lo dice**
  (`SCCL`, `cooperativa`, `Agrícola …`) o si la fuente lo marca. Si no, queda
  vacío: `ALTRES` exige una explicación que no tenemos.
- **`23.590` son 23 590 litros**, no 23,59. El patrón de separador de millares
  español es inequívoco y se trata aparte.
- **`DO Cava Catalunya` marca DO CAVA**, no DO Catalunya.
- **El orden de potencial no clasifica.** Es una valoración manual de prioridad;
  se guarda como nota y sirve para ordenar, pero la prioridad de quien vende no
  es evidencia de interés del cliente.
- **Nunca se inventan coordenadas.** Toda ubicación nace
  `PENDENT DE GEOLOCALITZAR`.

---

## Exclusiones: nada se borra

| Módulo | Filas | Motivo |
| --- | ---: | --- |
| `BAG_IN_BOX` | 2 | Fuera del módulo de granel, a la espera de módulo propio |
| `SUBPRODUCTE` | 40 | BRISA y MARES: excluidos del catálogo por especificación |
| `PRODUCTE_NO_CATALOGAT` | 24 | El producto del albarán no está en el catálogo |

Las tres van a `excluded_records` **con la fila original completa**. Añadir el
producto o un alias y reimportar las recupera.

---

## Coincidencia de productos

Las descripciones de albarán llevan añadas (`COLLITA 2025`), códigos de lote
(`GS-CB-AF`, `G-SZ-SZZ`), marcas (`FLOS`, `CABRÓ`) y erratas (`VI BALNC`,
`ECOLGÒGIC`, `VI NEGE`). Una lista de alias no escala.

`scripts/import/products.ts` parsea **los dos lados** — la cadena original y el
nombre del catálogo — a los mismos cinco atributos:

```
tipo (VI|MOST) · color (BLANC|ROSAT|NEGRE) · variedad · categoría · ecológico
```

Solo hay coincidencia si los cinco concuerdan. Esto llevó los rechazos de
productos de 213 filas a 24.

### Resolver los productos sin mapear

`ADMINISTRACIÓ → PRODUCTES` lista `unmapped_values` de tipo `PRODUCTE` con su
número de apariciones. Un ADMIN los asigna a un producto del catálogo; el alias
queda guardado y la siguiente importación los reconoce.

Hoy quedan **59 valores sin mapear**; resolverlos recupera las 24 líneas
aparcadas.

---

## Añadir una fuente o una hoja

Todo el registro de fuentes vive en `scripts/import/sources.ts`. Añadir una
entrada a `SOURCES`:

```ts
{
  file: 'NUEVO_FICHERO.xlsx',
  description: 'Qué es y por qué se puede confiar en él.',
  trust: 2,
  sheets: [
    {
      sheet: 'Hoja1',
      kind: 'CLIENTS',        // CLIENTS | SALES | CONTACTS_EXPORT |
                              // PUBLIC_DIRECTORY | PRIORITY_ORDER | REFERENCE | LEDGER
      headerRow: 3,           // opcional: forzar si la detección falla
      columns: { name: ['Empresa', 'Razón social'], phone: ['Teléfono'] },
      notes: 'Particularidades que el informe debe explicar.',
    },
  ],
}
```

`columns` acepta **varias grafías por campo**, porque la misma idea se escribe
distinto en cada hoja. Las hojas que no se importan se declaran igualmente con
`kind: 'REFERENCE'` y un `skipReason`: así aparecen en el inventario y no se
pierden en silencio.

Los informes se generan desde esta misma estructura, así que documentar la
fuente y programarla son el mismo acto.

---

## Leer los informes

- **`SOURCE_INVENTORY.md`** — fichero, tamaño, SHA-256, hojas, fila de cabecera,
  filas leídas y qué no se importó y por qué.
- **`COLUMN_MAPPING.md`** — correspondencia campo del CRM ↔ cabeceras aceptadas.
- **`NORMALIZATION_DECISIONS.md`** — cada regla, con su justificación.
- **`IMPORT_REPORT.md`** — la identidad de reconciliación, entidades creadas,
  duplicados, exclusiones agrupadas, clasificación propuesta, cruce con los PDF y
  los volúmenes reales.
- **`DUPLICATE_CANDIDATES.csv`** — la cola, con puntuación y señales.
- **`REJECTED_ROWS.csv`** — cada fila rechazada o excluida con fichero, hoja,
  número de fila, motivo y datos originales.

---

## Deshacer

`imports.undone_at` marca una importación deshecha. Como cada fila de staging
registra en `entities_created` lo que produjo, el borrado es dirigido, no una
purga. Se hace desde `ADMINISTRACIÓ → IMPORTACIONS`, y solo cuando es seguro:
si una entidad importada ya ha sido editada por una persona, esa edición manda.

La vía más limpia mientras el sistema no está en producción sigue siendo
`pnpm import:run -- --fresh`, que recrea la base local desde cero.
