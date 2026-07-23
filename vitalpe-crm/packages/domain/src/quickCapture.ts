/**
 * REGISTRE RÀPID (§25) — a fully deterministic, offline parser.
 *
 * It reads one line of free text and produces a proposal in EXACTLY the shape
 * of `voiceProposalSchema`, so the confirmation screen the user sees is the same
 * whether the text came from the AI interpreter or from here. That matters for
 * two reasons: the app keeps working with no network and no model, and the
 * preview UI has a single code path to test.
 *
 * Like every other parser in this package it never guesses. An unrecognised
 * company, or a date it cannot pin down, becomes an entry in `ambiguities` and
 * a null field — never an invented id and never an invented due date.
 */

import type {
  ActivityResult,
  CommercialAction,
  TaskPriority,
  VoiceAction,
  VoiceProposal,
} from '@vitalpe/types';
import { normalizeCompany, normalizeText, btrimSpaces } from './normalize.js';
import { parseRelativeDate, DEFAULT_TIMEZONE } from './dates.js';
import { activityTypeForAction } from './taskRules.js';

export interface CatalogEntry {
  id: string;
  name: string;
  aliases?: readonly string[];
}

export interface QuickCaptureCatalog {
  clients?: readonly CatalogEntry[];
  products?: readonly CatalogEntry[];
  campaigns?: readonly CatalogEntry[];
}

export interface QuickCaptureOptions {
  now?: Date;
  timezone?: string;
  /** Language override; otherwise detected from the marker words below. */
  language?: string;
}

/** Ambiguity messages this parser can emit, exported so the UI can style them. */
export const QUICK_CAPTURE_AMBIGUITIES = Object.freeze({
  CLIENT_NOT_FOUND: 'No s’ha reconegut cap empresa del catàleg: cal triar-la a mà.',
  CLIENT_MULTIPLE: 'El text encaixa amb més d’una empresa: cal triar-ne una.',
  PRODUCT_MULTIPLE: 'El text encaixa amb més d’un producte: cal triar-ne un.',
  CAMPAIGN_MULTIPLE: 'El text encaixa amb més d’una campanya: cal triar-ne una.',
});

/**
 * Action keywords, accent-folded exactly as `normalizeText` leaves them.
 * The EARLIEST match in the sentence wins (reading order is intent); a tie is
 * broken by the longer phrase, so "enviar preus" beats a bare "preus".
 */
const ACTION_KEYWORDS: readonly (readonly [string, CommercialAction])[] = [
  ['trucar', 'TRUCAR'],
  ['trucada', 'TRUCAR'],
  ['trucat', 'TRUCAR'],
  ['truca', 'TRUCAR'],
  ['telefonar', 'TRUCAR'],
  ['llamar', 'TRUCAR'],
  ['llamada', 'TRUCAR'],

  ['visita', 'VISITA'],
  ['visitar', 'VISITA'],
  ['visitat', 'VISITA'],
  ['visitado', 'VISITA'],
  ['passar per', 'VISITA'],
  ['pasar por', 'VISITA'],

  ['portar mostres', 'MOSTRES'],
  ['enviar mostres', 'MOSTRES'],
  ['mostres', 'MOSTRES'],
  ['mostra', 'MOSTRES'],
  ['muestras', 'MOSTRES'],
  ['muestra', 'MOSTRES'],

  ['enviar un correu', 'ENVIAR CORREU'],
  ['enviar correu', 'ENVIAR CORREU'],
  ['enviar correo', 'ENVIAR CORREU'],
  ['correu', 'ENVIAR CORREU'],
  ['correo', 'ENVIAR CORREU'],
  ['email', 'ENVIAR CORREU'],
  ['mail', 'ENVIAR CORREU'],

  ['enviar preus', 'ENVIAR PREUS'],
  ['enviar precios', 'ENVIAR PREUS'],
  ['llista de preus', 'ENVIAR PREUS'],
  ['tarifes', 'ENVIAR PREUS'],
  ['tarifas', 'ENVIAR PREUS'],
  ['tarifa', 'ENVIAR PREUS'],
  ['preus', 'ENVIAR PREUS'],
  ['precios', 'ENVIAR PREUS'],

  ['enviar oferta', 'ENVIAR OFERTA'],
  ['enviar una oferta', 'ENVIAR OFERTA'],
  ['pressupost', 'ENVIAR OFERTA'],
  ['presupuesto', 'ENVIAR OFERTA'],
  ['ofertes', 'ENVIAR OFERTA'],
  ['ofertas', 'ENVIAR OFERTA'],
  ['oferta', 'ENVIAR OFERTA'],

  ['verificar empresa', 'VERIFICAR EMPRESA'],
  ['comprovar empresa', 'VERIFICAR EMPRESA'],
  ['comprobar empresa', 'VERIFICAR EMPRESA'],
  ['verificar', 'VERIFICAR EMPRESA'],
];

/**
 * Result keywords. Here the LONGEST phrase wins (results are specific: "no
 * compra vi a granel" must never collapse into "no comprara"); a tie is broken
 * by the earliest position.
 */
const RESULT_KEYWORDS: readonly (readonly [string, ActivityResult])[] = [
  ['interes concret', 'INTERES CONCRET'],
  ['esta interessat', 'INTERES CONCRET'],
  ['estan interessats', 'INTERES CONCRET'],
  ['interessat', 'INTERES CONCRET'],
  ['interesado', 'INTERES CONCRET'],

  ['demana preus', 'DEMANA PREUS'],
  ['demanen preus', 'DEMANA PREUS'],
  ['vol preus', 'DEMANA PREUS'],
  ['pide precios', 'DEMANA PREUS'],
  ['piden precios', 'DEMANA PREUS'],

  ['demana mostres', 'DEMANA MOSTRES'],
  ['demanen mostres', 'DEMANA MOSTRES'],
  ['vol mostres', 'DEMANA MOSTRES'],
  ['pide muestras', 'DEMANA MOSTRES'],

  ['acordar visita', 'ACORDAR VISITA'],
  ['acordar una visita', 'ACORDAR VISITA'],
  ['concertar visita', 'ACORDAR VISITA'],
  ['quedem', 'ACORDAR VISITA'],

  ['te un altre proveidor', 'TE UN ALTRE PROVEIDOR'],
  ['tenen un altre proveidor', 'TE UN ALTRE PROVEIDOR'],
  ['ja te proveidor', 'TE UN ALTRE PROVEIDOR'],
  ['altre proveidor', 'TE UN ALTRE PROVEIDOR'],
  ['otro proveedor', 'TE UN ALTRE PROVEIDOR'],

  ['repetira comanda', 'REPETIRA COMANDA'],
  ['repetiran comanda', 'REPETIRA COMANDA'],
  ['repetira la comanda', 'REPETIRA COMANDA'],
  ['repetira pedido', 'REPETIRA COMANDA'],
  ['repetira', 'REPETIRA COMANDA'],
  ['repetiran', 'REPETIRA COMANDA'],

  ['no compra vi a granel', 'NO COMPRA VI A GRANEL'],
  ['no compren vi a granel', 'NO COMPRA VI A GRANEL'],
  ['no compra granel', 'NO COMPRA VI A GRANEL'],
  ['no compra vino a granel', 'NO COMPRA VI A GRANEL'],

  ['no determinat', 'NO DETERMINAT'],
  ['no ho saben', 'NO DETERMINAT'],
  ['no lo saben', 'NO DETERMINAT'],

  ['no comprara', 'NO COMPRARA'],
  ['no compraran', 'NO COMPRARA'],
  ['no compraran res', 'NO COMPRARA'],

  ['tancat o inactiu', 'TANCAT / INACTIU'],
  ['ha tancat', 'TANCAT / INACTIU'],
  ['han plegat', 'TANCAT / INACTIU'],
  ['ha plegat', 'TANCAT / INACTIU'],
  ['inactiu', 'TANCAT / INACTIU'],
  ['cerrado', 'TANCAT / INACTIU'],
  ['tancat', 'TANCAT / INACTIU'],
];

const PRIORITY_KEYWORDS: readonly (readonly [string, TaskPriority])[] = [
  ['molt urgent', 'ALTA'],
  ['prioritat alta', 'ALTA'],
  ['alta prioritat', 'ALTA'],
  ['com abans millor', 'ALTA'],
  ['cuanto antes', 'ALTA'],
  ['urgent', 'ALTA'],
  ['urgente', 'ALTA'],
  ['important', 'ALTA'],
  ['importante', 'ALTA'],

  ['prioritat baixa', 'BAIXA'],
  ['baixa prioritat', 'BAIXA'],
  ['sense pressa', 'BAIXA'],
  ['sin prisa', 'BAIXA'],
  ['poc urgent', 'BAIXA'],
];

/** Words that only appear in one of the two languages. */
const CA_MARKERS = new Set([
  'amb', 'aquest', 'aquesta', 'dema', 'avui', 'dilluns', 'dimarts', 'dimecres',
  'dijous', 'divendres', 'dissabte', 'diumenge', 'setmana', 'mostres', 'preus',
  'proveidor', 'trucar', 'trucada', 'vinent', 'despres', 'tambe', 'aixo',
  'nomes', 'empresa', 'demana',
]);
const ES_MARKERS = new Set([
  'con', 'este', 'esta', 'manana', 'hoy', 'lunes', 'martes', 'miercoles',
  'jueves', 'viernes', 'sabado', 'domingo', 'semana', 'muestras', 'precios',
  'proveedor', 'llamar', 'llamada', 'proxima', 'despues', 'tambien', 'esto',
  'solo', 'pide',
]);

interface Hit<T> {
  value: T;
  index: number;
  length: number;
}

/** Whole-token containment: ' key ' inside ' haystack '. */
function findPhrase(paddedHaystack: string, phrase: string): number {
  return paddedHaystack.indexOf(` ${phrase} `);
}

function findEarliestThenLongest<T>(
  paddedHaystack: string,
  table: readonly (readonly [string, T])[],
): Hit<T> | null {
  let best: Hit<T> | null = null;
  for (const [phrase, value] of table) {
    const index = findPhrase(paddedHaystack, phrase);
    if (index < 0) continue;
    if (
      best === null ||
      index < best.index ||
      (index === best.index && phrase.length > best.length)
    ) {
      best = { value, index, length: phrase.length };
    }
  }
  return best;
}

function findLongestThenEarliest<T>(
  paddedHaystack: string,
  table: readonly (readonly [string, T])[],
): Hit<T> | null {
  let best: Hit<T> | null = null;
  for (const [phrase, value] of table) {
    const index = findPhrase(paddedHaystack, phrase);
    if (index < 0) continue;
    if (
      best === null ||
      phrase.length > best.length ||
      (phrase.length === best.length && index < best.index)
    ) {
      best = { value, index, length: phrase.length };
    }
  }
  return best;
}

interface CatalogMatch {
  ids: string[];
  /** Length of the winning key, for the "longest name wins" rule. */
  length: number;
}

function matchCatalog(
  paddedHaystack: string,
  entries: readonly CatalogEntry[] | undefined,
  normalize: (v: string | null | undefined) => string | null,
): CatalogMatch {
  let bestLength = 0;
  const ids = new Set<string>();
  for (const entry of entries ?? []) {
    for (const candidate of [entry.name, ...(entry.aliases ?? [])]) {
      const key = normalize(candidate);
      if (key === null || key === '') continue;
      if (findPhrase(paddedHaystack, key) < 0) continue;
      if (key.length > bestLength) {
        bestLength = key.length;
        ids.clear();
        ids.add(entry.id);
      } else if (key.length === bestLength) {
        ids.add(entry.id);
      }
    }
  }
  return { ids: [...ids], length: bestLength };
}

function detectLanguage(tokens: readonly string[]): string {
  let ca = 0;
  let es = 0;
  for (const token of tokens) {
    if (CA_MARKERS.has(token)) ca += 1;
    if (ES_MARKERS.has(token)) es += 1;
  }
  if (es > ca) return 'es';
  return 'ca';
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
}

/**
 * Parses one line of REGISTRE RÀPID text into a confirmable proposal.
 *
 * Shape of the decision, in order:
 *   - a RESULT in the text means something already happened  -> CREATE_ACTIVITY
 *     (plus a CREATE_REMINDER when a future date is also present);
 *   - otherwise an ACTION means something to do              -> CREATE_TASK
 *     (dueAt = the parsed date, or null for an undated next action);
 *   - otherwise a bare date                                  -> CREATE_REMINDER;
 *   - otherwise                                              -> CREATE_NOTE.
 */
export function parseQuickCapture(
  text: string,
  catalog: QuickCaptureCatalog = {},
  options: QuickCaptureOptions = {},
): VoiceProposal {
  const now = options.now ?? new Date();
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;

  const normalizedText = normalizeText(text) ?? '';
  const normalizedCompanyText = normalizeCompany(text) ?? '';
  const hayText = ` ${normalizedText} `;
  const hayCompany = ` ${normalizedCompanyText} `;
  const tokens = normalizedText === '' ? [] : normalizedText.split(' ');

  const ambiguities: string[] = [];

  // -- company ------------------------------------------------------------
  const clientMatch = matchCatalog(hayCompany, catalog.clients, normalizeCompany);
  let clientId: string | null = null;
  if (clientMatch.ids.length === 1) {
    clientId = clientMatch.ids[0] as string;
  } else if (clientMatch.ids.length > 1) {
    ambiguities.push(QUICK_CAPTURE_AMBIGUITIES.CLIENT_MULTIPLE);
  } else if ((catalog.clients ?? []).length > 0) {
    ambiguities.push(QUICK_CAPTURE_AMBIGUITIES.CLIENT_NOT_FOUND);
  }

  // -- product / campaign -------------------------------------------------
  const productMatch = matchCatalog(hayText, catalog.products, normalizeText);
  let productId: string | null = null;
  if (productMatch.ids.length === 1) productId = productMatch.ids[0] as string;
  else if (productMatch.ids.length > 1) ambiguities.push(QUICK_CAPTURE_AMBIGUITIES.PRODUCT_MULTIPLE);

  const campaignMatch = matchCatalog(hayText, catalog.campaigns, normalizeText);
  let campaignId: string | null = null;
  if (campaignMatch.ids.length === 1) campaignId = campaignMatch.ids[0] as string;
  else if (campaignMatch.ids.length > 1)
    ambiguities.push(QUICK_CAPTURE_AMBIGUITIES.CAMPAIGN_MULTIPLE);

  // -- action / result / priority / date ----------------------------------
  const actionHit = findEarliestThenLongest(hayText, ACTION_KEYWORDS);
  const resultHit = findLongestThenEarliest(hayText, RESULT_KEYWORDS);
  const priorityHit = findLongestThenEarliest(hayText, PRIORITY_KEYWORDS);
  const parsedDate = parseRelativeDate(text, now, timezone);
  if (parsedDate.ambiguity !== undefined) ambiguities.push(parsedDate.ambiguity);

  const action = actionHit?.value ?? null;
  const result = resultHit?.value ?? null;
  const priority = priorityHit?.value ?? 'MITJANA';
  const dueAt = parsedDate.date === null ? null : parsedDate.date.toISOString();

  const summary = btrimSpaces(text ?? '').slice(0, 280);
  const notes = summary === '' ? null : summary;

  // -- build the proposal -------------------------------------------------
  const actions: VoiceAction[] = [];

  if (result !== null) {
    actions.push({
      type: 'CREATE_ACTIVITY',
      clientId,
      activityType: activityTypeForAction(action ?? 'ALTRES'),
      result,
      notes,
      productId,
      campaignId,
    });
    if (dueAt !== null) {
      actions.push({
        type: 'CREATE_REMINDER',
        clientId,
        title: summary === '' ? 'RECORDATORI' : summary,
        dueAt,
        notes,
      });
    }
  } else if (action !== null) {
    actions.push({
      type: 'CREATE_TASK',
      clientId,
      action,
      otherAction: action === 'ALTRES' ? notes : null,
      title: summary === '' ? null : summary,
      dueAt,
      priority,
      notes,
      productId,
      campaignId,
    });
  } else if (dueAt !== null) {
    actions.push({
      type: 'CREATE_REMINDER',
      clientId,
      title: summary === '' ? 'RECORDATORI' : summary,
      dueAt,
      notes,
    });
  } else {
    actions.push({
      type: 'CREATE_NOTE',
      clientId,
      text: summary === '' ? '(buit)' : summary,
    });
  }

  // -- confidence ---------------------------------------------------------
  let confidence = 0.4;
  if (clientId !== null) confidence += 0.25;
  if (action !== null || result !== null) confidence += 0.15;
  if (parsedDate.date !== null) confidence += 0.15;
  if (productId !== null) confidence += 0.05;
  confidence -= 0.2 * ambiguities.length;
  confidence = Math.min(1, Math.max(0, confidence));

  return {
    clientId,
    summary,
    language: options.language ?? detectLanguage(tokens),
    confidence: round3(confidence),
    ambiguities,
    actions,
  };
}

/** `quickCapture.parse(text, catalog)` — the entry point named by the brief. */
export const quickCapture = { parse: parseQuickCapture } as const;
