import Link from 'next/link';
import { requireRole } from '@/lib/auth';
import { DATASETS } from '@/lib/actions/exports';

export const dynamic = 'force-dynamic';

/**
 * EXPORTACIONS — every dataset downloads through /api/export/<slug>, which
 * rebuilds the query inside the caller's RLS context. What your role cannot
 * read, the file cannot contain; there is no separate "export permission" to
 * get wrong. Tokens, secrets and audio are structurally absent from the
 * datasets.
 */
export default async function ExportacionsPage() {
  const session = await requireRole('ADMIN', 'GERENT');

  const visible = DATASETS.filter((d) => !d.managerOnly || session.role !== 'COMERCIAL');

  return (
    <div className="grid gap-6 max-w-[900px]">
      <header>
        <p className="etiqueta m-0">
          <Link href="/administracio">ADMINISTRACIÓ</Link> / EXPORTACIONS
        </p>
        <h1 className="text-2xl font-semibold tracking-tight m-0">EXPORTAR A EXCEL</h1>
        <p className="text-[13px] text-[var(--color-ink-soft)] mt-1 mb-0 max-w-[68ch]">
          Cada fitxer es genera amb els teus permisos: el que el teu rol no pot consultar,
          tampoc no es pot exportar. Dates llegibles, litres amb separador de milers, i mai
          tokens, secrets ni àudio.
        </p>
      </header>

      <ul className="list-none p-0 m-0 grid gap-2 md:grid-cols-2">
        {visible.map((d) => (
          <li key={d.slug} className="targeta p-4 flex flex-col gap-2">
            <div>
              <p className="font-semibold m-0">{d.label}</p>
              <p className="text-[12px] text-[var(--color-ink-soft)] m-0 mt-1">{d.description}</p>
            </div>
            <div className="mt-auto flex gap-2">
              <a className="boto boto-principal" href={`/api/export/${d.slug}`} download>
                DESCARREGAR XLSX
              </a>
            </div>
          </li>
        ))}
      </ul>

      <p className="text-[12px] text-[var(--color-ink-faint)] m-0">
        El llistat d&apos;empreses filtrat també s&apos;exporta directament des de{' '}
        <Link href="/clients">CLIENTS</Link> amb els filtres actius.
      </p>
    </div>
  );
}
