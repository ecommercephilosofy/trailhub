'use server';

import { createClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { requireSession, setSessionCookie } from '@/lib/auth';
import { withServiceRole } from '@/lib/db';

const SERVICE_KEY_ENV = process.env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Sign-in with Supabase Auth, e-mail and password.
 *
 * Password, not a one-time code: the OTP flow depends on Supabase sending mail,
 * and the built-in mailer can only be customised behind a custom SMTP provider
 * and is rate-limited to a handful of messages an hour. For a tool one person
 * signs into every day that is the wrong dependency. A password is verified in
 * a single server-side call with nothing to deliver.
 *
 * Authentication is not authorisation. `signInWithPassword` only proves control
 * of the credentials; the session is opened only if the account also has an
 * active membership in a workspace. Accounts and passwords are created by an
 * administrator (scripts/maintenance/create-user.ts and set-password.ts) — this
 * screen never creates one, which is what keeps sign-in from being sign-up.
 */

const URL_ENV = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY_ENV =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export interface AuthResult {
  ok: boolean;
  error?: string;
}

function client() {
  if (!URL_ENV || !KEY_ENV) {
    throw new Error('SUPABASE_NO_CONFIGURAT');
  }
  return createClient(URL_ENV, KEY_ENV, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function normaliseEmail(raw: FormDataEntryValue | null): string {
  return String(raw ?? '').trim().toLowerCase();
}

/** Verify the credentials and open the session. */
export async function signIn(formData: FormData): Promise<AuthResult> {
  const email = normaliseEmail(formData.get('email'));
  const password = String(formData.get('password') ?? '');

  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || password.length === 0) {
    return { ok: false, error: 'Escriu el correu i la contrasenya.' };
  }

  let userId: string;
  try {
    const { data, error } = await client().auth.signInWithPassword({ email, password });
    if (error || !data.user) {
      // One message for both "no such account" and "wrong password": telling a
      // stranger which addresses exist is an account-enumeration gift, and a
      // password prompt that distinguishes the two is where that leak lives.
      if (error?.status === 429 || /rate limit/i.test(error?.message ?? '')) {
        return { ok: false, error: 'Massa intents. Espera un minut i torna-ho a provar.' };
      }
      return { ok: false, error: 'Correu o contrasenya incorrectes.' };
    }
    userId = data.user.id;
  } catch (error) {
    if ((error as Error).message === 'SUPABASE_NO_CONFIGURAT') {
      return { ok: false, error: 'L\'accés no està configurat en aquest entorn.' };
    }
    console.error('[auth]', (error as Error).message);
    return { ok: false, error: 'No s\'ha pogut iniciar la sessió. Torna-ho a provar.' };
  }

  // Authenticated with Supabase is not the same as authorised here: the user
  // also needs an active membership in a workspace.
  const member = await withServiceRole((q) =>
    q.one<{ user_id: string }>(
      `select m.user_id
         from public.workspace_memberships m
         join public.profiles p on p.id = m.user_id
        where m.user_id = $1 and m.status = 'ACTIU' and p.is_active
        limit 1`,
      [userId],
    ),
  );

  if (!member) {
    return {
      ok: false,
      error:
        'Aquest compte encara no té accés a cap espai de treball. Demana a un administrador que t\'hi doni d\'alta.',
    };
  }

  await setSessionCookie(userId);
  redirect('/inici');
}

/**
 * Change one's own password.
 *
 * The current password is checked first, with `signInWithPassword`: possession
 * of a valid session cookie is not the same as knowing the password, and a
 * borrowed unlocked screen must not be enough to lock the real owner out. Only
 * once the current one verifies does the service role set the new one.
 */
export async function changePassword(formData: FormData): Promise<AuthResult> {
  const session = await requireSession();
  const current = String(formData.get('current') ?? '');
  const next = String(formData.get('next') ?? '');

  if (next.length < 8) {
    return { ok: false, error: 'La nova contrasenya ha de tenir com a mínim 8 caràcters.' };
  }
  if (next === current) {
    return { ok: false, error: 'La nova contrasenya ha de ser diferent de l\'actual.' };
  }
  if (!SERVICE_KEY_ENV || !URL_ENV) {
    return { ok: false, error: 'El canvi de contrasenya no està configurat en aquest entorn.' };
  }

  // Verify the current password before changing anything.
  const check = await client().auth.signInWithPassword({
    email: session.email,
    password: current,
  });
  if (check.error || !check.data.user) {
    return { ok: false, error: 'La contrasenya actual no és correcta.' };
  }

  // Setting a password is an admin operation: the app holds its own session
  // cookie, not a live Supabase session the user could update themselves.
  const admin = createClient(URL_ENV, SERVICE_KEY_ENV, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const updated = await admin.auth.admin.updateUserById(session.userId, { password: next });
  if (updated.error) {
    console.error('[auth] updateUserById', updated.error.message);
    return { ok: false, error: 'No s\'ha pogut desar la contrasenya. Torna-ho a provar.' };
  }

  return { ok: true };
}
