'use server';

import { createClient } from '@supabase/supabase-js';
import { redirect } from 'next/navigation';
import { setSessionCookie } from '@/lib/auth';
import { withServiceRole } from '@/lib/db';

/**
 * Sign-in with Supabase Auth, one-time code by e-mail.
 *
 * A six-digit code rather than a magic link, deliberately: the link flow needs
 * PKCE state carried across a redirect, which is easy to get subtly wrong and
 * fails silently. `verifyOtp` is a single server-side call with no state to
 * lose, and it works when the mail client rewrites links.
 *
 * `shouldCreateUser: false` is the access control: only somebody who already
 * has a profile AND an active membership can get in. Signing in never creates
 * an account — that is what the invitation flow is for.
 */

const URL_ENV = process.env.NEXT_PUBLIC_SUPABASE_URL;
const KEY_ENV =
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

export interface AuthResult {
  ok: boolean;
  error?: string;
  /** Set when the code was sent and the UI should ask for it. */
  codeSent?: boolean;
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

/** Step 1 — e-mail the code. */
export async function requestCode(formData: FormData): Promise<AuthResult> {
  const email = normaliseEmail(formData.get('email'));
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: 'Escriu una adreça de correu vàlida.' };
  }

  try {
    const { error } = await client().auth.signInWithOtp({
      email,
      options: { shouldCreateUser: false },
    });

    // Supabase returns an error for an unknown address when shouldCreateUser is
    // false. Do not echo it: telling a stranger which addresses exist is an
    // account-enumeration gift. The next screen asks for the code either way.
    if (error && !/not found|signups not allowed|invalid/i.test(error.message)) {
      // The built-in mailer allows a handful of e-mails per hour. Rate-limited
      // is not failed: a code sent minutes ago still works, so the UI must let
      // the person proceed to typing it instead of locking them out here.
      if (error.status === 429 || /rate limit/i.test(error.message)) {
        return {
          ok: false,
          codeSent: true,
          error:
            'Massa correus en poca estona: Supabase limita els enviaments. Si ja tens un codi recent, fes-lo servir; si no, espera uns minuts.',
        };
      }
      console.error('[auth] signInWithOtp', error.message);
      return { ok: false, error: 'No s\'ha pogut enviar el codi. Torna-ho a provar.' };
    }
  } catch (error) {
    if ((error as Error).message === 'SUPABASE_NO_CONFIGURAT') {
      return { ok: false, error: 'L\'accés amb correu no està configurat en aquest entorn.' };
    }
    console.error('[auth]', (error as Error).message);
    return { ok: false, error: 'No s\'ha pogut enviar el codi. Torna-ho a provar.' };
  }

  return { ok: true, codeSent: true };
}

/** Step 2 — verify the code and open the session. */
export async function verifyCode(formData: FormData): Promise<AuthResult> {
  const email = normaliseEmail(formData.get('email'));
  const token = String(formData.get('code') ?? '').replace(/\D/g, '');

  if (token.length < 6) {
    return { ok: false, error: 'El codi té sis xifres.' };
  }

  let userId: string;
  try {
    const { data, error } = await client().auth.verifyOtp({ email, token, type: 'email' });
    if (error || !data.user) {
      return { ok: false, error: 'El codi no és vàlid o ha caducat. Demana\'n un de nou.' };
    }
    userId = data.user.id;
  } catch (error) {
    if ((error as Error).message === 'SUPABASE_NO_CONFIGURAT') {
      return { ok: false, error: 'L\'accés amb correu no està configurat en aquest entorn.' };
    }
    console.error('[auth]', (error as Error).message);
    return { ok: false, error: 'No s\'ha pogut verificar el codi.' };
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
        'Aquest compte encara no té accés a cap espai de treball. Demana a un administrador que t\'hi convidi.',
    };
  }

  await setSessionCookie(userId);
  redirect('/inici');
}
