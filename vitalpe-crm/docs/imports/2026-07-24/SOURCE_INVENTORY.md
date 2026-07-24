# SOURCE_INVENTORY

Inventari immutable de les fonts comercials. Els originals es conserven sense
modificar a `data/sources/`; el hash permet detectar qualsevol canvi posterior.

## cellers_DO_Penedes_ordenats_CORREGIT.xlsx

- **Mida**: 10.719 bytes
- **SHA-256**: `084373dcc1bb30c133c68257ee7022f920f5e1da5d81119447f96000335ad72f`
- **Descripció**: The same DO Penedès wineries, manually ordered by commercial potential.
- **Confiança**: 3 (1 = màxima)

| Full | Fila de capçalera | Files totals | Files llegides | Tipus | Estat |
| --- | ---: | ---: | ---: | --- | --- |
| ORDENAT PER POTENCIAL | — | 123 | 0 | PRIORITY_ORDER | importat |

## cellers_dopenedes.xlsx

- **Mida**: 21.415 bytes
- **SHA-256**: `15d9d5725d6c0d7c48d82af69c3cefa9588864b7b377fb21440ee86f46b6d6e5`
- **Descripció**: Public DO Penedès winery directory: address, postcode, town, phone, web, e-mail.
- **Confiança**: 3 (1 = màxima)

| Full | Fila de capçalera | Files totals | Files llegides | Tipus | Estat |
| --- | ---: | ---: | ---: | --- | --- |
| cellers_dopenedes | 1 | 135 | 134 | PUBLIC_DIRECTORY | importat |

## CLIENTS_ACTIUS.pdf

- **Mida**: 0 bytes
- **SHA-256**: `6aff8a707b77751ef04c9f375c1f164ee3da512b32675a484672640db5c866f5`
- **Descripció**: Accounting extract 01/08/2025-03/06/2026, customer accounts 43xxxxxxx. Parsed to JSON by scripts/import/parse_pdf_sources.py.
- **Confiança**: 1 (1 = màxima)

| Full | Fila de capçalera | Files totals | Files llegides | Tipus | Estat |
| --- | ---: | ---: | ---: | --- | --- |
| accounts | — | 74 | 74 | LEDGER | importat |

## CRM_clientes_activos_Vitalpe.xlsm

- **Mida**: 25.643 bytes
- **SHA-256**: `07d01c6663d1e12093306d29737572ebf6d3f8e727849bad13bd0a8d99e96e1a`
- **Descripció**: Working CRM sheet for the 40 active accounts. Only source with named contacts, direct phones and a next action with a date.
- **Confiança**: 1 (1 = màxima)

| Full | Fila de capçalera | Files totals | Files llegides | Tipus | Estat |
| --- | ---: | ---: | ---: | --- | --- |
| CRM Activos | 1 | 989 | 83 | CLIENTS | importat |
| Listas | 1 | 1000 | 6 | REFERENCE | NO IMPORTAT — Data-validation lists (Estado / Prioridad / Próxima acción). Used to build the value mapping, not imported as rows. |
| Resumen | 4 | 1000 | 8 | REFERENCE | NO IMPORTAT — Counters and a written process reminder. No company data. |

## CRM_contactos_exportacion_Vitalpe.xlsm

- **Mida**: 30.603 bytes
- **SHA-256**: `e50bbcc9e410b09a73530a2d88412eb0b81a0948575d22de77e3f90e040a8534`
- **Descripció**: International outreach list (export). Records that a first commercial e-mail was sent, but carries no send date.
- **Confiança**: 2 (1 = màxima)

| Full | Fila de capçalera | Files totals | Files llegides | Tipus | Estat |
| --- | ---: | ---: | ---: | --- | --- |
| CRM contactos | 1 | 999 | 36 | CONTACTS_EXPORT | importat |

## Listado_de_Bodegas_Elaboradoras_de_Cava_Certificadas.pdf

- **Mida**: 0 bytes
- **SHA-256**: `35086d1dbf67ec3bcc37bdb4f2920bfc1264faee06e225a2f698bca0656dd59c`
- **Descripció**: Official register of certified cava-producing wineries. Parsed to JSON.
- **Confiança**: 3 (1 = màxima)

| Full | Fila de capçalera | Files totals | Files llegides | Tipus | Estat |
| --- | ---: | ---: | ---: | --- | --- |
| companies | — | 159 | 159 | PUBLIC_DIRECTORY | importat |

## LLISTAT CLIENTS VITALPE + POTENCIALS DO_S.xlsx

- **Mida**: 175.928 bytes
- **SHA-256**: `21bf609891d7b446aed65652e449046c8c1cd879beedd0609d4142c6754c95c5`
- **Descripció**: Master commercial list. Most complete company-level source: carries the CLI-xxxx working id, the accounting account, the public-directory merge and the DO tags.
- **Confiança**: 1 (1 = màxima)

| Full | Fila de capçalera | Files totals | Files llegides | Tipus | Estat |
| --- | ---: | ---: | ---: | --- | --- |
| CRM CLIENTS EMBOTELLADORS | 1 | 994 | 27 | CLIENTS | importat |
| Historic_Vitalpe | 1 | 988 | 429 | CLIENTS | importat |
| Llistat_Mestre | 1 | 1000 | 605 | CLIENTS | importat |
| Potencials_DO_Catalunya | 1 | 168 | 167 | CLIENTS | importat |
| Potencials_DO_Cava_CAT | 1 | 1000 | 46 | CLIENTS | importat |
| Potencials_DO_Cava_Fora_CAT | 1 | 1000 | 17 | CLIENTS | importat |
| Potencials_DO_Penedes | 1 | 1000 | 99 | CLIENTS | importat |

## VENTES CAVA G I GS.xlsx

- **Mida**: 149.476 bytes
- **SHA-256**: `1f49b4db917c60fefcd4a7384b064ae3cf31abcf5ee56295063d9dd5efec3d9f`
- **Descripció**: Delivery-note ledger. The only source of real purchased volumes, and the only source of confirmed next-campaign forecasts.
- **Confiança**: 1 (1 = màxima)

| Full | Fila de capçalera | Files totals | Files llegides | Tipus | Estat |
| --- | ---: | ---: | ---: | --- | --- |
| CLIENTS GS CAVA A RECUPERAR | 1 | 1000 | 19 | SALES | importat |
| GUIES AGOST 24 - JULIOL 25 | 7 | 1000 | 309 | SALES | importat |
| Hoja 2 | — | 0 | 0 | REFERENCE | NO IMPORTAT — Empty sheet. |
| VENDES ALTES PRODUCTES 25-26 | 1 | 1000 | 19 | SALES | importat |
| VENDES BASE CAVA GUARDA 25-26 | 1 | 990 | 181 | SALES | importat |
| VENDES BASE CAVA GUARDA SUPERIO | 1 | 998 | 46 | SALES | importat |
| VENDES VI DO CATALUNYA 25-26 | 1 | 1000 | 11 | SALES | importat |
| VENDES VI DO PENEDES 25-26 | 1 | 1001 | 16 | SALES | importat |
