import { describe, expect, it } from 'vitest';
import { fakeClock, type FetchLike } from '../util/http';
import {
  GOOGLE_CALENDAR_CREATION_SCOPE,
  GOOGLE_CALENDAR_SCOPES,
  GoogleCalendarProvider,
  buildAuthorizationUrl,
  exchangeAuthorizationCode,
  refreshAccessToken,
  type GoogleOAuthConfig,
} from './google';
import { buildCrmEvent, type EventContentInput } from './sync';
import {
  CalendarAuthError,
  CalendarPermissionError,
  EtagConflictError,
  EventGoneError,
  SyncTokenInvalidError,
  type CrmEvent,
} from './types';

const CONFIG: GoogleOAuthConfig = {
  clientId: 'client-id.apps.googleusercontent.com',
  clientSecret: 'client-secret',
  redirectUri: 'https://crm.vitalpe.cat/api/google/callback',
};

const INPUT: EventContentInput = {
  companyName: 'Caves Solé Germans',
  clientId: 'cli-42',
  visitId: 'vis-7',
  appUrl: 'https://crm.vitalpe.cat',
  startsAt: '2026-07-28T09:00:00.000Z',
  endsAt: '2026-07-28T10:00:00.000Z',
  address: { formatted: 'Camí del Celler 12', verified: true },
  primaryContact: { name: 'Marta Solé', phone: '+34 938 000 111' },
  objective: 'Presentar la gamma',
};

const CRM: CrmEvent = buildCrmEvent(
  { workspaceId: 'ws-1', clientId: 'cli-42', visitId: 'vis-7', taskId: 'tsk-3' },
  INPUT,
);

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

interface Route {
  match: (url: string, method: string) => boolean;
  respond: (call: Call, hits: number) => Response;
}

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function harness(routes: Route[]): { fetchImpl: FetchLike; calls: Call[] } {
  const calls: Call[] = [];
  const hitCount = new Map<Route, number>();
  const fetchImpl: FetchLike = async (url, init = {}) => {
    const headers = (init.headers ?? {}) as Record<string, string>;
    const call: Call = {
      url,
      method: (init.method ?? 'GET').toUpperCase(),
      headers,
      body: typeof init.body === 'string' ? safeParse(init.body) : init.body,
    };
    calls.push(call);
    for (const route of routes) {
      if (!route.match(url, call.method)) continue;
      const hits = (hitCount.get(route) ?? 0) + 1;
      hitCount.set(route, hits);
      return route.respond(call, hits);
    }
    return jsonResponse({ error: { message: `no route for ${call.method} ${url}` } }, 500);
  };
  return { fetchImpl, calls };
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function providerWith(
  fetchImpl: FetchLike,
  overrides: Partial<ConstructorParameters<typeof GoogleCalendarProvider>[0]> = {},
): GoogleCalendarProvider {
  return new GoogleCalendarProvider({
    config: CONFIG,
    tokens: { accessToken: 'access-1', refreshToken: 'refresh-1' },
    fetch: fetchImpl,
    clock: fakeClock(),
    // `fakeClock` never actually sleeps, so realistic numbers cost nothing.
    retry: { maxRetries: 3, baseDelayMs: 1000, maxDelayMs: 60_000 },
    channelIdFactory: () => 'chan-1',
    verificationTokenFactory: () => 'secret-token',
    ...overrides,
  });
}

const eventResource = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'gev-1',
  etag: 'W/"abc"',
  updated: '2026-07-23T09:00:00.000Z',
  status: 'confirmed',
  summary: 'VISITA — CAVES SOLÉ GERMANS',
  location: 'Camí del Celler 12',
  description: 'Contacte: Marta Solé',
  start: { dateTime: '2026-07-28T09:00:00.000Z', timeZone: 'Europe/Madrid' },
  end: { dateTime: '2026-07-28T10:00:00.000Z', timeZone: 'Europe/Madrid' },
  extendedProperties: {
    private: {
      crmWorkspaceId: 'ws-1',
      crmClientId: 'cli-42',
      crmVisitId: 'vis-7',
      crmTaskId: 'tsk-3',
    },
  },
  ...overrides,
});

// ---------------------------------------------------------------------------

describe('OAuth', () => {
  it('asks for the minimal scopes and offline access', () => {
    const url = new URL(buildAuthorizationUrl(CONFIG, { state: 'nonce-1' }));
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('scope')).toBe(GOOGLE_CALENDAR_SCOPES.join(' '));
    expect(url.searchParams.get('access_type')).toBe('offline');
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('state')).toBe('nonce-1');
    // Never the broad `calendar` scope.
    expect(url.searchParams.get('scope')).not.toContain('auth/calendar ');
  });

  it('adds the calendar-creation scope only when asked', () => {
    const url = new URL(
      buildAuthorizationUrl(CONFIG, { state: 'n', includeCalendarCreation: true }),
    );
    expect(url.searchParams.get('scope')).toContain(GOOGLE_CALENDAR_CREATION_SCOPE);
  });

  it('exchanges an authorization code', async () => {
    const { fetchImpl, calls } = harness([
      {
        match: (url) => url.includes('oauth2.googleapis.com/token'),
        respond: () =>
          jsonResponse({
            access_token: 'access-1',
            refresh_token: 'refresh-1',
            expires_in: 3599,
            scope: GOOGLE_CALENDAR_SCOPES.join(' '),
          }),
      },
    ]);
    const tokens = await exchangeAuthorizationCode(CONFIG, 'code-abc', {
      fetch: fetchImpl,
      clock: fakeClock(),
    });
    expect(tokens.accessToken).toBe('access-1');
    expect(tokens.refreshToken).toBe('refresh-1');
    expect(tokens.expiresAt).toBe('2026-07-23T09:59:59.000Z');
    expect(String(calls[0]?.body)).toContain('grant_type=authorization_code');
  });

  it('carries the refresh token forward when Google omits it', async () => {
    const { fetchImpl } = harness([
      {
        match: (url) => url.includes('oauth2.googleapis.com/token'),
        respond: () => jsonResponse({ access_token: 'access-2', expires_in: 3599 }),
      },
    ]);
    const tokens = await refreshAccessToken(CONFIG, 'refresh-1', {
      fetch: fetchImpl,
      clock: fakeClock(),
    });
    expect(tokens.refreshToken).toBe('refresh-1');
  });

  it('turns a rejected grant into a typed auth error', async () => {
    const { fetchImpl } = harness([
      {
        match: (url) => url.includes('oauth2.googleapis.com/token'),
        respond: () => jsonResponse({ error: 'invalid_grant' }, 400),
      },
    ]);
    await expect(
      refreshAccessToken(CONFIG, 'refresh-1', { fetch: fetchImpl, clock: fakeClock() }),
    ).rejects.toBeInstanceOf(CalendarAuthError);
  });
});

describe('GoogleCalendarProvider', () => {
  it('creates an event with private extended properties, not a magic title', async () => {
    const { fetchImpl, calls } = harness([
      {
        match: (url, method) => url.includes('/events') && method === 'POST',
        respond: () => jsonResponse(eventResource(), 200),
      },
    ]);
    const remote = await providerWith(fetchImpl).createEvent('primary', CRM);

    const body = calls[0]?.body as Record<string, any>;
    expect(body.extendedProperties.private).toEqual({
      crmWorkspaceId: 'ws-1',
      crmClientId: 'cli-42',
      crmVisitId: 'vis-7',
      crmTaskId: 'tsk-3',
    });
    expect(calls[0]?.headers.authorization).toBe('Bearer access-1');
    expect(remote.identity.crmVisitId).toBe('vis-7');
    expect(remote.etag).toBe('W/"abc"');
  });

  it('sends the stored ETag as If-Match on update', async () => {
    const { fetchImpl, calls } = harness([
      {
        match: (url, method) => url.includes('/events/') && method === 'PUT',
        respond: () => jsonResponse(eventResource({ etag: 'W/"def"' })),
      },
    ]);
    await providerWith(fetchImpl).updateEvent('primary', 'gev-1', CRM, { etag: 'W/"abc"' });
    expect(calls[0]?.headers['If-Match']).toBe('W/"abc"');
  });

  it('refreshes on 401 and retries exactly once', async () => {
    let attempted = 0;
    const { fetchImpl, calls } = harness([
      {
        match: (url) => url.includes('oauth2.googleapis.com/token'),
        respond: () => jsonResponse({ access_token: 'access-2', expires_in: 3599 }),
      },
      {
        match: (url, method) => url.includes('/events') && method === 'POST',
        respond: () => {
          attempted += 1;
          return attempted === 1
            ? jsonResponse({ error: { message: 'Invalid Credentials' } }, 401)
            : jsonResponse(eventResource());
        },
      },
    ]);

    const saved: string[] = [];
    const provider = providerWith(fetchImpl, {
      onTokensRefreshed: (tokens) => {
        saved.push(tokens.accessToken);
      },
    });
    const remote = await provider.createEvent('primary', CRM);

    expect(remote.id).toBe('gev-1');
    expect(attempted).toBe(2);
    expect(saved).toEqual(['access-2']);
    // Second attempt carries the fresh token.
    expect(calls.at(-1)?.headers.authorization).toBe('Bearer access-2');
  });

  it('gives up after a single refresh when 401 persists', async () => {
    const { fetchImpl } = harness([
      {
        match: (url) => url.includes('oauth2.googleapis.com/token'),
        respond: () => jsonResponse({ access_token: 'access-2', expires_in: 3599 }),
      },
      {
        match: (url, method) => url.includes('/events') && method === 'POST',
        respond: () => jsonResponse({ error: { message: 'Invalid Credentials' } }, 401),
      },
    ]);
    await expect(providerWith(fetchImpl).createEvent('primary', CRM)).rejects.toThrow();
  });

  it('backs off on a 403 rate limit and succeeds on retry', async () => {
    const clock = fakeClock();
    let attempted = 0;
    const { fetchImpl } = harness([
      {
        match: (url, method) => url.includes('/events') && method === 'POST',
        respond: () => {
          attempted += 1;
          return attempted < 3
            ? jsonResponse(
                { error: { errors: [{ reason: 'rateLimitExceeded' }], message: 'Rate Limit Exceeded' } },
                403,
              )
            : jsonResponse(eventResource());
        },
      },
    ]);
    await providerWith(fetchImpl, { clock }).createEvent('primary', CRM);
    expect(attempted).toBe(3);
    expect(clock.slept.length).toBe(2);
    // Exponential, and jittered rather than a fixed ladder.
    expect(clock.slept[1]).toBeGreaterThan(clock.slept[0] as number);
  });

  it('honours Retry-After on 429', async () => {
    const clock = fakeClock();
    let attempted = 0;
    const { fetchImpl } = harness([
      {
        match: (url, method) => url.includes('/events') && method === 'POST',
        respond: () => {
          attempted += 1;
          return attempted === 1
            ? jsonResponse({ error: { message: 'Too many' } }, 429, { 'retry-after': '2' })
            : jsonResponse(eventResource());
        },
      },
    ]);
    await providerWith(fetchImpl, { clock }).createEvent('primary', CRM);
    expect(clock.slept).toEqual([2000]);
  });

  it('does not retry a genuine 403 permission error', async () => {
    let attempted = 0;
    const { fetchImpl } = harness([
      {
        match: (url, method) => url.includes('/events') && method === 'POST',
        respond: () => {
          attempted += 1;
          return jsonResponse(
            { error: { errors: [{ reason: 'forbiddenForServiceAccounts' }], message: 'Forbidden' } },
            403,
          );
        },
      },
    ]);
    await expect(providerWith(fetchImpl).createEvent('primary', CRM)).rejects.toBeInstanceOf(
      CalendarPermissionError,
    );
    expect(attempted).toBe(1);
  });

  it('reports a 404 as EventGoneError but resolves getEvent to null', async () => {
    const { fetchImpl } = harness([
      {
        match: (url, method) => url.includes('/events/') && method === 'PUT',
        respond: () => jsonResponse({ error: { message: 'Not Found' } }, 404),
      },
      {
        match: (url, method) => url.includes('/events/') && method === 'GET',
        respond: () => jsonResponse({ error: { message: 'Not Found' } }, 404),
      },
    ]);
    const provider = providerWith(fetchImpl);
    await expect(provider.updateEvent('primary', 'gev-1', CRM)).rejects.toBeInstanceOf(EventGoneError);
    expect(await provider.getEvent('primary', 'gev-1')).toBeNull();
  });

  it('turns a 410 on incremental sync into a full-resync signal', async () => {
    const { fetchImpl } = harness([
      {
        match: (url, method) => url.includes('/events?') && method === 'GET',
        respond: () => jsonResponse({ error: { message: 'Sync token is no longer valid' } }, 410),
      },
    ]);
    const error = await providerWith(fetchImpl)
      .listChanged({ calendarId: 'primary', syncToken: 'old-token' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(SyncTokenInvalidError);
    expect((error as SyncTokenInvalidError).requiresFullResync).toBe(true);
  });

  it('turns a 412 into an ETag conflict', async () => {
    const { fetchImpl } = harness([
      {
        match: (url, method) => url.includes('/events/') && method === 'PUT',
        respond: () => jsonResponse({ error: { message: 'Precondition Failed' } }, 412),
      },
    ]);
    await expect(
      providerWith(fetchImpl).updateEvent('primary', 'gev-1', CRM, { etag: 'W/"stale"' }),
    ).rejects.toBeInstanceOf(EtagConflictError);
  });

  it('filters incremental sync by our own private property', async () => {
    const { fetchImpl, calls } = harness([
      {
        match: (url, method) => url.includes('/events?') && method === 'GET',
        respond: () =>
          jsonResponse({
            items: [eventResource(), eventResource({ id: 'gev-2', status: 'cancelled' })],
            nextSyncToken: 'tok-2',
          }),
      },
    ]);
    const result = await providerWith(fetchImpl).listChanged({
      calendarId: 'primary',
      syncToken: 'tok-1',
      workspaceId: 'ws-1',
    });
    const url = new URL(calls[0]?.url as string);
    expect(url.searchParams.get('privateExtendedProperty')).toBe('crmWorkspaceId=ws-1');
    expect(url.searchParams.get('showDeleted')).toBe('true');
    expect(url.searchParams.get('syncToken')).toBe('tok-1');
    expect(result.events).toHaveLength(2);
    expect(result.events[1]?.status).toBe('cancelled');
    expect(result.nextSyncToken).toBe('tok-2');
  });

  it('opens and closes a watch channel', async () => {
    const { fetchImpl, calls } = harness([
      {
        match: (url, method) => url.endsWith('/events/watch') && method === 'POST',
        respond: () =>
          jsonResponse({
            id: 'chan-1',
            resourceId: 'res-1',
            expiration: String(Date.parse('2026-07-30T09:00:00.000Z')),
          }),
      },
      {
        match: (url, method) => url.endsWith('/channels/stop') && method === 'POST',
        respond: () => new Response(null, { status: 204 }),
      },
    ]);
    const provider = providerWith(fetchImpl);
    const channel = await provider.watch('primary', 'https://crm.vitalpe.cat/api/google/webhook');
    expect(channel.verificationToken).toBe('secret-token');
    expect(channel.expiresAt).toBe('2026-07-30T09:00:00.000Z');
    expect((calls[0]?.body as Record<string, unknown>).token).toBe('secret-token');

    await provider.stopWatch(channel);
    expect(calls[1]?.body).toEqual({ id: 'chan-1', resourceId: 'res-1' });
  });

  it('lists writable calendars', async () => {
    const { fetchImpl } = harness([
      {
        match: (url) => url.includes('/users/me/calendarList'),
        respond: () =>
          jsonResponse({
            items: [
              { id: 'primary', summary: 'Marta', primary: true, accessRole: 'owner' },
              { id: 'cal-2', summary: 'Visites', accessRole: 'writer' },
              { summary: 'sense id' },
            ],
          }),
      },
    ]);
    const calendars = await providerWith(fetchImpl).listCalendars();
    expect(calendars.map((c) => c.id)).toEqual(['primary', 'cal-2']);
  });

  it('retries 5xx and eventually fails cleanly', async () => {
    const clock = fakeClock();
    let attempted = 0;
    const { fetchImpl } = harness([
      {
        match: (url, method) => url.includes('/events') && method === 'POST',
        respond: () => {
          attempted += 1;
          return jsonResponse({ error: { message: 'Backend Error' } }, 503);
        },
      },
    ]);
    await expect(providerWith(fetchImpl, { clock }).createEvent('primary', CRM)).rejects.toThrow();
    expect(attempted).toBe(4); // 1 attempt + 3 retries
  });

  it('never puts a token in an error message', async () => {
    const { fetchImpl } = harness([
      {
        match: (url, method) => url.includes('/events') && method === 'POST',
        respond: () =>
          jsonResponse(
            { error: { message: 'Bad request with access_token=ya29.a0ARrdaMsupersecretvalue inside' } },
            400,
          ),
      },
    ]);
    const error = await providerWith(fetchImpl)
      .createEvent('primary', CRM)
      .catch((e: unknown) => e as Error);
    expect((error as Error).message).not.toContain('ya29.a0ARrdaMsupersecretvalue');
  });
});
