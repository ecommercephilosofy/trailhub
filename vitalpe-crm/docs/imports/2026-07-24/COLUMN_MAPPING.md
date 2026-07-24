# COLUMN_MAPPING

Correspondència entre les columnes originals i els camps del CRM.
Una mateixa idea apareix escrita de maneres diferents a cada full; totes les
variants acceptades es llisten aquí i viuen a `scripts/import/sources.ts`.

## LLISTAT CLIENTS VITALPE + POTENCIALS DO_S.xlsx

### Llistat_Mestre — CLIENTS

> Canonical company set. Every other sheet is matched against this one before creating anything new.

| Camp CRM | Capçaleres acceptades |
| --- | --- |
| `externalId` | `ID` |
| `name` | `Empresa`, `Celler`, `Celler / marca`, `CLIENT` |
| `group` | `Grup principal` |
| `isHistoric` | `Històric Vitalpe` |
| `accountCode` | `Comptes Vitalpe` |
| `sources` | `Fonts` |
| `publicDo` | `DO / Origen públic` |
| `street` | `Adreça`, `Carrer`, `Direccion` |
| `street2` | `Carrer2` |
| `postalCode` | `CP`, `Codi Postal` |
| `municipality` | `Població`, `Poblacio`, `Localización` |
| `province` | `Província`, `Provincia` |
| `zone` | `Zona` |
| `phone` | `Telèfon`, `Tel`, `Teléfono` |
| `email` | `Email`, `E-mail`, `Correo / vía contacto` |
| `website` | `Web` |
| `bottlerFlag` | `EMBOTELLADOR` |
| `buyerContact` | `Responsable compres` |
| `initialPriority` | `Prioritat inicial`, `Prioridad` |
| `listStatus` | `Estat llistat`, `Estado` |
| `boughtLastCampaign` | `Comprà campanya passada`, `Client actiu campanya passada` |
| `pendingData` | `Dades pendents` |
| `notes` | `Notes`, `NOTES`, `Observaciones` |
| `publicSource` | `Font pública` |
| `publicCheckDate` | `Data consulta pública` |
| `publicCheckNote` | `Nota verificació pública` |
| `contactResultJune` | `RESULTAT CONTACTE JUNY 2026` |

### Historic_Vitalpe — CLIENTS

> Subset of Llistat_Mestre restricted to companies with Vitalpe trading history. Adds "Responsable compres" (a named buyer -> contact) and "Client actiu campanya passada".

| Camp CRM | Capçaleres acceptades |
| --- | --- |
| `externalId` | `ID` |
| `name` | `Empresa`, `Celler`, `Celler / marca`, `CLIENT` |
| `group` | `Grup principal` |
| `isHistoric` | `Històric Vitalpe` |
| `accountCode` | `Comptes Vitalpe` |
| `sources` | `Fonts` |
| `publicDo` | `DO / Origen públic` |
| `street` | `Adreça`, `Carrer`, `Direccion` |
| `street2` | `Carrer2` |
| `postalCode` | `CP`, `Codi Postal` |
| `municipality` | `Població`, `Poblacio`, `Localización` |
| `province` | `Província`, `Provincia` |
| `zone` | `Zona` |
| `phone` | `Telèfon`, `Tel`, `Teléfono` |
| `email` | `Email`, `E-mail`, `Correo / vía contacto` |
| `website` | `Web` |
| `bottlerFlag` | `EMBOTELLADOR` |
| `buyerContact` | `Responsable compres` |
| `initialPriority` | `Prioritat inicial`, `Prioridad` |
| `listStatus` | `Estat llistat`, `Estado` |
| `boughtLastCampaign` | `Comprà campanya passada`, `Client actiu campanya passada` |
| `pendingData` | `Dades pendents` |
| `notes` | `Notes`, `NOTES`, `Observaciones` |
| `publicSource` | `Font pública` |
| `publicCheckDate` | `Data consulta pública` |
| `publicCheckNote` | `Nota verificació pública` |
| `contactResultJune` | `RESULTAT CONTACTE JUNY 2026` |

### Potencials_DO_Penedes — CLIENTS

| Camp CRM | Capçaleres acceptades |
| --- | --- |
| `externalId` | `ID` |
| `name` | `Empresa`, `Celler`, `Celler / marca`, `CLIENT` |
| `group` | `Grup principal` |
| `isHistoric` | `Històric Vitalpe` |
| `accountCode` | `Comptes Vitalpe` |
| `sources` | `Fonts` |
| `publicDo` | `DO / Origen públic` |
| `street` | `Adreça`, `Carrer`, `Direccion` |
| `street2` | `Carrer2` |
| `postalCode` | `CP`, `Codi Postal` |
| `municipality` | `Població`, `Poblacio`, `Localización` |
| `province` | `Província`, `Provincia` |
| `zone` | `Zona` |
| `phone` | `Telèfon`, `Tel`, `Teléfono` |
| `email` | `Email`, `E-mail`, `Correo / vía contacto` |
| `website` | `Web` |
| `bottlerFlag` | `EMBOTELLADOR` |
| `buyerContact` | `Responsable compres` |
| `initialPriority` | `Prioritat inicial`, `Prioridad` |
| `listStatus` | `Estat llistat`, `Estado` |
| `boughtLastCampaign` | `Comprà campanya passada`, `Client actiu campanya passada` |
| `pendingData` | `Dades pendents` |
| `notes` | `Notes`, `NOTES`, `Observaciones` |
| `publicSource` | `Font pública` |
| `publicCheckDate` | `Data consulta pública` |
| `publicCheckNote` | `Nota verificació pública` |
| `contactResultJune` | `RESULTAT CONTACTE JUNY 2026` |

### Potencials_DO_Cava_CAT — CLIENTS

| Camp CRM | Capçaleres acceptades |
| --- | --- |
| `externalId` | `ID` |
| `name` | `Empresa`, `Celler`, `Celler / marca`, `CLIENT` |
| `group` | `Grup principal` |
| `isHistoric` | `Històric Vitalpe` |
| `accountCode` | `Comptes Vitalpe` |
| `sources` | `Fonts` |
| `publicDo` | `DO / Origen públic` |
| `street` | `Adreça`, `Carrer`, `Direccion` |
| `street2` | `Carrer2` |
| `postalCode` | `CP`, `Codi Postal` |
| `municipality` | `Població`, `Poblacio`, `Localización` |
| `province` | `Província`, `Provincia` |
| `zone` | `Zona` |
| `phone` | `Telèfon`, `Tel`, `Teléfono` |
| `email` | `Email`, `E-mail`, `Correo / vía contacto` |
| `website` | `Web` |
| `bottlerFlag` | `EMBOTELLADOR` |
| `buyerContact` | `Responsable compres` |
| `initialPriority` | `Prioritat inicial`, `Prioridad` |
| `listStatus` | `Estat llistat`, `Estado` |
| `boughtLastCampaign` | `Comprà campanya passada`, `Client actiu campanya passada` |
| `pendingData` | `Dades pendents` |
| `notes` | `Notes`, `NOTES`, `Observaciones` |
| `publicSource` | `Font pública` |
| `publicCheckDate` | `Data consulta pública` |
| `publicCheckNote` | `Nota verificació pública` |
| `contactResultJune` | `RESULTAT CONTACTE JUNY 2026` |

### Potencials_DO_Catalunya — CLIENTS

> No CLI id and no "Fonts" column; DO Catalunya is implied by the sheet, which is recorded as the source rather than inferred per row.

| Camp CRM | Capçaleres acceptades |
| --- | --- |
| `externalId` | `ID` |
| `name` | `Empresa`, `Celler`, `Celler / marca`, `CLIENT` |
| `group` | `Grup principal` |
| `isHistoric` | `Històric Vitalpe` |
| `accountCode` | `Comptes Vitalpe` |
| `sources` | `Fonts` |
| `publicDo` | `DO / Origen públic` |
| `street` | `Adreça`, `Carrer`, `Direccion` |
| `street2` | `Carrer2` |
| `postalCode` | `CP`, `Codi Postal` |
| `municipality` | `Població`, `Poblacio`, `Localización` |
| `province` | `Província`, `Provincia` |
| `zone` | `Zona` |
| `phone` | `Telèfon`, `Tel`, `Teléfono` |
| `email` | `Email`, `E-mail`, `Correo / vía contacto` |
| `website` | `Web` |
| `bottlerFlag` | `EMBOTELLADOR` |
| `buyerContact` | `Responsable compres` |
| `initialPriority` | `Prioritat inicial`, `Prioridad` |
| `listStatus` | `Estat llistat`, `Estado` |
| `boughtLastCampaign` | `Comprà campanya passada`, `Client actiu campanya passada` |
| `pendingData` | `Dades pendents` |
| `notes` | `Notes`, `NOTES`, `Observaciones` |
| `publicSource` | `Font pública` |
| `publicCheckDate` | `Data consulta pública` |
| `publicCheckNote` | `Nota verificació pública` |
| `contactResultJune` | `RESULTAT CONTACTE JUNY 2026` |

### Potencials_DO_Cava_Fora_CAT — CLIENTS

| Camp CRM | Capçaleres acceptades |
| --- | --- |
| `externalId` | `ID` |
| `name` | `Empresa`, `Celler`, `Celler / marca`, `CLIENT` |
| `group` | `Grup principal` |
| `isHistoric` | `Històric Vitalpe` |
| `accountCode` | `Comptes Vitalpe` |
| `sources` | `Fonts` |
| `publicDo` | `DO / Origen públic` |
| `street` | `Adreça`, `Carrer`, `Direccion` |
| `street2` | `Carrer2` |
| `postalCode` | `CP`, `Codi Postal` |
| `municipality` | `Població`, `Poblacio`, `Localización` |
| `province` | `Província`, `Provincia` |
| `zone` | `Zona` |
| `phone` | `Telèfon`, `Tel`, `Teléfono` |
| `email` | `Email`, `E-mail`, `Correo / vía contacto` |
| `website` | `Web` |
| `bottlerFlag` | `EMBOTELLADOR` |
| `buyerContact` | `Responsable compres` |
| `initialPriority` | `Prioritat inicial`, `Prioridad` |
| `listStatus` | `Estat llistat`, `Estado` |
| `boughtLastCampaign` | `Comprà campanya passada`, `Client actiu campanya passada` |
| `pendingData` | `Dades pendents` |
| `notes` | `Notes`, `NOTES`, `Observaciones` |
| `publicSource` | `Font pública` |
| `publicCheckDate` | `Data consulta pública` |
| `publicCheckNote` | `Nota verificació pública` |
| `contactResultJune` | `RESULTAT CONTACTE JUNY 2026` |

### CRM CLIENTS EMBOTELLADORS — CLIENTS

> Bottlers being actively worked. "RESULTAT CONTACTE JUNY 2026" is free text describing a real June-2026 outcome; it is kept verbatim as a client note and, when it maps unambiguously, as a dated activity.

| Camp CRM | Capçaleres acceptades |
| --- | --- |
| `externalId` | `ID` |
| `name` | `Empresa`, `Celler`, `Celler / marca`, `CLIENT` |
| `group` | `Grup principal` |
| `isHistoric` | `Històric Vitalpe` |
| `accountCode` | `Comptes Vitalpe` |
| `sources` | `Fonts` |
| `publicDo` | `DO / Origen públic` |
| `street` | `Adreça`, `Carrer`, `Direccion` |
| `street2` | `Carrer2` |
| `postalCode` | `CP`, `Codi Postal` |
| `municipality` | `Població`, `Poblacio`, `Localización` |
| `province` | `Província`, `Provincia` |
| `zone` | `Zona` |
| `phone` | `Telèfon`, `Tel`, `Teléfono` |
| `email` | `Email`, `E-mail`, `Correo / vía contacto` |
| `website` | `Web` |
| `bottlerFlag` | `EMBOTELLADOR` |
| `buyerContact` | `Responsable compres` |
| `initialPriority` | `Prioritat inicial`, `Prioridad` |
| `listStatus` | `Estat llistat`, `Estado` |
| `boughtLastCampaign` | `Comprà campanya passada`, `Client actiu campanya passada` |
| `pendingData` | `Dades pendents` |
| `notes` | `Notes`, `NOTES`, `Observaciones` |
| `publicSource` | `Font pública` |
| `publicCheckDate` | `Data consulta pública` |
| `publicCheckNote` | `Nota verificació pública` |
| `contactResultJune` | `RESULTAT CONTACTE JUNY 2026` |

## CRM_clientes_activos_Vitalpe.xlsm

### CRM Activos — CLIENTS

| Camp CRM | Capçaleres acceptades |
| --- | --- |
| `externalId` | `ID` |
| `name` | `Empresa` |
| `group` | `Grup principal` |
| `isHistoric` | `Històric Vitalpe` |
| `accountCode` | `Comptes Vitalpe` |
| `sources` | `Fonts` |
| `publicDo` | `DO / Origen públic` |
| `street` | `Adreça`, `Carrer`, `Direccion` |
| `street2` | `Carrer2` |
| `postalCode` | `CP`, `Codi Postal` |
| `municipality` | `Població`, `Poblacio`, `Localización` |
| `province` | `Província`, `Provincia` |
| `zone` | `Zona` |
| `phone` | `Teléfono` |
| `email` | `Email` |
| `website` | `Web` |
| `bottlerFlag` | `EMBOTELLADOR` |
| `buyerContact` | `Responsable compres` |
| `initialPriority` | `Prioridad` |
| `listStatus` | `Estado` |
| `boughtLastCampaign` | `Comprà campanya passada`, `Client actiu campanya passada` |
| `pendingData` | `Dades pendents` |
| `notes` | `Notes`, `NOTES`, `Observaciones` |
| `publicSource` | `Font pública` |
| `publicCheckDate` | `Data consulta pública` |
| `publicCheckNote` | `Nota verificació pública` |
| `contactResultJune` | `RESULTAT CONTACTE JUNY 2026` |
| `contactName` | `Contacto` |
| `lastContact` | `Último contacto` |
| `nextAction` | `Próxima acción` |
| `nextActionDate` | `Fecha próxima acción` |
| `callResult` | `Resultado llamada` |

### Resumen — REFERENCE

_No importat: Counters and a written process reminder. No company data._

### Listas — REFERENCE

_No importat: Data-validation lists (Estado / Prioridad / Próxima acción). Used to build the value mapping, not imported as rows._

## CRM_contactos_exportacion_Vitalpe.xlsm

### CRM contactos — CONTACTS_EXPORT

> No date anywhere in this sheet. "E-MAIL ENVIADO = SI" is therefore recorded as a client note plus provenance, and NOT as a dated activity — inventing a date would be inventing history.

| Camp CRM | Capçaleres acceptades |
| --- | --- |
| `name` | `Empresa` |
| `companyKind` | `Tipo` |
| `location` | `Localización` |
| `email` | `Correo / vía contacto` |
| `emailSent` | `E-MAIL ENVIADO` |
| `interest` | `INTERES` |
| `nextAction` | `Próxima acción` |
| `notes` | `NOTES` |

## VENTES CAVA G I GS.xlsx

### VENDES BASE CAVA GUARDA SUPERIO — SALES

| Camp CRM | Capçaleres acceptades |
| --- | --- |
| `guideNumber` | `Nº GUIA` |
| `guideDate` | `DATA GUIA` |
| `client` | `CLIENT` |
| `product` | `PRODUCTE` |
| `liters` | `LITRES` |
| `forecast` | `PREVISIÓ 2026` |
| `contacted` | `CONTACTAT` |
| `via` | `VIA` |
| `document` | `DOCUMENT` |
| `isOrganic` | `ECO` |

### VENDES BASE CAVA GUARDA 25-26 — SALES

| Camp CRM | Capçaleres acceptades |
| --- | --- |
| `guideNumber` | `Nº GUIA` |
| `guideDate` | `DATA GUIA` |
| `client` | `CLIENT` |
| `product` | `PRODUCTE` |
| `liters` | `LITRES` |
| `forecast` | `PREVISIÓ 2026` |
| `contacted` | `CONTACTAT` |
| `via` | `VIA` |
| `document` | `DOCUMENT` |
| `isOrganic` | `ECO` |

### VENDES VI DO CATALUNYA 25-26 — SALES

| Camp CRM | Capçaleres acceptades |
| --- | --- |
| `guideNumber` | `Nº GUIA` |
| `guideDate` | `DATA GUIA` |
| `client` | `CLIENT` |
| `product` | `PRODUCTE` |
| `liters` | `LITRES` |
| `forecast` | `PREVISIÓ 2026` |
| `contacted` | `CONTACTAT` |
| `via` | `VIA` |
| `document` | `DOCUMENT` |
| `isOrganic` | `ECO` |

### VENDES VI DO PENEDES 25-26 — SALES

| Camp CRM | Capçaleres acceptades |
| --- | --- |
| `guideNumber` | `Nº GUIA` |
| `guideDate` | `DATA GUIA` |
| `client` | `CLIENT` |
| `product` | `PRODUCTE` |
| `liters` | `LITRES` |
| `forecast` | `PREVISIÓ 2026` |
| `contacted` | `CONTACTAT` |
| `via` | `VIA` |
| `document` | `DOCUMENT` |
| `isOrganic` | `ECO` |

### VENDES ALTES PRODUCTES 25-26 — SALES

> Row 1 is a data row that lost its header, followed by "Columna 1..21" filler. Contains BIB (Bag in Box) lines, which are excluded from the bulk-wine module and parked in excluded_records.

| Camp CRM | Capçaleres acceptades |
| --- | --- |
| `guideNumber` | `Nº GUIA` |
| `guideDate` | `DATA GUIA` |
| `client` | `CLIENT` |
| `product` | `PRODUCTE` |
| `liters` | `LITRES` |
| `forecast` | `PREVISIÓ 2026` |
| `contacted` | `CONTACTAT` |
| `via` | `VIA` |
| `document` | `DOCUMENT` |
| `isOrganic` | `ECO` |

### GUIES AGOST 24 - JULIOL 25 — SALES

> Header sits on row 7 under a title row and a totals block. Full 2024-2025 campaign. Price and invoice columns exist but are NOT imported: the CRM holds commercial facts, not accounting.

| Camp CRM | Capçaleres acceptades |
| --- | --- |
| `guideNumber` | `Nº GUIA` |
| `guideDate` | `DATA GUIA` |
| `client` | `CLIENT` |
| `product` | `PRODUCTE` |
| `liters` | `LITRES` |
| `forecast` | `PREVISIÓ 2026` |
| `contacted` | `CONTACTAT` |
| `via` | `VIA` |
| `document` | `DOCUMENT` |
| `isOrganic` | `ECO` |

### CLIENTS GS CAVA A RECUPERAR — SALES

> Past Guarda Superior buyers to win back. Imported as historical purchases; the "to recover" intent is expressed by the resulting classification, not by a made-up flag.

| Camp CRM | Capçaleres acceptades |
| --- | --- |
| `guideNumber` | `Nº GUIA` |
| `guideDate` | `DATA GUIA` |
| `client` | `CLIENT` |
| `product` | `PRODUCTE` |
| `liters` | `LITRES` |
| `forecast` | `PREVISIÓ 2026` |
| `contacted` | `CONTACTAT` |
| `via` | `VIA` |
| `document` | `DOCUMENT` |
| `isOrganic` | `ECO` |

### Hoja 2 — REFERENCE

_No importat: Empty sheet._

## cellers_dopenedes.xlsx

### cellers_dopenedes — PUBLIC_DIRECTORY

> Enriches existing companies. Creates a company only when no match exists.

| Camp CRM | Capçaleres acceptades |
| --- | --- |
| `externalId` | `ID` |
| `name` | `Empresa`, `Celler`, `Celler / marca`, `CLIENT` |
| `group` | `Grup principal` |
| `isHistoric` | `Històric Vitalpe` |
| `accountCode` | `Comptes Vitalpe` |
| `sources` | `Fonts` |
| `publicDo` | `DO / Origen públic` |
| `street` | `Adreça`, `Carrer`, `Direccion` |
| `street2` | `Carrer2` |
| `postalCode` | `CP`, `Codi Postal` |
| `municipality` | `Població`, `Poblacio`, `Localización` |
| `province` | `Província`, `Provincia` |
| `zone` | `Zona` |
| `phone` | `Telèfon`, `Tel`, `Teléfono` |
| `email` | `Email`, `E-mail`, `Correo / vía contacto` |
| `website` | `Web` |
| `bottlerFlag` | `EMBOTELLADOR` |
| `buyerContact` | `Responsable compres` |
| `initialPriority` | `Prioritat inicial`, `Prioridad` |
| `listStatus` | `Estat llistat`, `Estado` |
| `boughtLastCampaign` | `Comprà campanya passada`, `Client actiu campanya passada` |
| `pendingData` | `Dades pendents` |
| `notes` | `Notes`, `NOTES`, `Observaciones` |
| `publicSource` | `Font pública` |
| `publicCheckDate` | `Data consulta pública` |
| `publicCheckNote` | `Nota verificació pública` |
| `contactResultJune` | `RESULTAT CONTACTE JUNY 2026` |

## cellers_DO_Penedes_ordenats_CORREGIT.xlsx

### ORDENAT PER POTENCIAL — PRIORITY_ORDER

> Single column. Rank is a human judgement about priority, not evidence of interest, so it never drives a classification — it is stored as a note and used for list ordering.

| Camp CRM | Capçaleres acceptades |
| --- | --- |
| `name` | `Celler / marca` |

## CLIENTS_ACTIUS.pdf

### accounts — LEDGER

> Used for two things only: mapping accounting account -> company name, and evidence that the account moved in the period. No monetary amount enters the CRM.

## Listado_de_Bodegas_Elaboradoras_de_Cava_Certificadas.pdf

### companies — PUBLIC_DIRECTORY

> Sets the DO CAVA flag on companies that match, and is a public verification source. Never creates a purchase or an interest.
