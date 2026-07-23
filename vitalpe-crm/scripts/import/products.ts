/**
 * Product matching.
 *
 * The delivery-note product strings are free text written over three campaigns:
 * they carry vintages ("COLLITA 2025", "ANYADA ZERO"), internal lot codes
 * ("GS-CB-AF", "G-SZ-SZZ", "PDS", "MJPS"), brand names ("FLOS", "CABRÓ") and
 * typos ("VI BALNC", "ECOLGÒGIC", "VI NEGE"). Matching them with an alias list
 * does not scale, so both sides — the raw string and the catalogue name — are
 * parsed into the same five facets and compared:
 *
 *   kind · colour · variety · category · organic
 *
 * A product is returned only when all five agree. Anything else is reported as
 * unmapped: the catalogue in the brief is authoritative and no product is
 * invented to make a row fit.
 */

export type Kind = 'VI' | 'MOST';
export type Colour = 'BLANC' | 'ROSAT' | 'NEGRE';
export type Category =
  | 'BASE CAVA GUARDA'
  | 'BASE CAVA GUARDA SUPERIOR'
  | 'DO PENEDES'
  | 'DO CATALUNYA'
  | 'DE TAULA';

export interface ProductFacets {
  kind: Kind;
  colour: Colour;
  /** CUPATGE means "blend / no single variety stated". */
  variety: string;
  category: Category;
  organic: boolean;
}

/** By-products the brief explicitly keeps out of the catalogue. */
export function isByProduct(raw: string): boolean {
  return /^\s*(brisa|mares|mares de vi|brisa de vi)\b/i.test(raw.trim());
}

function fold(input: string): string {
  return input
    .toUpperCase()
    .replace(/[ÀÁÂÄ]/g, 'A').replace(/[ÈÉÊË]/g, 'E').replace(/[ÌÍÎÏ]/g, 'I')
    .replace(/[ÒÓÔÖ]/g, 'O').replace(/[ÙÚÛÜ]/g, 'U').replace(/Ç/g, 'C')
    .replace(/·/g, '')
    .replace(/[^A-Z0-9()\-. ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Vintages and campaign suffixes are never part of a product name. */
function stripVintage(text: string): string {
  return text
    .replace(/\bCOLL?ITA\b\s*\d{0,4}/g, ' ')
    .replace(/\bCOLLTIA\b\s*\d{0,4}/g, ' ') // typo present in the source
    .replace(/\bANYADA\b\s*(ZERO|\d{0,4})/g, ' ')
    .replace(/\.\s*\d{4}\b/g, ' ')
    .replace(/\b(19|20)\d{2}\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Misspellings, abbreviations and the occasional Spanish line, corrected before
 * parsing. Every entry here was observed in the supplied files.
 */
const TYPOS: [RegExp, string][] = [
  [/\bBALNC\b/g, 'BLANC'],
  [/\bNEGE\b/g, 'NEGRE'],
  [/\bECOLGOGIC[AO]?\b/g, 'ECOLOGIC'],
  [/\bECOLOGIG\b/g, 'ECOLOGIC'],
  [/\bECOLOGI\b/g, 'ECOLOGIC'],
  [/\bECOLOGICA\b/g, 'ECOLOGIC'],
  [/\bECO\b/g, 'ECOLOGIC'],
  // Spanish spellings used on a handful of delivery notes.
  [/\bVINO\b/g, 'VI'],
  [/\bBLANCO\b/g, 'BLANC'],
  [/\bTINTO\b/g, 'NEGRE'],
  [/\bROSADO\b/g, 'ROSAT'],
  [/\bMESA\b/g, 'TAULA'],
  [/\bMOSTO\b/g, 'MOST'],
  // "MUSCAT FRONT." is Muscat de Frontignan.
  [/\bMUSCAT FRONT\.?\b/g, 'MUSCAT FRONTIGNAN'],
  // "B.C GS" / "B.C. GS" is base cava, guarda superior.
  [/\bB\.\s?C\.?\s+GS\b/g, 'BASE CAVA GS'],
  [/\bB\.\s?C\.?\s+G\b/g, 'BASE CAVA G-CB'],
];

/**
 * Varieties, longest first so "XARELLO VERMELL" is not swallowed by "XARELLO".
 * The catalogue spelling is what gets returned.
 */
const VARIETIES: [RegExp, string][] = [
  [/\bXARELLO VERMELL\b/, 'XAREL·LO VERMELL'],
  [/\bMUSCAT FRONTIGNAN\b/, 'MUSCAT FRONTIGNAN'],
  [/\bPINOT NOIR\b/, 'PINOT NOIR'],
  [/\bULL LLEBRE\b/, 'ULL LLEBRE'],
  [/\bXARELLO\b/, 'XAREL·LO'],
  [/\bMACABEU\b/, 'MACABEU'],
  [/\bCHARDONNAY\b/, 'CHARDONNAY'],
  [/\bPARELLADA\b/, 'PARELLADA'],
  [/\bGARNATXA\b/, 'GARNATXA'],
  [/\bMERLOT\b/, 'MERLOT'],
  [/\bCABERNET\b/, 'CABERNET'],
  [/\bCHENIN\b/, 'CHENIN'],
  [/\bMUSCAT\b/, 'MUSCAT'],
];

function detectCategory(text: string): Category | null {
  // Guarda Superior is written "(GS…)", "GS-CB", "BASE CAVA GS", or spelled out.
  if (/\(GS[^)]*\)|\bGS-\w+|\bGUARDA SUPERIOR\b|\bBASE CAVA GS\b/.test(text)) {
    return 'BASE CAVA GUARDA SUPERIOR';
  }
  // Guarda is "(G)", "(G-CB)", "(G-SZ-SZZ)" — a "G" code that is not "GS".
  if (/\(G(?![S])[^)]*\)|\bG-CB\b|\bBASE CAVA\b|\bB\.? ?CAVA\b/.test(text)) return 'BASE CAVA GUARDA';
  if (/\bPENEDES\b/.test(text)) return 'DO PENEDES';
  if (/\bCATALUNYA\b/.test(text)) return 'DO CATALUNYA';
  if (/\bTAULA\b/.test(text)) return 'DE TAULA';
  return null;
}

export function parseProduct(raw: string): ProductFacets | null {
  let text = stripVintage(fold(raw));
  for (const [re, to] of TYPOS) text = text.replace(re, to);

  const kind: Kind = /\bMOST\b/.test(text) ? 'MOST' : 'VI';
  const colour: Colour | null = /\bBLANC\b/.test(text)
    ? 'BLANC'
    : /\bROSAT\b/.test(text)
      ? 'ROSAT'
      : /\bNEGRE\b/.test(text)
        ? 'NEGRE'
        : null;
  if (!colour) return null;

  const category = detectCategory(text);
  if (!category) return null;

  const organic = /\bECOLOGIC\b/.test(text);

  const found: string[] = [];
  for (const [re, name] of VARIETIES) {
    if (re.test(text)) {
      // "XAREL·LO VERMELL" must not also register as "XAREL·LO".
      if (name === 'XAREL·LO' && found.includes('XAREL·LO VERMELL')) continue;
      if (name === 'MUSCAT' && found.includes('MUSCAT FRONTIGNAN')) continue;
      found.push(name);
    }
  }
  // No variety, or two varieties blended, is a "cupatge" in this catalogue.
  const variety = found.length === 1 ? (found[0] as string) : 'CUPATGE';

  return { kind, colour, variety, category, organic };
}

/**
 * Parses a catalogue name (the canonical spelling) into the same facets.
 * e.g. "VI BLANC XAREL·LO BASE CAVA GUARDA SUPERIOR ECOLÒGIC".
 */
export function parseCatalogueName(name: string): ProductFacets | null {
  const facets = parseProduct(name);
  if (!facets) return null;
  // "DE TAULA" in the catalogue vs "TAULA" in the ledger: detectCategory
  // already normalises both, nothing else to reconcile.
  return facets;
}

export function facetKey(f: ProductFacets): string {
  return [f.kind, f.colour, f.variety, f.category, f.organic ? 'ECO' : 'CONV'].join('|');
}

export interface CatalogueEntry {
  id: string;
  name: string;
  facets: ProductFacets;
}

export function buildCatalogueIndex(
  products: { id: string; name: string }[],
): { index: Map<string, CatalogueEntry>; unparsed: string[] } {
  const index = new Map<string, CatalogueEntry>();
  const unparsed: string[] = [];
  for (const p of products) {
    const facets = parseCatalogueName(p.name);
    if (!facets) {
      unparsed.push(p.name);
      continue;
    }
    index.set(facetKey(facets), { id: p.id, name: p.name, facets });
  }
  return { index, unparsed };
}

export interface MatchResult {
  productId: string | null;
  productName: string | null;
  facets: ProductFacets | null;
  reason: string;
}

export function matchProduct(
  raw: string,
  index: Map<string, CatalogueEntry>,
): MatchResult {
  const facets = parseProduct(raw);
  if (!facets) {
    return { productId: null, productName: null, facets: null, reason: 'no s\'han pogut llegir els atributs del producte' };
  }
  const hit = index.get(facetKey(facets));
  if (hit) {
    return {
      productId: hit.id,
      productName: hit.name,
      facets,
      reason: `atributs ${facetKey(facets)}`,
    };
  }
  return {
    productId: null,
    productName: null,
    facets,
    reason: `combinació no present al catàleg: ${facetKey(facets)}`,
  };
}
