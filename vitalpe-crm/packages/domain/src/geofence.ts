/**
 * Geofencing — dynamic region prioritisation (§23.3) and arrival confidence
 * (§23.4).
 *
 * iOS monitors at most 20 regions per app, so the interesting problem is not
 * "which companies have coordinates" but "which 20 matter right now". The
 * ordering below is fixed and deliberate: a visit booked for today always
 * outranks a company you merely happen to be near.
 *
 * Nothing here does I/O. The caller supplies candidates already filtered by
 * workspace and by `client_locations.geofence_enabled`, and persists the result
 * into `public.geofence_registrations` (whose `priority` and `selection_reason`
 * columns are exactly the two fields produced here).
 */

import type { ArrivalConfidence } from '@vitalpe/types';
import { isSameZonedDay, DEFAULT_TIMEZONE } from './dates';
import { haversineMeters, type LatLng } from './geo';

/** The hard iOS limit on simultaneously monitored regions. */
export const IOS_MAX_MONITORED_REGIONS = 20;

/** Default cooldown from `notification_settings.geofence_cooldown_hours`. */
export const DEFAULT_COOLDOWN_HOURS = 6;

/** A visit this close to the arrival counts as "the visit you came for". */
export const VISIT_MATCH_WINDOW_MS = 2 * 60 * 60 * 1000; // ±2 h

/** Below this dwell time inside the region it was a pass-through, not a visit. */
export const PASS_THROUGH_SECONDS = 120;

/** At or above this speed the device is driving past, not arriving. */
export const PASS_THROUGH_SPEED_KMH = 20;

/**
 * The reasons a region can be registered, in priority order. The string is
 * stored verbatim in `geofence_registrations.selection_reason`.
 */
export const GEOFENCE_SELECTION_REASONS = [
  'VISITA AVUI',
  'VISITA PROPERA',
  'CLIENT ASSIGNAT',
  'TASCA PRIORITARIA',
  'PROP DE LA ULTIMA POSICIO',
  'VISITAT RECENTMENT',
  'FIXAT MANUALMENT',
] as const;
export type GeofenceSelectionReason = (typeof GEOFENCE_SELECTION_REASONS)[number];

export interface GeofenceCandidate {
  /** Stable id used by the OS; also the dedupe key here. */
  regionId: string;
  clientId: string;
  locationId: string;
  latitude: number;
  longitude: number;
  /** `client_locations.geofence_radius_m`; defaults to 120 like the column. */
  radiusM?: number;
  /** `client_locations.geofence_enabled`; false removes the candidate entirely. */
  geofenceEnabled?: boolean;
  /** Start of the nearest non-cancelled visit at this company, if any. */
  visitStartsAt?: Date | string | null;
  /** The company is assigned to this user (owner or collaborator). */
  isAssigned?: boolean;
  /** There is a PENDENT task with priority ALTA at this company. */
  hasHighPriorityTask?: boolean;
  /** When the user last visited, for the "recently visited" tier. */
  lastVisitedAt?: Date | string | null;
  /** The user pinned this company by hand. */
  isPinned?: boolean;
}

export interface SelectedRegion {
  regionId: string;
  clientId: string;
  locationId: string;
  latitude: number;
  longitude: number;
  radiusM: number;
  /** 1 = highest. Written to `geofence_registrations.priority`. */
  priority: number;
  selectionReason: GeofenceSelectionReason;
  /** Metres from `lastKnownPosition`, or null when no position was supplied. */
  distanceMeters: number | null;
}

export interface SelectRegionsOptions {
  now: Date;
  /** Hard cap. Defaults to the iOS limit of 20. */
  maxRegions?: number;
  timezone?: string;
  lastKnownPosition?: LatLng | null;
  /** How near "near the last known position" is. Default 25 km. */
  nearRadiusMeters?: number;
  /** How far ahead a visit still counts as "upcoming". Default 7 days. */
  upcomingVisitDays?: number;
  /** How far back "recently visited" reaches. Default 30 days. */
  recentlyVisitedDays?: number;
  /** Fallback radius when the candidate carries none. Default 120 m. */
  defaultRadiusMeters?: number;
}

function toDate(value: Date | string | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

interface Ranked {
  region: SelectedRegion;
  index: number;
  visitAt: number | null;
  lastVisitedAt: number | null;
}

/**
 * Picks the regions worth monitoring right now, in this order:
 *
 *   1  VISITA AVUI               a visit at this company today
 *   2  VISITA PROPERA            a visit in the next `upcomingVisitDays`
 *   3  CLIENT ASSIGNAT           the company is assigned to this user
 *   4  TASCA PRIORITARIA         an open ALTA-priority task
 *   5  PROP DE LA ULTIMA POSICIO within `nearRadiusMeters` of where we last were
 *   6  VISITAT RECENTMENT        visited within `recentlyVisitedDays`
 *   7  FIXAT MANUALMENT          pinned by hand
 *
 * Candidates matching none of the seven are not registered at all. The result
 * is truncated to `maxRegions` (default {@link IOS_MAX_MONITORED_REGIONS}).
 */
export function selectRegions(
  candidates: readonly GeofenceCandidate[],
  options: SelectRegionsOptions,
): SelectedRegion[] {
  const now = options.now;
  const timezone = options.timezone ?? DEFAULT_TIMEZONE;
  const maxRegions = Math.max(0, options.maxRegions ?? IOS_MAX_MONITORED_REGIONS);
  const nearRadius = options.nearRadiusMeters ?? 25000;
  const upcomingMs = (options.upcomingVisitDays ?? 7) * 24 * 60 * 60 * 1000;
  const recentMs = (options.recentlyVisitedDays ?? 30) * 24 * 60 * 60 * 1000;
  const defaultRadius = options.defaultRadiusMeters ?? 120;
  const position = options.lastKnownPosition ?? null;

  const seen = new Set<string>();
  const ranked: Ranked[] = [];

  candidates.forEach((candidate, index) => {
    if (candidate.geofenceEnabled === false) return;
    if (!Number.isFinite(candidate.latitude) || !Number.isFinite(candidate.longitude)) return;
    if (seen.has(candidate.regionId)) return;

    const visit = toDate(candidate.visitStartsAt);
    const lastVisited = toDate(candidate.lastVisitedAt);
    const distance =
      position === null
        ? null
        : haversineMeters(position, {
            latitude: candidate.latitude,
            longitude: candidate.longitude,
          });

    let priority: number | null = null;
    let reason: GeofenceSelectionReason | null = null;

    if (visit !== null && isSameZonedDay(visit, now, timezone)) {
      priority = 1;
      reason = 'VISITA AVUI';
    } else if (
      visit !== null &&
      visit.getTime() > now.getTime() &&
      visit.getTime() - now.getTime() <= upcomingMs
    ) {
      priority = 2;
      reason = 'VISITA PROPERA';
    } else if (candidate.isAssigned === true) {
      priority = 3;
      reason = 'CLIENT ASSIGNAT';
    } else if (candidate.hasHighPriorityTask === true) {
      priority = 4;
      reason = 'TASCA PRIORITARIA';
    } else if (distance !== null && distance <= nearRadius) {
      priority = 5;
      reason = 'PROP DE LA ULTIMA POSICIO';
    } else if (
      lastVisited !== null &&
      now.getTime() - lastVisited.getTime() >= 0 &&
      now.getTime() - lastVisited.getTime() <= recentMs
    ) {
      priority = 6;
      reason = 'VISITAT RECENTMENT';
    } else if (candidate.isPinned === true) {
      priority = 7;
      reason = 'FIXAT MANUALMENT';
    }

    if (priority === null || reason === null) return;
    seen.add(candidate.regionId);

    ranked.push({
      region: {
        regionId: candidate.regionId,
        clientId: candidate.clientId,
        locationId: candidate.locationId,
        latitude: candidate.latitude,
        longitude: candidate.longitude,
        radiusM: candidate.radiusM ?? defaultRadius,
        priority,
        selectionReason: reason,
        distanceMeters: distance,
      },
      index,
      visitAt: visit === null ? null : visit.getTime(),
      lastVisitedAt: lastVisited === null ? null : lastVisited.getTime(),
    });
  });

  ranked.sort((left, right) => {
    if (left.region.priority !== right.region.priority) {
      return left.region.priority - right.region.priority;
    }
    // Within a visit tier: the soonest visit first.
    if (left.region.priority <= 2 && left.visitAt !== null && right.visitAt !== null) {
      if (left.visitAt !== right.visitAt) return left.visitAt - right.visitAt;
    }
    // Within "recently visited": the most recent first.
    if (left.region.priority === 6 && left.lastVisitedAt !== null && right.lastVisitedAt !== null) {
      if (left.lastVisitedAt !== right.lastVisitedAt) return right.lastVisitedAt - left.lastVisitedAt;
    }
    // Otherwise: the nearest first, when we know where we are.
    if (left.region.distanceMeters !== null && right.region.distanceMeters !== null) {
      const diff = left.region.distanceMeters - right.region.distanceMeters;
      if (diff !== 0) return diff;
    }
    return left.index - right.index; // stable
  });

  return ranked.slice(0, maxRegions).map((entry) => entry.region);
}

export interface ArrivalConfidenceInput {
  /** Distance from the region centre, metres. */
  distanceMeters: number;
  /** The region radius, metres. */
  radiusMeters: number;
  now: Date;
  /** Start of the nearest visit at this company, if any. */
  nearestVisitStartsAt?: Date | string | null;
  /** How many companies the position could plausibly belong to. Default 1. */
  candidateClientCount?: number;
  /** Seconds spent inside the region so far, when the OS reports it. */
  dwellSeconds?: number | null;
  /** Device speed at the moment of entry, km/h, when available. */
  speedKmh?: number | null;
}

/**
 * §23.4 — how sure are we that this ENTRADA is a real arrival at this company?
 *
 *   BAIXA    outside the radius, or a fast pass-through (short dwell / driving)
 *   AMBIGUA  several companies share this spot — we do not pick one
 *   ALTA     inside the radius AND a visit within ±2 h
 *   MITJANA  inside the radius, no visit to corroborate it
 *
 * Note the order: AMBIGUA is evaluated BEFORE ALTA. When an industrial estate
 * holds three of our companies, a booked visit does not license us to assert
 * which one the user walked into — the notification asks instead.
 */
export function arrivalConfidence(input: ArrivalConfidenceInput): ArrivalConfidence {
  const inside = input.distanceMeters <= input.radiusMeters;
  if (!inside) return 'BAIXA';

  const dwell = input.dwellSeconds ?? null;
  const speed = input.speedKmh ?? null;
  if (dwell !== null && dwell < PASS_THROUGH_SECONDS) return 'BAIXA';
  if (speed !== null && speed >= PASS_THROUGH_SPEED_KMH) return 'BAIXA';

  if ((input.candidateClientCount ?? 1) > 1) return 'AMBIGUA';

  const visit = toDate(input.nearestVisitStartsAt);
  if (visit !== null && Math.abs(visit.getTime() - input.now.getTime()) <= VISIT_MATCH_WINDOW_MS) {
    return 'ALTA';
  }

  return 'MITJANA';
}

/**
 * Are we still inside the quiet period after the last geofence event for this
 * company? Mirrors `notification_settings.geofence_cooldown_hours`.
 *
 * No previous event means no cooldown. A timestamp in the future (clock skew on
 * the device) is treated as "just happened", i.e. still in cooldown.
 */
export function isInCooldown(
  lastEventAt: Date | string | null | undefined,
  now: Date,
  cooldownHours: number = DEFAULT_COOLDOWN_HOURS,
): boolean {
  const last = toDate(lastEventAt);
  if (last === null) return false;
  const elapsed = now.getTime() - last.getTime();
  if (elapsed < 0) return true;
  return elapsed < cooldownHours * 60 * 60 * 1000;
}

export const geofence = {
  selectRegions,
  arrivalConfidence,
  isInCooldown,
  IOS_MAX_MONITORED_REGIONS,
  GEOFENCE_SELECTION_REASONS,
} as const;
