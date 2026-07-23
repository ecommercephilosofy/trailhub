/**
 * Google Calendar API v3 adapter — plain `fetch`, no googleapis SDK.
 *
 * ## Scopes
 *
 * Two scopes, and a justification for each:
 *
 *  - `https://www.googleapis.com/auth/calendar.events`
 *    Read and write **events only**. This is what bidirectional visit sync
 *    needs: create, update, delete and watch events. It deliberately does not
 *    grant access to the user's calendar settings, sharing rules or ACLs.
 *
 *  - `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
 *    Read-only list of the user's calendars, so the connection screen can ask
 *    *which* calendar to sync into instead of silently assuming `primary`.
 *
 * Anything broader (`calendar`, `calendar.readonly`) would hand us the user's
 * entire personal agenda, which this product has no business reading.
 *
 * `createCalendar()` is the one operation those two scopes cannot perform:
 * creating a calendar requires `calendar.app.created` (a calendar the app owns
 * and can only see its own). That scope is requested **only** when the user
 * explicitly opts into a dedicated "Visites Vitalpe" calendar, via
 * {@link buildAuthorizationUrl} with `includeCalendarCreation: true`. The
 * default connection flow never asks for it.
 *
 * ## Identity
 *
 * Every event carries private extended properties `crmWorkspaceId`,
 * `crmClientId`, `crmVisitId` and `crmTaskId`. Events are matched by those and
 * never by title: titles are user-editable, get translated, get typo'd, and
 * two clients can legitimately share a name.
 *
 * ## Failure handling
 *
 *  - 401 → refresh the access token once, retry once, then give up.
 *  - 403 → rate-limit reasons back off with jitter; anything else is a real
 *          permission error and is not retried.
 *  - 404 → the event is gone. Reported as {@link EventGoneError}; `getEvent`
 *          resolves to `null` instead of throwing.
 *  - 410 → the sync token is dead. {@link SyncTokenInvalidError} tells the
 *          caller to drop it and run a full resync.
 *  - 412 → someone wrote first. {@link EtagConflictError}.
 *  - 429/5xx → exponential backoff with full jitter, bounded.
 */
import {
  DEFAULT_RETRY,
  parseRetryAfter,
  readBodySafely,
  requestWithRetry,
  systemClock,
  type Clock,
  type FetchLike,
  type RetryDecision,
  type RetryPolicy,
} from '../util/http';
import { redact } from '../util/redact';
import {
  CalendarAuthError,
  CalendarError,
  CalendarPermissionError,
  EtagConflictError,
  EventGoneError,
  SyncTokenInvalidError,
  type CalendarProvider,
  type CalendarSummary,
  type ChangeList,
  type CrmEvent,
  type DeleteOptions,
  type ListChangedOptions,
  type RemoteEvent,
  type UpdateOptions,
  type WatchChannel,
} from './types';

export const CALENDAR_API_BASE = 'https://www.googleapis.com/calendar/v3';
export const OAUTH_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const OAUTH_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
export const OAUTH_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

/** The minimal scope set. See the module comment for the justification. */
export const GOOGLE_CALENDAR_SCOPES = [
  'https://www.googleapis.com/auth/calendar.events',
  'https://www.googleapis.com/auth/calendar.calendarlist.readonly',
] as const;

/** Only requested when the user opts into a dedicated CRM calendar. */
export const GOOGLE_CALENDAR_CREATION_SCOPE =
  'https://www.googleapis.com/auth/calendar.app.created';

/** Google's maximum watch channel TTL for calendar resources. */
export const WATCH_TTL_SECONDS = 7 * 24 * 60 * 60;

// ---------------------------------------------------------------------------
// OAuth
// ---------------------------------------------------------------------------

export interface GoogleOAuthConfig {
  readonly clientId: string;
  readonly clientSecret: string;
  readonly redirectUri: string;
}

export interface GoogleTokens {
  readonly accessToken: string;
  readonly refreshToken?: string;
  /** ISO-8601 instant. */
  readonly expiresAt?: string;
  readonly scopes?: readonly string[];
}

export interface AuthorizationUrlOptions {
  /** Opaque CSRF/state value. Required. */
  readonly state: string;
  readonly loginHint?: string;
  /** Adds `calendar.app.created` so the app can create its own calendar. */
  readonly includeCalendarCreation?: boolean;
}

export function buildAuthorizationUrl(
  config: GoogleOAuthConfig,
  options: AuthorizationUrlOptions,
): string {
  const scopes = options.includeCalendarCreation
    ? [...GOOGLE_CALENDAR_SCOPES, GOOGLE_CALENDAR_CREATION_SCOPE]
    : [...GOOGLE_CALENDAR_SCOPES];
  const url = new URL(OAUTH_AUTH_ENDPOINT);
  url.searchParams.set('client_id', config.clientId);
  url.searchParams.set('redirect_uri', config.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', scopes.join(' '));
  // Offline access + consent: without both, Google stops returning a refresh
  // token on re-authorisation and background sync silently dies after an hour.
  url.searchParams.set('access_type', 'offline');
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('include_granted_scopes', 'true');
  url.searchParams.set('state', options.state);
  if (options.loginHint) url.searchParams.set('login_hint', options.loginHint);
  return url.toString();
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  scope?: string;
  token_type?: string;
  error?: string;
  error_description?: string;
}

async function postToken(
  fetchImpl: FetchLike,
  body: URLSearchParams,
  clock: Clock,
): Promise<GoogleTokens> {
  const response = await fetchImpl(OAUTH_TOKEN_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });
  const text = await readBodySafely(response, 4000);
  let payload: TokenResponse = {};
  try {
    payload = JSON.parse(text) as TokenResponse;
  } catch {
    /* keep the empty payload; the status check below reports it */
  }
  if (!response.ok || !payload.access_token) {
    throw new CalendarAuthError(
      `Google ha rebutjat la petició de testimoni (${response.status}): ${
        payload.error_description ?? payload.error ?? 'motiu desconegut'
      }`,
      response.status,
    );
  }
  const expiresAt =
    payload.expires_in === undefined
      ? undefined
      : new Date(clock.now().getTime() + payload.expires_in * 1000).toISOString();
  return {
    accessToken: payload.access_token,
    ...(payload.refresh_token === undefined ? {} : { refreshToken: payload.refresh_token }),
    ...(expiresAt === undefined ? {} : { expiresAt }),
    ...(payload.scope === undefined ? {} : { scopes: payload.scope.split(' ') }),
  };
}

/** Authorization-code exchange. */
export async function exchangeAuthorizationCode(
  config: GoogleOAuthConfig,
  code: string,
  deps: { fetch?: FetchLike; clock?: Clock } = {},
): Promise<GoogleTokens> {
  const fetchImpl = deps.fetch ?? (globalThis.fetch as FetchLike);
  const clock = deps.clock ?? systemClock;
  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  });
  return postToken(fetchImpl, body, clock);
}

/** Offline refresh. Google does not return a new refresh token here. */
export async function refreshAccessToken(
  config: GoogleOAuthConfig,
  refreshToken: string,
  deps: { fetch?: FetchLike; clock?: Clock } = {},
): Promise<GoogleTokens> {
  const fetchImpl = deps.fetch ?? (globalThis.fetch as FetchLike);
  const clock = deps.clock ?? systemClock;
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    grant_type: 'refresh_token',
  });
  const tokens = await postToken(fetchImpl, body, clock);
  // Carry the existing refresh token forward: the response omits it.
  return tokens.refreshToken ? tokens : { ...tokens, refreshToken };
}

export async function revokeToken(
  token: string,
  deps: { fetch?: FetchLike } = {},
): Promise<void> {
  const fetchImpl = deps.fetch ?? (globalThis.fetch as FetchLike);
  await fetchImpl(OAUTH_REVOKE_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ token }).toString(),
  });
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export interface GoogleCalendarProviderOptions {
  readonly config: GoogleOAuthConfig;
  readonly tokens: GoogleTokens;
  /** Injectable for tests. Defaults to the global `fetch`. */
  readonly fetch?: FetchLike;
  readonly clock?: Clock;
  readonly retry?: RetryPolicy;
  /** Called whenever a refresh produces new tokens, so they can be re-encrypted. */
  readonly onTokensRefreshed?: (tokens: GoogleTokens) => Promise<void> | void;
  readonly defaultTimeZone?: string;
  /** Secret echoed back in every push notification. */
  readonly verificationTokenFactory?: () => string;
  readonly channelIdFactory?: () => string;
}

interface GoogleEventResource {
  id?: string;
  etag?: string;
  updated?: string;
  status?: string;
  summary?: string;
  location?: string;
  description?: string;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  htmlLink?: string;
  extendedProperties?: { private?: Record<string, string>; shared?: Record<string, string> };
}

export class GoogleCalendarProvider implements CalendarProvider {
  readonly name = 'google';

  private readonly config: GoogleOAuthConfig;
  private tokens: GoogleTokens;
  private readonly fetchImpl: FetchLike;
  private readonly clock: Clock;
  private readonly retry: RetryPolicy;
  private readonly onTokensRefreshed: ((tokens: GoogleTokens) => Promise<void> | void) | undefined;
  private readonly defaultTimeZone: string;
  private readonly verificationTokenFactory: () => string;
  private readonly channelIdFactory: () => string;

  constructor(options: GoogleCalendarProviderOptions) {
    this.config = options.config;
    this.tokens = options.tokens;
    this.fetchImpl = options.fetch ?? (globalThis.fetch as FetchLike);
    this.clock = options.clock ?? systemClock;
    this.retry = options.retry ?? DEFAULT_RETRY;
    this.onTokensRefreshed = options.onTokensRefreshed;
    this.defaultTimeZone = options.defaultTimeZone ?? 'Europe/Madrid';
    this.verificationTokenFactory =
      options.verificationTokenFactory ?? (() => cryptoRandomToken());
    this.channelIdFactory = options.channelIdFactory ?? (() => cryptoRandomToken());
  }

  currentTokens(): GoogleTokens {
    return this.tokens;
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  async createEvent(calendarId: string, event: CrmEvent): Promise<RemoteEvent> {
    const response = await this.request(
      `/calendars/${enc(calendarId)}/events`,
      { method: 'POST', body: JSON.stringify(this.toGoogleEvent(event)) },
      { context: `crear l'esdeveniment de la visita ${event.visitId}` },
    );
    return this.toRemoteEvent(calendarId, await parseJson<GoogleEventResource>(response));
  }

  async updateEvent(
    calendarId: string,
    eventId: string,
    event: CrmEvent,
    options: UpdateOptions = {},
  ): Promise<RemoteEvent> {
    const headers: Record<string, string> = {};
    // Optimistic concurrency: never blind-overwrite a change we have not seen.
    if (options.etag) headers['If-Match'] = options.etag;
    const response = await this.request(
      `/calendars/${enc(calendarId)}/events/${enc(eventId)}`,
      { method: 'PUT', headers, body: JSON.stringify(this.toGoogleEvent(event)) },
      { context: `actualitzar l'esdeveniment ${eventId}`, eventId },
    );
    return this.toRemoteEvent(calendarId, await parseJson<GoogleEventResource>(response));
  }

  async deleteEvent(
    calendarId: string,
    eventId: string,
    options: DeleteOptions = {},
  ): Promise<void> {
    const headers: Record<string, string> = {};
    if (options.etag) headers['If-Match'] = options.etag;
    const query = new URLSearchParams({
      sendUpdates: options.sendUpdates ? 'all' : 'none',
    });
    await this.request(
      `/calendars/${enc(calendarId)}/events/${enc(eventId)}?${query.toString()}`,
      { method: 'DELETE', headers },
      { context: `esborrar l'esdeveniment ${eventId}`, eventId },
    );
  }

  async getEvent(calendarId: string, eventId: string): Promise<RemoteEvent | null> {
    const response = await this.request(
      `/calendars/${enc(calendarId)}/events/${enc(eventId)}`,
      { method: 'GET' },
      { context: `llegir l'esdeveniment ${eventId}`, eventId, notFoundAsNull: true },
    );
    if (response.status === 404 || response.status === 410) return null;
    return this.toRemoteEvent(calendarId, await parseJson<GoogleEventResource>(response));
  }

  async listChanged(options: ListChangedOptions): Promise<ChangeList> {
    const query = new URLSearchParams();
    if (options.syncToken) {
      query.set('syncToken', options.syncToken);
    } else {
      // A full sync must still be bounded, or a decade-old calendar is pulled.
      query.set('showDeleted', 'true');
    }
    if (options.pageToken) query.set('pageToken', options.pageToken);
    query.set('showDeleted', 'true');
    query.set('singleEvents', 'true');
    query.set('maxResults', String(options.maxResults ?? 250));
    if (options.workspaceId) {
      // Server-side filter on our own private property: never pulls events
      // this CRM did not create.
      query.set('privateExtendedProperty', `crmWorkspaceId=${options.workspaceId}`);
    }

    const response = await this.request(
      `/calendars/${enc(options.calendarId)}/events?${query.toString()}`,
      { method: 'GET' },
      { context: 'sincronitzar els canvis del calendari' },
    );
    const payload = await parseJson<{
      items?: GoogleEventResource[];
      nextSyncToken?: string;
      nextPageToken?: string;
    }>(response);

    return {
      events: (payload.items ?? []).map((item) => this.toRemoteEvent(options.calendarId, item)),
      ...(payload.nextSyncToken === undefined ? {} : { nextSyncToken: payload.nextSyncToken }),
      ...(payload.nextPageToken === undefined ? {} : { nextPageToken: payload.nextPageToken }),
    };
  }

  // -------------------------------------------------------------------------
  // Watch channels
  // -------------------------------------------------------------------------

  async watch(calendarId: string, webhookUrl: string): Promise<WatchChannel> {
    const channelId = this.channelIdFactory();
    const verificationToken = this.verificationTokenFactory();
    const response = await this.request(
      `/calendars/${enc(calendarId)}/events/watch`,
      {
        method: 'POST',
        body: JSON.stringify({
          id: channelId,
          type: 'web_hook',
          address: webhookUrl,
          token: verificationToken,
          params: { ttl: String(WATCH_TTL_SECONDS) },
        }),
      },
      { context: 'obrir el canal d’avisos del calendari' },
    );
    const payload = await parseJson<{ id?: string; resourceId?: string; expiration?: string }>(
      response,
    );
    if (!payload.resourceId) {
      throw new CalendarError('Google no ha retornat cap resourceId per al canal d’avisos.');
    }
    const expiration = payload.expiration
      ? new Date(Number(payload.expiration)).toISOString()
      : new Date(this.clock.now().getTime() + WATCH_TTL_SECONDS * 1000).toISOString();

    return {
      channelId: payload.id ?? channelId,
      resourceId: payload.resourceId,
      verificationToken,
      expiresAt: expiration,
      calendarId,
    };
  }

  async stopWatch(channel: Pick<WatchChannel, 'channelId' | 'resourceId'>): Promise<void> {
    await this.request(
      '/channels/stop',
      {
        method: 'POST',
        body: JSON.stringify({ id: channel.channelId, resourceId: channel.resourceId }),
      },
      { context: 'tancar el canal d’avisos', notFoundAsNull: true },
    );
  }

  // -------------------------------------------------------------------------
  // Calendars
  // -------------------------------------------------------------------------

  async createCalendar(name: string): Promise<CalendarSummary> {
    const response = await this.request(
      '/calendars',
      {
        method: 'POST',
        body: JSON.stringify({ summary: name, timeZone: this.defaultTimeZone }),
      },
      { context: 'crear el calendari' },
    );
    const payload = await parseJson<{ id?: string; summary?: string; timeZone?: string }>(response);
    if (!payload.id) throw new CalendarError('Google no ha retornat cap identificador de calendari.');
    return {
      id: payload.id,
      summary: payload.summary ?? name,
      primary: false,
      timeZone: payload.timeZone ?? this.defaultTimeZone,
      accessRole: 'owner',
    };
  }

  async listCalendars(): Promise<readonly CalendarSummary[]> {
    const response = await this.request(
      '/users/me/calendarList?minAccessRole=writer&showHidden=false',
      { method: 'GET' },
      { context: 'llistar els calendaris' },
    );
    const payload = await parseJson<{
      items?: Array<{
        id?: string;
        summary?: string;
        primary?: boolean;
        timeZone?: string;
        accessRole?: string;
      }>;
    }>(response);
    return (payload.items ?? [])
      .filter((item): item is { id: string } & typeof item => typeof item.id === 'string')
      .map((item) => ({
        id: item.id,
        summary: item.summary ?? item.id,
        ...(item.primary === undefined ? {} : { primary: item.primary }),
        ...(item.timeZone === undefined ? {} : { timeZone: item.timeZone }),
        ...(item.accessRole === undefined ? {} : { accessRole: item.accessRole }),
      }));
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async request(
    path: string,
    init: RequestInit,
    meta: { context: string; eventId?: string; notFoundAsNull?: boolean },
  ): Promise<Response> {
    await this.ensureFreshToken();

    const send = (): Promise<Response> =>
      this.fetchImpl(`${CALENDAR_API_BASE}${path}`, {
        ...init,
        headers: {
          authorization: `Bearer ${this.tokens.accessToken}`,
          'content-type': 'application/json',
          accept: 'application/json',
          ...(init.headers as Record<string, string> | undefined),
        },
      });

    const classify = async (response: Response): Promise<RetryDecision> => {
      if (response.ok) return { kind: 'return' };

      switch (response.status) {
        case 401:
          // Stale access token: refresh once, then retry once.
          return this.tokens.refreshToken
            ? { kind: 'refresh' }
            : {
                kind: 'fail',
                error: new CalendarAuthError(
                  `Google ha rebutjat l'autenticació en ${meta.context}. Cal tornar a connectar el compte.`,
                  401,
                ),
              };

        case 403: {
          const body = await readBodySafely(response);
          if (isRateLimitBody(body)) {
            const retryAfter = parseRetryAfter(response);
            return retryAfter === undefined
              ? { kind: 'retry' }
              : { kind: 'retry', retryAfterSeconds: retryAfter };
          }
          return {
            kind: 'fail',
            error: new CalendarPermissionError(
              `Google no permet ${meta.context}: ${String(redact(summariseError(body)))}`,
              403,
            ),
          };
        }

        case 404:
          if (meta.notFoundAsNull) return { kind: 'return' };
          return {
            kind: 'fail',
            error: new EventGoneError(
              meta.eventId ?? 'desconegut',
              `No s'ha pogut ${meta.context}: el recurs ja no existeix a Google.`,
            ),
          };

        case 410:
          if (meta.notFoundAsNull) return { kind: 'return' };
          return { kind: 'fail', error: new SyncTokenInvalidError() };

        case 412:
          return {
            kind: 'fail',
            error: new EtagConflictError(meta.eventId ?? 'desconegut'),
          };

        case 429: {
          const retryAfter = parseRetryAfter(response);
          return retryAfter === undefined
            ? { kind: 'retry' }
            : { kind: 'retry', retryAfterSeconds: retryAfter };
        }

        default: {
          if (response.status >= 500) {
            const retryAfter = parseRetryAfter(response);
            return retryAfter === undefined
              ? { kind: 'retry' }
              : { kind: 'retry', retryAfterSeconds: retryAfter };
          }
          const body = await readBodySafely(response);
          return {
            kind: 'fail',
            error: new CalendarError(
              `Error de Google en ${meta.context} (${response.status}): ${String(
                redact(summariseError(body)),
              )}`,
              response.status,
            ),
          };
        }
      }
    };

    return requestWithRetry(
      { fetch: this.fetchImpl, clock: this.clock, retry: this.retry },
      send,
      classify,
      () => this.refreshTokens(),
    );
  }

  /** Refreshes proactively when the token expires within a minute. */
  private async ensureFreshToken(): Promise<void> {
    if (!this.tokens.expiresAt || !this.tokens.refreshToken) return;
    const expiresAt = Date.parse(this.tokens.expiresAt);
    if (Number.isNaN(expiresAt)) return;
    if (expiresAt - this.clock.now().getTime() > 60_000) return;
    await this.refreshTokens();
  }

  private async refreshTokens(): Promise<void> {
    if (!this.tokens.refreshToken) {
      throw new CalendarAuthError(
        'No hi ha cap testimoni de refresc: cal tornar a connectar el compte de Google.',
        401,
      );
    }
    const refreshed = await refreshAccessToken(this.config, this.tokens.refreshToken, {
      fetch: this.fetchImpl,
      clock: this.clock,
    });
    this.tokens = refreshed;
    await this.onTokensRefreshed?.(refreshed);
  }

  private toGoogleEvent(event: CrmEvent): Record<string, unknown> {
    const privateProps: Record<string, string> = {
      crmWorkspaceId: event.workspaceId,
      crmClientId: event.clientId,
      crmVisitId: event.visitId,
    };
    if (event.taskId) privateProps.crmTaskId = event.taskId;

    return {
      summary: event.title,
      location: event.location ?? '',
      description: event.description,
      start: { dateTime: event.startsAt, timeZone: event.timeZone },
      end: { dateTime: event.endsAt, timeZone: event.timeZone },
      status: event.status === 'CANCELLED' ? 'cancelled' : event.status.toLowerCase(),
      // Identity lives here, never in the title.
      extendedProperties: { private: privateProps },
      reminders:
        event.reminderMinutes && event.reminderMinutes.length > 0
          ? {
              useDefault: false,
              overrides: event.reminderMinutes.map((minutes) => ({ method: 'popup', minutes })),
            }
          : { useDefault: true },
    };
  }

  private toRemoteEvent(calendarId: string, resource: GoogleEventResource): RemoteEvent {
    const priv = resource.extendedProperties?.private ?? {};
    const location = resource.location?.trim();
    const status =
      resource.status === 'cancelled'
        ? 'cancelled'
        : resource.status === 'tentative'
          ? 'tentative'
          : 'confirmed';
    return {
      id: resource.id ?? '',
      calendarId,
      etag: resource.etag ?? '',
      updated: resource.updated ?? this.clock.now().toISOString(),
      status,
      ...(resource.summary === undefined ? {} : { summary: resource.summary }),
      ...(location ? { location } : {}),
      ...(resource.description === undefined ? {} : { description: resource.description }),
      ...(resource.start === undefined ? {} : { start: resource.start }),
      ...(resource.end === undefined ? {} : { end: resource.end }),
      ...(resource.htmlLink === undefined ? {} : { htmlLink: resource.htmlLink }),
      identity: {
        ...(priv.crmWorkspaceId === undefined ? {} : { crmWorkspaceId: priv.crmWorkspaceId }),
        ...(priv.crmClientId === undefined ? {} : { crmClientId: priv.crmClientId }),
        ...(priv.crmVisitId === undefined ? {} : { crmVisitId: priv.crmVisitId }),
        ...(priv.crmTaskId === undefined ? {} : { crmTaskId: priv.crmTaskId }),
      },
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function enc(value: string): string {
  return encodeURIComponent(value);
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await readBodySafely(response, 1_000_000);
  if (text.trim().length === 0) return {} as T;
  try {
    return JSON.parse(text) as T;
  } catch (cause) {
    throw new CalendarError('Google ha retornat una resposta que no és JSON vàlid.', response.status, {
      cause,
    });
  }
}

const RATE_LIMIT_REASONS = [
  'rateLimitExceeded',
  'userRateLimitExceeded',
  'quotaExceeded',
  'backendError',
];

function isRateLimitBody(body: string): boolean {
  return RATE_LIMIT_REASONS.some((reason) => body.includes(reason));
}

function summariseError(body: string): string {
  try {
    const parsed = JSON.parse(body) as { error?: { message?: string } };
    return parsed.error?.message ?? body.slice(0, 200);
  } catch {
    return body.slice(0, 200);
  }
}

function cryptoRandomToken(): string {
  const bytes = new Uint8Array(24);
  globalThis.crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
