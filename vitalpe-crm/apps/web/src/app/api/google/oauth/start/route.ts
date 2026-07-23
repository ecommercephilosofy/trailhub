import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { getSession } from '@/lib/auth';
import {
  buildAuthorizationUrl,
} from '@vitalpe/integrations/calendar/index';
import { googleOAuthConfig, newOAuthState } from '../../sync-engine';

/**
 * Step 1 of the authorization-code flow.
 *
 * Offline access with a forced consent screen — without both, Google stops
 * returning a refresh token on re-authorisation and background sync dies an
 * hour later. Scopes are the minimum: read/write events on the chosen calendar,
 * the calendar list, and (only so the app can create its own calendar) the
 * `calendar.app.created` scope.
 *
 * The `state` is bound to the signed-in user and mirrored in an HttpOnly,
 * SameSite=Lax cookie so the callback can reject a forged or replayed one.
 */
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) {
    return NextResponse.redirect(new URL('/entrar', request.url));
  }

  const config = googleOAuthConfig();
  if (!config) {
    // Never a broken error page: say exactly what is missing.
    return NextResponse.redirect(
      new URL('/calendari/google?error=no-configurat', request.url),
    );
  }

  const state = newOAuthState(session.userId);
  const store = await cookies();
  store.set('vitalpe_gcal_state', state, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/api/google',
    maxAge: 600,
  });

  const url = buildAuthorizationUrl(config, {
    state,
    loginHint: session.email,
    includeCalendarCreation: true,
  });
  return NextResponse.redirect(url);
}
