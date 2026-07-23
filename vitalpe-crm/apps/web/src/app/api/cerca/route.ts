import { NextResponse } from 'next/server';
import { getSession, query } from '@/lib/auth';

/**
 * Global search. Runs entirely inside the user's RLS context, so a COMERCIAL
 * can never surface a row they are not allowed to read.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const session = await getSession();
  if (!session) return NextResponse.json({ hits: [] }, { status: 401 });

  const term = new URL(request.url).searchParams.get('q')?.trim() ?? '';
  if (term.length < 2) return NextResponse.json({ hits: [] });

  const hits = await query(session, async (q) => {
    const rows = await q.many<{
      kind: string; id: string; title: string; subtitle: string; rank: number;
    }>(
      `(
         select 'EMPRESA' as kind, c.id::text as id, c.name as title,
                concat_ws(' · ', nullif(c.municipality, ''), nullif(c.province, ''),
                          coalesce(c.confirmed_classification::text, c.proposed_classification::text)) as subtitle,
                greatest(similarity(c.name_norm, app.normalize_company($1)),
                         case when c.name ilike '%' || $1 || '%' then 0.9 else 0 end) as rank
           from public.clients c
          where c.workspace_id = $2 and c.deleted_at is null
            and (c.name ilike '%' || $1 || '%'
                 or c.name_norm % app.normalize_company($1)
                 or c.municipality ilike '%' || $1 || '%')
          limit 12
       )
       union all
       (
         select 'EMPRESA', c.id::text, c.name,
                concat('àlies: ', a.alias), 0.75
           from public.client_aliases a
           join public.clients c on c.id = a.client_id and c.deleted_at is null
          where a.workspace_id = $2
            and (a.alias ilike '%' || $1 || '%' or a.alias_norm % app.normalize_company($1))
          limit 8
       )
       union all
       (
         select 'CONTACTE', c.id::text,
                nullif(btrim(concat_ws(' ', ct.first_name, ct.last_name)), ''),
                concat_ws(' · ', c.name, ct.email, ct.phone), 0.7
           from public.contacts ct
           join public.clients c on c.id = ct.client_id and c.deleted_at is null
          where ct.workspace_id = $2 and ct.deleted_at is null
            and (ct.first_name ilike '%' || $1 || '%'
                 or ct.last_name ilike '%' || $1 || '%'
                 or ct.email ilike '%' || $1 || '%'
                 or ct.phone like '%' || regexp_replace($1, '\\D', '', 'g') || '%')
          limit 8
       )
       union all
       (
         select 'PRODUCTE', p.id::text, p.name, p.category, 0.5
           from public.products p
          where p.deleted_at is null and p.name ilike '%' || $1 || '%'
          limit 5
       )
       order by rank desc nulls last
       limit 20`,
      [term, session.workspaceId],
    );

    return rows
      .filter((r) => r.title)
      .map((r) => ({
        kind: r.kind,
        id: r.id,
        title: r.title,
        subtitle: r.subtitle ?? '',
        href:
          r.kind === 'PRODUCTE'
            ? `/administracio/productes#${r.id}`
            : `/clients/${r.id}`,
      }));
  });

  return NextResponse.json({ hits });
}
