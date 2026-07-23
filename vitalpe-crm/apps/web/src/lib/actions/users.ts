'use server';

import { createHash, randomBytes } from 'node:crypto';
import { revalidatePath } from 'next/cache';
import { query, requireSession, type Role } from '@/lib/auth';
import { friendlyError } from '@/lib/db';
import { field, type ActionResult } from '@/components/admin/service';

/**
 * Users, roles and invitations.
 *
 * Everything here runs through the caller's own RLS context: the
 * `memberships_admin_write` and `invitations_admin_all` policies are
 * ADMIN-only and their WITH CHECK is evaluated against the *new* row, so a
 * COMERCIAL cannot raise their own role even by replaying this action with a
 * forged form. The role check below is a second lock on the same door, not the
 * door itself.
 *
 * No mail provider is configured, so an invitation is stored (hashed token) and
 * the link is shown on screen for the administrator to deliver by hand.
 */

const ROLES: readonly Role[] = ['ADMIN', 'GERENT', 'COMERCIAL'];
const INVITATION_DAYS = 7;

function isRole(value: string | null): value is Role {
  return value !== null && (ROLES as readonly string[]).includes(value);
}

function newToken(): { token: string; hash: string } {
  const token = randomBytes(32).toString('base64url');
  return { token, hash: createHash('sha256').update(token).digest('hex') };
}

/** Public base URL for the invitation link; falls back to the dev server. */
function appUrl(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
  return (configured && configured.length > 0 ? configured : 'http://localhost:3004').replace(
    /\/+$/,
    '',
  );
}

export interface InviteData {
  link: string;
  email: string;
  expiresAt: string;
}

export async function inviteUser(formData: FormData): Promise<ActionResult<InviteData>> {
  const session = await requireSession();
  if (session.role !== 'ADMIN') {
    return { ok: false, error: 'Només un ADMIN pot convidar persones.' };
  }

  const email = field(formData, 'email')?.toLowerCase() ?? '';
  const role = field(formData, 'role');
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    return { ok: false, error: 'El correu no té un format vàlid.' };
  }
  if (!isRole(role)) return { ok: false, error: 'Cal triar un rol.' };

  const { token, hash } = newToken();

  try {
    const expiresAt = await query(session, async (q) => {
      const alreadyMember = await q.one<{ id: string }>(
        `select m.id from public.workspace_memberships m
           join public.profiles p on p.id = m.user_id
          where m.workspace_id = $1 and app.normalize_email(p.email) = app.normalize_email($2)`,
        [session.workspaceId, email],
      );
      if (alreadyMember) throw new Error('JA_ES_MEMBRE');

      // The partial unique index allows exactly one PENDENT invitation per
      // address, so an existing one is renewed rather than duplicated.
      const pending = await q.one<{ id: string }>(
        `select id from public.workspace_invitations
          where workspace_id = $1 and email_norm = app.normalize_email($2) and status = 'PENDENT'`,
        [session.workspaceId, email],
      );

      const row = pending
        ? await q.one<{ expires_at: string }>(
            `update public.workspace_invitations
                set role = $2::app.user_role, token_hash = $3,
                    expires_at = now() + ($4 || ' days')::interval, invited_by = $5
              where id = $1
              returning expires_at`,
            [pending.id, role, hash, String(INVITATION_DAYS), session.userId],
          )
        : await q.one<{ expires_at: string }>(
            `insert into public.workspace_invitations
               (workspace_id, email, role, token_hash, expires_at, invited_by)
             values ($1, $2, $3::app.user_role, $4, now() + ($5 || ' days')::interval, $6)
             returning expires_at`,
            [session.workspaceId, email, role, hash, String(INVITATION_DAYS), session.userId],
          );
      return row?.expires_at ?? '';
    });

    revalidatePath('/administracio/usuaris');
    return {
      ok: true,
      data: { link: `${appUrl()}/convidar/${token}`, email, expiresAt },
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'JA_ES_MEMBRE') {
      return { ok: false, error: 'Aquesta persona ja forma part de l’espai de treball.' };
    }
    return { ok: false, error: friendlyError(error) };
  }
}

/** Issues a fresh token and extends the deadline. The old link stops working. */
export async function resendInvitation(formData: FormData): Promise<ActionResult<InviteData>> {
  const session = await requireSession();
  if (session.role !== 'ADMIN') return { ok: false, error: 'Només un ADMIN pot reenviar convidades.' };
  const id = field(formData, 'id');
  if (!id) return { ok: false, error: 'Falta la invitació.' };

  const { token, hash } = newToken();
  try {
    const row = await query(session, (q) =>
      q.one<{ email: string; expires_at: string }>(
        `update public.workspace_invitations
            set token_hash = $2, expires_at = now() + ($3 || ' days')::interval,
                status = 'PENDENT', revoked_at = null, invited_by = $4
          where id = $1 and workspace_id = $5 and status in ('PENDENT', 'CADUCADA')
          returning email, expires_at`,
        [id, hash, String(INVITATION_DAYS), session.userId, session.workspaceId],
      ),
    );
    if (!row) return { ok: false, error: 'Aquesta invitació ja no es pot reenviar.' };
    revalidatePath('/administracio/usuaris');
    return {
      ok: true,
      data: { link: `${appUrl()}/convidar/${token}`, email: row.email, expiresAt: row.expires_at },
    };
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
}

export async function revokeInvitation(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (session.role !== 'ADMIN') return { ok: false, error: 'Només un ADMIN pot revocar convidades.' };
  const id = field(formData, 'id');
  if (!id) return { ok: false, error: 'Falta la invitació.' };
  try {
    await query(session, (q) =>
      q.run(
        `update public.workspace_invitations
            set status = 'REVOCADA', revoked_at = now()
          where id = $1 and workspace_id = $2 and status = 'PENDENT'`,
        [id, session.workspaceId],
      ),
    );
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath('/administracio/usuaris');
  return { ok: true };
}

/** Marks every past-deadline invitation as CADUCADA so the list stops lying. */
export async function expireInvitations(): Promise<ActionResult> {
  const session = await requireSession();
  if (session.role !== 'ADMIN') return { ok: false, error: 'Només un ADMIN pot fer aquesta acció.' };
  try {
    await query(session, (q) =>
      q.run(
        `update public.workspace_invitations
            set status = 'CADUCADA'
          where workspace_id = $1 and status = 'PENDENT' and expires_at < now()`,
        [session.workspaceId],
      ),
    );
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath('/administracio/usuaris');
  return { ok: true };
}

export async function changeRole(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (session.role !== 'ADMIN') {
    return { ok: false, error: 'Només un ADMIN pot canviar rols. La base de dades també ho impedeix.' };
  }
  const userId = field(formData, 'userId');
  const role = field(formData, 'role');
  if (!userId || !isRole(role)) return { ok: false, error: 'Dades incompletes.' };
  if (userId === session.userId) {
    return { ok: false, error: 'No pots canviar el teu propi rol. Demana-ho a un altre ADMIN.' };
  }

  try {
    await query(session, async (q) => {
      const admins = await q.one<{ n: string }>(
        `select count(*)::text as n from public.workspace_memberships
          where workspace_id = $1 and role = 'ADMIN' and status = 'ACTIU'`,
        [session.workspaceId],
      );
      const target = await q.one<{ role: string }>(
        `select role::text as role from public.workspace_memberships
          where workspace_id = $1 and user_id = $2`,
        [session.workspaceId, userId],
      );
      if (!target) throw new Error('MEMBRE_NO_TROBAT');
      if (target.role === 'ADMIN' && role !== 'ADMIN' && Number(admins?.n ?? 0) <= 1) {
        throw new Error('ULTIM_ADMIN');
      }
      await q.run(
        `update public.workspace_memberships set role = $3::app.user_role
          where workspace_id = $1 and user_id = $2`,
        [session.workspaceId, userId, role],
      );
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'ULTIM_ADMIN') {
      return { ok: false, error: 'És l’últim ADMIN actiu. Nomena’n un altre abans de baixar-li el rol.' };
    }
    if (error instanceof Error && error.message === 'MEMBRE_NO_TROBAT') {
      return { ok: false, error: 'Aquesta persona ja no és membre.' };
    }
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath('/administracio/usuaris');
  return { ok: true };
}

/**
 * Deactivation is a membership state, not a profile edit: `profiles` only has a
 * self-update policy, so an ADMIN can never touch somebody else's profile row.
 * `getSession()` requires an ACTIU membership, so DESACTIVAT is a real lock-out.
 */
export async function setMembershipStatus(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  if (session.role !== 'ADMIN') return { ok: false, error: 'Només un ADMIN pot fer aquesta acció.' };
  const userId = field(formData, 'userId');
  const status = field(formData, 'status');
  if (!userId || (status !== 'ACTIU' && status !== 'DESACTIVAT')) {
    return { ok: false, error: 'Dades incompletes.' };
  }
  if (userId === session.userId && status === 'DESACTIVAT') {
    return { ok: false, error: 'No et pots desactivar a tu mateix.' };
  }

  try {
    await query(session, async (q) => {
      if (status === 'DESACTIVAT') {
        const admins = await q.one<{ n: string }>(
          `select count(*)::text as n from public.workspace_memberships
            where workspace_id = $1 and role = 'ADMIN' and status = 'ACTIU' and user_id <> $2`,
          [session.workspaceId, userId],
        );
        const target = await q.one<{ role: string }>(
          `select role::text as role from public.workspace_memberships
            where workspace_id = $1 and user_id = $2`,
          [session.workspaceId, userId],
        );
        if (target?.role === 'ADMIN' && Number(admins?.n ?? 0) === 0) throw new Error('ULTIM_ADMIN');
      }
      await q.run(
        `update public.workspace_memberships
            set status = $3::app.membership_status,
                activated_at = case when $3 = 'ACTIU' then coalesce(activated_at, now()) else activated_at end
          where workspace_id = $1 and user_id = $2`,
        [session.workspaceId, userId, status],
      );
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'ULTIM_ADMIN') {
      return { ok: false, error: 'És l’últim ADMIN actiu: desactivar-lo deixaria l’espai sense administració.' };
    }
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath('/administracio/usuaris');
  return { ok: true };
}
