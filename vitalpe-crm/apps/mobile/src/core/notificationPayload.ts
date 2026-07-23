/**
 * What an arrival notification is allowed to say, and what it is allowed to
 * carry.
 *
 * The payload (`data`) is the part that survives outside the app: it is written
 * to the notification centre, it can be read from a lock screen preview on some
 * OEM builds, and it is persisted by the system until the notification is
 * dismissed. So it carries FOUR keys and nothing else:
 *
 *     { type, clientId, locationId, route }
 *
 * No company name, no address, no phone, no visit objective, no coordinates.
 * The visible text is a separate decision, governed by
 * `notification_settings.hide_client_name_on_lockscreen`: with the flag on, the
 * name never appears in the title or the body either.
 *
 * `notificationPayloadIsMinimal()` exists so this contract is enforced by a
 * test rather than by good intentions.
 *
 * Pure module: no React, no Expo, no I/O.
 */

import type { ArrivalConfidence } from '@vitalpe/types';
import { isUuid, routeForArrivalChooser, routeForClient, type ArrivalCandidateRef } from './deepLinks.js';

export const NOTIFICATION_TYPES = ['ARRIBADA', 'ARRIBADA_AMBIGUA'] as const;
export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** The four keys, in a fixed order, so the shape is easy to assert. */
export const NOTIFICATION_DATA_KEYS = ['type', 'clientId', 'locationId', 'route'] as const;

export interface NotificationData {
  type: NotificationType;
  /** Null when the arrival is ambiguous: we refuse to name one of several. */
  clientId: string | null;
  locationId: string | null;
  /** In-app route, always built by `deepLinks.ts`. */
  route: string;
}

export interface LocalNotification {
  title: string;
  body: string;
  data: NotificationData;
  /** Android channel; iOS ignores it. */
  channelId: string;
}

export const ARRIVAL_CHANNEL_ID = 'arribades';

export interface BuildArrivalNotificationInput {
  clientId: string;
  locationId: string;
  /** Only ever used for the visible text, never for `data`. */
  clientName: string;
  confidence: ArrivalConfidence;
  /** `notification_settings.hide_client_name_on_lockscreen`. */
  hideClientName: boolean;
}

/**
 * A confident arrival at one identified company.
 * Returns null if the ids are not usable — we would rather show nothing than
 * show a notification that opens the wrong screen.
 */
export function buildArrivalNotification(
  input: BuildArrivalNotificationInput,
): LocalNotification | null {
  const route = routeForClient(input.clientId);
  if (route === null || !isUuid(input.locationId)) return null;

  const hidden = input.hideClientName === true;
  const name = input.clientName.trim();

  return {
    title: hidden || name.length === 0 ? 'VITALPE' : name,
    body: hidden
      ? "Ets a prop d'una empresa de la teva llista. Obre l'app per veure-la."
      : input.confidence === 'ALTA'
        ? 'Sembla que has arribat a la visita. Obre la fitxa per registrar-la.'
        : "Sembla que ets aquí. Obre la fitxa si vols registrar-hi alguna cosa.",
    data: {
      type: 'ARRIBADA',
      clientId: input.clientId.toLowerCase(),
      locationId: input.locationId.toLowerCase(),
      route,
    },
    channelId: ARRIVAL_CHANNEL_ID,
  };
}

export interface BuildAmbiguousArrivalInput {
  candidates: readonly ArrivalCandidateRef[];
  /** Parallel to `candidates`; used for the body only, and only when allowed. */
  clientNames?: readonly string[];
  hideClientName: boolean;
}

/**
 * Several of our companies share this spot. We do not pick one: the
 * notification opens the chooser.
 */
export function buildAmbiguousArrivalNotification(
  input: BuildAmbiguousArrivalInput,
): LocalNotification | null {
  const route = routeForArrivalChooser(input.candidates);
  if (route === null) return null;

  const count = input.candidates.length;
  const names = (input.clientNames ?? []).map((n) => n.trim()).filter((n) => n.length > 0);
  const canName = input.hideClientName !== true && names.length > 0 && names.length === count;

  return {
    title: 'VITALPE',
    body: canName
      ? `Ets a prop de ${count} empreses: ${names.join(', ')}. Tria quina.`
      : `Ets a prop de ${count} empreses de la teva llista. Obre l'app per triar quina.`,
    data: {
      type: 'ARRIBADA_AMBIGUA',
      clientId: null,
      locationId: null,
      route,
    },
    channelId: ARRIVAL_CHANNEL_ID,
  };
}

/**
 * True when `data` carries nothing beyond the four allowed keys, and when every
 * value is either the type word, a UUID, `null`, or a route made only of known
 * path segments and UUIDs.
 *
 * This is the machine-checkable form of "the payload leaks no personal data".
 */
export function notificationPayloadIsMinimal(data: unknown): boolean {
  if (typeof data !== 'object' || data === null) return false;
  const keys = Object.keys(data as Record<string, unknown>).sort();
  const expected = [...NOTIFICATION_DATA_KEYS].sort();
  if (keys.length !== expected.length) return false;
  if (!keys.every((key, i) => key === expected[i])) return false;

  const record = data as Record<string, unknown>;
  const type = record.type;
  if (typeof type !== 'string' || !NOTIFICATION_TYPES.includes(type as NotificationType)) {
    return false;
  }
  for (const key of ['clientId', 'locationId'] as const) {
    const value = record[key];
    if (value !== null && !isUuid(typeof value === 'string' ? value : null)) return false;
  }
  const route = record.route;
  if (typeof route !== 'string') return false;
  return routeCarriesOnlyIds(route);
}

/** Every route token is either a known literal segment or a UUID. */
export function routeCarriesOnlyIds(route: string): boolean {
  if (!route.startsWith('/')) return false;
  const [path = '', query = ''] = route.split('?', 2);
  const literals = new Set(['clients', 'visits', 'arribada']);
  for (const segment of path.split('/').filter((s) => s.length > 0)) {
    if (literals.has(segment)) continue;
    if (isUuid(segment)) continue;
    return false;
  }
  if (query.length === 0) return true;
  for (const pair of query.split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1) return false;
    if (pair.slice(0, eq) !== 'candidats') return false;
    for (const item of pair.slice(eq + 1).split(',')) {
      const [clientId, locationId] = item.split('.');
      if (!isUuid(clientId ?? null) || !isUuid(locationId ?? null)) return false;
    }
  }
  return true;
}
