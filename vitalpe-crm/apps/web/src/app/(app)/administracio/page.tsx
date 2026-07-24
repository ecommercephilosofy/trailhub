import Link from 'next/link';
import { isManager, query, requireRole } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * ADMINISTRACIÓ — index. Reading anything in this section is a manager action,
 * so a COMERCIAL never gets here; `requireRole` sends them back to INICI.
 */
export default async function AdministracioPage() {
  const session = await requireRole('ADMIN', 'GERENT');
  const admin = session.role === 'ADMIN';

  const counts = await query(session, (q) =>
    q.one<{ imports: string; pending: string; unmapped: string; excluded: string; members: string }>(
      `select
         (select count(*)::text from public.imports where workspace_id = $1) as imports,
         (select count(*)::text from public.duplicate_candidates
           where workspace_id = $1 and decision = 'PENDENT') as pending,
         (select count(*)::text from public.unmapped_values
           where workspace_id = $1 and resolved_at is null) as unmapped,
         (select count(*)::text from public.excluded_records where workspace_id = $1) as excluded,
         (select count(*)::text from public.workspace_memberships
           where workspace_id = $1 and status = 'ACTIU') as members`,
      [session.workspaceId],
    ),
  );

  const cards = [
    {
      href: '/administracio/usuaris',
      label: 'USUARIS',
      hint: 'Membres, rols, invitacions i baixes.',
      value: `${counts?.members ?? '0'} actius`,
      visible: admin,
    },
    {
      href: '/administracio/productes',
      label: 'PRODUCTES',
      hint: 'Catàleg normalitzat, àlies i valors sense mapatge.',
      value: `${counts?.unmapped ?? '0'} valors sense mapar`,
      visible: admin,
    },
    {
      href: '/administracio/importacions',
      label: 'IMPORTACIONS',
      hint: 'Informes, reconciliació i desfer. Els fitxers nous entren per pnpm import:run.',
      value: `${counts?.imports ?? '0'} importacions`,
      visible: true,
    },
    {
      href: '/administracio/duplicats',
      label: 'DUPLICATS',
      hint: 'Cua de revisió. Res es fusiona sol.',
      value: `${counts?.pending ?? '0'} pendents`,
      visible: true,
    },
    {
      href: '/administracio/exportacions',
      label: 'EXPORTACIONS',
      hint: 'Excel i CSV del que el teu rol pot llegir.',
      value: '',
      visible: true,
    },
    {
      href: '/administracio/auditoria',
      label: 'AUDITORIA',
      hint: 'Qui va canviar què, quan i des d’on. Només lectura.',
      value: '',
      visible: true,
    },
    {
      href: '/administracio/integracions',
      label: 'INTEGRACIONS',
      hint: 'Estat de Google Calendar, transcripció, IA i geocodificació.',
      value: '',
      visible: admin,
    },
  ].filter((c) => (isManager(session.role) ? c.visible : false));

  return (
    <div className="grid gap-6 max-w-[900px]">
      <header>
        <p className="etiqueta m-0">VITALPE</p>
        <h1 className="text-2xl font-semibold tracking-tight m-0">ADMINISTRACIÓ</h1>
      </header>

      <ul className="list-none p-0 m-0 grid gap-2 md:grid-cols-2">
        {cards.map((c) => (
          <li key={c.href}>
            <Link
              href={c.href}
              className="targeta p-3 no-underline text-[var(--color-ink)] block hover:bg-[var(--color-paper-sunken)] h-full"
            >
              <span className="block text-[13px] font-semibold tracking-[0.04em]">{c.label}</span>
              <span className="block text-[12px] text-[var(--color-ink-faint)]">{c.hint}</span>
              {c.value && (
                <span className="block text-[12px] mt-1 font-mono tabular-nums">{c.value}</span>
              )}
            </Link>
          </li>
        ))}
      </ul>

      {!admin && (
        <p className="targeta p-3 m-0 text-[13px]">
          Com a GERENT pots consultar importacions, duplicats, exportacions i auditoria. Executar una
          importació, decidir un duplicat, canviar rols o tocar el catàleg són accions d’ADMIN, i qui
          ho impedeix són les polítiques de la base de dades, no aquesta pantalla.
        </p>
      )}
    </div>
  );
}
