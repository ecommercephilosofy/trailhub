import { redirect } from 'next/navigation';
import { getSession, setSessionCookie } from '@/lib/auth';
import { backendKind, withServiceRole } from '@/lib/db';
import { EntrarAmbCorreu } from '@/components/entrar-correu';

/**
 * Sign in.
 *
 * With Supabase configured this page hands off to Supabase Auth. Without it —
 * the local development setup — it lists the seeded workspace members so the
 * app is usable immediately after `pnpm import:run`. The local path is only
 * available outside production and is stated plainly on screen: it is a
 * convenience, not a hidden back door.
 */
export const dynamic = 'force-dynamic';

// Supabase renamed the browser key from `anon` to `publishable`; both spellings
// are accepted so an older or newer project dashboard both work.
const SUPABASE_CONFIGURED = Boolean(
  process.env.NEXT_PUBLIC_SUPABASE_URL &&
    (process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY),
);

/**
 * The user picker is a development convenience: it opens a session with no
 * password. It must never be reachable from a deployed environment, whether or
 * not Supabase happens to be configured — otherwise anybody with the URL could
 * sign in as ADMIN.
 */
const LOCAL_PICKER_ALLOWED = process.env.NODE_ENV !== 'production';

async function signInLocally(formData: FormData): Promise<void> {
  'use server';
  // Checked on the server too: hiding the buttons is not what stops this.
  if (!LOCAL_PICKER_ALLOWED) {
    throw new Error('L\'accés local està desactivat en producció.');
  }
  const userId = String(formData.get('userId') ?? '');
  const exists = await withServiceRole((q) =>
    q.one<{ id: string }>(
      `select p.id from public.profiles p
        join public.workspace_memberships m on m.user_id = p.id and m.status = 'ACTIU'
       where p.id = $1 and p.is_active limit 1`,
      [userId],
    ),
  );
  if (!exists) throw new Error('Usuari no vàlid.');
  await setSessionCookie(userId);
  redirect('/inici');
}

export default async function EntrarPage() {
  if (await getSession()) redirect('/inici');

  const users = await withServiceRole((q) =>
    q.many<{ id: string; email: string; first_name: string | null; last_name: string | null; role: string; workspace: string }>(
      `select p.id, p.email, p.first_name, p.last_name, m.role::text as role, w.name as workspace
         from public.profiles p
         join public.workspace_memberships m on m.user_id = p.id and m.status = 'ACTIU'
         join public.workspaces w on w.id = m.workspace_id
        where p.is_active
        order by case m.role when 'ADMIN' then 1 when 'GERENT' then 2 else 3 end, p.email`,
    ),
  );
  const backend = await backendKind();

  return (
    <main className="min-h-screen grid place-items-center p-6">
      <div className="w-full max-w-md">
        <header className="mb-7">
          <p className="etiqueta">CRM COMERCIAL</p>
          <h1 className="text-3xl font-semibold tracking-tight text-[var(--color-burgundy)] m-0">
            VITALPE
          </h1>
          <p className="text-[var(--color-ink-soft)] mt-1 mb-0">
            Vi a granel, base cava, DO Penedès i most.
          </p>
        </header>

        {SUPABASE_CONFIGURED ? (
          <section className="targeta p-5">
            <h2 className="etiqueta m-0 mb-3">ACCÉS</h2>
            <EntrarAmbCorreu />
          </section>
        ) : !LOCAL_PICKER_ALLOWED ? (
          <section className="targeta p-5">
            <h2 className="etiqueta m-0 mb-1">ACCÉS NO CONFIGURAT</h2>
            <p className="text-[13px] text-[var(--color-ink-soft)] mb-0">
              Aquest desplegament no té Supabase Auth configurat, i l&apos;accés local
              només funciona en desenvolupament. Cal definir{' '}
              <code>NEXT_PUBLIC_SUPABASE_URL</code> i{' '}
              <code>NEXT_PUBLIC_SUPABASE_ANON_KEY</code> a les variables d&apos;entorn.
            </p>
          </section>
        ) : (
          <section className="targeta p-5">
            <h2 className="etiqueta m-0 mb-1">ACCÉS LOCAL DE DESENVOLUPAMENT</h2>
            <p className="text-[13px] text-[var(--color-ink-soft)] mt-0">
              Supabase Auth no està configurat en aquest entorn ({backend}). Tria un usuari de
              l&apos;espai de treball per continuar. En producció aquesta pantalla la substitueix
              l&apos;accés real amb Supabase Auth.
            </p>
            {users.length === 0 ? (
              <p className="text-[13px]">
                No hi ha cap usuari. Executa <code>pnpm import:run</code> per crear
                l&apos;espai de treball i els usuaris inicials.
              </p>
            ) : (
              <ul className="list-none p-0 m-0 grid gap-2">
                {users.map((u) => (
                  <li key={u.id}>
                    <form action={signInLocally}>
                      <input type="hidden" name="userId" value={u.id} />
                      <button
                        type="submit"
                        className="w-full text-left border border-[var(--color-line-strong)] rounded-[var(--radius-sm)] bg-[var(--color-paper-raised)] hover:bg-[var(--color-paper-sunken)] p-3 cursor-pointer flex items-center justify-between gap-3"
                      >
                        <span>
                          <span className="block font-semibold">
                            {[u.first_name, u.last_name].filter(Boolean).join(' ') || u.email}
                          </span>
                          <span className="block text-[12px] text-[var(--color-ink-faint)]">
                            {u.email} · {u.workspace}
                          </span>
                        </span>
                        <span className="estat estat-marca">{u.role}</span>
                      </button>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
