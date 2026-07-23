/**
 * What to do when the OS says we entered a region.
 *
 * `arrivalConfidence()` and `isInCooldown()` come from `@vitalpe/domain` and are
 * already tested there. This module is the decision around them, in the order
 * the checks actually have to happen:
 *
 *   1. do we still know this region?          (a stale OS registration)
 *   2. has the user turned arrivals off?      (notify_client_arrival)
 *   3. are we inside the quiet period?        (geofence_cooldown_hours)
 *   4. how sure are we?                       (arrivalConfidence)
 *
 * Only then is a notification built. BAIXA never notifies — a drive-past is not
 * an arrival. AMBIGUA never names a company — it opens the chooser.
 *
 * The event itself is recorded either way (`public.geofence_events`), with
 * `notification_shown` telling the truth about whether we bothered the user.
 * That table stores arrival facts only; there is no movement trail anywhere in
 * this app.
 *
 * Pure module: no React, no Expo, no I/O.
 */

import {
  arrivalConfidence,
  haversineMeters,
  isInCooldown,
  type LatLng,
} from '@vitalpe/domain';
import type { ArrivalConfidence, GeofenceEventType } from '@vitalpe/types';
import type { ArrivalCandidateRef } from './deepLinks.js';

export interface MonitoredRegion {
  regionId: string;
  clientId: string;
  locationId: string;
  latitude: number;
  longitude: number;
  radiusM: number;
  /** Cached company name — used for the visible text only, never for `data`. */
  clientName?: string;
  /** Start of the nearest non-cancelled visit at this company, if any. */
  nearestVisitStartsAt?: string | Date | null;
}

export interface ArrivalSettings {
  notify_client_arrival: boolean;
  geofence_cooldown_hours: number;
  hide_client_name_on_lockscreen: boolean;
}

export type ArrivalSuppression =
  | 'REGIO_DESCONEGUDA'
  | 'AVISOS_DESACTIVATS'
  | 'DINS_DEL_PERIODE_DE_SILENCI'
  | 'CONFIANCA_BAIXA'
  | 'REBUTJAT_ANTERIORMENT';

export interface EvaluateArrivalInput {
  /** The region id the OS reported. */
  regionId: string;
  eventType: GeofenceEventType;
  /** Everything currently monitored, so neighbours can be spotted. */
  regions: readonly MonitoredRegion[];
  /**
   * The fix reported with the event. Null when the OS gave none: then we trust
   * the OS that we are inside, and use distance 0.
   */
  position?: LatLng | null;
  now: Date;
  /** `occurred_at` of the last geofence event for THIS company, if any. */
  lastEventAt?: string | Date | null;
  /** The user pressed "NO ÉS AQUEST CLIENT" here recently. */
  rejectedRecently?: boolean;
  dwellSeconds?: number | null;
  speedKmh?: number | null;
  settings: ArrivalSettings;
}

export interface ArrivalDecisionBase {
  confidence: ArrivalConfidence | null;
  /** Companies whose radius also covers this position. */
  candidates: ArrivalCandidateRef[];
  /** Row for `public.geofence_events`, or null when the region is unknown. */
  event: GeofenceEventDraft | null;
}

export type ArrivalDecision = ArrivalDecisionBase &
  (
    | { action: 'IGNORAR'; reason: ArrivalSuppression }
    | { action: 'NOTIFICAR'; region: MonitoredRegion }
    | { action: 'PREGUNTAR' }
  );

/** Mirrors the writable columns of `public.geofence_events`. */
export interface GeofenceEventDraft {
  client_id: string | null;
  location_id: string | null;
  event_type: GeofenceEventType;
  occurred_at: string;
  notification_shown: boolean;
  client_opened: boolean;
  rejected_by_user: boolean;
  confidence: ArrivalConfidence;
}

/**
 * How near another monitored company has to be before the arrival counts as
 * ambiguous. An industrial estate is easily 150 m across.
 */
export const AMBIGUITY_RADIUS_M = 150;

/**
 * Companies whose own radius (or {@link AMBIGUITY_RADIUS_M}, whichever is
 * larger) contains this position. Always includes the entered region itself.
 */
export function candidatesAt(
  regions: readonly MonitoredRegion[],
  entered: MonitoredRegion,
  position: LatLng | null,
): MonitoredRegion[] {
  const origin: LatLng =
    position ?? { latitude: entered.latitude, longitude: entered.longitude };
  const found: MonitoredRegion[] = [];
  const seenClients = new Set<string>();
  for (const region of regions) {
    const distance = haversineMeters(origin, {
      latitude: region.latitude,
      longitude: region.longitude,
    });
    const reach = Math.max(region.radiusM, AMBIGUITY_RADIUS_M);
    if (region.regionId !== entered.regionId && distance > reach) continue;
    if (seenClients.has(region.clientId)) continue;
    seenClients.add(region.clientId);
    found.push(region);
  }
  // The entered region always comes first, so the chooser leads with it.
  found.sort((a, b) =>
    a.regionId === entered.regionId ? -1 : b.regionId === entered.regionId ? 1 : 0,
  );
  return found;
}

export function evaluateArrival(input: EvaluateArrivalInput): ArrivalDecision {
  const entered = input.regions.find((r) => r.regionId === input.regionId);
  if (entered === undefined) {
    return {
      action: 'IGNORAR',
      reason: 'REGIO_DESCONEGUDA',
      confidence: null,
      candidates: [],
      event: null,
    };
  }

  const position = input.position ?? null;
  const candidateRegions = candidatesAt(input.regions, entered, position);
  const candidates: ArrivalCandidateRef[] = candidateRegions.map((r) => ({
    clientId: r.clientId,
    locationId: r.locationId,
  }));

  const distanceMeters =
    position === null
      ? 0
      : haversineMeters(position, { latitude: entered.latitude, longitude: entered.longitude });

  const confidence = arrivalConfidence({
    distanceMeters,
    radiusMeters: entered.radiusM,
    now: input.now,
    nearestVisitStartsAt: entered.nearestVisitStartsAt ?? null,
    candidateClientCount: candidateRegions.length,
    dwellSeconds: input.dwellSeconds ?? null,
    speedKmh: input.speedKmh ?? null,
  });

  const draft = (notificationShown: boolean): GeofenceEventDraft => ({
    client_id: entered.clientId,
    location_id: entered.locationId,
    event_type: input.eventType,
    occurred_at: input.now.toISOString(),
    notification_shown: notificationShown,
    client_opened: false,
    rejected_by_user: false,
    confidence,
  });

  // A SORTIDA is recorded but never announced: leaving is not news.
  if (input.eventType !== 'ENTRADA') {
    return {
      action: 'IGNORAR',
      reason: 'AVISOS_DESACTIVATS',
      confidence,
      candidates,
      event: draft(false),
    };
  }

  if (input.settings.notify_client_arrival !== true) {
    return {
      action: 'IGNORAR',
      reason: 'AVISOS_DESACTIVATS',
      confidence,
      candidates,
      event: draft(false),
    };
  }

  if (input.rejectedRecently === true) {
    return {
      action: 'IGNORAR',
      reason: 'REBUTJAT_ANTERIORMENT',
      confidence,
      candidates,
      event: draft(false),
    };
  }

  if (isInCooldown(input.lastEventAt ?? null, input.now, input.settings.geofence_cooldown_hours)) {
    return {
      action: 'IGNORAR',
      reason: 'DINS_DEL_PERIODE_DE_SILENCI',
      confidence,
      candidates,
      event: draft(false),
    };
  }

  if (confidence === 'BAIXA') {
    return {
      action: 'IGNORAR',
      reason: 'CONFIANCA_BAIXA',
      confidence,
      candidates,
      event: draft(false),
    };
  }

  if (confidence === 'AMBIGUA') {
    return { action: 'PREGUNTAR', confidence, candidates, event: draft(true) };
  }

  return { action: 'NOTIFICAR', region: entered, confidence, candidates, event: draft(true) };
}
