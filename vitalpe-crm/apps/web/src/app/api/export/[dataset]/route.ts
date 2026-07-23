import ExcelJS from 'exceljs';
import { getSession, isManager } from '@/lib/auth';
import { buildExport, findDataset, type SheetPayload } from '@/lib/actions/exports';

/**
 * Excel / CSV download.
 *
 * The queries run inside the caller's RLS context (see lib/actions/exports.ts),
 * so the file contains exactly the rows that person could already read on
 * screen — no more, and no filter to forget. Column lists are explicit: no
 * `select *`, so a column added to a table later cannot silently start being
 * exported.
 */

export const dynamic = 'force-dynamic';

function csvCell(value: string | number | null): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  return /[",\n;]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function toCsv(sheets: SheetPayload[]): string {
  // CSV is one table: several sheets are concatenated with a titled separator
  // rather than silently losing all but the first.
  const blocks = sheets.map((s) => {
    const head = s.headers.map(csvCell).join(',');
    const body = s.rows.map((r) => r.map(csvCell).join(','));
    return [`# ${s.name}`, head, ...body].join('\n');
  });
  // BOM so Excel opens accented Catalan text correctly.
  return `﻿${blocks.join('\n\n')}\n`;
}

export async function GET(
  request: Request,
  context: { params: Promise<{ dataset: string }> },
): Promise<Response> {
  const session = await getSession();
  if (!session) return new Response('Cal iniciar sessió.', { status: 401 });

  const { dataset } = await context.params;
  const spec = findDataset(dataset);
  if (!spec) return new Response('Aquesta exportació no existeix.', { status: 404 });
  if (spec.managerOnly && !isManager(session.role)) {
    return new Response('El teu rol no pot exportar aquestes dades.', { status: 403 });
  }

  const url = new URL(request.url);
  const format = url.searchParams.get('format') === 'csv' ? 'csv' : 'xlsx';

  let payload;
  try {
    payload = await buildExport(session, spec, url.searchParams);
  } catch (error) {
    console.error('[export]', (error as Error).message);
    return new Response('No s’ha pogut generar l’exportació.', { status: 500 });
  }

  if (format === 'csv') {
    return new Response(toCsv(payload.sheets), {
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${payload.filename}.csv"`,
        'cache-control': 'no-store',
      },
    });
  }

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'VITALPE CRM';
  workbook.created = new Date();
  for (const s of payload.sheets) {
    const ws = workbook.addWorksheet(s.name || 'FULL');
    ws.addRow(s.headers);
    for (const row of s.rows) ws.addRow(row);
    ws.getRow(1).font = { bold: true };
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: Math.max(1, s.headers.length) },
    };
    s.headers.forEach((header, index) => {
      const sample = s.rows.slice(0, 200).map((r) => String(r[index] ?? '').length);
      const width = Math.min(52, Math.max(header.length + 2, ...sample, 8));
      ws.getColumn(index + 1).width = width;
    });
  }

  const buffer = await workbook.xlsx.writeBuffer();
  return new Response(buffer as ArrayBuffer, {
    headers: {
      'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'content-disposition': `attachment; filename="${payload.filename}.xlsx"`,
      'cache-control': 'no-store',
    },
  });
}
