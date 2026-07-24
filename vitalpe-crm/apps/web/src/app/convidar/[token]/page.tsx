import { createHash } from 'node:crypto';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { withServiceRole } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Invitation acceptance — the page the link from ADMINISTRACIÓ → USUARIS
 * points at.
 *
 * Runs before any session exists, so it works through the service role; the
 * token is the credential. Only its SHA-256 is stored, so a database read
 * cannot mint a working link. Accepting provisions the account (Supabase Auth
 * when configured, the local shim otherwise), activates the membership and
 * burns the invitation — a link can be accepted exactly once. The session
 * itself still comes from the normal sign-in: accepting proves you hold the
 * link, signing in proves you hold the mailbox.
 */

interface Invitation {
  id: string;
  email: string;
  role: string;
  workspace_id: string;
  workspace_name: string;
  expires_at: string;
  status: string;
}

async function findInvitation(token: string): Promise<Invitation | null> {
  const hash = createHash('sha256').update(token).digest('hex');
  return withServiceRole((q) =>
    q.one<Invitation>(
      `select i.id::text as id, i.email, i.role::text as role,
              i.workspace_id::text as workspace_id, w.name as workspace_name,
              i.expires_at::text as expires_at, i.status::text as status
         from public.workspace_invitations i
         join public.workspaces w on w.id = i.workspace_id
        where i.token_hash = $1`,
      [hash],
    ),
  );
}

async function acceptInvitation(formData: FormData): Promise<void> {
  'use server';
  const token = String(formData.get('token') ?? '');
  const invitation = await findInvitation(token);

  if (!invitation || invitation.status !== 'PENDENT') redirect('/convidar/invalida');
  if (new Date(invitation.expires_at).getTime() < Date.now()) redirect('/convidar/invalida');

  const email = invitation.email.toLowerCase();

  // 1 — the auth account, so the sign-in code has somewhere to go.
  let userId: string | null = null;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (supabaseUrl && serviceKey) {
    const { createClient } = await import('@supabase/supabase-js');
    const admin = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const created = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (created.error) {
      if (!/already been registered|already exists/i.test(created.error.message)) {
        console.error('[convidar]', created.error.message);
        redirect('/convidar/invalida');
      }
      const { data } = await admin.auth.admin.listUsers({ perPage: 1000 });
      userId = data?.users.find((u) => u.email?.toLowerCase() === email)?.id ?? null;
    } else {
      userId = created.data.user.id;
    }
  } else {
    // Local development: the PGlite harness ships an auth.users shim.
    userId = await withServiceRole(async (q) => {
      const row = await q.one<{ id: string }>(
        `insert into auth.users (email) values ($1)
         on conflict (email) do update set email = excluded.email
         returning id`,
        [email],
      );
      return row?.id ?? null;
    });
  }
  if (!userId) redirect('/convidar/invalida');

  // 2 — profile, membership, and burning the invitation, atomically.
  await withServiceRole(async (q) => {
    await q.run(
      `insert into public.profiles (id, email) values ($1, $2)
       on conflict (id) do update set email = excluded.email`,
      [userId, email],
    );
    await q.run(
      `insert into public.workspace_memberships (workspace_id, user_id, role, status, activated_at)
       values ($1, $2, $3::app.user_role, 'ACTIU', now())
       on conflict (workspace_id, user_id) do update
         set role = excluded.role, status = 'ACTIU', activated_at = now()`,
      [invitation.workspace_id, userId, invitation.role],
    );
    await q.run(
      `update public.workspace_invitations
          set status = 'ACCEPTADA', accepted_at = now(), accepted_by = $2
        where id = $1 and status = 'PENDENT'`,
      [invitation.id, userId],
    );
  });

  redirect('/entrar?convidat=1');
}

export default async function ConvidarPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const invitation = token === 'invalida' ? null : await findInvitation(token);

  const valid =
    invitation !== null &&
    invitation.status === 'PENDENT' &&
    new Date(invitation.expires_at).getTime() >= Date.now();

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-md">
        <header className="mb-7">
          <p className="etiqueta">CRM COMERCIAL</p>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-burgundy)] m-0">
            VITALPE
          </h1>
        </header>

        {valid ? (
          <section className="targeta p-5 grid gap-3">
            <h2 className="etiqueta m-0">INVITACIÓ</h2>
            <p className="m-0 text-[14px]">
              Has estat convidat a <strong>{invitation.workspace_name}</strong> amb el rol{' '}
              <span className="estat estat-marca">{invitation.role}</span> per al correu{' '}
              <strong>{invitation.email}</strong>.
            </p>
            <form action={acceptInvitation}>
              <input type="hidden" name="token" value={token} />
              <button className="boto boto-principal w-full" type="submit">
                ACCEPTAR LA INVITACIÓ
              </button>
            </form>
            <p className="text-[12px] text-[var(--color-ink-faint)] m-0">
              En acceptar, el compte queda actiu. Després entraràs des de la pantalla
              d&apos;accés amb un codi enviat a aquest correu.
            </p>
          </section>
        ) : (
          <section className="targeta p-5 grid gap-2">
            <h2 className="etiqueta m-0">INVITACIÓ NO VÀLIDA</h2>
            <p className="m-0 text-[14px] text-[var(--color-ink-soft)]">
              Aquest enllaç ha caducat, ja s&apos;ha fet servir o ha estat revocat. Demana a
              l&apos;administrador que te&apos;n generi un de nou des d&apos;ADMINISTRACIÓ → USUARIS.
            </p>
            <Link className="boto justify-self-start" href="/entrar">
              ANAR A LA PANTALLA D&apos;ACCÉS
            </Link>
          </section>
        )}
      </div>
    </main>
  );
}
