/**
 * Declarative source registry.
 *
 * Every sheet in every supplied file is listed here — including the ones we
 * deliberately do not import — so the inventory, the mapping document and the
 * reconciliation report are generated from one place and can never silently
 * drop a sheet.
 *
 * `columns` maps a CRM field to the header text as it literally appears in the
 * file. Several spellings are allowed per field because the same concept is
 * named differently across sheets.
 */

export type SheetKind =
  | 'CLIENTS' // one company per row
  | 'SALES' // delivery notes -> real purchases + forecasts
  | 'CONTACTS_EXPORT' // international outreach list
  | 'PUBLIC_DIRECTORY' // public DO listing, address/web/email only
  | 'PRIORITY_ORDER' // ranking only, no new facts
  | 'REFERENCE' // lookup lists, summaries, empty sheets
  | 'LEDGER'; // accounting extract (JSON, parsed from PDF)

export interface SheetSpec {
  sheet: string;
  kind: SheetKind;
  /** Force the header row when detection would be ambiguous. */
  headerRow?: number;
  /** Why a sheet is not imported as entities. */
  skipReason?: string;
  columns?: Record<string, string[]>;
  /** Extra notes rendered into COLUMN_MAPPING.md. */
  notes?: string;
}

export interface SourceSpec {
  file: string;
  description: string;
  /** Lower number wins when two sources disagree on the same field. */
  trust: number;
  sheets: SheetSpec[];
}

/** Header aliases shared by the many "Llistat"-shaped sheets. */
const CLIENT_COLUMNS: Record<string, string[]> = {
  externalId: ['ID'],
  name: ['Empresa', 'Celler', 'Celler / marca', 'CLIENT'],
  group: ['Grup principal'],
  isHistoric: ['Històric Vitalpe'],
  accountCode: ['Comptes Vitalpe'],
  sources: ['Fonts'],
  publicDo: ['DO / Origen públic'],
  street: ['Adreça', 'Carrer', 'Direccion'],
  street2: ['Carrer2'],
  postalCode: ['CP', 'Codi Postal'],
  municipality: ['Població', 'Poblacio', 'Localización'],
  province: ['Província', 'Provincia'],
  zone: ['Zona'],
  phone: ['Telèfon', 'Tel', 'Teléfono'],
  email: ['Email', 'E-mail', 'Correo / vía contacto'],
  website: ['Web'],
  bottlerFlag: ['EMBOTELLADOR'],
  buyerContact: ['Responsable compres'],
  initialPriority: ['Prioritat inicial', 'Prioridad'],
  listStatus: ['Estat llistat', 'Estado'],
  boughtLastCampaign: ['Comprà campanya passada', 'Client actiu campanya passada'],
  pendingData: ['Dades pendents'],
  notes: ['Notes', 'NOTES', 'Observaciones'],
  publicSource: ['Font pública'],
  publicCheckDate: ['Data consulta pública'],
  publicCheckNote: ['Nota verificació pública'],
  contactResultJune: ['RESULTAT CONTACTE JUNY 2026'],
};

const SALES_COLUMNS: Record<string, string[]> = {
  guideNumber: ['Nº GUIA'],
  guideDate: ['DATA GUIA'],
  client: ['CLIENT'],
  product: ['PRODUCTE'],
  liters: ['LITRES'],
  forecast: ['PREVISIÓ 2026'],
  contacted: ['CONTACTAT'],
  via: ['VIA'],
  document: ['DOCUMENT'],
  isOrganic: ['ECO'],
};

export const SOURCES: SourceSpec[] = [
  {
    file: 'LLISTAT CLIENTS VITALPE + POTENCIALS DO_S.xlsx',
    description:
      'Master commercial list. Most complete company-level source: carries the CLI-xxxx working id, the accounting account, the public-directory merge and the DO tags.',
    trust: 1,
    sheets: [
      {
        sheet: 'Llistat_Mestre',
        kind: 'CLIENTS',
        columns: CLIENT_COLUMNS,
        notes:
          'Canonical company set. Every other sheet is matched against this one before creating anything new.',
      },
      {
        sheet: 'Historic_Vitalpe',
        kind: 'CLIENTS',
        columns: CLIENT_COLUMNS,
        notes:
          'Subset of Llistat_Mestre restricted to companies with Vitalpe trading history. Adds "Responsable compres" (a named buyer -> contact) and "Client actiu campanya passada".',
      },
      { sheet: 'Potencials_DO_Penedes', kind: 'CLIENTS', columns: CLIENT_COLUMNS },
      { sheet: 'Potencials_DO_Cava_CAT', kind: 'CLIENTS', columns: CLIENT_COLUMNS },
      {
        sheet: 'Potencials_DO_Catalunya',
        kind: 'CLIENTS',
        columns: CLIENT_COLUMNS,
        notes:
          'No CLI id and no "Fonts" column; DO Catalunya is implied by the sheet, which is recorded as the source rather than inferred per row.',
      },
      { sheet: 'Potencials_DO_Cava_Fora_CAT', kind: 'CLIENTS', columns: CLIENT_COLUMNS },
      {
        sheet: 'CRM CLIENTS EMBOTELLADORS',
        kind: 'CLIENTS',
        columns: CLIENT_COLUMNS,
        notes:
          'Bottlers being actively worked. "RESULTAT CONTACTE JUNY 2026" is free text describing a real June-2026 outcome; it is kept verbatim as a client note and, when it maps unambiguously, as a dated activity.',
      },
    ],
  },
  {
    file: 'CRM_clientes_activos_Vitalpe.xlsm',
    description:
      'Working CRM sheet for the 40 active accounts. Only source with named contacts, direct phones and a next action with a date.',
    trust: 1,
    sheets: [
      {
        sheet: 'CRM Activos',
        kind: 'CLIENTS',
        columns: {
          ...CLIENT_COLUMNS,
          name: ['Empresa'],
          contactName: ['Contacto'],
          phone: ['Teléfono'],
          email: ['Email'],
          initialPriority: ['Prioridad'],
          listStatus: ['Estado'],
          lastContact: ['Último contacto'],
          nextAction: ['Próxima acción'],
          nextActionDate: ['Fecha próxima acción'],
          callResult: ['Resultado llamada'],
        },
      },
      {
        sheet: 'Resumen',
        kind: 'REFERENCE',
        skipReason: 'Counters and a written process reminder. No company data.',
      },
      {
        sheet: 'Listas',
        kind: 'REFERENCE',
        skipReason:
          'Data-validation lists (Estado / Prioridad / Próxima acción). Used to build the value mapping, not imported as rows.',
      },
    ],
  },
  {
    file: 'CRM_contactos_exportacion_Vitalpe.xlsm',
    description:
      'International outreach list (export). Records that a first commercial e-mail was sent, but carries no send date.',
    trust: 2,
    sheets: [
      {
        sheet: 'CRM contactos',
        kind: 'CONTACTS_EXPORT',
        columns: {
          name: ['Empresa'],
          companyKind: ['Tipo'],
          location: ['Localización'],
          email: ['Correo / vía contacto'],
          emailSent: ['E-MAIL ENVIADO'],
          interest: ['INTERES'],
          nextAction: ['Próxima acción'],
          notes: ['NOTES'],
        },
        notes:
          'No date anywhere in this sheet. "E-MAIL ENVIADO = SI" is therefore recorded as a client note plus provenance, and NOT as a dated activity — inventing a date would be inventing history.',
      },
    ],
  },
  {
    file: 'VENTES CAVA G I GS.xlsx',
    description:
      'Delivery-note ledger. The only source of real purchased volumes, and the only source of confirmed next-campaign forecasts.',
    trust: 1,
    sheets: [
      { sheet: 'VENDES BASE CAVA GUARDA SUPERIO', kind: 'SALES', columns: SALES_COLUMNS },
      { sheet: 'VENDES BASE CAVA GUARDA 25-26', kind: 'SALES', columns: SALES_COLUMNS },
      { sheet: 'VENDES VI DO CATALUNYA 25-26', kind: 'SALES', columns: SALES_COLUMNS },
      { sheet: 'VENDES VI DO PENEDES 25-26', kind: 'SALES', columns: SALES_COLUMNS },
      {
        sheet: 'VENDES ALTES PRODUCTES 25-26',
        kind: 'SALES',
        headerRow: 1,
        columns: SALES_COLUMNS,
        notes:
          'Row 1 is a data row that lost its header, followed by "Columna 1..21" filler. Contains BIB (Bag in Box) lines, which are excluded from the bulk-wine module and parked in excluded_records.',
      },
      {
        sheet: 'GUIES AGOST 24 - JULIOL 25',
        kind: 'SALES',
        headerRow: 7,
        columns: SALES_COLUMNS,
        notes:
          'Header sits on row 7 under a title row and a totals block. Full 2024-2025 campaign. Price and invoice columns exist but are NOT imported: the CRM holds commercial facts, not accounting.',
      },
      {
        sheet: 'CLIENTS GS CAVA A RECUPERAR',
        kind: 'SALES',
        columns: SALES_COLUMNS,
        notes:
          'Past Guarda Superior buyers to win back. Imported as historical purchases; the "to recover" intent is expressed by the resulting classification, not by a made-up flag.',
      },
      { sheet: 'Hoja 2', kind: 'REFERENCE', skipReason: 'Empty sheet.' },
    ],
  },
  {
    file: 'cellers_dopenedes.xlsx',
    description: 'Public DO Penedès winery directory: address, postcode, town, phone, web, e-mail.',
    trust: 3,
    sheets: [
      {
        sheet: 'cellers_dopenedes',
        kind: 'PUBLIC_DIRECTORY',
        columns: CLIENT_COLUMNS,
        notes: 'Enriches existing companies. Creates a company only when no match exists.',
      },
    ],
  },
  {
    file: 'cellers_DO_Penedes_ordenats_CORREGIT.xlsx',
    description: 'The same DO Penedès wineries, manually ordered by commercial potential.',
    trust: 3,
    sheets: [
      {
        sheet: 'ORDENAT PER POTENCIAL',
        kind: 'PRIORITY_ORDER',
        columns: { name: ['Celler / marca'] },
        notes:
          'Single column. Rank is a human judgement about priority, not evidence of interest, so it never drives a classification — it is stored as a note and used for list ordering.',
      },
    ],
  },
  {
    file: 'CLIENTS_ACTIUS.pdf',
    description:
      'Accounting extract 01/08/2025-03/06/2026, customer accounts 43xxxxxxx. Parsed to JSON by scripts/import/parse_pdf_sources.py.',
    trust: 1,
    sheets: [
      {
        sheet: 'accounts',
        kind: 'LEDGER',
        notes:
          'Used for two things only: mapping accounting account -> company name, and evidence that the account moved in the period. No monetary amount enters the CRM.',
      },
    ],
  },
  {
    file: 'Listado_de_Bodegas_Elaboradoras_de_Cava_Certificadas.pdf',
    description: 'Official register of certified cava-producing wineries. Parsed to JSON.',
    trust: 3,
    sheets: [
      {
        sheet: 'companies',
        kind: 'PUBLIC_DIRECTORY',
        notes:
          'Sets the DO CAVA flag on companies that match, and is a public verification source. Never creates a purchase or an interest.',
      },
    ],
  },
];

/** Accounts in the ledger that are not customers. */
export const NON_CUSTOMER_ACCOUNTS = new Set(['4308995', '4304093']);

/** Rows whose product belongs to the future Bag in Box module. */
export function isBagInBox(product: string | null | undefined): boolean {
  if (!product) return false;
  return /\bBIB\b|bag\s*in\s*box|doll\s*div[ií]/i.test(product);
}

export function findHeader(
  headers: string[],
  candidates: string[] | undefined,
): string | null {
  if (!candidates) return null;
  const lower = new Map(headers.map((h) => [h.trim().toLowerCase(), h]));
  for (const candidate of candidates) {
    const hit = lower.get(candidate.trim().toLowerCase());
    if (hit) return hit;
  }
  return null;
}
