import { getSession, query } from '@/lib/auth';

/**
 * Per-import error CSV: the rows that did not become data, with the reason and
 * the original cells. Read through the caller's RLS context — `import_rows` is
 * manager-only, so a COMERCIAL downloads an empty file rather than a secret.
 *
 * A static segment wins over `[dataset]`, so this lives at /api/export/errors.
 */

export const dynamic = 'force-dynamic';

const KINDS: Record<string, string[]> = {
  rebutjades: ['REBUTJADA'],
  excloses: ['EXCLOSA'],
  ignorades: ['IGNORADA'],
  totes: ['REBUTJADA', 'EXCLOSA', 'IGNORADA'],
};

function cell(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export async function GET(request: Request): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response('Cal iniciar sessió.', { status: 401 });

  const url = new URL(request.url);
  const importId = url.searchParams.get('import') ?? '';
  const kind = url.searchParams.get('tipus') ?? 'totes';
  const outcomes = KINDS[kind];
  if (!/^[0-9a-fA-F-]{36}$/.test(importId) || !outcomes) {
    return new Response('Paràmetres no vàlids.', { status: 400 });
  }

  const rows = await query(session, (q) =>
    q.many<Record<string, unknown>>(
      `select f.filename, s.sheet_name, r.row_number, r.outcome, r.outcome_reason, r.raw::text as raw
         from public.import_rows r
         join public.import_sheets s on s.id = r.import_sheet_id
         join public.import_files f on f.id = s.import_file_id
        where r.import_id = $1 and r.outcome = any($2)
        order by f.filename, s.sheet_name, r.row_number`,
      [importId, outcomes],
    ),
  );

  const header = ['FITXER', 'FULL', 'FILA', 'RESULTAT', 'MOTIU', 'DADES ORIGINALS'];
  const body = rows.map((r) =>
    [r.filename, r.sheet_name, r.row_number, r.outcome, r.outcome_reason, r.raw]
      .map(cell)
      .join(','),
  );
  const csv = `﻿${[header.join(','), ...body].join('\n')}\n`;

  return new Response(csv, {
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="vitalpe-importacio-${kind}-${importId.slice(0, 8)}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
