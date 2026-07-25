/**
 * Municipality → commercial zone.
 *
 * The portfolio has **no coordinates**: 346 companies on the working list and
 * not one geocoded address. So a route cannot be planned by distance, and
 * pretending otherwise would mean inventing positions — the one thing this
 * system must not do. What every company does have is a municipality, and
 * municipalities belong to comarques, which is real, checkable geography.
 *
 * So a zone is a comarca. Two companies in the same zone are genuinely a short
 * drive apart; two in different zones are not. That is the whole claim, and it
 * is weaker than "optimal route" on purpose.
 *
 * A municipality that is not in this map becomes **its own zone**. That is the
 * honest fallback: we know where it is, we just do not claim to know what it is
 * near. Adding it here later improves the plan; guessing would corrupt it.
 */
import { unaccentCa } from './normalize';

/** Uppercase, unaccented, apostrophes unified, separators collapsed. */
export function municipalityKey(value: string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  // The workbook carries variants: curly vs straight apostrophes, "A | B" for a
  // company that straddles two towns, "ELS CASOTS - SUBIRATS" for a hamlet.
  // The first named town wins: it is the one the address is in.
  const first = value.split('|')[0] ?? value;
  const folded = unaccentCa(first)
    .toUpperCase()
    .replace(/[’´`]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  if (folded.length === 0) return null;
  // "ELS CASOTS - SUBIRATS" → the municipality is the part after the dash when
  // the first part is a hamlet; we cannot tell which is which, so keep both
  // halves joined and let the explicit map below decide.
  return folded;
}

/**
 * Comarca per municipality, for the towns this portfolio actually contains.
 *
 * Only entries verified as real administrative geography are listed. The map is
 * intentionally incomplete rather than speculative.
 */
const ZONE_BY_MUNICIPALITY: Readonly<Record<string, string>> = Object.freeze({
  // --- ALT PENEDÈS (the core of the portfolio) ---
  "SANT SADURNI D'ANOIA": 'ALT PENEDÈS',
  SUBIRATS: 'ALT PENEDÈS',
  'ELS CASOTS - SUBIRATS': 'ALT PENEDÈS',
  'VILAFRANCA DEL PENEDES': 'ALT PENEDÈS',
  'AVINYONET DEL PENEDES': 'ALT PENEDÈS',
  'FONT-RUBI': 'ALT PENEDÈS',
  'GUARDIOLA DE FONT-RUBI': 'ALT PENEDÈS',
  'SANT MARTI SARROCA': 'ALT PENEDÈS',
  'SANT MARTI SARROCA (LA BLEDA)': 'ALT PENEDÈS',
  'PACS DEL PENEDES': 'ALT PENEDÈS',
  'SANTA MARGARIDA I ELS MONJOS': 'ALT PENEDÈS',
  'CASTELLVI DE LA MARCA': 'ALT PENEDÈS',
  TORRELAVIT: 'ALT PENEDÈS',
  'EL PLA DEL PENEDES': 'ALT PENEDÈS',
  'SANTA FE DEL PENEDES': 'ALT PENEDÈS',
  'LA GRANADA': 'ALT PENEDÈS',
  'LA GRANADA DEL PENEDES': 'ALT PENEDÈS',
  'SANT CUGAT SESGARRIGUES': 'ALT PENEDÈS',
  'SANT QUINTI DE MEDIONA': 'ALT PENEDÈS',
  MEDIONA: 'ALT PENEDÈS',
  'SANT JOAN DE MEDIONA': 'ALT PENEDÈS',
  'TORRELLES DE FOIX': 'ALT PENEDÈS',
  'LES CABANYES': 'ALT PENEDÈS',
  PUIGDALBER: 'ALT PENEDÈS',
  'VILOBI DEL PENEDES': 'ALT PENEDÈS',
  "SANT LLORENÇ D'HORTONS": 'ALT PENEDÈS',
  GELIDA: 'ALT PENEDÈS',
  OLERDOLA: 'ALT PENEDÈS',
  'MOJA - OLERDOLA': 'ALT PENEDÈS',
  'OLESA DE BONESVALLS': 'ALT PENEDÈS',
  'SANT PERE DE RIUDEBITLLES': 'ALT PENEDÈS',
  'CASTELLET I LA GORNAL': 'ALT PENEDÈS',
  'LA BEGUDA BAIXA': 'ALT PENEDÈS',
  ORDAL: 'ALT PENEDÈS',
  VILADELLOPS: 'ALT PENEDÈS',
  'SANT MARÇAL': 'ALT PENEDÈS',
  "L'ARBOÇAR": 'ALT PENEDÈS',

  // --- BAIX PENEDÈS ---
  'EL VENDRELL': 'BAIX PENEDÈS',
  'LLORENÇ DEL PENEDES': 'BAIX PENEDÈS',
  'SANTA OLIVA': 'BAIX PENEDÈS',
  ALBINYANA: 'BAIX PENEDÈS',
  BONASTRE: 'BAIX PENEDÈS',
  "L'ARBOÇ": 'BAIX PENEDÈS',
  'SANT JAUME DELS DOMENYS': 'BAIX PENEDÈS',
  'BELLVEI DEL PENEDES': 'BAIX PENEDÈS',
  MASLLORENÇ: 'BAIX PENEDÈS',

  // --- GARRAF ---
  CANYELLES: 'GARRAF',
  SITGES: 'GARRAF',
  'SANT PERE DE RIBES': 'GARRAF',

  // --- ALT CAMP ---
  'VILA-RODONA': 'ALT CAMP',
  NULLES: 'ALT CAMP',
  VALLMOLL: 'ALT CAMP',
  MONTFERRI: 'ALT CAMP',
  RODONYA: 'ALT CAMP',
  BRAFIM: 'ALT CAMP',
  VILABELLA: 'ALT CAMP',
  'EL PLA DE MANLLEU': 'ALT CAMP',
  'LES POBLES, AIGUMURCIA': 'ALT CAMP',
  AIGUAMURCIA: 'ALT CAMP',

  // --- CONCA DE BARBERÀ ---
  MONTBLANC: 'CONCA DE BARBERÀ',
  SARRAL: 'CONCA DE BARBERÀ',
  SOLIVELLA: 'CONCA DE BARBERÀ',
  'BARBERA DE LA CONCA': 'CONCA DE BARBERÀ',
  PIRA: 'CONCA DE BARBERÀ',
  BLANCAFORT: 'CONCA DE BARBERÀ',
  'ROCAFORT DE QUERALT': 'CONCA DE BARBERÀ',
  'VIMBODI I POBLET': 'CONCA DE BARBERÀ',

  // --- TERRA ALTA ---
  GANDESA: 'TERRA ALTA',
  BATEA: 'TERRA ALTA',
  BOT: 'TERRA ALTA',
  "CORBERA D'EBRE": 'TERRA ALTA',
  'VILALBA DELS ARCS': 'TERRA ALTA',
  'HORTA DE SANT JOAN': 'TERRA ALTA',
  'HORTA DE SANT JOAN / GANDESA': 'TERRA ALTA',
  'LA POBLA DE MASSALUCA': 'TERRA ALTA',

  // --- PRIORAT i MONTSANT ---
  FALSET: 'PRIORAT',
  'CORNUDELLA DE MONTSANT': 'PRIORAT',
  'EL MASROIG': 'PRIORAT',
  CAPÇANES: 'PRIORAT',
  'ELS GUIAMETS': 'PRIORAT',
  ULLDEMOLINS: 'PRIORAT',

  // --- RIBERA D'EBRE ---
  ASCO: "RIBERA D'EBRE",
  VINEBRE: "RIBERA D'EBRE",
  GINESTAR: "RIBERA D'EBRE",
  MIRAVET: "RIBERA D'EBRE",
  BENISSANET: "RIBERA D'EBRE",
  'MORA LA NOVA': "RIBERA D'EBRE",

  // --- ANOIA ---
  ODENA: 'ANOIA',
  "CABRERA D'ANOIA": 'ANOIA',
  'LA TORRE DE CLARAMUNT': 'ANOIA',
  PIERA: 'ANOIA',
  MASQUEFA: 'ANOIA',
  'SANT JAUME SESOLIVERES': 'ANOIA',

  // --- BAGES i OSONA ---
  ARTES: 'BAGES',
  'SANT FRUITOS DE BAGES': 'BAGES',
  FONOLLOSA: 'BAGES',
  "HORTA D'AVINYO": 'BAGES',
  "SANTA MARIA HORTA D'AVINYO": 'BAGES',
  "STS. MARIA HORTA D'AVINYO": 'BAGES',
  'MAIANS (CASTELLFOLLIT DEL BOIX)': 'BAGES',
  'SANTA MARIA DE BESORA': 'OSONA',

  // --- ALT i BAIX EMPORDÀ ---
  GARRIGUELLA: 'ALT EMPORDÀ',
  VILAJUIGA: 'ALT EMPORDÀ',
  'MOLLET DE PERALADA': 'ALT EMPORDÀ',
  MASARAC: 'ALT EMPORDÀ',
  'SANT CLIMENT DE SESCEBES': 'ALT EMPORDÀ',
  CAPMANY: 'ALT EMPORDÀ',
  PAU: 'ALT EMPORDÀ',
  "EL FAR D'EMPORDA": 'ALT EMPORDÀ',
  VILAMALLA: 'ALT EMPORDÀ',
  CORÇA: 'BAIX EMPORDÀ',
  CALONGE: 'BAIX EMPORDÀ',

  // --- GIRONÈS ---
  'SANT JULIA DE RAMIS': 'GIRONÈS',
  'SANT JORDI DESVALLS': 'GIRONÈS',

  // --- TARRAGONÈS i BAIX CAMP ---
  TARRAGONA: 'TARRAGONÈS',
  'VILA-SECA': 'TARRAGONÈS',
  CONSTANTI: 'TARRAGONÈS',
  'LA SECUITA': 'TARRAGONÈS',
  SALOMO: 'TARRAGONÈS',
  'VILALLONGA DEL CAMP': 'TARRAGONÈS',
  'LES BORGES DEL CAMP': 'BAIX CAMP',

  // --- BAIX LLOBREGAT i entorn de Barcelona ---
  'SANT JOAN DESPI': 'BAIX LLOBREGAT',
  BEGUES: 'BAIX LLOBREGAT',
  ABRERA: 'BAIX LLOBREGAT',
  'CASTELLVI DE ROSANES': 'BAIX LLOBREGAT',
  'CORBERA DE LLOBREGAT': 'BAIX LLOBREGAT',
  ESPARREGUERA: 'BAIX LLOBREGAT',
  ESPARRAGUERA: 'BAIX LLOBREGAT',
  'SANT ESTEVE SESROVIRES': 'BAIX LLOBREGAT',
  CASTELLBISBAL: 'VALLÈS OCCIDENTAL',
  SABADELL: 'VALLÈS OCCIDENTAL',
  BARCELONA: 'BARCELONÈS',
  'CORNELLA DE LLOBREGAT': 'BAIX LLOBREGAT',
  ALELLA: 'MARESME',
  TIANA: 'MARESME',
  MATARO: 'MARESME',

  // --- Lleida ---
  BALAGUER: 'NOGUERA',
  'ARTESA DE SEGRE': 'NOGUERA',
  'ARTESA DEL SEGRE': 'NOGUERA',
  TARREGA: 'URGELL',
  "L'ALBAGES": 'GARRIGUES',
  'VALLBONA DE LES MONGES': 'URGELL',
  LLEIDA: 'SEGRIÀ',
});

/**
 * Provinces/regions outside Catalonia are grouped at their own level: a trip to
 * Requena or Almendralejo is a different kind of journey altogether, and
 * pretending those towns cluster with anything here would produce nonsense
 * routes.
 */
const ZONE_BY_PROVINCE: Readonly<Record<string, string>> = Object.freeze({
  VALENCIA: 'FORA DE CATALUNYA · VALÈNCIA',
  'VALÈNCIA': 'FORA DE CATALUNYA · VALÈNCIA',
  NAVARRA: 'FORA DE CATALUNYA · NAVARRA',
  BADAJOZ: 'FORA DE CATALUNYA · EXTREMADURA',
  'LA RIOJA': 'FORA DE CATALUNYA · LA RIOJA',
  ZARAGOZA: 'FORA DE CATALUNYA · ARAGÓ',
  ZAMORA: 'FORA DE CATALUNYA · CASTELLA I LLEÓ',
  BURGOS: 'FORA DE CATALUNYA · CASTELLA I LLEÓ',
  'ÁLAVA': 'FORA DE CATALUNYA · PAÍS BASC',
  ALAVA: 'FORA DE CATALUNYA · PAÍS BASC',
  'CIUDAD REAL': 'FORA DE CATALUNYA · CASTELLA-LA MANXA',
  MADRID: 'FORA DE CATALUNYA · MADRID',
  GERMANY: 'FORA DE CATALUNYA · ALEMANYA',
});

export interface ZoneResult {
  zone: string;
  /** False when the zone is just the municipality, because we have no comarca. */
  known: boolean;
}

/**
 * The zone a company belongs to.
 *
 * Order matters: a known Catalan municipality wins over its province, because
 * the comarca is the useful unit. Only when the town is unknown does the
 * province decide, and only for places far enough away that province-level
 * grouping is honest.
 */
export function zoneFor(
  municipality: string | null | undefined,
  province?: string | null,
): ZoneResult {
  const key = municipalityKey(municipality);
  if (key !== null) {
    const zone = ZONE_BY_MUNICIPALITY[key];
    if (zone !== undefined) return { zone, known: true };
  }
  const provinceKey = province === null || province === undefined ? null : unaccentCa(province).toUpperCase().trim();
  if (provinceKey !== null) {
    const zone = ZONE_BY_PROVINCE[provinceKey] ?? ZONE_BY_PROVINCE[province!.toUpperCase().trim()];
    if (zone !== undefined) return { zone, known: true };
  }
  // Unknown town: it is its own zone. We know where it is; we do not claim to
  // know what it is near.
  if (key !== null) return { zone: key, known: false };
  return { zone: 'SENSE MUNICIPI', known: false };
}

/** Every zone this map can produce, for the UI's filter. */
export function knownZones(): string[] {
  return [...new Set([...Object.values(ZONE_BY_MUNICIPALITY), ...Object.values(ZONE_BY_PROVINCE)])].sort();
}
