import Link from 'next/link';
import { redirect } from 'next/navigation';
import { clearSessionCookie, isManager, requireSession } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * MÉS — the mobile overflow menu.
 *
 * The bottom bar holds the four things a commercial does every day; everything
 * else lives here. Sections the signed-in role cannot open are not listed:
 * hiding them is a courtesy, the database is what actually refuses.
 */

interface Entry {
  href: string;
  label: string;
  hint: string;
}

export default async function MesPage() {
  const session = await requireSession();
  const manager = isManager(session.role);
  const admin = session.role === 'ADMIN';

  async function signOut(): Promise<void> {
    'use server';
    await clearSessionCookie();
    redirect('/entrar');
  }

  const work: Entry[] = [
    { href: '/tasques', label: 'TASQUES', hint: 'Tot el que tens pendent, amb data i sense.' },
    { href: '/registre', label: 'REGISTRE', hint: 'Historial comercial de totes les empreses.' },
    { href: '/calendari', label: 'CALENDARI', hint: 'Visites de la setmana.' },
    { href: '/clients', label: 'CLIENTS', hint: 'Fitxes d’empresa, contactes i classificació.' },
  ];

  const administration: (Entry & { visible: boolean })[] = [
    {
      href: '/administracio/usuaris',
      label: 'USUARIS',
      hint: 'Membres, rols i invitacions.',
      visible: admin,
    },
    {
      href: '/administracio/productes',
      label: 'PRODUCTES',
      hint: 'Catàleg normalitzat i àlies d’importació.',
      visible: admin,
    },
    {
      href: '/administracio/importacions',
      label: 'IMPORTACIONS',
      hint: 'Informes d’importació, reconciliació i desfer.',
      visible: manager,
    },
    {
      href: '/administracio/duplicats',
      label: 'DUPLICATS',
      hint: 'Cua de revisió d’empreses possiblement repetides.',
      visible: manager,
    },
    {
      href: '/administracio/exportacions',
      label: 'EXPORTACIONS',
      hint: 'Excel i CSV de les dades que pots llegir.',
      visible: manager,
    },
    {
      href: '/administracio/auditoria',
      label: 'AUDITORIA',
      hint: 'Registre de canvis, només lectura.',
      visible: manager,
    },
    {
      href: '/administracio/integracions',
      label: 'INTEGRACIONS',
      hint: 'Google Calendar, transcripció, IA, geocodificació.',
      visible: admin,
    },
  ];

  const visibleAdmin = administration.filter((entry) => entry.visible);

  return (
    <div className="grid gap-6 max-w-[720px]">
      <header>
        <p className="etiqueta m-0">MENÚ</p>
        <h1 className="text-2xl font-semibold tracking-tight m-0">MÉS</h1>
      </header>

      <Section title="FEINA">
        {work.map((entry) => (
          <Item key={entry.href} {...entry} />
        ))}
      </Section>

      {visibleAdmin.length > 0 && (
        <Section title="ADMINISTRACIÓ">
          {visibleAdmin.map((entry) => (
            <Item key={entry.href} {...entry} />
          ))}
        </Section>
      )}

      <Section title="EL TEU COMPTE">
        <li className="targeta p-3">
          <p className="m-0 font-semibold">{session.fullName}</p>
          <p className="m-0 text-[12px] text-[var(--color-ink-faint)]">{session.email}</p>
          <p className="mt-2 mb-0">
            <span className="estat estat-marca">{session.role}</span>
          </p>
          <p className="text-[12px] text-[var(--color-ink-soft)] mt-2 mb-0">
            El rol el canvia un ADMIN des d’USUARIS. Ni aquesta pantalla ni cap altra et permet
            pujar-te el rol: ho impedeix la base de dades.
          </p>
        </li>
      </Section>

      <form action={signOut}>
        <button className="boto boto-perill" type="submit">
          TANCAR SESSIÓ
        </button>
      </form>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h2 className="etiqueta mb-2">{title}</h2>
      <ul className="list-none p-0 m-0 grid gap-2">{children}</ul>
    </section>
  );
}

function Item({ href, label, hint }: Entry) {
  return (
    <li>
      <Link
        href={href}
        className="targeta p-3 no-underline text-[var(--color-ink)] flex items-center justify-between gap-3 hover:bg-[var(--color-paper-sunken)]"
      >
        <span>
          <span className="block text-[13px] font-semibold tracking-[0.04em]">{label}</span>
          <span className="block text-[12px] text-[var(--color-ink-faint)]">{hint}</span>
        </span>
        <span aria-hidden className="text-[var(--color-ink-faint)]">
          →
        </span>
      </Link>
    </li>
  );
}
