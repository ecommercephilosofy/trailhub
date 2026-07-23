import 'server-only';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { withServiceRole, withUser } from './db';

/**
 * Session handling.
 *
 * Production: Supabase Auth issues the JWT; we verify it and take `sub`.
 * Development without Supabase: a signed, HttpOnly cookie carrying the user id,
 * issued by the local sign-in page against the seeded users.
 *
 * Either way the rest of the application only ever sees a `Session`, and every
 * query still runs through RLS as that user — the local path is not a bypass.
 */

const COOKIE = 'vitalpe_session';
const MAX_AGE_S = 60 * 60 * 12;

export type Role = 'ADMIN' | 'GERENT' | 'COMERCIAL';

export interface Session {
  userId: string;
  workspaceId: string;
  role: Role;
  email: string;
  fullName: string;
}

function secret(): string {
  const key = process.env.APP_ENCRYPTION_KEY;
  if (key && key.length >= 16) return key;
  if (process.env.NODE_ENV === 'production') {
    throw new Error('APP_ENCRYPTION_KEY és obligatòria en producció.');
  }
  // Development fallback so a fresh clone runs without any configuration.
  return 'vitalpe-dev-only-signing-key';
}

function sign(value: string): string {
  return createHmac('sha256', secret()).update(value).digest('base64url');
}

export function issueToken(userId: string): string {
  const payload = `${userId}.${Date.now() + MAX_AGE_S * 1000}.${randomBytes(8).toString('hex')}`;
  return `${payload}.${sign(payload)}`;
}

export function verifyToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 4) return null;
  const payload = parts.slice(0, 3).join('.');
  const expected = sign(payload);
  const given = parts[3] ?? '';
  if (expected.length !== given.length) return null;
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(given))) return null;
  const expiresAt = Number(parts[1]);
  if (!Number.isFinite(expiresAt) || Date.now() > expiresAt) return null;
  return parts[0] ?? null;
}

export async function setSessionCookie(userId: string): Promise<void> {
  const store = await cookies();
  store.set(COOKIE, issueToken(userId), {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE_S,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

/** Reads the session without redirecting. Returns null when signed out. */
export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  const userId = verifyToken(token);
  if (!userId) return null;

  // Membership is read with the service role because the user's own RLS
  // context cannot be established before we know which workspace they are in.
  const row = await withServiceRole((q) =>
    q.one<{
      user_id: string; workspace_id: string; role: Role; email: string;
      first_name: string | null; last_name: string | null;
    }>(
      `select m.user_id, m.workspace_id, m.role::text as role, p.email, p.first_name, p.last_name
         from public.workspace_memberships m
         join public.profiles p on p.id = m.user_id
        where m.user_id = $1 and m.status = 'ACTIU' and p.is_active
        order by m.created_at
        limit 1`,
      [userId],
    ),
  );
  if (!row) return null;

  return {
    userId: row.user_id,
    workspaceId: row.workspace_id,
    role: row.role,
    email: row.email,
    fullName: [row.first_name, row.last_name].filter(Boolean).join(' ') || row.email,
  };
}

/** Session or redirect to the sign-in page. Use in every protected page. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) redirect('/entrar');
  return session;
}

export async function requireRole(...roles: Role[]): Promise<Session> {
  const session = await requireSession();
  if (!roles.includes(session.role)) redirect('/inici?error=permisos');
  return session;
}

export const isManager = (role: Role): boolean => role === 'ADMIN' || role === 'GERENT';

/**
 * Convenience wrapper: run a query as the signed-in user.
 * `origin` ends up in the audit log for every row the statement touches.
 */
export async function query<T>(
  session: Session,
  fn: Parameters<typeof withUser<T>>[1],
  origin: 'CRM' | 'MOBIL' | 'VEU' | 'GOOGLE CALENDAR' = 'CRM',
): Promise<T> {
  return withUser(session.userId, fn, { origin });
}
