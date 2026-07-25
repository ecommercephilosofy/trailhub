/**
 * Reads the working set the phone needs, through the user's own session.
 *
 * Every query here runs with the signed-in user's JWT, so Row Level Security
 * applies exactly as it does on the web. The phone never holds a service-role
 * key — there is no code path here that could.
 *
 * What it pulls is deliberately small: today's and the coming week's visits,
 * open tasks, and the companies that could plausibly be visited. That is the
 * same set the geofence planner needs, so one refresh feeds both the screens
 * and the region plan.
 */
import { supabase } from './supabase';
import type { CachedClient, CachedSettings, CachedTask, CachedVisit } from '../core/cache';
import { DEFAULT_SETTINGS } from '../core/cache';

export interface WorkingSet {
  clients: CachedClient[];
  visits: CachedVisit[];
  tasks: CachedTask[];
  settings: CachedSettings;
}

/** Companies worth caching: assigned to me, or with a visit/open task. */
const CLIENT_LIMIT = 300;

export async function fetchWorkingSet(now: Date): Promise<WorkingSet> {
  const db = supabase();
  const cachedAt = now.toISOString();
  const from = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const to = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000).toISOString();

  const [clientRes, visitRes, taskRes, settingsRes] = await Promise.all([
    db
      .from('clients')
      .select(
        'id, name, municipality, confirmed_classification, proposed_classification, phone, email, owner_id,' +
          ' client_locations!left(id, latitude, longitude, geofence_radius_m, geofence_enabled, is_primary, deleted_at)',
      )
      .is('deleted_at', null)
      .limit(CLIENT_LIMIT),
    db
      .from('visits')
      .select('id, client_id, location_id, starts_at, ends_at, status, objective, updated_at, clients!inner(name)')
      .is('deleted_at', null)
      .gte('starts_at', from)
      .lte('starts_at', to)
      .order('starts_at'),
    db
      .from('tasks')
      .select('id, client_id, action, other_action, title, due_at, priority, status, visit_id, updated_at, clients!left(name)')
      .is('deleted_at', null)
      .eq('status', 'PENDENT')
      .limit(400),
    db.from('notification_settings').select('*').maybeSingle(),
  ]);

  if (clientRes.error) throw new Error(clientRes.error.message);
  if (visitRes.error) throw new Error(visitRes.error.message);
  if (taskRes.error) throw new Error(taskRes.error.message);

  type LocationRow = {
    id: string;
    latitude: number | null;
    longitude: number | null;
    geofence_radius_m: number | null;
    geofence_enabled: boolean | null;
    is_primary: boolean | null;
    deleted_at: string | null;
  };

  const clients: CachedClient[] = (clientRes.data ?? []).map((row) => {
    const locations = ((row as { client_locations?: LocationRow[] }).client_locations ?? []).filter(
      (l) => l.deleted_at === null,
    );
    // The primary location wins; failing that, the first one that actually has
    // coordinates. A location without them is never used to build a geofence.
    const primary =
      locations.find((l) => l.is_primary === true && l.latitude !== null) ??
      locations.find((l) => l.latitude !== null) ??
      null;
    const r = row as unknown as {
      id: string; name: string; municipality: string | null;
      confirmed_classification: string | null; proposed_classification: string | null;
      phone: string | null; email: string | null; owner_id: string | null;
    };
    return {
      id: r.id,
      name: r.name,
      municipality: r.municipality,
      classification: r.confirmed_classification ?? r.proposed_classification,
      phone: r.phone,
      email: r.email,
      locationId: primary?.id ?? null,
      latitude: primary?.latitude ?? null,
      longitude: primary?.longitude ?? null,
      geofenceRadiusM: primary?.geofence_radius_m ?? null,
      geofenceEnabled: primary?.geofence_enabled !== false,
      isAssigned: true,
      lastVisitedAt: null,
      cachedAt,
    };
  });

  const visits: CachedVisit[] = (visitRes.data ?? []).map((row) => {
    const r = row as unknown as {
      id: string; client_id: string; location_id: string | null; starts_at: string;
      ends_at: string; status: string; objective: string | null; updated_at: string;
      clients?: { name?: string } | { name?: string }[];
    };
    const joined = Array.isArray(r.clients) ? r.clients[0] : r.clients;
    const client = clients.find((c) => c.id === r.client_id);
    return {
      id: r.id,
      clientId: r.client_id,
      clientName: joined?.name ?? client?.name ?? '',
      locationId: r.location_id,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      status: r.status,
      objective: r.objective,
      address: client?.municipality ?? null,
      latitude: client?.latitude ?? null,
      longitude: client?.longitude ?? null,
      updatedAt: r.updated_at,
    };
  });

  const tasks: CachedTask[] = (taskRes.data ?? []).map((row) => {
    const r = row as unknown as {
      id: string; client_id: string | null; action: string; other_action: string | null;
      title: string | null; due_at: string | null; priority: string; status: string;
      visit_id: string | null; updated_at: string;
      clients?: { name?: string } | { name?: string }[];
    };
    const joined = Array.isArray(r.clients) ? r.clients[0] : r.clients;
    return {
      id: r.id,
      clientId: r.client_id,
      clientName: joined?.name ?? null,
      action: r.other_action ?? r.action,
      title: r.title,
      dueAt: r.due_at,
      priority: r.priority,
      status: r.status,
      visitId: r.visit_id,
      updatedAt: r.updated_at,
    };
  });

  // Settings are optional: a workspace with no row uses the documented
  // defaults rather than failing to plan any region at all.
  const s = settingsRes.data as Partial<CachedSettings> | null;
  const settings: CachedSettings = {
    notify_client_arrival: s?.notify_client_arrival ?? DEFAULT_SETTINGS.notify_client_arrival,
    geofence_cooldown_hours:
      s?.geofence_cooldown_hours ?? DEFAULT_SETTINGS.geofence_cooldown_hours,
    hide_client_name_on_lockscreen:
      s?.hide_client_name_on_lockscreen ?? DEFAULT_SETTINGS.hide_client_name_on_lockscreen,
    max_geofence_regions: s?.max_geofence_regions ?? DEFAULT_SETTINGS.max_geofence_regions,
    geofence_default_radius_m:
      s?.geofence_default_radius_m ?? DEFAULT_SETTINGS.geofence_default_radius_m,
  };

  return { clients, visits, tasks, settings };
}

/** One company, for the card opened from a notification. */
export async function fetchClient(clientId: string): Promise<CachedClient | null> {
  const db = supabase();
  const { data, error } = await db
    .from('clients')
    .select(
      'id, name, municipality, confirmed_classification, proposed_classification, phone, email,' +
        ' client_locations!left(id, latitude, longitude, geofence_radius_m, geofence_enabled, is_primary, deleted_at)',
    )
    .eq('id', clientId)
    .is('deleted_at', null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;

  const locations = ((data as { client_locations?: { id: string; latitude: number | null; longitude: number | null; geofence_radius_m: number | null; geofence_enabled: boolean | null; is_primary: boolean | null; deleted_at: string | null }[] }).client_locations ?? []).filter((l) => l.deleted_at === null);
  const primary =
    locations.find((l) => l.is_primary === true && l.latitude !== null) ??
    locations.find((l) => l.latitude !== null) ??
    null;
  const r = data as unknown as {
    id: string; name: string; municipality: string | null;
    confirmed_classification: string | null; proposed_classification: string | null;
    phone: string | null; email: string | null;
  };
  return {
    id: r.id,
    name: r.name,
    municipality: r.municipality,
    classification: r.confirmed_classification ?? r.proposed_classification,
    phone: r.phone,
    email: r.email,
    locationId: primary?.id ?? null,
    latitude: primary?.latitude ?? null,
    longitude: primary?.longitude ?? null,
    geofenceRadiusM: primary?.geofence_radius_m ?? null,
    geofenceEnabled: primary?.geofence_enabled !== false,
    isAssigned: true,
    lastVisitedAt: null,
    cachedAt: new Date().toISOString(),
  };
}

/** Records that an arrival notification was shown / opened. */
export async function recordGeofenceEvent(draft: {
  client_id: string | null;
  location_id: string | null;
  event_type: string;
  occurred_at: string;
  notification_shown: boolean;
  client_opened: boolean;
  rejected_by_user: boolean;
  confidence: string;
}): Promise<void> {
  const db = supabase();
  const { error } = await db.from('geofence_events').insert(draft);
  // A failed telemetry write must never break the arrival flow.
  if (error) console.warn('[geofence] no s\'ha pogut desar l\'esdeveniment:', error.message);
}
