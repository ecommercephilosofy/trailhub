import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import { withServiceRole } from '@/lib/db';
import { encryptSecret } from '@vitalpe/config';
import {
  exchangeAuthorizationCode,
  GOOGLE_CALENDAR_SCOPES,
} from '@vitalpe/integrations/calendar/index';
import {
  describe,
  googleOAuthConfig,
  openWatchChannel,
  readOAuthState,
} from '../sync-engine';

/**
 * Step 2 of the authorization-code flow.
 *
 * The tokens are encrypted with AES-256-GCM before they touch the database and
 * are never returned to the client — not in the redirect, not in a cookie, not
 * in a response body. The only thing that leaves this handler is a redirect.
 */
export const dynamic = 'force-dynamic';

function back(request: Request, params: Record<string, string>): Response {
  const url = new URL('/calendari/google', request.url);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  const response = NextResponse.redirect(url);
  response.cookies.delete('vitalpe_gcal_state');
  return response;
}

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return NextResponse.redirect(new URL('/entrar', request.url));

  const url = new URL(request.url);
  const error = url.searchParams.get('error');
  if (error) return back(request, { error: 'denegat' });

  const code = url.searchParams.get('code') ?? '';
  const state = url.searchParams.get('state') ?? '';
  const store = await cookies();
  const expected = store.get('vitalpe_gcal_state')?.value ?? '';

  if (!code) return back(request, { error: 'sense-codi' });
  if (!state || state !== expected || readOAuthState(state) !== session.userId) {
    return back(request, { error: 'estat-invalid' });
  }

  const config = googleOAuthConfig();
  if (!config) return back(request, { error: 'no-configurat' });

  try {
    const tokens = await exchangeAuthorizationCode(config, code);

    // Pulled into a const so the narrowing survives into the closure below:
    // TypeScript cannot prove a property check still holds inside a callback,
    // because the callback could in principle run later.
    const refreshToken = tokens.refreshToken;
    if (!refreshToken) {
      // Without a refresh token the connection dies in an hour. Say so rather
      // than storing something that will fail silently later.
      return back(request, { error: 'sense-refresh' });
    }

    await withServiceRole((q) =>
      q.run(
        `insert into public.google_calendar_connections
           (workspace_id, user_id, provider, google_account_email, calendar_id, calendar_name,
            status, scopes, access_token_enc, refresh_token_enc, token_expires_at, sync_token,
            last_error, disconnected_at)
         values ($1, $2, 'google', $3, 'primary', 'Calendari principal', 'CONNECTAT', $4::text[],
                 $5, $6, $7::timestamptz, null, null, null)
         on conflict (user_id, provider) do update
           set google_account_email = excluded.google_account_email,
               status = 'CONNECTAT',
               scopes = excluded.scopes,
               access_token_enc = excluded.access_token_enc,
               refresh_token_enc = excluded.refresh_token_enc,
               token_expires_at = excluded.token_expires_at,
               sync_token = null,
               last_error = null,
               disconnected_at = null`,
        [
          session.workspaceId,
          session.userId,
          session.email,
          `{${(tokens.scopes ?? GOOGLE_CALENDAR_SCOPES).join(',')}}`,
          encryptSecret(tokens.accessToken),
          encryptSecret(refreshToken),
          tokens.expiresAt ?? null,
        ],
      ),
    );

    const connection = await withServiceRole((q) =>
      q.one<{ id: string }>(
        `select id from public.google_calendar_connections
          where user_id = $1 and provider = 'google'`,
        [session.userId],
      ),
    );
    if (connection) await openWatchChannel(connection.id);

    return back(request, { ok: 'connectat' });
  } catch (cause) {
    return back(request, { error: 'fallida', detall: describe(cause).slice(0, 180) });
  }
}
