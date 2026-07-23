import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isManager, query, requireSession, type Session } from '@/lib/auth';
import {
  CLASSIFICATION_TONE,
  formatDate,
  formatDateTime,
  formatLiters,
  relativeDays,
  VERIFICATION_TONE,
} from '@/lib/format';
import { AccionsRapides } from '@/components/clients/accions-rapides';
import { BlocClassificacio } from '@/components/clients/bloc-classificacio';
import { EditorDades } from '@/components/clients/editor-dades';
import {
  SeccioAuditoria,
  SeccioContactes,
  SeccioHistorial,
  SeccioOportunitats,
  SeccioTasques,
  SeccioUbicacions,
  SeccioVeu,
  SeccioVisites,
  type Catalegs,
} from './seccions';

export const dynamic = 'force-dynamic';

/**
 * FITXA D'EMPRESA.
 *
 * The tab lives in the query string, not in component state, so every tab is a
 * link a person can send to a colleague. The header answers "what is this
 * company and what is pending"; the detail lives in the tabs and is not
 * repeated on RESUM.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TABS = [
  { key: 'resum', label: 'RESUM' },
  { key: 'contactes', label: 'CONTACTES' },
  { key: 'ubicacions', label: 'UBICACIONS' },
  { key: 'oportunitats', label: 'VINS I OPORTUNITATS' },
  { key: 'historial', label: 'HISTORIAL COMERCIAL' },
  { key: 'tasques', label: 'TASQUES' },
  { key: 'visites', label: 'VISITES' },
  { key: 'veu', label: 'NOTES DE VEU' },
  { key: 'auditoria', label: 'CANVIS/AUDITORIA', managerOnly: true },
] as const;

interface Capcalera {
  id: string;
  name: string;
  legal_name: string | null;
  tax_id: string | null;
  municipality: string | null;
  comarca: string | null;
  province: string | null;
  website: string | null;
  client_type_code: string | null;
  other_client_type: string | null;
  do_cava: boolean;
  do_penedes: boolean;
  do_catalunya: boolean;
  do_altres: boolean;
  proposed_classification: string | null;
  confirmed_classification: string | null;
  classification_confirmed_at: string | null;
  confirmed_by_name: string | null;
  not_potential_reason: string | null;
  verification_status: string;
  last_verified_at: string | null;
  verification_source: string | null;
  verification_note: string | null;
  general_notes: string | null;
  external_account_code: string | null;
  owner_id: string | null;
  owner_name: string | null;
  last_contact_on: string | null;
  last_result: string | null;
  pending_tasks: number;
  overdue_tasks: number;
  undated_tasks: number;
  next_task_at: string | null;
  next_visit_at: string | null;
  opportunities_count: number;
  primary_contact_name: string | null;
  primary_contact_phone: string | null;
  primary_contact_email: string | null;
  has_classification_discrepancy: boolean;
  verification_is_stale: boolean;
  geo_status: string;
}

export default async function FitxaClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ tab?: string }>;
}): Promise<React.ReactElement> {
  const session = await requireSession();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const { tab } = await searchParams;
  const manager = isManager(session.role);

  const data = await query(session, async (q) => {
    const client = await q.one<Capcalera>(
      `select c.id, c.name, c.legal_name, c.tax_id, c.municipality, c.comarca, c.province,
              c.website, c.client_type_code, c.other_client_type,
              c.do_cava, c.do_penedes, c.do_catalunya, c.do_altres,
              c.proposed_classification::text as proposed_classification,
              c.confirmed_classification::text as confirmed_classification,
              c.classification_confirmed_at,
              nullif(btrim(concat_ws(' ', cb.first_name, cb.last_name)), '') as confirmed_by_name,
              c.not_potential_reason,
              c.verification_status::text as verification_status,
              c.last_verified_at, c.verification_source, c.verification_note,
              c.general_notes, c.external_account_code, c.owner_id,
              nullif(btrim(concat_ws(' ', pr.first_name, pr.last_name)), '') as owner_name,
              d.last_contact_on, d.last_result::text as last_result,
              d.pending_tasks, d.overdue_tasks, d.undated_tasks, d.next_task_at,
              d.next_visit_at, d.opportunities_count,
              nullif(d.primary_contact_name, '') as primary_contact_name,
              d.primary_contact_phone, d.primary_contact_email,
              d.has_classification_discrepancy, d.verification_is_stale,
              coalesce(g.geo_status, 'PENDENT DE GEOLOCALITZAR') as geo_status
         from public.clients c
         join public.v_client_derived d on d.client_id = c.id
         left join public.v_client_geo_status g on g.client_id = c.id
         left join public.profiles pr on pr.id = c.owner_id
         left join public.profiles cb on cb.id = c.classification_confirmed_by
        where c.id = $1::uuid and c.workspace_id = $2::uuid and c.deleted_at is null`,
      [id, session.workspaceId],
    );
    if (!client) return null;

    const [canEdit, location, duplicates, types, comercials, products, campaigns, aliases] =
      await Promise.all([
        q.one<{ ok: boolean }>(`select app.can_edit_client($1::uuid) as ok`, [id]),
        q.one<{
          id: string;
          formatted_address: string | null;
          latitude: number | null;
          longitude: number | null;
        }>(
          `select id, formatted_address, latitude, longitude
             from public.client_locations
            where client_id = $1::uuid and deleted_at is null
            order by is_primary desc, created_at limit 1`,
          [id],
        ),
        q.one<{ n: string }>(
          `select count(*)::text as n from public.duplicate_candidates
            where decision = 'PENDENT' and (left_client_id = $1::uuid or right_client_id = $1::uuid)`,
          [id],
        ),
        q.many<{ code: string; label: string }>(
          `select code, label from public.client_types where is_active order by sort_order, label`,
        ),
        q.many<{ id: string; name: string }>(
          `select p.id, coalesce(nullif(btrim(concat_ws(' ', p.first_name, p.last_name)), ''), p.email) as name
             from public.profiles p
             join public.workspace_memberships m
               on m.user_id = p.id and m.workspace_id = $1::uuid and m.status = 'ACTIU'
            order by name`,
          [session.workspaceId],
        ),
        q.many<{ id: string; name: string; category: string }>(
          `select id, name, category from public.products
            where deleted_at is null and is_active order by category, name`,
        ),
        q.many<{ id: string; name: string; status: string }>(
          `select id, name, status from public.campaigns order by year_start desc`,
        ),
        q.many<{ alias: string; source: string | null }>(
          `select alias, source from public.client_aliases
            where client_id = $1::uuid and is_visible order by alias limit 12`,
          [id],
        ),
      ]);

    return { client, canEdit: canEdit?.ok ?? false, location, duplicates, types, comercials, products, campaigns, aliases };
  });

  if (!data) notFound();
  const client = data.client;
  const canEdit = data.canEdit;

  const activeTab =
    TABS.find((t) => t.key === tab && (!('managerOnly' in t && t.managerOnly) || manager))?.key ??
    'resum';

  const locations = data.location ? [{ id: data.location.id, name: data.location.formatted_address ?? 'UBICACIÓ PRINCIPAL' }] : [];
  const mapHref =
    data.location?.latitude !== null && data.location?.latitude !== undefined && data.location?.longitude !== null && data.location?.longitude !== undefined
      ? `https://www.google.com/maps/search/?api=1&query=${data.location.latitude},${data.location.longitude}`
      : data.location?.formatted_address
        ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(data.location.formatted_address)}`
        : client.municipality
          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${client.name}, ${client.municipality}`)}`
          : null;

  const catalegs: Catalegs = {
    products: data.products,
    campaigns: data.campaigns.map((c) => ({ id: c.id, name: c.name })),
    defaultCampaignId: data.campaigns.find((c) => c.status === 'OBERTA')?.id ?? null,
  };

  const pendingDuplicates = Number(data.duplicates?.n ?? '0');

  return (
    <div className="grid gap-4 max-w-[1400px]">
      <p className="text-[12px] m-0">
        <Link href="/clients">CLIENTS</Link>{' '}
        <span className="text-[var(--color-ink-faint)]">/ {client.name}</span>
      </p>

      {/* ---------------- capçalera compacta ---------------- */}
      <header className="targeta p-4 grid gap-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="text-2xl font-semibold tracking-tight m-0">{client.name}</h1>
            <p className="text-[13px] text-[var(--color-ink-soft)] m-0">
              {[client.municipality, client.comarca, client.province].filter(Boolean).join(' · ') ||
                'Sense localitat registrada'}
            </p>
            {data.aliases.length > 0 && (
              <p className="text-[11px] text-[var(--color-ink-faint)] m-0 mt-1">
                Àlies: {data.aliases.map((a) => a.alias).join(' · ')}
              </p>
            )}
          </div>
          <div className="flex flex-wrap gap-1 items-start">
            {client.confirmed_classification ? (
              <span
                className={
                  CLASSIFICATION_TONE[client.confirmed_classification] ?? 'estat estat-neutre'
                }
              >
                {client.confirmed_classification}
              </span>
            ) : client.proposed_classification ? (
              <span className="estat estat-neutre">
                PROPOSTA: {client.proposed_classification}
              </span>
            ) : (
              <span className="estat estat-neutre">PENDENT DE REVISAR</span>
            )}
            <span className={VERIFICATION_TONE[client.verification_status] ?? 'estat estat-neutre'}>
              {client.verification_status}
            </span>
            {client.geo_status === 'PENDENT DE GEOLOCALITZAR' && (
              <span className="estat estat-neutre">PENDENT DE GEOLOCALITZAR</span>
            )}
            {[
              client.do_cava && 'CAVA',
              client.do_penedes && 'PENEDÈS',
              client.do_catalunya && 'CATALUNYA',
              client.do_altres && 'ALTRES DO',
            ]
              .filter(Boolean)
              .map((tag) => (
                <span key={String(tag)} className="estat estat-marca">
                  {tag}
                </span>
              ))}
          </div>
        </div>

        <dl className="grid gap-x-5 gap-y-2 m-0 [grid-template-columns:repeat(auto-fit,minmax(165px,1fr))] text-[13px]">
          <div>
            <dt className="etiqueta">CONTACTE PRINCIPAL</dt>
            <dd className="m-0">
              {client.primary_contact_name ?? <Buit />}
              {client.primary_contact_phone && (
                <a className="block text-[12px]" href={`tel:${client.primary_contact_phone}`}>
                  {client.primary_contact_phone}
                </a>
              )}
              {client.primary_contact_email && (
                <a className="block text-[12px]" href={`mailto:${client.primary_contact_email}`}>
                  {client.primary_contact_email}
                </a>
              )}
            </dd>
          </div>
          <div>
            <dt className="etiqueta">COMERCIAL</dt>
            <dd className="m-0">{client.owner_name ?? <Buit text="SENSE ASSIGNAR" />}</dd>
          </div>
          <div>
            <dt className="etiqueta">PROPERA VISITA</dt>
            <dd className="m-0 tabular-nums">
              {client.next_visit_at ? formatDateTime(client.next_visit_at) : <Buit text="CAP" />}
            </dd>
          </div>
          <div>
            <dt className="etiqueta">TASQUES PENDENTS</dt>
            <dd className="m-0">
              {client.pending_tasks}
              {client.overdue_tasks > 0 && (
                <span className="estat estat-perill ml-2">{client.overdue_tasks} VENÇUDES</span>
              )}
            </dd>
          </div>
          <div>
            <dt className="etiqueta">ÚLTIMA VERIFICACIÓ</dt>
            <dd className="m-0 tabular-nums">
              {client.last_verified_at ? formatDate(client.last_verified_at) : <Buit text="MAI" />}
            </dd>
          </div>
        </dl>

        <AccionsRapides
          clientId={client.id}
          clientName={client.name}
          phone={client.primary_contact_phone}
          email={client.primary_contact_email}
          mapHref={mapHref}
          canEdit={canEdit}
          locations={locations}
          products={data.products}
          campaigns={catalegs.campaigns}
          defaultCampaignId={catalegs.defaultCampaignId}
        />
      </header>

      {/* ---------------- pestanyes ---------------- */}
      <nav aria-label="Seccions de la fitxa">
        <ul className="list-none p-0 m-0 flex flex-wrap gap-1 border-b border-[var(--color-line-strong)]">
          {TABS.filter((t) => !('managerOnly' in t && t.managerOnly) || manager).map((t) => {
            const active = activeTab === t.key;
            return (
              <li key={t.key}>
                <Link
                  href={`/clients/${client.id}?tab=${t.key}`}
                  aria-current={active ? 'page' : undefined}
                  className={`inline-flex items-center gap-2 px-3 py-2 text-[12px] font-semibold uppercase tracking-wide no-underline border border-b-0 rounded-t-[var(--radius-sm)] ${
                    active
                      ? 'bg-[var(--color-paper-raised)] border-[var(--color-line-strong)] text-[var(--color-burgundy)]'
                      : 'bg-transparent border-transparent text-[var(--color-ink-soft)]'
                  }`}
                >
                  {t.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>

      {activeTab === 'resum' && (
        <Resum
          session={session}
          client={client}
          canEdit={canEdit}
          manager={manager}
          types={data.types}
          comercials={data.comercials}
          pendingDuplicates={pendingDuplicates}
        />
      )}
      {activeTab === 'contactes' && (
        <SeccioContactes session={session} clientId={client.id} canEdit={canEdit} />
      )}
      {activeTab === 'ubicacions' && (
        <SeccioUbicacions session={session} clientId={client.id} canEdit={canEdit} />
      )}
      {activeTab === 'oportunitats' && (
        <SeccioOportunitats
          session={session}
          clientId={client.id}
          canEdit={canEdit}
          catalegs={catalegs}
        />
      )}
      {activeTab === 'historial' && (
        <SeccioHistorial
          session={session}
          clientId={client.id}
          canEdit={canEdit}
          catalegs={catalegs}
        />
      )}
      {activeTab === 'tasques' && (
        <SeccioTasques session={session} clientId={client.id} clientName={client.name} />
      )}
      {activeTab === 'visites' && <SeccioVisites session={session} clientId={client.id} />}
      {activeTab === 'veu' && <SeccioVeu session={session} clientId={client.id} />}
      {activeTab === 'auditoria' && manager && (
        <SeccioAuditoria session={session} clientId={client.id} />
      )}
    </div>
  );
}

function Buit({ text = '—' }: { text?: string }): React.ReactElement {
  return <span className="text-[var(--color-ink-faint)]">{text}</span>;
}

/** RESUM: the current situation and what to do next. Never the full history. */
async function Resum({
  session,
  client,
  canEdit,
  manager,
  types,
  comercials,
  pendingDuplicates,
}: {
  session: Session;
  client: Capcalera;
  canEdit: boolean;
  manager: boolean;
  types: { code: string; label: string }[];
  comercials: { id: string; name: string }[];
  pendingDuplicates: number;
}): Promise<React.ReactElement> {
  const data = await query(session, async (q) => {
    const [interest, purchases, nextTask] = await Promise.all([
      q.many<{ name: string; category: string; data_type: string; volume: string | null }>(
        `select p.name, p.category, o.data_type::text as data_type, o.volume_liters::text as volume
           from public.opportunities o
           join public.products p on p.id = o.product_id
          where o.client_id = $1::uuid and o.deleted_at is null
            and o.data_type in ('POSSIBLE COMPRA', 'PREVISIO CONFIRMADA')
          order by o.data_type, p.name limit 12`,
        [client.id],
      ),
      q.many<{ name: string; campaign: string; volume: string | null; last_guide: string | null }>(
        `select p.name, ca.name as campaign, o.volume_liters::text as volume,
                max(d.guide_date)::text as last_guide
           from public.opportunities o
           join public.products p on p.id = o.product_id
           join public.campaigns ca on ca.id = o.campaign_id
           left join public.opportunity_deliveries d on d.opportunity_id = o.id
          where o.client_id = $1::uuid and o.deleted_at is null and o.data_type = 'COMPRA REAL'
          group by p.name, ca.name, o.volume_liters, ca.year_start
          order by ca.year_start desc, p.name limit 8`,
        [client.id],
      ),
      q.one<{
        id: string;
        action: string;
        other_action: string | null;
        due_at: string | null;
        title: string | null;
      }>(
        `select id, action::text as action, other_action, due_at, title
           from public.tasks
          where client_id = $1::uuid and deleted_at is null and status = 'PENDENT'
          order by due_at nulls last, created_at limit 1`,
        [client.id],
      ),
    ]);
    return { interest, purchases, nextTask };
  });

  const alerts: { tone: string; text: string }[] = [];
  if (client.verification_is_stale) {
    alerts.push({
      tone: 'estat estat-avis',
      text: client.last_verified_at
        ? `La verificació té més de 12 mesos (${formatDate(client.last_verified_at)}). Torna-la a comprovar.`
        : 'Aquesta empresa no s’ha verificat mai.',
    });
  }
  if (client.has_classification_discrepancy) {
    alerts.push({
      tone: 'estat estat-avis',
      text: `La proposta del sistema (${client.proposed_classification}) no coincideix amb la classificació confirmada (${client.confirmed_classification}).`,
    });
  }
  if (!client.confirmed_classification) {
    alerts.push({
      tone: 'estat estat-neutre',
      text: 'La classificació encara no està confirmada per una persona.',
    });
  }
  if (pendingDuplicates > 0) {
    alerts.push({
      tone: 'estat estat-avis',
      text: `Hi ha ${pendingDuplicates} possible${pendingDuplicates === 1 ? '' : 's'} duplicat${pendingDuplicates === 1 ? '' : 's'} pendent${pendingDuplicates === 1 ? '' : 's'} de decidir.`,
    });
  }
  if (client.geo_status === 'PENDENT DE GEOLOCALITZAR') {
    alerts.push({
      tone: 'estat estat-neutre',
      text: 'Sense coordenades: no apareixerà a CLIENTS PROPERS ni activarà cap avís d’arribada.',
    });
  }
  if (client.client_type_code === 'ALTRES' && !client.other_client_type) {
    alerts.push({
      tone: 'estat estat-avis',
      text: 'El tipus d’empresa és ALTRES sense explicació.',
    });
  }

  return (
    <div className="grid gap-4 [grid-template-columns:repeat(auto-fit,minmax(320px,1fr))] items-start">
      <section className="targeta p-4 grid gap-3">
        <h2 className="etiqueta m-0">SITUACIÓ ACTUAL</h2>
        <dl className="grid gap-3 m-0 [grid-template-columns:repeat(auto-fit,minmax(150px,1fr))] text-[13px]">
          <div>
            <dt className="etiqueta">ÚLTIM CONTACTE</dt>
            <dd className="m-0 tabular-nums">
              {client.last_contact_on ? (
                <>
                  {formatDate(client.last_contact_on)}
                  <span className="block text-[11px] text-[var(--color-ink-faint)]">
                    {relativeDays(client.last_contact_on)}
                  </span>
                </>
              ) : (
                <Buit text="SENSE CONTACTE" />
              )}
            </dd>
          </div>
          <div>
            <dt className="etiqueta">ÚLTIM RESULTAT</dt>
            <dd className="m-0">{client.last_result ?? <Buit text="NO DETERMINAT" />}</dd>
          </div>
          <div>
            <dt className="etiqueta">PROPERA ACCIÓ</dt>
            <dd className="m-0">
              {data.nextTask ? (
                <>
                  {data.nextTask.other_action ?? data.nextTask.action}
                  <span className="block text-[11px] text-[var(--color-ink-faint)] tabular-nums">
                    {data.nextTask.due_at ? formatDateTime(data.nextTask.due_at) : 'SENSE DATA'}
                  </span>
                </>
              ) : (
                <Buit text="CAP" />
              )}
            </dd>
          </div>
          <div>
            <dt className="etiqueta">PROPERA VISITA</dt>
            <dd className="m-0 tabular-nums">
              {client.next_visit_at ? formatDateTime(client.next_visit_at) : <Buit text="CAP" />}
            </dd>
          </div>
        </dl>
        <p className="text-[11px] text-[var(--color-ink-faint)] m-0">
          L&apos;historial complet és a{' '}
          <Link href={`/clients/${client.id}?tab=historial`}>HISTORIAL COMERCIAL</Link>.
        </p>
      </section>

      <section className="targeta p-4 grid gap-2">
        <h2 className="etiqueta m-0">AVISOS</h2>
        {alerts.length === 0 ? (
          <p className="m-0 text-[13px] text-[var(--color-ink-faint)]">Res a revisar.</p>
        ) : (
          <ul className="list-none p-0 m-0 grid gap-2">
            {alerts.map((alert) => (
              <li key={alert.text} className="flex items-start gap-2 text-[13px]">
                <span className={alert.tone}>AVÍS</span>
                <span>{alert.text}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <BlocClassificacio
        clientId={client.id}
        proposed={client.proposed_classification}
        confirmed={client.confirmed_classification}
        confirmedAt={
          client.classification_confirmed_at ? formatDateTime(client.classification_confirmed_at) : null
        }
        confirmedBy={client.confirmed_by_name}
        reason={client.not_potential_reason}
        canEdit={canEdit}
      />

      <section className="targeta p-4 grid gap-2">
        <h2 className="etiqueta m-0">PRODUCTES D&apos;INTERÈS</h2>
        {data.interest.length === 0 ? (
          <p className="m-0 text-[13px] text-[var(--color-ink-faint)]">
            Cap previsió ni possible compra registrada.
          </p>
        ) : (
          <ul className="list-none p-0 m-0 grid gap-1 text-[13px]">
            {data.interest.map((row) => (
              <li key={`${row.name}-${row.data_type}`} className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    row.data_type === 'PREVISIO CONFIRMADA' ? 'estat estat-marca' : 'estat estat-neutre'
                  }
                >
                  {row.data_type === 'PREVISIO CONFIRMADA' ? 'PREVISIÓ CONFIRMADA' : 'POSSIBLE COMPRA'}
                </span>
                <span>{row.name}</span>
                <span className="text-[var(--color-ink-faint)] tabular-nums">
                  {formatLiters(row.volume)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="targeta p-4 grid gap-2">
        <h2 className="etiqueta m-0">COMPRES RECENTS</h2>
        {data.purchases.length === 0 ? (
          <p className="m-0 text-[13px] text-[var(--color-ink-faint)]">Cap compra registrada.</p>
        ) : (
          <ul className="list-none p-0 m-0 grid gap-1 text-[13px]">
            {data.purchases.map((row) => (
              <li key={`${row.campaign}-${row.name}`} className="flex flex-wrap items-center gap-2">
                <span className="estat estat-ok">{row.campaign}</span>
                <span>{row.name}</span>
                <span className="text-[var(--color-ink-faint)] tabular-nums">
                  {formatLiters(row.volume)}
                </span>
                {row.last_guide && (
                  <span className="text-[11px] text-[var(--color-ink-faint)] tabular-nums">
                    últim albarà {formatDate(row.last_guide)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        <p className="text-[11px] text-[var(--color-ink-faint)] m-0">
          El detall per campanya és a{' '}
          <Link href={`/clients/${client.id}?tab=oportunitats`}>VINS I OPORTUNITATS</Link>.
        </p>
      </section>

      <EditorDades
        client={{
          id: client.id,
          name: client.name,
          legal_name: client.legal_name,
          tax_id: client.tax_id,
          municipality: client.municipality,
          comarca: client.comarca,
          province: client.province,
          website: client.website,
          client_type_code: client.client_type_code,
          other_client_type: client.other_client_type,
          do_cava: client.do_cava,
          do_penedes: client.do_penedes,
          do_catalunya: client.do_catalunya,
          do_altres: client.do_altres,
          general_notes: client.general_notes,
          external_account_code: client.external_account_code,
          owner_id: client.owner_id,
        }}
        canEdit={canEdit}
        manager={manager}
        types={types}
        comercials={comercials}
      />

      <section className="targeta p-4 grid gap-2">
        <h2 className="etiqueta m-0">VERIFICACIÓ</h2>
        <dl className="grid gap-2 m-0 text-[13px]">
          <div>
            <dt className="etiqueta">ESTAT</dt>
            <dd className="m-0">
              <span className={VERIFICATION_TONE[client.verification_status] ?? 'estat estat-neutre'}>
                {client.verification_status}
              </span>
            </dd>
          </div>
          <div>
            <dt className="etiqueta">FONT</dt>
            <dd className="m-0">{client.verification_source ?? <Buit />}</dd>
          </div>
          {client.verification_note && (
            <div>
              <dt className="etiqueta">OBSERVACIONS</dt>
              <dd className="m-0">{client.verification_note}</dd>
            </div>
          )}
        </dl>
      </section>
    </div>
  );
}
