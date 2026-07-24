# IMPORT_REPORT

Importació `16cc91de-eb5b-4c2e-a9d9-15b8177309a7`

## Reconciliació de files

| Resultat | Files |
| --- | ---: |
| EXCLOSA | 66 |
| IGNORADA | 36 |
| IMPORTADA | 2367 |
| REBUTJADA | 22 |
| **TOTAL LLEGIDES** | **2491** |

✅ `FILES LLEGIDES (2491) = IMPORTADES + IGNORADES + REBUTJADES + EXCLOSES (2491)`

Una fila pot generar diverses entitats (empresa + contacte + ubicació + tasca),
per això el nombre d'entitats creades és superior al nombre de files.

## Entitats al CRM

| Entitat | Total |
| --- | ---: |
| Empreses canòniques | 802 |
| Àlies | 836 |
| Contactes | 479 |
| Ubicacions | 461 |
| Oportunitats | 177 |
| Albarans / guies | 443 |
| Activitats | 36 |
| Tasques | 76 |
| Verificacions | 97 |
| Registres de procedència | 0 |

## Duplicats i exclusions

- Candidats a duplicat pendents de revisió: **174**
- Fusions automàtiques executades: **0** (cap parella complia el criteri determinista)
- Files excloses i conservades a `excluded_records`: **66**
  - `SUBPRODUCTE`: 40
  - `PRODUCTE_NO_CATALOGAT`: 24
  - `BAG_IN_BOX`: 2
- Valors sense mapatge (productes, accions, resultats, tipus): **59**

## Classificació proposada

Calculada pel motor de domini a partir dels fets importats. Cap classificació
ha estat confirmada: la confirmació és sempre humana.

| Classificació proposada | Empreses |
| --- | ---: |
| SENSE PROPOSTA | 621 |
| ACTIU SEGUR | 48 |
| POTENCIAL AMB UN ALTRE PROVEIDOR | 133 |

## Encreuament amb les fonts en PDF

- Comptes comptables vinculats a una empresa: **71**
- Comptes sense coincidència (nom truncat a l'origen): **1**
- Cellers del registre oficial de cava vinculats: **140**

<details><summary>Comptes sense coincidència</summary>

- 4304172 · MANUEL MIRET CASANOVAS

</details>

## Productes no catalogats

Aquestes descripcions de l'albarà no coincideixen amb cap producte del
catàleg normalitzat. Les files corresponents s'han **rebutjat** (no s'ha
inventat cap producte). Cal afegir-hi un àlies des d'ADMINISTRACIÓ i
reimportar.

| Descripció original | Ocurrències |
| --- | ---: |
| VI BLANC XAREL·LO VERMELL ECOLÒGIC TAULA. COLLITA 2025 | 3 |
| VI ROSAT PINOT NOIR ECOLÒGIC BASE CAVA (G-CB) | 3 |
| VI BLANC CHARDONNAY ECOLÒGIC BASE CAVA (G-CB) | 2 |
| VI BLANC CHENIN ECOLÒGIC APTE D.O PENEDÈS. COLLITA 2025 | 2 |
| VI BLANC MUSCAT ECOLÒGI TAULA. COLLITA 2025 | 2 |
| VI BLANC PARELLADA ECOLÒGIC BASE CAVA (GS-CB-AF) | 2 |
| VI NEGRE CUPATGE APTE D.O CATALUNYA. COLLTIA 2025 | 2 |
| VI NEGRE ULL LLEBRE ECOLÒGIC D.O PENEDÈS. COLLITA 2024 | 2 |
| VI BLANC PARELLADA ECOLÒGIC B. CAVA (GS-CB-AF). COLLITA 2025 | 1 |
| VI NEGE ECOLÒGIC APTE D.O PENEDÈS (CUPATGE). 2024 | 1 |
| VI NEGRE ULL LLEBRE - CABERNET ECOLÒGIC APTE D.O PENEDÈS. COLLITA 2025 | 1 |
| VI ROSAT CUPATGE ECOLÒGI BASE CAVA (G-CB) | 1 |
| VI ROSAT CUPATGE ECOLÒGIC APTE D.O PENEDÈS. COLLITA 2025 | 1 |
| VI ROSAT CUPATGE ECOLÒGIC BASE CAVA (G-CB) | 1 |

## Volums reals importats (top 10)

| Empresa | Litres |
| --- | ---: |
| MASIA VALLFORMOSA S.L | 2.048.397 |
| JOSEP MASACHS | 710.848 |
| CELLERS MOST DORÉ S.L | 681.432 |
| BODEGAS PINORD S.A | 615.451 |
| Codorniu, SA | 589.177 |
| MOVIALSA | 529.516 |
| MASIA PUIGMULTÓ SL | 507.286 |
| UNITED WENERIES ESTATES S.L.U | 250.574 |
| CAN QUETU SL | 239.993 |
| CAVAS DEL CASTILLO DE PERELADA S.L | 203.969 |
