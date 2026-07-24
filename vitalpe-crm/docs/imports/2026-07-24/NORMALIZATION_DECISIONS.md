# NORMALIZATION_DECISIONS

Decisions preses en normalitzar les fonts. Cap d'aquestes regles inventa dades:
quan una dada no hi és, el camp queda buit i la fila es marca per revisar.

## Identitat d'empresa

- El nom canònic és el text original de la font més fiable. Cap nom es reescriu.
- La clau de comparació (`app.normalize_company`) passa a minúscules, elimina
  accents i signes, i **elimina la forma jurídica** (SL, SA, SCCL, SCP, SAT…),
  de manera que `MASIA ROMAGOSA S.L` i `Masia Romagosa SL` són la mateixa clau.
- Totes les grafies originals es guarden com a àlies visibles, incloses les de
  l'extracte comptable i el registre oficial de cava.

## Fusió automàtica

Només s'enllaça automàticament amb una empresa existent quan hi ha una identitat
**determinista**: mateix NIF, o mateix correu corporatiu (mai un domini genèric
tipus gmail/hotmail) amb nom compatible, o mateix telèfon amb nom compatible.
Qualsevol altra semblança crea una empresa nova **i** una entrada a la cua de
revisió (`duplicate_candidates`). No hi ha cap fusió silenciosa.

## Volums

- `23.590` és 23 590 litres (separador de milers espanyol), no 23,59.
  El patró `\d{1,3}(\.\d{3})+` és inequívoc i es tracta explícitament.
- Un volum no numèric no s'aproxima mai: queda buit i el text original es conserva.

## Campanyes

La campanya va de l'1 d'agost al 31 de juliol, exactament com estan tallats els
fulls d'origen (`GUIES AGOST 24 - JULIOL 25`). La data de la guia determina la
campanya; el nom de la campanya **mai** forma part del nom del producte.

## Previsions

- Un número a `PREVISIÓ 2026` és una **PREVISIÓ CONFIRMADA** per a la campanya
  següent, amb `REPETIR COMANDA`.
- `PENDENT` i `NO TENEN PREVISIÓ` són `NO DETERMINAT` (no són una negativa).
- Qualsevol altre text és `ALTRES` amb el text original obligatori a les
  observacions, i queda registrat a `unmapped_values`.

## Resultats de contacte

El text lliure de `Resultado llamada` i `RESULTAT CONTACTE JUNY 2026`
(`PASSAR A PRESENTAR`, `VACANCES FINS EL 10/07`, `COMPREN AL PINYOL`…) **no**
s'ha forçat contra la llista tancada de resultats. Tot això és `NO DETERMINAT`
amb el text original conservat i una entrada a `unmapped_values` perquè una
persona decideixi. Interpretar `COMPREN AL PINYOL` com `TÉ UN ALTRE PROVEÏDOR`
seria versemblant, però és una inferència, i el criteri és no inferir.

## Dates absents

El llistat d'exportació (`CRM_contactos_exportacion_Vitalpe.xlsm`) diu que es va
enviar un primer correu, però **no conté cap data**. Per això:

- **no** es crea cap activitat datada (seria inventar història),
- el fet es guarda com a nota d'empresa amb la procedència completa,
- i es crea una tasca **sense data** amb la propera acció indicada.

Una tasca sense data apareix a la fitxa de l'empresa, no al tauler diari i mai
com a vençuda — que és exactament el que aquesta informació mereix.

## Dates no interpretables

`VEREMA` a la columna `Fecha próxima acción` no és una data: es crea la tasca
**sense data** i el text original queda a les observacions.

## Tipus d'empresa

Només es dedueix quan la forma jurídica del nom ho diu de manera inequívoca
(`SCCL`, `cooperativa`, `Agrícola …` → `COOPERATIVA`) o quan la font ho marca
(`EMBOTELLADOR = SI`, full `CRM CLIENTS EMBOTELLADORS`). En qualsevol altre cas
queda buit; no es força `ALTRES`, perquè `ALTRES` exigeix una explicació que no
tenim.

Excepció documentada: al llistat d'exportació, la columna `Tipo` (`Grupo
espumosos`, `Crémant`…) descriu el mercat, no el tipus d'empresa del CRM. S'hi
assigna `ALTRES` amb aquest text com a explicació obligatòria, i es registra a
`unmapped_values` per si convé ampliar la llista mestra.

## Codis postals

Excel ha perdut el zero inicial (`8770`). Es reconstrueix a 5 dígits i la
província es dedueix del prefix oficial només quan la columna `Província` és
buida.

## DO

`DO Cava Catalunya` marca **DO CAVA**, no `DO Catalunya`. Són denominacions
diferents i el text s'assembla; la regla ho tracta explícitament.

## Bag in Box

Les línies amb producte `BIB` / `Bag in Box` / `Doll Diví` **no s'esborren**:
van a `excluded_records` amb el motiu i la fila original completa, a l'espera
del mòdul futur. No entren ni a productes, ni a oportunitats, ni a informes de
granel.

## Extracte comptable

De `CLIENTS_ACTIUS.pdf` només s'importa la correspondència compte → nom i el fet
que el compte va tenir moviment en el període (com a verificació `ACTIVA`).
**Cap import econòmic entra al CRM.** Els comptes `4308995` (clients vi pendent)
i `4304093` (vendes al comptat) són comptes interns i s'ignoren.

## Ordre de potencial

`cellers_DO_Penedes_ordenats_CORREGIT.xlsx` és una valoració manual de prioritat.
Es guarda com a nota i serveix per ordenar llistes, però **no** genera cap
classificació: la prioritat de qui vol treballar no és evidència d'interès del
client.
