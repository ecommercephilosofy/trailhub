import Link from 'next/link';
import { isManager, query, type Session } from '@/lib/auth';
import { formatDateTime, relativeDays, TASK_TONE } from '@/lib/format';
import { TaskRowActions } from '@/components/task-row-actions';
import { EditorContactes, type ContacteRow } from '@/components/clients/editor-contactes';
import { EditorUbicacions, type UbicacioRow } from '@/components/clients/editor-ubicacions';
import {
  EditorOportunitats,
  type Lliurament,
  type OportunitatRow,
} from '@/components/clients/editor-oportunitats';
import { EditorHistorial, type AccioRow } from '@/components/clients/editor-historial';

/**
 * The tab bodies of a company card. Each one fetches only what its own tab
 * needs, so opening RESUM never pays for the audit log.
 */

export interface Catalegs {
  products: { id: string; name: string; category: string }[];
  campaigns: { id: string; name: string }[];
  defaultCampaignId: string | null;
}

export async function SeccioContactes({
  session,
  clientId,
  canEdit,
}: {
  session: Session;
  clientId: string;
  canEdit: boolean;
}): Promise<React.ReactElement> {
  const rows = await query(session, (q) =>
    q.many<ContacteRow>(
      `select id, first_name, last_name, role_title, phone_original, phone,
              email_original, email, contact_type::text as contact_type,
              is_primary, is_active, notes, source
         from public.contacts
        where client_id = $1::uuid and deleted_at is null
        order by is_primary desc, is_active desc, last_name nulls last, first_name nulls last`,
      [clientId],
    ),
  );
  return <EditorContactes clientId={clientId} contacts={rows} canEdit={canEdit} />;
}

export async function SeccioUbicacions({
  session,
  clientId,
  canEdit,
}: {
  session: Session;
  clientId: string;
  canEdit: boolean;
}): Promise<React.ReactElement> {
  const rows = await query(session, (q) =>
    q.many<UbicacioRow>(
      `select id, name, location_type::text as location_type, street, postal_code, municipality,
              comarca, province, formatted_address, latitude, longitude, geocode_source,
              verified_by_user, is_primary, geofence_enabled, geofence_radius_m, notes
         from public.client_locations
        where client_id = $1::uuid and deleted_at is null
        order by is_primary desc, created_at`,
      [clientId],
    ),
  );
  return <EditorUbicacions clientId={clientId} locations={rows} canEdit={canEdit} />;
}

export async function SeccioOportunitats({
  session,
  clientId,
  canEdit,
  catalegs,
}: {
  session: Session;
  clientId: string;
  canEdit: boolean;
  catalegs: Catalegs;
}): Promise<React.ReactElement> {
  const data = await query(session, async (q) => {
    const rows = await q.many<Omit<OportunitatRow, 'deliveries'>>(
      `select o.id, o.product_id, p.name as product_name, p.category as product_category,
              o.campaign_id, ca.name as campaign_name,
              o.data_type::text as data_type, o.volume_liters::text as volume_liters,
              o.forecast_next::text as forecast_next, o.status::text as status,
              o.notes, o.source
         from public.opportunities o
         join public.products p on p.id = o.product_id
         join public.campaigns ca on ca.id = o.campaign_id
        where o.client_id = $1::uuid and o.deleted_at is null
        order by ca.year_start desc, p.category, p.name`,
      [clientId],
    );
    const deliveries = await q.many<Lliurament & { opportunity_id: string }>(
      `select d.id, d.opportunity_id, d.guide_number, d.guide_date::text as guide_date,
              d.volume_liters::text as volume_liters, d.raw_product
         from public.opportunity_deliveries d
         join public.opportunities o on o.id = d.opportunity_id
        where o.client_id = $1::uuid and o.deleted_at is null
        order by d.guide_date desc nulls last`,
      [clientId],
    );
    return { rows, deliveries };
  });

  const byOpportunity = new Map<string, Lliurament[]>();
  for (const delivery of data.deliveries) {
    const list = byOpportunity.get(delivery.opportunity_id) ?? [];
    list.push(delivery);
    byOpportunity.set(delivery.opportunity_id, list);
  }

  const rows: OportunitatRow[] = data.rows.map((row) => ({
    ...row,
    deliveries: byOpportunity.get(row.id) ?? [],
  }));

  return (
    <EditorOportunitats
      clientId={clientId}
      rows={rows}
      products={catalegs.products}
      campaigns={catalegs.campaigns}
      defaultCampaignId={catalegs.defaultCampaignId}
      canEdit={canEdit}
    />
  );
}

export async function SeccioHistorial({
  session,
  clientId,
  canEdit,
  catalegs,
}: {
  session: Session;
  clientId: string;
  canEdit: boolean;
  catalegs: Catalegs;
}): Promise<React.ReactElement> {
  const rows = await query(session, (q) =>
    q.many<AccioRow>(
      `select a.id, a.occurred_on::text as occurred_on, a.activity_type::text as activity_type,
              a.result::text as result, a.notes,
              nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), '') as user_name,
              p.name as product_name, ca.name as campaign_name,
              a.origin::text as origin, a.corrects_activity_id::text as corrects_activity_id,
              exists (select 1 from public.activities x
                       where x.corrects_activity_id = a.id and x.deleted_at is null) as is_corrected,
              a.created_at
         from public.activities a
         left join public.profiles pr on pr.id = a.user_id
         left join public.products p on p.id = a.product_id
         left join public.campaigns ca on ca.id = a.campaign_id
        where a.client_id = $1::uuid and a.deleted_at is null
        order by a.occurred_on desc, a.created_at desc
        limit 200`,
      [clientId],
    ),
  );
  return (
    <EditorHistorial
      clientId={clientId}
      rows={rows}
      canEdit={canEdit}
      manager={isManager(session.role)}
      products={catalegs.products}
      campaigns={catalegs.campaigns}
    />
  );
}

interface TascaRow {
  id: string;
  kind: string;
  action: string;
  other_action: string | null;
  title: string | null;
  due_at: string | null;
  priority: string;
  status: string;
  result: string | null;
  notes: string | null;
  assignee: string | null;
  sample_subtype: string | null;
}

export async function SeccioTasques({
  session,
  clientId,
  clientName,
}: {
  session: Session;
  clientId: string;
  clientName: string;
}): Promise<React.ReactElement> {
  const rows = await query(session, (q) =>
    q.many<TascaRow>(
      `select t.id, t.kind::text as kind, t.action::text as action, t.other_action, t.title,
              t.due_at, t.priority::text as priority, t.status::text as status,
              t.result::text as result, t.notes,
              t.sample_subtype::text as sample_subtype,
              nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), '') as assignee
         from public.tasks t
         left join public.profiles pr on pr.id = t.assigned_to
        where t.client_id = $1::uuid and t.deleted_at is null
        order by t.status = 'FET', t.due_at nulls last, t.created_at desc
        limit 200`,
      [clientId],
    ),
  );

  const dated = rows.filter((r) => r.due_at !== null);
  const undated = rows.filter((r) => r.due_at === null);

  return (
    <section className="grid gap-4">
      <h2 className="etiqueta m-0">TASQUES ({rows.length})</h2>
      <TaulaTasques title="AMB DATA" rows={dated} clientName={clientName} />
      <TaulaTasques
        title="PROPERES ACCIONS SENSE DATA"
        rows={undated}
        clientName={clientName}
        hint="No compten com a vençudes ni ocupen el dia."
      />
    </section>
  );
}

function TaulaTasques({
  title,
  rows,
  clientName,
  hint,
}: {
  title: string;
  rows: TascaRow[];
  clientName: string;
  hint?: string;
}): React.ReactElement {
  return (
    <div className="grid gap-1">
      <p className="etiqueta m-0">
        {title} ({rows.length})
      </p>
      {hint && <p className="text-[11px] text-[var(--color-ink-faint)] m-0">{hint}</p>}
      {rows.length === 0 ? (
        <p className="targeta p-3 m-0 text-[13px] text-[var(--color-ink-faint)]">Res pendent.</p>
      ) : (
        <div className="taula-ampla targeta">
          <table className="taula">
            <thead>
              <tr>
                <th scope="col">DATA</th>
                <th scope="col">TIPUS</th>
                <th scope="col">ACCIÓ</th>
                <th scope="col">IMPORTÀNCIA</th>
                <th scope="col">ESTAT</th>
                <th scope="col">RESULTAT</th>
                <th scope="col">COMERCIAL</th>
                <th scope="col" className="text-right">
                  ACCIONS
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const overdue =
                  row.status === 'PENDENT' && row.due_at !== null && new Date(row.due_at) < new Date();
                return (
                  <tr key={row.id} className={overdue ? 'fila-vencuda' : ''}>
                    <td className="tabular-nums whitespace-nowrap">
                      {row.due_at ? formatDateTime(row.due_at) : '—'}
                      {overdue && (
                        <span className="block text-[11px] text-[var(--color-danger)]">
                          {relativeDays(row.due_at)}
                        </span>
                      )}
                    </td>
                    <td>{row.kind}</td>
                    <td>
                      {row.other_action ?? row.action}
                      {row.sample_subtype && (
                        <span className="block text-[11px] text-[var(--color-ink-faint)]">
                          {row.sample_subtype}
                        </span>
                      )}
                      {row.title && row.title !== row.action && (
                        <span className="block text-[11px] text-[var(--color-ink-soft)]">
                          {row.title}
                        </span>
                      )}
                    </td>
                    <td>{row.priority}</td>
                    <td>
                      <span className={TASK_TONE[row.status] ?? 'estat estat-neutre'}>
                        {row.status}
                      </span>
                    </td>
                    <td className="text-[var(--color-ink-soft)]">{row.result ?? '—'}</td>
                    <td className="text-[var(--color-ink-soft)]">{row.assignee ?? '—'}</td>
                    <td className="text-right">
                      {row.status === 'PENDENT' && (
                        <TaskRowActions
                          task={{ id: row.id, undated: row.due_at === null, clientName }}
                        />
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

interface VisitaRow {
  id: string;
  title: string | null;
  objective: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  result: string | null;
  notes_after: string | null;
  assignee: string | null;
  address: string | null;
  sync_state: string | null;
}

export async function SeccioVisites({
  session,
  clientId,
}: {
  session: Session;
  clientId: string;
}): Promise<React.ReactElement> {
  const rows = await query(session, (q) =>
    q.many<VisitaRow>(
      `select v.id, v.title, v.objective, v.starts_at, v.ends_at, v.status::text as status,
              v.result::text as result, v.notes_after,
              nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), '') as assignee,
              l.formatted_address as address,
              cel.status::text as sync_state
         from public.visits v
         left join public.profiles pr on pr.id = v.user_id
         left join public.client_locations l on l.id = v.location_id
         left join public.calendar_event_links cel on cel.visit_id = v.id
        where v.client_id = $1::uuid and v.deleted_at is null
        order by v.starts_at desc
        limit 100`,
      [clientId],
    ),
  );

  const now = Date.now();
  const upcoming = rows.filter((r) => new Date(r.starts_at).getTime() >= now).reverse();
  const past = rows.filter((r) => new Date(r.starts_at).getTime() < now);

  return (
    <section className="grid gap-4">
      <h2 className="etiqueta m-0">VISITES ({rows.length})</h2>
      <LlistaVisites title="PROPERES" rows={upcoming} />
      <LlistaVisites title="FETES" rows={past} />
    </section>
  );
}

function LlistaVisites({ title, rows }: { title: string; rows: VisitaRow[] }): React.ReactElement {
  return (
    <div className="grid gap-1">
      <p className="etiqueta m-0">
        {title} ({rows.length})
      </p>
      {rows.length === 0 ? (
        <p className="targeta p-3 m-0 text-[13px] text-[var(--color-ink-faint)]">Cap visita.</p>
      ) : (
        <ul className="list-none p-0 m-0 grid gap-2">
          {rows.map((row) => (
            <li key={row.id} className="targeta p-3 grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums font-semibold">{formatDateTime(row.starts_at)}</span>
                <span className="estat estat-neutre">{row.status}</span>
                {row.result && <span className="estat estat-marca">{row.result}</span>}
                {row.sync_state && (
                  <span
                    className={`estat ${
                      row.sync_state === 'SINCRONITZAT'
                        ? 'estat-ok'
                        : row.sync_state === 'ERROR'
                          ? 'estat-perill'
                          : 'estat-neutre'
                    }`}
                  >
                    {row.sync_state}
                  </span>
                )}
                <span className="ml-auto text-[11px] text-[var(--color-ink-faint)]">
                  {row.assignee ?? '—'}
                </span>
              </div>
              {row.title && <p className="m-0 text-[13px] font-semibold">{row.title}</p>}
              {row.objective && (
                <p className="m-0 text-[12px] text-[var(--color-ink-soft)]">{row.objective}</p>
              )}
              {row.address && (
                <p className="m-0 text-[11px] text-[var(--color-ink-faint)]">{row.address}</p>
              )}
              {row.notes_after && <p className="m-0 text-[12px] whitespace-pre-line">{row.notes_after}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export async function SeccioVeu({
  session,
  clientId,
}: {
  session: Session;
  clientId: string;
}): Promise<React.ReactElement> {
  const rows = await query(session, (q) =>
    q.many<{
      id: string;
      created_at: string;
      transcript: string | null;
      summary: string | null;
      transcription_status: string;
      interpretation_status: string;
      audio_duration_s: string | null;
      user_name: string | null;
    }>(
      `select v.id, v.created_at, v.transcript, v.summary,
              v.transcription_status::text as transcription_status,
              v.interpretation_status::text as interpretation_status,
              v.audio_duration_s::text as audio_duration_s,
              nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), '') as user_name
         from public.voice_notes v
         left join public.profiles pr on pr.id = v.user_id
        where v.client_id = $1::uuid
        order by v.created_at desc
        limit 50`,
      [clientId],
    ),
  );

  return (
    <section className="grid gap-3">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="etiqueta m-0">NOTES DE VEU ({rows.length})</h2>
        <Link className="boto" href={`/registre?client=${clientId}`}>
          GRAVAR NOTA DE VEU
        </Link>
      </header>
      <p className="text-[11px] text-[var(--color-ink-faint)] m-0">
        Aquí només es consulten. Les propostes d&apos;una nota es confirmen a REGISTRE.
      </p>
      {rows.length === 0 ? (
        <p className="targeta p-4 m-0 text-[13px] text-[var(--color-ink-faint)]">
          Cap nota de veu per a aquesta empresa.
        </p>
      ) : (
        <ul className="list-none p-0 m-0 grid gap-2">
          {rows.map((row) => (
            <li key={row.id} className="targeta p-3 grid gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="tabular-nums font-semibold">{formatDateTime(row.created_at)}</span>
                <span className="estat estat-neutre">
                  TRANSCRIPCIÓ: {row.transcription_status}
                </span>
                <span className="estat estat-neutre">
                  INTERPRETACIÓ: {row.interpretation_status}
                </span>
                <span className="ml-auto text-[11px] text-[var(--color-ink-faint)]">
                  {row.user_name ?? '—'}
                </span>
              </div>
              {row.summary && <p className="m-0 text-[13px] font-semibold">{row.summary}</p>}
              <p className="m-0 text-[13px] whitespace-pre-line">
                {row.transcript ?? (
                  <span className="text-[var(--color-ink-faint)]">PENDENT DE TRANSCRIURE</span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export async function SeccioAuditoria({
  session,
  clientId,
}: {
  session: Session;
  clientId: string;
}): Promise<React.ReactElement> {
  const rows = await query(session, (q) =>
    q.many<{
      id: string;
      entity: string;
      action: string;
      changed_fields: string[] | null;
      actor: string | null;
      origin: string;
      created_at: string;
    }>(
      `select l.id::text as id, l.entity, l.action, l.changed_fields,
              nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), '') as actor,
              l.origin::text as origin, l.created_at
         from public.audit_log l
         left join public.profiles pr on pr.id = l.actor_id
        where l.workspace_id = $2::uuid
          and (
            (l.entity = 'clients' and l.entity_id = $1)
            or coalesce(l.after_value, l.before_value) ->> 'client_id' = $1
          )
        order by l.created_at desc, l.id desc
        limit 150`,
      [clientId, session.workspaceId],
    ),
  );

  return (
    <section className="grid gap-3">
      <h2 className="etiqueta m-0">CANVIS / AUDITORIA ({rows.length})</h2>
      <p className="text-[11px] text-[var(--color-ink-faint)] m-0">
        Registre de només escriptura: cap canvi es pot esborrar d&apos;aquí. Es mostren els 150 més
        recents.
      </p>
      {rows.length === 0 ? (
        <p className="targeta p-4 m-0 text-[13px] text-[var(--color-ink-faint)]">
          Cap canvi registrat.
        </p>
      ) : (
        <div className="taula-ampla targeta max-h-[60vh] overflow-y-auto">
          <table className="taula taula-compacta">
            <thead>
              <tr>
                <th scope="col">QUAN</th>
                <th scope="col">ENTITAT</th>
                <th scope="col">CANVI</th>
                <th scope="col">CAMPS</th>
                <th scope="col">QUI</th>
                <th scope="col">ORIGEN</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.id}>
                  <td className="tabular-nums whitespace-nowrap">{formatDateTime(row.created_at)}</td>
                  <td>{row.entity}</td>
                  <td>{row.action}</td>
                  <td className="text-[var(--color-ink-soft)]">
                    {row.changed_fields?.join(', ') ?? '—'}
                  </td>
                  <td>{row.actor ?? 'Sistema'}</td>
                  <td>{row.origin}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
