# PDF source extraction notes

- **Extracted at:** 2026-07-23
- **Script (reproducible):** `scripts/import/parse_pdf_sources.py`
- **Re-run with:** `python3 scripts/import/parse_pdf_sources.py`

## Tooling

| Purpose | Tool |
|---|---|
| Text extraction (primary) | `pdftotext -layout` — poppler, `/opt/homebrew/bin/pdftotext` |
| Page count | `pdfinfo` (poppler), `pypdf` 6.10.2 as fallback |
| Independent cross-check | `pdfplumber` (second, unrelated engine) |
| Runtime | Python 3.13 (`/opt/homebrew/bin/python3`) |

`pdftotext -layout` was used because both documents are column-oriented and the
layout mode preserves the column boundaries needed to separate fields. No OCR
was required — both PDFs contain a real text layer.

Every page of both documents was processed. Nothing was sampled.

---

## A) `CLIENTS_ACTIUS.pdf` → `clients_actius_accounts.json`

- **sha256:** `6aff8a707b77751ef04c9f375c1f164ee3da512b32675a484672640db5c866f5`
- **Pages processed:** 11 / 11
- **Accounts extracted:** **74**
- **Movement rows counted:** **379**
- **Lines that could not be parsed: 0**

Report header (printed on every page): accounts `43000000000`..`43099999999`,
period `01/08/2025`..`03/06/2026`, "Todas las partidas", "Imprimir saldos
iniciales", issuer `VITALPE SAT NUM 1384 CAT - F61378659`, print date
`10-06-2026`.

### Distribution

| Page | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Accounts first seen | 6 | 4 | 7 | 5 | 9 | 11 | 7 | 6 | 8 | 10 | 1 |

Account code lengths as printed: 6 digits ×1 (`430462`), 7 digits ×71,
9 digits ×2 (`430000009`, `430000099`). Codes are stored **exactly as printed**,
not zero-padded or normalised.

Movements per account range from 1 to 33.

### Verification performed

1. **Independent grep count** on the raw text: 379 lines beginning `DD/MM/YY`,
   74 account-header lines, 74 `Total General` lines (one per account) — all
   match the parser output exactly.
2. **Second-engine cross-check** with `pdfplumber`: 379 movement rows,
   74 header lines — identical.
3. **Arithmetic reconciliation (strongest check):** for each of the 74 accounts,
   the DEBE and HABER columns of exactly the rows the parser attributed to that
   account were summed and compared against the account's printed
   `Total General` line. **74/74 reconcile to the cent, 0 mismatches.** This
   proves no row was missed, dropped or double-counted, and that every
   continuation block was attached to the correct account.
4. No duplicate account codes; no account with 0 movements; no null dates;
   no `first_movement_date > last_movement_date`; every date falls inside the
   declared period `2025-08-01`..`2026-06-03`.

### Continuation blocks (merged, not duplicated)

The report splits long accounts across pages. Two different continuation
patterns exist and **both** are handled; in every case the account appears
**once** in the JSON, with `page` = page of first appearance and
`movement_count` = rows from all its blocks combined.

1. **Explicit** — 8 occurrences, marked `Continuación de la cuenta: <code> <name>`:

   | Account | Company | First page | Merged movements |
   |---|---|---|---|
   | 4300049 | CAN QUETU SL | 1 | 9 |
   | 4300082 | VINICOLA DE GANDESA SL | 2 | 7 |
   | 4304068 | CAVAS ST. MARTIN S.A | 3 | 3 |
   | 4304118 | MASIA PUIGMOLTO S.L. | 4 | 16 |
   | 4304224 | CA L´EUGENI S.C.P | 6 | 3 |
   | 4304245 | JOSEP MASACHS | 7 | 33 |
   | 4304276 | CELLER CAL FERU S.L | 8 | 4 |
   | 4304333 | DIFUSION GASTRONOMICA S.L | 9 | 7 |

2. **Implicit / silent** — 1 occurrence, **no** `Continuación` marker:
   account `4304180 PERE SURIA PASCUAL` has its header as the last line of
   page 5, and its 3 movement rows begin at the top of page 6 with no
   re-declaration of the account. The parser carries the account context across
   the page break, so these 3 rows are correctly attributed rather than being
   dropped or attached to a neighbouring account. Confirmed by the arithmetic
   reconciliation above.

### Decisions and ambiguities

- **Monetary amounts are deliberately excluded**, per the import spec. DEBE,
  HABER and SALDO ACUM. were read only transiently, in memory, for the
  reconciliation check described above; they are not written to the JSON.

- **`movement_count` counts every printed movement row**, including the
  `Apertura del Ejercicio` (opening-balance) rows. **31 of the 74 accounts**
  carry one such row, always dated `01/08/25`, i.e. 31 of the 379 rows. This
  means those 31 accounts have `first_movement_date` = `2025-08-01`, which is
  the opening-balance carry-over rather than a new commercial transaction in
  the period. If the CRM should only consider genuinely new commercial
  activity, subtract these rows / ignore a lone `2025-08-01` first date. They
  were kept because they are literally printed movement rows and the brief
  requires extracting only what is printed.

- **⚠️ Discrepancy against the example in the import spec.** The spec's sample
  object shows `4300025 / CADES PENEDÈS` with `"movement_count": 18`. The
  document literally prints **22** movement rows for that account, so the JSON
  records 22. The account code, company name, `first_movement_date`
  (`2025-09-06`) and `last_movement_date` (`2026-01-13`) all match the spec
  sample exactly — only the count differs. The value 22 is confirmed three
  ways: manual line-by-line count of the printed block (11 invoice rows +
  11 collection rows), the `pdfplumber` cross-check, and the arithmetic
  reconciliation (the 22 rows sum to the printed
  `Total General 17.834,19 / 17.834,19`). The figure 18 in the spec appears to
  be an illustrative placeholder. **No data was adjusted to match it.**

- **Two-digit years.** The ledger prints years as `YY` only (`25`, `26`).
  These are expanded to `20YY`, which is unambiguous given the declared period
  runs 01/08/2025–03/06/2026. Only `25` and `26` occur.

- **Company names are stored exactly as printed**, including inconsistent
  casing and typography that exists in the source, e.g.
  `viticultura Ramon Junyent SCP` (lower case in the original),
  `Aarstiderne a/s engros`, `CA L´EUGENI S.C.P` and
  `BRINS D´OPORTUNITATS EMPRESA D´` (acute accent `´` used as an apostrophe,
  as printed). Several names are visibly **truncated by the report itself**
  at the width of the account-name column, e.g.
  `AGRUPACIO VITICULTORS ARTESANA`,
  `UNIDAD TECNICA DE INNOVACION Y D`,
  `BRINS D´OPORTUNITATS EMPRESA D´`,
  `4308995 CLIENTS VI PTE DE FRAR`. This truncation is in the source document,
  not an extraction artefact; the full legal names are not recoverable from
  this PDF.

- **`4308995 CLIENTS VI PTE DE FRAR`** (page 11) is an internal collective /
  clearing account, not a real customer. It is included because it is a
  genuine account block in the ledger, but it should probably be filtered out
  before creating CRM customer records. Similarly `4304093 VENTAS COMPTAT`
  (cash/counter sales) and `4304358 ALANI HIGIENE PROFESIONAL S.L.U`
  (a supplier-like entry) are not wine-trade customers in the usual sense —
  flagged for the CRM mapping step, not altered here.

---

## B) `Listado_de_Bodegas_Elaboradoras_de_Cava_Certificadas.pdf` → `bodegues_cava_certificades.json`

- **sha256:** `35086d1dbf67ec3bcc37bdb4f2920bfc1264faee06e225a2f698bca0656dd59c`
- **Pages processed:** 3 / 3
- **Companies extracted:** **159** (page 1: 57, page 2: 67, page 3: 35)
- **Rows that could not be parsed: 0**

### Document structure

The document prints exactly **three** columns:

| Printed header | Mapped to |
|---|---|
| `RAZÓN SOCIAL` | `name` |
| `ALCANCE` | `other_columns.ALCANCE` |
| `MUNICIPIO` | `municipality` |

Preamble text (kept out of the data, recorded here for provenance):
"Normas y otros documentos normativos con los cuales se ha certificado la
conformidad: * Pliego de Condiciones de la DOP CAVA / * PG10- Proceso de
Certificación". The column header row is printed on page 1 only; pages 2 and 3
continue the table with no header and no footer. The document carries no page
numbers, no issue date and no revision number.

### Field notes

- **`province` is `null` for all 159 rows** — the document contains **no**
  province column. Nothing was inferred from the municipality names, per the
  "do not invent any data" rule. (The municipalities do span several provinces
  — Barcelona, Tarragona, Girona, Valencia, La Rioja, Álava, Navarra,
  Zaragoza, Badajoz, Burgos — but none of that is printed, so none of it was
  recorded.)
- **`ALCANCE` is the constant literal `Elaboración de Cava` for all 159 rows**
  (verified: exactly one distinct value). It is preserved in `other_columns`
  because it is a genuine printed column.
- **`municipality` is present and non-empty for all 159 rows.** No `null` and
  no `""` values were needed.
- 64 distinct municipalities. No duplicate company names.

### Verification performed

1. **Second-engine cross-check** with `pdfplumber`: 159 rows, and the set of
   159 company names is **byte-identical** to the `pdftotext` result.
2. **Alphabetical continuity check.** The list is alphabetically sorted, so a
   sort-order scan was used to detect dropped rows. Three pairs flagged by a
   naive byte comparison — `FERRÉ I CATASÚS` / `FERRER MATA`,
   `GIRÓ DEL GORNER` / `GIRO RIBOT`, `VIÑA TORREBLANCA` / `VIVES AMBROS` —
   are **correct** under Spanish collation (where `É`≡`E` and `Ñ` sorts after
   `N`), not gaps. No missing rows.

### Decisions and ambiguities

- Names are preserved **exactly as printed**, including original accents,
  casing, punctuation and internal spacing anomalies that exist in the source:
  - `S.A.T . MAS LLUET Nº 907` — space before the third period, as printed.
  - `RIGOL ORDI, Mª ISABEL` — ordinal `ª` as printed.
  - `CANALS NADAL,S.L.` — missing space after the comma, as printed.
  - `AGUSTI TORELLO , S.A.` and `FELIX MASSANA , S.L.` — space before the
    comma, as printed.
  - Disambiguating parentheticals kept verbatim:
    `CASTELL D'OR, S.L. (VILA-RODONA)`,
    `CELLERS DOMENYS I S.C., S.C.C.L. (ROCAFORT)`,
    `COOP. VINICOLA DEL PENEDES, S.C.C.L. (COVIDES) (SANT SADURNÍ)`.
  - Mixed accent conventions are left untouched (`ORGANISME AUTÒNOM DES. DE LA
    CONCA DE BARBERÀ`, `MOLÍ PARELLADA, S.L.`, `CELLERS MOST DORÉ, S.L.`,
    `LLOPART GÜELL, S.L.`, `COVIÑAS, COOP. V.`).
  - Apostrophes are the typographic `'` where the document uses it
    (e.g. `Sant Sadurní d'Anoia`, `CASTELL D'AGE, S.A.`).
- Person-name entries are printed surname-first
  (`BUTI MASANA, MARIA BLANCA`, `LLUCH LLUCH, JORDI`,
  `DOMINGUEZ CRUCES, FRANCISCO`, …). Left as printed; no name reordering.
- Legal-form suffixes are **not** normalised. Note for the matching step: the
  same company is spelled differently across the two source documents, e.g.
  ledger `CANALS I MUNNÉ SL` vs list `CANALS Y MUNNE, S.L.`;
  ledger `CAN QUETU SL` vs list `CAN QUETU, S.L.`;
  ledger `FERRE I CATASUS S.L` vs list `FERRÉ I CATASÚS, S.L.`;
  ledger `BODEGUES CA N´ESTELLA S.L` vs list `BODEGAS CA N'ESTELLA, S.L.`.
  Cross-document matching will need accent/punctuation/legal-form
  normalisation. **No such normalisation was applied to these files** — both
  hold the literal source text.

---

## Summary

| File | Rows | Unparseable |
|---|---|---|
| `clients_actius_accounts.json` | 74 accounts (379 movement rows) | 0 |
| `bodegues_cava_certificades.json` | 159 companies | 0 |

Both JSON files validate with `python3 -m json.tool`. Both are UTF-8 with
`ensure_ascii=False`, so accented characters are stored literally.
