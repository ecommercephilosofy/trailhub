/**
 * Background geofencing — the part that must work with the app closed.
 *
 * `TaskManager.defineTask` is called at MODULE SCOPE, on purpose. When the OS
 * wakes the app for a region crossing it boots a fresh JavaScript context and
 * looks for the task by name *immediately*; a task defined inside a component,
 * an effect or a lazy import would not exist yet and the event would be dropped
 * silently. This is the single most common way background geofencing "works in
 * development and never fires in production".
 *
 * The decision itself is not taken here. It is taken by `evaluateArrival()` in
 * `src/core/arrival.ts`, which is pure and unit tested: this file only supplies
 * the device facts (which region fired, where we are, what is cached) and then
 * carries out whatever it decides.
 */
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { evaluateArrival, type MonitoredRegion } from '../core/arrival';
import {
  buildAmbiguousArrivalNotification,
  buildArrivalNotification,
} from '../core/notificationPayload';
import { candidatesFromCache, planRegions, type DevicePlatform } from '../core/regionPlan';
import { DEFAULT_SETTINGS } from '../core/cache';
import { Platform } from 'react-native';
import { present } from './notifications';
import {
  loadCache,
  loadCooldowns,
  loadRegions,
  loadRejected,
  saveRegions,
  stampCooldown,
} from './storage';
import { recordGeofenceEvent } from './api';

export const GEOFENCE_TASK = 'vitalpe-arribada-geofence';

/** Rebuilds the monitored-region view the decision needs, from the cache. */
async function monitoredRegions(now: Date): Promise<MonitoredRegion[]> {
  const cache = await loadCache(now);
  const byClient = new Map(cache.clients.map((c) => [c.id, c]));
  const nextVisit = new Map<string, string>();
  for (const visit of cache.visits) {
    if (visit.status === 'CANCEL·LADA') continue;
    const current = nextVisit.get(visit.clientId);
    if (current === undefined || Date.parse(visit.startsAt) < Date.parse(current)) {
      nextVisit.set(visit.clientId, visit.startsAt);
    }
  }
  const regions: MonitoredRegion[] = [];
  for (const stored of await loadRegions()) {
    const client = byClient.get(stored.clientId);
    regions.push({
      regionId: stored.regionId,
      clientId: stored.clientId,
      locationId: stored.locationId,
      latitude: stored.latitude,
      longitude: stored.longitude,
      radiusM: stored.radiusM,
      ...(client?.name ? { clientName: client.name } : {}),
      nearestVisitStartsAt: nextVisit.get(stored.clientId) ?? null,
    });
  }
  return regions;
}

TaskManager.defineTask<{
  eventType: Location.GeofencingEventType;
  region: Location.LocationRegion;
}>(GEOFENCE_TASK, async ({ data, error }) => {
  if (error) {
    console.warn('[geofence] tasca amb error:', error.message);
    return;
  }
  if (!data?.region?.identifier) return;

  try {
    const now = new Date();
    const cache = await loadCache(now);
    const settings = cache.settings ?? DEFAULT_SETTINGS;
    const regions = await monitoredRegions(now);
    const cooldowns = await loadCooldowns();
    const rejected = await loadRejected();

    const regionId = data.region.identifier;
    const clientId = regions.find((r) => r.regionId === regionId)?.clientId ?? '';

    // A fix is best-effort: on a cold wake the OS may hand us nothing, and
    // `evaluateArrival` treats "no position" as "trust the OS, distance 0".
    let position: { latitude: number; longitude: number } | null = null;
    try {
      const fix = await Location.getLastKnownPositionAsync({ maxAge: 60_000 });
      if (fix) position = { latitude: fix.coords.latitude, longitude: fix.coords.longitude };
    } catch {
      position = null;
    }

    const decision = evaluateArrival({
      regionId,
      eventType:
        data.eventType === Location.GeofencingEventType.Enter ? 'ENTRADA' : 'SORTIDA',
      regions,
      position,
      now,
      lastEventAt: cooldowns[clientId] ?? null,
      rejectedRecently: rejected[clientId] !== undefined,
      settings,
    });

    if (decision.action === 'NOTIFICAR') {
      const notification = buildArrivalNotification({
        clientId: decision.region.clientId,
        locationId: decision.region.locationId,
        clientName: decision.region.clientName ?? '',
        confidence: decision.confidence ?? 'MITJANA',
        hideClientName: settings.hide_client_name_on_lockscreen,
      });
      if (notification) {
        await present(notification);
        await stampCooldown(decision.region.clientId, now);
      }
    } else if (decision.action === 'PREGUNTAR') {
      const notification = buildAmbiguousArrivalNotification({
        candidates: decision.candidates,
        hideClientName: settings.hide_client_name_on_lockscreen,
      });
      if (notification) {
        await present(notification);
        // Every candidate goes on cooldown: the user has been asked once, and
        // asking again for the neighbour thirty seconds later is noise.
        for (const candidate of decision.candidates) {
          await stampCooldown(candidate.clientId, now);
        }
      }
    }

    // The event row is written whatever we decided — including the suppressed
    // ones, because "we saw you arrive and stayed quiet" is the interesting
    // case when someone reports a missing notification.
    if (decision.event) {
      await recordGeofenceEvent({
        ...decision.event,
        notification_shown: decision.action !== 'IGNORAR',
      });
    }
  } catch (e) {
    // Never throw out of a background task: an unhandled rejection here can
    // make the OS stop delivering region events to the app entirely.
    console.warn('[geofence] fallada en processar:', (e as Error).message);
  }
});

export interface GeofenceSyncReport {
  registered: number;
  removed: number;
  unchanged: number;
  capped: boolean;
  eligible: number;
  max: number;
}

/**
 * Recomputes which regions should be monitored and applies the difference.
 *
 * expo-location replaces the whole set on every `startGeofencingAsync`, so the
 * plan's add/remove split is used for reporting and persistence rather than for
 * issuing per-region calls. Re-running with unchanged inputs still produces an
 * empty diff, which is what makes calling this on every foreground cheap.
 */
export async function syncGeofences(now: Date): Promise<GeofenceSyncReport> {
  const cache = await loadCache(now);
  const settings = cache.settings ?? DEFAULT_SETTINGS;
  const current = await loadRegions();

  const candidates = candidatesFromCache({
    clients: cache.clients,
    visits: cache.visits,
    tasks: cache.tasks,
  });

  const plan = planRegions(
    candidates,
    {
      now,
      platform: (Platform.OS as DevicePlatform) ?? 'ios',
      settings,
      ...(cache.lastPlanPosition ? { lastKnownPosition: cache.lastPlanPosition } : {}),
    },
    current,
  );

  const desired = plan.desired.map((r) => ({
    regionId: r.regionId,
    clientId: r.clientId,
    locationId: r.locationId,
    latitude: r.latitude,
    longitude: r.longitude,
    radiusM: r.radiusM,
  }));

  if (desired.length === 0) {
    await stopGeofencing();
  } else {
    await Location.startGeofencingAsync(
      GEOFENCE_TASK,
      desired.map((r) => ({
        identifier: r.regionId,
        latitude: r.latitude,
        longitude: r.longitude,
        radius: r.radiusM,
        notifyOnEnter: true,
        // Exits are monitored so the OS keeps the region warm; the arrival
        // logic ignores them for notification purposes.
        notifyOnExit: true,
      })),
    );
  }
  await saveRegions(desired);

  return {
    registered: plan.toRegister.length,
    removed: plan.toRemove.length,
    unchanged: plan.unchanged.length,
    capped: plan.capped,
    eligible: plan.eligibleCount,
    max: plan.maxRegions,
  };
}

export async function stopGeofencing(): Promise<void> {
  try {
    const running = await Location.hasStartedGeofencingAsync(GEOFENCE_TASK);
    if (running) await Location.stopGeofencingAsync(GEOFENCE_TASK);
  } catch {
    // Nothing to stop.
  }
  await saveRegions([]);
}

export interface LocationPermissionState {
  foreground: boolean;
  background: boolean;
  canAskBackground: boolean;
}

export async function locationPermissionState(): Promise<LocationPermissionState> {
  const fg = await Location.getForegroundPermissionsAsync();
  const bg = await Location.getBackgroundPermissionsAsync();
  return {
    foreground: fg.granted,
    background: bg.granted,
    canAskBackground: bg.canAskAgain !== false,
  };
}

/**
 * Foreground first, then background — in that order, always.
 *
 * iOS refuses "Always" unless "When in use" has already been granted, and asking
 * for both at once is how an app ends up with neither.
 */
export async function requestLocationPermissions(): Promise<LocationPermissionState> {
  const fg = await Location.requestForegroundPermissionsAsync();
  if (!fg.granted) {
    return { foreground: false, background: false, canAskBackground: false };
  }
  const bg = await Location.requestBackgroundPermissionsAsync();
  return {
    foreground: true,
    background: bg.granted,
    canAskBackground: bg.canAskAgain !== false,
  };
}
