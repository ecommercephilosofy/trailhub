import { NextResponse } from 'next/server';
import { getSession, query } from '@/lib/auth';
import { formatDate, formatDateTime } from '@/lib/format';
import { buildOrderBy, buildWhere, CLIENT_FROM, EXPORT_MAX, parseFilters } from '../filters';

/**
 * CSV of the current filtered list.
 *
 * The filters are re-applied SERVER-SIDE from the same query string and through
 * the same `buildWhere`, so the file can never contain a row the screen was
 * hiding — and never a row the user's RLS context would refuse.
 */

export const dynamic = 'force-dynamic';

interface ExportRow {
  name: string;
  municipality: string | null;
  comarca: string | null;
  province: string | null;
  tipus: string | null;
  dos: string | null;
  confirmed_classification: string | null;
  proposed_classification: string | null;
  verification_status: string;
  last_verified_at: string | null;
  last_contact_on: string | null;
  last_result: string | null;
  pending_tasks: number;
  overdue_tasks: number;
  next_visit_at: string | null;
  primary_contact_name: string | null;
  primary_contact_phone: string | null;
  primary_contact_email: string | null;
  geo_status: string | null;
  owner_name: string | null;
}

const HEADERS = [
  'EMPRESA', 'MUNICIPI', 'COMARCA', 'PROVINCIA', 'TIPUS', 'DO',
  'CLASSIFICACIO CONFIRMADA', 'CLASSIFICACIO PROPOSADA', 'VERIFICACIO', 'ULTIMA VERIFICACIO',
  'ULTIM CONTACTE', 'ULTIM RESULTAT', 'TASQUES PENDENTS', 'TASQUES VENCUDES',
  'PROPERA VISITA', 'CONTACTE PRINCIPAL', 'TELEFON', 'CORREU', 'GEOLOCALITZACIO', 'COMERCIAL',
];

/**
 * Escapes a value for CSV. A leading =, +, - or @ is prefixed with a quote so a
 * spreadsheet reads it as text and never as a formula.
 */
function cell(value: string | number | null | undefined): string {
  const text = value === null || value === undefined ? '' : String(value);
  const safe = /^[=+\-@\t\r]/.test(text) ? `'${text}` : text;
  return `"${safe.replace(/"/g, '""')}"`;
}

export async function GET(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ error: 'No autenticat.' }, { status: 401 });

  const url = new URL(request.url);
  const search = Object.fromEntries(url.searchParams.entries());
  const filters = parseFilters(search);
  const where = buildWhere(filters, session.workspaceId);

  const rows = await query(session, (q) =>
    q.many<ExportRow>(
      `select c.name, c.municipality, c.comarca, c.province,
              case when c.client_type_code = 'ALTRES'
                   then 'ALTRES: ' || coalesce(c.other_client_type, 'PENDENT DE REVISAR')
                   else c.client_type_code end as tipus,
              nullif(concat_ws(' / ',
                case when c.do_cava then 'CAVA' end,
                case when c.do_penedes then 'PENEDES' end,
                case when c.do_catalunya then 'CATALUNYA' end,
                case when c.do_altres then 'ALTRES' end), '') as dos,
              c.confirmed_classification::text as confirmed_classification,
              c.proposed_classification::text as proposed_classification,
              c.verification_status::text as verification_status,
              c.last_verified_at,
              d.last_contact_on, d.last_result::text as last_result,
              d.pending_tasks, d.overdue_tasks, d.next_visit_at,
              nullif(d.primary_contact_name, '') as primary_contact_name,
              d.primary_contact_phone, d.primary_contact_email,
              g.geo_status,
              nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), '') as owner_name
         ${CLIENT_FROM}
        where ${where.sql}
        order by ${buildOrderBy(filters)}
        limit ${EXPORT_MAX}`,
      where.params,
    ),
  );

  const lines = [HEADERS.map(cell).join(';')];
  for (const row of rows) {
    lines.push(
      [
        row.name,
        row.municipality,
        row.comarca,
        row.province,
        row.tipus ?? 'NO DETERMINAT',
        row.dos,
        row.confirmed_classification ?? 'PENDENT DE REVISAR',
        row.proposed_classification,
        row.verification_status,
        row.last_verified_at ? formatDate(row.last_verified_at) : '',
        row.last_contact_on ? formatDate(row.last_contact_on) : '',
        row.last_result,
        row.pending_tasks,
        row.overdue_tasks,
        row.next_visit_at ? formatDateTime(row.next_visit_at) : '',
        row.primary_contact_name,
        row.primary_contact_phone,
        row.primary_contact_email,
        row.geo_status ?? 'PENDENT DE GEOLOCALITZAR',
        row.owner_name ?? 'SENSE ASSIGNAR',
      ]
        .map(cell)
        .join(';'),
    );
  }

  const stamp = new Date().toISOString().slice(0, 10);
  // BOM so Excel in Spanish locale opens the accents correctly.
  const body = `﻿${lines.join('\r\n')}\r\n`;

  return new NextResponse(body, {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="clients-vitalpe-${stamp}.csv"`,
      'cache-control': 'no-store',
    },
  });
}
