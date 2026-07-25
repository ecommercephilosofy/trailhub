/**
 * Device-local persistence.
 *
 * The background geofence task runs in its own JavaScript context: no React,
 * no component state, no live Supabase session guaranteed. Anything it needs to
 * make a decision has to be on disk before the OS wakes it. That is what this
 * module is for — the offline cache, the monitored region set, and the arrival
 * cooldown stamps.
 *
 * None of it is a location history. The only positional thing stored is the
 * last position used to plan regions (so the plan can be reused) and, per
 * company, the instant of the last arrival (so the cooldown works).
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OfflineCache } from '../core/cache';
import { emptyCache, readCache } from '../core/cache';
import type { RegisteredRegion } from '../core/regionPlan';

const KEYS = {
  cache: 'vitalpe.cache.v1',
  regions: 'vitalpe.regions.v1',
  cooldown: 'vitalpe.cooldown.v1',
  rejected: 'vitalpe.rejected.v1',
} as const;

export async function loadCache(now: Date): Promise<OfflineCache> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.cache);
    if (raw === null) return emptyCache(now);
    return readCache(JSON.parse(raw), now);
  } catch {
    // A corrupt cache is discarded, never migrated: stale rules are worse than
    // no rules when they decide what to notify about.
    return emptyCache(now);
  }
}

export async function saveCache(cache: OfflineCache): Promise<void> {
  await AsyncStorage.setItem(KEYS.cache, JSON.stringify(cache));
}

/**
 * A monitored region as stored on the device.
 *
 * It carries `clientId`/`locationId` explicitly rather than leaving them to be
 * recovered by splitting `regionId`: the id format belongs to `regionIdFor()`,
 * and a background task that re-parses it would silently break the day that
 * function changes its separator.
 */
export interface StoredRegion extends RegisteredRegion {
  clientId: string;
  locationId: string;
}

export async function loadRegions(): Promise<StoredRegion[]> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.regions);
    if (raw === null) return [];
    const parsed = JSON.parse(raw) as StoredRegion[];
    return parsed.filter((r) => typeof r?.regionId === 'string' && typeof r?.clientId === 'string');
  } catch {
    return [];
  }
}

export async function saveRegions(regions: readonly StoredRegion[]): Promise<void> {
  await AsyncStorage.setItem(KEYS.regions, JSON.stringify(regions));
}

/** Instant of the last arrival per company, for the cooldown. */
export async function loadCooldowns(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.cooldown);
    return raw === null ? {} : (JSON.parse(raw) as Record<string, string>);
  } catch {
    return {};
  }
}

export async function stampCooldown(clientId: string, at: Date): Promise<void> {
  const current = await loadCooldowns();
  current[clientId] = at.toISOString();
  await AsyncStorage.setItem(KEYS.cooldown, JSON.stringify(current));
}

/** Companies where the user pressed "NO ÉS AQUEST CLIENT" recently. */
export async function loadRejected(): Promise<Record<string, string>> {
  try {
    const raw = await AsyncStorage.getItem(KEYS.rejected);
    return raw === null ? {} : (JSON.parse(raw) as Record<string, string>);
  } catch {
    return {};
  }
}

export async function markRejected(clientId: string, at: Date): Promise<void> {
  const current = await loadRejected();
  current[clientId] = at.toISOString();
  await AsyncStorage.setItem(KEYS.rejected, JSON.stringify(current));
}

export async function clearAllLocalState(): Promise<void> {
  await AsyncStorage.multiRemove([KEYS.cache, KEYS.regions, KEYS.cooldown, KEYS.rejected]);
}
