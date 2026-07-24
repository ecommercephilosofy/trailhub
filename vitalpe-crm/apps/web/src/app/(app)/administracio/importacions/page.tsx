import Link from 'next/link';
import { query, requireRole } from '@/lib/auth';
import { formatDateTime, formatNumber } from '@/lib/format';
import { undoImport, abandonImport } from '@/lib/actions/imports';
import { AccioBoto } from '@/components/admin/accions';

export const dynamic = 'force-dynamic';

/**
 * IMPORTACIONS — past runs with their reconciliation identity, per-file
 * detail, what was excluded and why, and undo where it is still safe.
 *
 * The reconciliation line is the contract of every import:
 *   rows read = imported + ignored + rejected + excluded.
 * It is recomputed here from import_rows, not read from the stored stats, so
 * this screen cannot show a number the database does not back.
 */

interface ImportRow {
  id: string;
  label: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  undone_at: string | null;
  read: string;
  imported: string;
  ignored: string;
  rejected: string;
  excluded: string;
  pending: string;
  files: { filename: string; sha256: string; sheets: number; rows: number }[] | null;
  excluded_by_module: { module: string; n: string }[] | null;
}

const STATUS_TONE: Record<string, string> = {
  APLICAT: 'estat-ok',
  DESFET: 'estat-neutre',
  ERROR: 'estat-perill',
  BORRADOR: 'estat-avis',
  INSPECCIONAT: 'estat-avis',
  MAPEJAT: 'estat-avis',
  NORMALITZAT: 'estat-avis',
};

export default async function ImportacionsPage() {
  const session = await requireRole('ADMIN', 'GERENT');
  const admin = session.role === 'ADMIN';

  const imports = await query(session, (q) =>
    q.many<ImportRow>(
      `select i.id::text as id, i.label, i.status::text as status,
              i.started_at::text as started_at, i.finished_at::text as finished_at,
              i.undone_at::text as undone_at,
              (select count(*)::text from public.import_rows r where r.import_id = i.id) as read,
              (select count(*)::text from public.import_rows r where r.import_id = i.id and r.outcome = 'IMPORTADA') as imported,
              (select count(*)::text from public.import_rows r where r.import_id = i.id and r.outcome = 'IGNORADA') as ignored,
              (select count(*)::text from public.import_rows r where r.import_id = i.id and r.outcome = 'REBUTJADA') as rejected,
              (select count(*)::text from public.import_rows r where r.import_id = i.id and r.outcome = 'EXCLOSA') as excluded,
              (select count(*)::text from public.import_rows r where r.import_id = i.id and r.outcome = 'PENDENT') as pending,
              (select json_agg(json_build_object(
                       'filename', f.filename, 'sha256', f.sha256,
                       'sheets', (select count(*) from public.import_sheets s where s.import_file_id = f.id),
                       'rows', (select coalesce(sum(s.rows_read), 0) from public.import_sheets s where s.import_file_id = f.id))
                       order by f.filename)
                 from public.import_files f where f.import_id = i.id) as files,
              (select json_agg(json_build_object('module', e.module, 'n', e.n))
                 from (select module, count(*)::text as n from public.excluded_records x
                        where x.import_id = i.id group by module order by module) e) as excluded_by_module
         from public.imports i
        where i.workspace_id = $1
        order by i.started_at desc`,
      [session.workspaceId],
    ),
  );

  return (
    <div className="grid gap-6 max-w-[1100px]">
      <header>
        <p className="etiqueta m-0">
          <Link href="/administracio">ADMINISTRACIÓ</Link> / IMPORTACIONS
        </p>
        <h1 className="text-2xl font-semibold tracking-tight m-0">IMPORTACIONS</h1>
        <p className="text-[13px] text-[var(--color-ink-soft)] mt-1 mb-0 max-w-[68ch]">
          Cada execució conserva els fitxers amb la seva empremta SHA-256, cada fila amb el seu
          resultat i el seu motiu, i la identitat de reconciliació es recalcula aquí des de la
          base de dades — no es llegeix d&apos;un comptador desat.
        </p>
      </header>

      <div className="targeta p-4 text-[13px]">
        <p className="etiqueta m-0 mb-1">IMPORTAR FITXERS NOUS</p>
        <p className="m-0 text-[var(--color-ink-soft)]">
          Els fitxers nous es deixen a <code>data/sources/</code> i s&apos;executa{' '}
          <code>pnpm import:run</code> des del terminal, amb el servidor local aturat. El
          procés és idempotent: reimportar el mateix fitxer no duplica res, i tot passa primer
          per la zona d&apos;aterratge amb detecció de duplicats. Els informes complets queden a{' '}
          <code>docs/imports/&lt;data&gt;/</code>.
        </p>
      </div>

      {imports.length === 0 ? (
        <p className="targeta p-4 m-0 text-[13px]">Cap importació registrada.</p>
      ) : (
        <ul className="list-none p-0 m-0 grid gap-4">
          {imports.map((imp) => {
            const read = Number(imp.read);
            const accounted =
              Number(imp.imported) + Number(imp.ignored) + Number(imp.rejected) + Number(imp.excluded) + Number(imp.pending);
            const reconciled = read === accounted && Number(imp.pending) === 0;
            return (
              <li key={imp.id} className="targeta p-4 grid gap-3">
                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <div>
                    <p className="font-semibold m-0">{imp.label}</p>
                    <p className="text-[12px] text-[var(--color-ink-faint)] m-0">
                      {formatDateTime(imp.started_at)}
                      {imp.finished_at ? ` → ${formatDateTime(imp.finished_at)}` : ''}
                    </p>
                  </div>
                  <span className={`estat ${STATUS_TONE[imp.status] ?? 'estat-neutre'}`}>
                    {imp.undone_at ? 'DESFETA' : imp.status}
                  </span>
                </div>

                <div className="taula-ampla">
                  <table className="taula taula-compacta">
                    <thead>
                      <tr>
                        <th>LLEGIDES</th>
                        <th>IMPORTADES</th>
                        <th>IGNORADES</th>
                        <th>REBUTJADES</th>
                        <th>EXCLOSES</th>
                        <th>RECONCILIACIÓ</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr>
                        <td className="tabular-nums font-semibold">{formatNumber(read)}</td>
                        <td className="tabular-nums">{formatNumber(imp.imported)}</td>
                        <td className="tabular-nums">{formatNumber(imp.ignored)}</td>
                        <td className="tabular-nums">{formatNumber(imp.rejected)}</td>
                        <td className="tabular-nums">{formatNumber(imp.excluded)}</td>
                        <td>
                          {reconciled ? (
                            <span className="estat estat-ok">EXACTA</span>
                          ) : (
                            <span className="estat estat-perill">DESCUADRE</span>
                          )}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {imp.files && (
                  <details>
                    <summary className="cursor-pointer text-[12px] text-[var(--color-burgundy)]">
                      {imp.files.length} fitxers font
                    </summary>
                    <div className="taula-ampla mt-2">
                      <table className="taula taula-compacta">
                        <thead>
                          <tr>
                            <th>FITXER</th>
                            <th>FULLS</th>
                            <th>FILES</th>
                            <th>SHA-256</th>
                          </tr>
                        </thead>
                        <tbody>
                          {imp.files.map((f) => (
                            <tr key={f.filename}>
                              <td>{f.filename}</td>
                              <td className="tabular-nums">{f.sheets}</td>
                              <td className="tabular-nums">{formatNumber(f.rows)}</td>
                              <td>
                                <code className="text-[10px]">{f.sha256.slice(0, 16)}…</code>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </details>
                )}

                <div className="flex items-center justify-between gap-3 flex-wrap">
                  <p className="text-[12px] text-[var(--color-ink-faint)] m-0">
                    {imp.excluded_by_module
                      ? imp.excluded_by_module.map((e) => `${e.module}: ${e.n}`).join(' · ')
                      : 'sense exclusions'}
                  </p>
                  {admin && !imp.undone_at && imp.status === 'APLICAT' && (
                    <AccioBoto
                      accio={undoImport}
                      camps={{ id: imp.id }}
                      etiqueta="DESFER IMPORTACIÓ"
                      variant="perill"
                      titol="Només elimina el que aquesta importació va crear i ningú ha editat després"
                    />
                  )}
                  {admin && ['BORRADOR', 'INSPECCIONAT', 'MAPEJAT', 'NORMALITZAT', 'ERROR'].includes(imp.status) && (
                    <AccioBoto
                      accio={abandonImport}
                      camps={{ id: imp.id }}
                      etiqueta="ABANDONAR ESBORRANY"
                    />
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
