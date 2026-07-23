/**
 * Turning "everything we know" into "the regions the OS should watch".
 *
 * The prioritisation itself lives in `@vitalpe/domain` (`selectRegions`) and is
 * already tested there; this module is the mobile-side wiring around it:
 *
 *   - the cap. iOS monitors at most 20 regions PER APP — that is an OS limit,
 *     not a policy — so the number actually used is
 *     `min(notification_settings.max_geofence_regions, platform cap)`.
 *   - the diff. Re-registering all twenty regions on every agenda change makes
 *     iOS drop and re-arm every one of them, which loses in-flight entries. So
 *     we compute add/remove/keep and touch only what changed.
 *   - the triggers. The set of moments at which a re-plan is warranted.
 *
 * Pure module: no React, no Expo, no I/O.
 */

import {
  haversineMeters,
  IOS_MAX_MONITORED_REGIONS,
  selectRegions,
  type GeofenceCandidate,
  type SelectedRegion,
  type SelectRegionsOptions,
} from '@vitalpe/domain';

export type DevicePlatform = 'ios' | 'android' | 'web';

/**
 * Hard per-platform ceilings.
 *
 *  - iOS: 20 `CLCircularRegion`s per application. Registering the 21st silently
 *    drops another one, so we never try.
 *  - Android: `GeofencingClient` allows 100 per app.
 *  - web: no background geofencing at all.
 */
export const PLATFORM_REGION_CAPS: Readonly<Record<DevicePlatform, number>> = Object.freeze({
  ios: IOS_MAX_MONITORED_REGIONS,
  android: 100,
  web: 0,
});

/** The moments at which the region set is recomputed (§23.3). */
export const REPLAN_TRIGGERS = [
  'AGENDA_CANVIADA',
  'APP_OBERTA_EN_UN_LLOC_NOU',
  'VISITA_CREADA',
  'VISITA_MODIFICADA',
  'VISITA_COMPLETADA',
  'SINCRONITZACIO_MANUAL',
  'PERMIS_CONCEDIT',
  'AJUSTOS_CANVIATS',
] as const;
export type ReplanTrigger = (typeof REPLAN_TRIGGERS)[number];

/** How far the phone must move before "opened somewhere new" is true. */
export const NEW_PLACE_THRESHOLD_M = 5000;

export interface RegionSettings {
  /** `notification_settings.max_geofence_regions` (1..100, default 20). */
  max_geofence_regions: number;
  /** `notification_settings.geofence_default_radius_m` (50..2000, default 120). */
  geofence_default_radius_m: number;
}

/**
 * The number of regions we may actually register.
 * Never above the platform ceiling, never below zero.
 */
export function resolveMaxRegions(platform: DevicePlatform, settingsMax: number | null | undefined): number {
  const cap = PLATFORM_REGION_CAPS[platform] ?? 0;
  const requested =
    typeof settingsMax === 'number' && Number.isFinite(settingsMax) ? Math.floor(settingsMax) : cap;
  return Math.max(0, Math.min(cap, requested));
}

/**
 * Region id = client + location. Stable across sessions, which is what lets the
 * diff work and what `geofence_registrations.region_id` stores.
 */
export function regionIdFor(clientId: string, locationId: string): string {
  return `${clientId}:${locationId}`;
}

/** The pieces of a region that, if changed, require re-arming it with the OS. */
export interface RegisteredRegion {
  regionId: string;
  latitude: number;
  longitude: number;
  radiusM: number;
}

export interface RegionPlan {
  /** Regions to hand to the OS (new, or changed shape). */
  toRegister: SelectedRegion[];
  /** Region ids to stop monitoring. */
  toRemove: string[];
  /** Already monitored with the same shape: left completely alone. */
  unchanged: SelectedRegion[];
  /** The full desired set, in priority order — what gets persisted. */
  desired: SelectedRegion[];
  /** True when candidates had to be dropped because of the cap. */
  capped: boolean;
  /** How many candidates qualified before the cap was applied. */
  eligibleCount: number;
  maxRegions: number;
}

export interface PlanRegionsOptions extends Omit<SelectRegionsOptions, 'maxRegions'> {
  platform: DevicePlatform;
  settings: RegionSettings;
}

/**
 * Computes the desired region set and the minimal set of OS operations to get
 * there from `current`.
 *
 * Running it twice with the same inputs yields an empty `toRegister` and an
 * empty `toRemove` the second time: re-planning is free when nothing changed.
 */
export function planRegions(
  candidates: readonly GeofenceCandidate[],
  options: PlanRegionsOptions,
  current: readonly RegisteredRegion[] = [],
): RegionPlan {
  const maxRegions = resolveMaxRegions(options.platform, options.settings.max_geofence_regions);
  const selectOptions: SelectRegionsOptions = {
    ...options,
    maxRegions,
    defaultRadiusMeters: options.defaultRadiusMeters ?? options.settings.geofence_default_radius_m,
  };

  // How many WOULD have been selected without the cap, so the UI can be honest
  // about "only 20 of your 46 companies are being watched".
  const eligible = selectRegions(candidates, { ...selectOptions, maxRegions: candidates.length });
  const desired = eligible.slice(0, maxRegions);

  const currentById = new Map<string, RegisteredRegion>();
  for (const region of current) currentById.set(region.regionId, region);

  const toRegister: SelectedRegion[] = [];
  const unchanged: SelectedRegion[] = [];
  const desiredIds = new Set<string>();

  for (const region of desired) {
    desiredIds.add(region.regionId);
    const existing = currentById.get(region.regionId);
    if (existing !== undefined && sameShape(existing, region)) {
      unchanged.push(region);
    } else {
      toRegister.push(region);
    }
  }

  const toRemove: string[] = [];
  for (const region of current) {
    if (!desiredIds.has(region.regionId)) toRemove.push(region.regionId);
  }

  return {
    toRegister,
    toRemove,
    unchanged,
    desired,
    capped: eligible.length > desired.length,
    eligibleCount: eligible.length,
    maxRegions,
  };
}

/** Coordinates within ~1 m and the same radius: no need to re-arm. */
function sameShape(a: RegisteredRegion, b: SelectedRegion): boolean {
  return (
    Math.abs(a.latitude - b.latitude) < 1e-5 &&
    Math.abs(a.longitude - b.longitude) < 1e-5 &&
    Math.round(a.radiusM) === Math.round(b.radiusM)
  );
}

/**
 * Has the phone moved far enough since the last plan that "the app opened
 * somewhere new" is worth a re-plan? Missing information means yes: a plan is
 * cheap, a missed arrival is not.
 */
export function isNewPlace(
  previous: { latitude: number; longitude: number } | null | undefined,
  currentPosition: { latitude: number; longitude: number } | null | undefined,
  thresholdMeters: number = NEW_PLACE_THRESHOLD_M,
  distance: (
    a: { latitude: number; longitude: number },
    b: { latitude: number; longitude: number },
  ) => number = defaultDistance,
): boolean {
  if (previous === null || previous === undefined) return true;
  if (currentPosition === null || currentPosition === undefined) return false;
  return distance(previous, currentPosition) >= thresholdMeters;
}

/** `haversineMeters` is the twin of `app.distance_meters`. */
function defaultDistance(
  a: { latitude: number; longitude: number },
  b: { latitude: number; longitude: number },
): number {
  return haversineMeters(a, b);
}

/**
 * Builds the candidate list from what the phone already has cached: the
 * companies, plus today's / this week's visits, plus the open ALTA tasks.
 *
 * Companies with no coordinates, or with `geofence_enabled = false` on their
 * location, are simply absent — `selectRegions` drops them anyway, but not
 * producing them keeps the count in the UI honest.
 */
export function candidatesFromCache(input: {
  clients: readonly {
    id: string;
    locationId: string | null;
    latitude: number | null;
    longitude: number | null;
    geofenceRadiusM: number | null;
    geofenceEnabled: boolean;
    isAssigned: boolean;
    lastVisitedAt: string | null;
  }[];
  visits: readonly { clientId: string; startsAt: string; status: string }[];
  tasks: readonly { clientId: string | null; priority: string; status: string }[];
  pinnedClientIds?: readonly string[];
}): GeofenceCandidate[] {
  const nextVisitByClient = new Map<string, string>();
  for (const visit of input.visits) {
    if (visit.status === 'CANCEL·LADA') continue;
    const current = nextVisitByClient.get(visit.clientId);
    if (current === undefined || Date.parse(visit.startsAt) < Date.parse(current)) {
      nextVisitByClient.set(visit.clientId, visit.startsAt);
    }
  }

  const highPriority = new Set<string>();
  for (const task of input.tasks) {
    if (task.clientId === null) continue;
    if (task.status !== 'PENDENT' || task.priority !== 'ALTA') continue;
    highPriority.add(task.clientId);
  }

  const pinned = new Set(input.pinnedClientIds ?? []);

  const candidates: GeofenceCandidate[] = [];
  for (const client of input.clients) {
    if (client.locationId === null) continue;
    if (client.latitude === null || client.longitude === null) continue;
    if (!client.geofenceEnabled) continue;
    candidates.push({
      regionId: regionIdFor(client.id, client.locationId),
      clientId: client.id,
      locationId: client.locationId,
      latitude: client.latitude,
      longitude: client.longitude,
      radiusM: client.geofenceRadiusM ?? undefined,
      geofenceEnabled: true,
      visitStartsAt: nextVisitByClient.get(client.id) ?? null,
      isAssigned: client.isAssigned,
      hasHighPriorityTask: highPriority.has(client.id),
      lastVisitedAt: client.lastVisitedAt,
      isPinned: pinned.has(client.id),
    });
  }
  return candidates;
}

/**
 * The row shape `public.geofence_registrations` expects. Kept here so the
 * column names are checked against the schema in one place.
 */
export interface GeofenceRegistrationRow {
  workspace_id: string;
  user_id: string;
  device_id: string | null;
  client_id: string;
  location_id: string;
  region_id: string;
  radius_m: number;
  priority: number;
  selection_reason: string;
  status: 'ACTIVA' | 'RETIRADA' | 'CADUCADA';
}

export function toRegistrationRows(
  regions: readonly SelectedRegion[],
  context: { workspaceId: string; userId: string; deviceId: string | null },
): GeofenceRegistrationRow[] {
  return regions.map((region) => ({
    workspace_id: context.workspaceId,
    user_id: context.userId,
    device_id: context.deviceId,
    client_id: region.clientId,
    location_id: region.locationId,
    region_id: region.regionId,
    radius_m: Math.round(region.radiusM),
    priority: region.priority,
    selection_reason: region.selectionReason,
    status: 'ACTIVA',
  }));
}
