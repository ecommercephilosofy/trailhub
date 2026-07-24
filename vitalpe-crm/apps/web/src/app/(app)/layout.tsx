import Link from 'next/link';
import { redirect } from 'next/navigation';
import { clearSessionCookie, isManager, requireSession } from '@/lib/auth';
import { NavLink } from '@/components/nav-link';
import { CercaGlobal } from '@/components/cerca-global';

/**
 * Application shell: sidebar on desktop, bottom bar on mobile.
 * The header stays compact so the working area is the page, not the chrome.
 */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  const manager = isManager(session.role);

  async function signOut(): Promise<void> {
    'use server';
    await clearSessionCookie();
    redirect('/entrar');
  }

  // The supervisor does not work the portfolio; she watches it. Her landing
  // page is SUPERVISIÓ, and the working tools (REGISTRE, TASQUES) are not
  // offered — the database refuses those writes anyway (migration 0008).
  const supervisor = session.role === 'GERENT';
  const home = supervisor ? '/supervisio' : '/inici';

  const nav = supervisor
    ? [
        { href: '/supervisio', label: 'SUPERVISIÓ' },
        { href: '/clients', label: 'CLIENTS' },
        { href: '/calendari', label: 'CALENDARI' },
      ]
    : [
        { href: '/inici', label: 'INICI' },
        { href: '/clients', label: 'CLIENTS' },
        { href: '/calendari', label: 'CALENDARI' },
        { href: '/tasques', label: 'TASQUES' },
        { href: '/registre', label: 'REGISTRE' },
      ];
  const admin = [
    { href: '/administracio/usuaris', label: 'USUARIS', adminOnly: true },
    { href: '/administracio/productes', label: 'PRODUCTES', adminOnly: true },
    { href: '/administracio/importacions', label: 'IMPORTACIONS', adminOnly: false },
    { href: '/administracio/exportacions', label: 'EXPORTACIONS', adminOnly: false },
    { href: '/administracio/duplicats', label: 'DUPLICATS', adminOnly: false },
    { href: '/administracio/auditoria', label: 'AUDITORIA', adminOnly: false },
    { href: '/administracio/integracions', label: 'INTEGRACIONS', adminOnly: true },
  ].filter((item) => (item.adminOnly ? session.role === 'ADMIN' : manager));

  return (
    <div className="min-h-screen md:grid md:grid-cols-[218px_1fr]">
      {/* ---------------- desktop sidebar ---------------- */}
      <aside className="hidden md:flex flex-col border-r border-[var(--color-line)] bg-[var(--color-paper-sunken)] sticky top-0 h-screen">
        <div className="px-4 py-4 border-b border-[var(--color-line)]">
          <Link href={home} className="no-underline">
            <span className="block text-[19px] font-semibold tracking-tight text-[var(--color-burgundy)]">
              VITALPE
            </span>
            <span className="etiqueta">CRM COMERCIAL</span>
          </Link>
        </div>

        <nav className="p-2 flex-1 overflow-y-auto" aria-label="Navegació principal">
          <ul className="list-none p-0 m-0 grid gap-[2px]">
            {nav.map((item) => (
              <li key={item.href}>
                <NavLink href={item.href}>{item.label}</NavLink>
              </li>
            ))}
          </ul>

          {admin.length > 0 && (
            <>
              <p className="etiqueta px-3 mt-5 mb-1">ADMINISTRACIÓ</p>
              <ul className="list-none p-0 m-0 grid gap-[2px]">
                {admin.map((item) => (
                  <li key={item.href}>
                    <NavLink href={item.href}>{item.label}</NavLink>
                  </li>
                ))}
              </ul>
            </>
          )}
        </nav>

        <div className="border-t border-[var(--color-line)] p-3">
          <p className="m-0 text-[13px] font-semibold leading-tight">{session.fullName}</p>
          <p className="m-0 text-[11px] text-[var(--color-ink-faint)]">{session.email}</p>
          <div className="flex items-center justify-between mt-2 gap-2">
            <span className="estat estat-marca">{session.role}</span>
            <form action={signOut}>
              <button className="boto" type="submit">
                SORTIR
              </button>
            </form>
          </div>
          <Link
            href="/mes"
            className="block mt-2 text-[11px] text-[var(--color-ink-faint)] no-underline hover:underline"
          >
            EL MEU COMPTE · CONTRASENYA
          </Link>
        </div>
      </aside>

      {/* ---------------- content ---------------- */}
      <div className="min-w-0 flex flex-col">
        <header className="sticky top-0 z-20 bg-[var(--color-paper)]/95 backdrop-blur border-b border-[var(--color-line)] px-4 py-2 flex items-center gap-3">
          <Link
            href={home}
            className="md:hidden text-[16px] font-semibold text-[var(--color-burgundy)] no-underline"
          >
            VITALPE
          </Link>
          <CercaGlobal />
        </header>

        <main className="flex-1 p-4 md:p-6 pb-24 md:pb-6 min-w-0">{children}</main>
      </div>

      {/* ---------------- mobile bottom bar ---------------- */}
      <nav
        className={`md:hidden fixed bottom-0 inset-x-0 z-30 bg-[var(--color-paper-raised)] border-t border-[var(--color-line-strong)] grid ${
          supervisor ? 'grid-cols-4' : 'grid-cols-5'
        }`}
        aria-label="Navegació"
      >
        {[...nav.slice(0, 4), { href: '/mes', label: 'MÉS' }].map((item) => (
          <NavLink key={item.href} href={item.href} variant="bottom">
            {item.label}
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
