/**
 * Deep links — the ONE place that turns an outside URL into an in-app route.
 *
 * Three sources produce links into this app and none of them is trustworthy on
 * its own: an arrival notification we built ourselves, a Google Calendar event
 * description, and whatever the OS hands us from a browser. So parsing is
 * deliberately strict:
 *
 *   - only the `vitalpe:` scheme and `https://<allowed host>` are accepted;
 *   - only the two documented paths are accepted;
 *   - every id must look like a UUID.
 *
 * Anything else returns `null` and the app opens INICI. A route is never built
 * by string concatenation at the call site — always through
 * {@link routeForClient} / {@link routeForVisit} — so a malformed id can never
 * reach the router.
 *
 * Pure module: no React, no Expo, no I/O.
 */

export const APP_SCHEME = 'vitalpe';

/** Default Universal Link / App Link host; overridden from `extra.appHost`. */
export const DEFAULT_APP_HOST = 'crm.vitalpe.cat';

/** Lax UUID shape: 8-4-4-4-12 hex. Version/variant nibbles are not policed. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: string | null | undefined): boolean {
  return typeof value === 'string' && UUID_RE.test(value);
}

export interface ArrivalCandidateRef {
  clientId: string;
  locationId: string;
}

export type DeepLinkTarget =
  | { kind: 'CLIENT'; clientId: string; route: string }
  | { kind: 'VISITA'; clientId: string; visitId: string; route: string }
  | { kind: 'ARRIBADA'; candidates: ArrivalCandidateRef[]; route: string };

// ---------------------------------------------------------------------------
// Route builders — the only sanctioned way to produce an in-app path.
// ---------------------------------------------------------------------------

export function routeForClient(clientId: string): string | null {
  return isUuid(clientId) ? `/clients/${clientId.toLowerCase()}` : null;
}

export function routeForVisit(clientId: string, visitId: string): string | null {
  if (!isUuid(clientId) || !isUuid(visitId)) return null;
  return `/clients/${clientId.toLowerCase()}/visits/${visitId.toLowerCase()}`;
}

/**
 * Route for the "which of these companies are you at?" chooser. The candidates
 * travel as `clientId.locationId` pairs — ids only, never a name.
 */
export function routeForArrivalChooser(candidates: readonly ArrivalCandidateRef[]): string | null {
  const pairs = candidates
    .filter((c) => isUuid(c.clientId) && isUuid(c.locationId))
    .map((c) => `${c.clientId.toLowerCase()}.${c.locationId.toLowerCase()}`);
  if (pairs.length === 0) return null;
  return `/arribada?candidats=${pairs.join(',')}`;
}

/** The public https URL for a client card, for sharing out of the app. */
export function webUrlForClient(clientId: string, host: string = DEFAULT_APP_HOST): string | null {
  const route = routeForClient(clientId);
  return route === null ? null : `https://${host}${route}`;
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

interface SplitUrl {
  scheme: string;
  host: string;
  path: string;
  query: string;
}

/**
 * Splits a URL without `new URL`, which is only partially implemented on
 * Hermes. Handles `vitalpe://x`, `vitalpe:///x`, `vitalpe:/x` and `https://h/x`.
 */
function splitUrl(raw: string): SplitUrl | null {
  const trimmed = raw.trim();
  const schemeEnd = trimmed.indexOf(':');
  if (schemeEnd <= 0) return null;
  const scheme = trimmed.slice(0, schemeEnd).toLowerCase();
  if (!/^[a-z][a-z0-9+.-]*$/.test(scheme)) return null;

  let rest = trimmed.slice(schemeEnd + 1);
  let host = '';
  if (rest.startsWith('//')) {
    rest = rest.slice(2);
    // The authority ends at the first '/', '?' or '#'. Splitting only on '/'
    // would swallow the query of an authority-only URL such as
    // `vitalpe://arribada?candidats=…`, leaving the chooser unparseable.
    const end = rest.search(/[/?#]/);
    if (end === -1) {
      host = rest;
      rest = '';
    } else {
      host = rest.slice(0, end);
      rest = rest.slice(end);
    }
  }

  // Strip credentials and port from the authority; strip the fragment.
  const at = host.lastIndexOf('@');
  if (at !== -1) host = host.slice(at + 1);
  const colon = host.indexOf(':');
  if (colon !== -1) host = host.slice(0, colon);

  const hash = rest.indexOf('#');
  if (hash !== -1) rest = rest.slice(0, hash);

  const qmark = rest.indexOf('?');
  const query = qmark === -1 ? '' : rest.slice(qmark + 1);
  const path = qmark === -1 ? rest : rest.slice(0, qmark);

  return { scheme, host: host.toLowerCase(), path, query };
}

function segments(path: string): string[] {
  return path.split('/').filter((s) => s.length > 0);
}

function queryValue(query: string, key: string): string | null {
  for (const part of query.split('&')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (decodeURIComponent(part.slice(0, eq)) !== key) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1));
    } catch {
      return null;
    }
  }
  return null;
}

export interface ParseDeepLinkOptions {
  /** Hosts accepted for `https://` links. Defaults to {@link DEFAULT_APP_HOST}. */
  allowedHosts?: readonly string[];
}

/**
 * Turns an incoming URL into a target, or `null` when it is not one of ours.
 *
 * Accepted:
 *   vitalpe://clients/<uuid>
 *   vitalpe://clients/<uuid>/visits/<uuid>
 *   vitalpe://arribada?candidats=<uuid>.<uuid>[,<uuid>.<uuid>...]
 *   https://<allowed host>/clients/<uuid>[/visits/<uuid>]
 */
export function parseDeepLink(
  url: string | null | undefined,
  options: ParseDeepLinkOptions = {},
): DeepLinkTarget | null {
  if (typeof url !== 'string' || url.length === 0) return null;
  const parts = splitUrl(url);
  if (parts === null) return null;

  if (parts.scheme === 'https' || parts.scheme === 'http') {
    const allowed = (options.allowedHosts ?? [DEFAULT_APP_HOST]).map((h) => h.toLowerCase());
    if (parts.scheme !== 'https') return null; // never trust a plain-text link
    if (!allowed.includes(parts.host)) return null;
  } else if (parts.scheme !== APP_SCHEME) {
    return null;
  }

  // `vitalpe://clients/x` puts "clients" in the authority, not the path.
  const raw =
    parts.scheme === APP_SCHEME && parts.host.length > 0
      ? [parts.host, ...segments(parts.path)]
      : segments(parts.path);

  if (raw.length === 0) return null;

  if (raw[0] === 'arribada') {
    const target = parseArrivalCandidates(queryValue(parts.query, 'candidats'));
    return target;
  }

  if (raw[0] !== 'clients') return null;

  const clientId = raw[1];
  if (clientId === undefined || !isUuid(clientId)) return null;

  if (raw.length === 2) {
    const route = routeForClient(clientId);
    return route === null ? null : { kind: 'CLIENT', clientId: clientId.toLowerCase(), route };
  }

  if (raw.length === 4 && raw[2] === 'visits') {
    const visitId = raw[3];
    if (visitId === undefined || !isUuid(visitId)) return null;
    const route = routeForVisit(clientId, visitId);
    return route === null
      ? null
      : {
          kind: 'VISITA',
          clientId: clientId.toLowerCase(),
          visitId: visitId.toLowerCase(),
          route,
        };
  }

  return null;
}

/** `<uuid>.<uuid>,<uuid>.<uuid>` -> the chooser target. */
export function parseArrivalCandidates(value: string | null): DeepLinkTarget | null {
  if (value === null || value.length === 0) return null;
  const candidates: ArrivalCandidateRef[] = [];
  for (const pair of value.split(',')) {
    const [clientId, locationId] = pair.split('.');
    if (clientId === undefined || locationId === undefined) return null;
    if (!isUuid(clientId) || !isUuid(locationId)) return null;
    candidates.push({ clientId: clientId.toLowerCase(), locationId: locationId.toLowerCase() });
  }
  if (candidates.length === 0) return null;
  const route = routeForArrivalChooser(candidates);
  return route === null ? null : { kind: 'ARRIBADA', candidates, route };
}

/**
 * Validates a route that arrived inside a notification payload before it is
 * handed to the router. Same rules as {@link parseDeepLink}, expressed as a
 * bare path.
 */
export function isSafeInAppRoute(route: string | null | undefined): boolean {
  if (typeof route !== 'string' || !route.startsWith('/')) return false;
  return parseDeepLink(`${APP_SCHEME}:/${route}`) !== null;
}
