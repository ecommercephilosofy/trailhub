/**
 * What the app keeps on the phone so it works with no signal.
 *
 * Scope is deliberately small — today's visits, the user's own tasks, the
 * companies they have touched recently, and their notification settings. Not
 * the whole CRM. A stolen phone should give up a working day, not a customer
 * database, and the mobile tables are strictly personal in RLS anyway
 * (`user_id = auth.uid()`), so a wider cache could not be refilled without a
 * session.
 *
 * The cache is a plain JSON value with a schema version. A version bump throws
 * the old shape away rather than trying to migrate it: a stale cache is never
 * worth a migration bug, because everything in it is re-fetchable.
 *
 * Pure module: no React, no Expo, no I/O.
 */

import { normalizeText, unaccentCa } from '@vitalpe/domain';
import type { ArrivalSettings } from './arrival.js';
import type { RegionSettings } from './regionPlan.js';

export const CACHE_VERSION = 1;

/** How many companies are kept for offline search (most recent first). */
export const RECENT_CLIENTS_LIMIT = 300;

/** The cache is shown with a warning past this age. */
export const STALE_AFTER_MS = 12 * 60 * 60 * 1000;

export interface CachedClient {
  id: string;
  name: string;
  municipality: string | null;
  classification: string | null;
  phone: string | null;
  email: string | null;
  /** Primary location, when it has coordinates. */
  locationId: string | null;
  latitude: number | null;
  longitude: number | null;
  geofenceRadiusM: number | null;
  geofenceEnabled: boolean;
  isAssigned: boolean;
  lastVisitedAt: string | null;
  /** When this row was last refreshed from the server. */
  cachedAt: string;
}

export interface CachedVisit {
  id: string;
  clientId: string;
  clientName: string;
  locationId: string | null;
  startsAt: string;
  endsAt: string;
  status: string;
  objective: string | null;
  address: string | null;
  latitude: number | null;
  longitude: number | null;
  updatedAt: string;
}

export interface CachedTask {
  id: string;
  clientId: string | null;
  clientName: string | null;
  action: string;
  title: string | null;
  dueAt: string | null;
  priority: string;
  status: string;
  visitId: string | null;
  updatedAt: string;
}

export type CachedSettings = ArrivalSettings & RegionSettings;

export interface OfflineCache {
  version: number;
  savedAt: string;
  visits: CachedVisit[];
  tasks: CachedTask[];
  clients: CachedClient[];
  settings: CachedSettings | null;
  /** Last position used for a region plan; NOT a movement history. */
  lastPlanPosition: { latitude: number; longitude: number } | null;
}

export const DEFAULT_SETTINGS: CachedSettings = Object.freeze({
  notify_client_arrival: true,
  geofence_cooldown_hours: 6,
  hide_client_name_on_lockscreen: false,
  max_geofence_regions: 20,
  geofence_default_radius_m: 120,
});

export function emptyCache(now: Date): OfflineCache {
  return {
    version: CACHE_VERSION,
    savedAt: now.toISOString(),
    visits: [],
    tasks: [],
    clients: [],
    settings: null,
    lastPlanPosition: null,
  };
}

/** An unknown or older schema is discarded, not migrated. */
export function readCache(raw: unknown, now: Date): OfflineCache {
  if (typeof raw !== 'object' || raw === null) return emptyCache(now);
  const candidate = raw as Partial<OfflineCache>;
  if (candidate.version !== CACHE_VERSION) return emptyCache(now);
  return {
    version: CACHE_VERSION,
    savedAt: typeof candidate.savedAt === 'string' ? candidate.savedAt : now.toISOString(),
    visits: Array.isArray(candidate.visits) ? candidate.visits : [],
    tasks: Array.isArray(candidate.tasks) ? candidate.tasks : [],
    clients: Array.isArray(candidate.clients) ? candidate.clients : [],
    settings: candidate.settings ?? null,
    lastPlanPosition: candidate.lastPlanPosition ?? null,
  };
}

export function isStale(cache: OfflineCache, now: Date, maxAgeMs: number = STALE_AFTER_MS): boolean {
  const at = Date.parse(cache.savedAt);
  if (Number.isNaN(at)) return true;
  return now.getTime() - at >= maxAgeMs;
}

/**
 * Merges freshly fetched companies into the cache, most recently seen first,
 * capped at {@link RECENT_CLIENTS_LIMIT}. The cap is what stops the cache from
 * quietly becoming a full export of the CRM.
 */
export function mergeClients(
  cached: readonly CachedClient[],
  fresh: readonly CachedClient[],
  limit: number = RECENT_CLIENTS_LIMIT,
): CachedClient[] {
  const merged: CachedClient[] = [];
  const seen = new Set<string>();
  for (const client of [...fresh, ...cached]) {
    if (seen.has(client.id)) continue;
    seen.add(client.id);
    merged.push(client);
    if (merged.length >= limit) break;
  }
  return merged;
}

/**
 * Offline company search. Accent- and case-insensitive, matching on any word,
 * using the same `normalizeText` the database uses for `name_norm` so the
 * offline result set is a subset of the online one rather than a different one.
 */
export function searchClients(
  clients: readonly CachedClient[],
  term: string,
  limit = 50,
): CachedClient[] {
  const needle = normalizeText(term);
  if (needle === null) return clients.slice(0, limit);
  const words = needle.split(' ').filter((w) => w.length > 0);
  if (words.length === 0) return clients.slice(0, limit);

  const results: CachedClient[] = [];
  for (const client of clients) {
    const haystack = `${normalizeText(client.name) ?? ''} ${
      unaccentCa(client.municipality ?? '').toLowerCase()
    }`;
    if (words.every((word) => haystack.includes(word))) {
      results.push(client);
      if (results.length >= limit) break;
    }
  }
  return results;
}

/** Today's visits, in start order, from whatever the cache holds. */
export function visitsOn(
  visits: readonly CachedVisit[],
  day: Date,
  isSameDay: (a: Date, b: Date) => boolean,
): CachedVisit[] {
  return visits
    .filter((visit) => {
      const start = new Date(visit.startsAt);
      return !Number.isNaN(start.getTime()) && isSameDay(start, day);
    })
    .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
}
