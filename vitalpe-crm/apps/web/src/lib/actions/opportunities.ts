'use server';

import { revalidatePath } from 'next/cache';
import { query, requireSession } from '@/lib/auth';
import { friendlyError } from '@/lib/db';

/**
 * Opportunity server actions.
 *
 * Grain: EMPRESA + PRODUCTE + CAMPANYA + TIPUS DE DADA (unique index
 * `opportunities_grain_uq`). Volumes are positive or empty (CHECK), and a
 * forecast of ALTRES demands a note (`opportunities_forecast_altres_needs_note`).
 * Those rules are the database's; this file only phrases the refusal.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const DATA_TYPES = ['COMPRA REAL', 'PREVISIO CONFIRMADA', 'POSSIBLE COMPRA'];
const FORECASTS = ['REPETIR COMANDA', 'NO DETERMINAT', 'NO COMPRARAN', 'ALTRES'];
const STATUSES = ['OBERTA', 'GUANYADA', 'PERDUDA', 'TANCADA'];

interface OpportunityInput {
  productId: string;
  campaignId: string;
  dataType: string;
  volume: string;
  forecastNext: string;
  status: string;
  notes: string;
}

function read(formData: FormData): OpportunityInput {
  const text = (key: string): string => String(formData.get(key) ?? '').trim();
  return {
    productId: text('productId'),
    campaignId: text('campaignId'),
    dataType: text('dataType'),
    volume: text('volume').replace(/\s/g, '').replace(',', '.'),
    forecastNext: text('forecastNext'),
    status: text('status'),
    notes: text('notes'),
  };
}

function validate(input: OpportunityInput): string | null {
  if (!input.productId) return 'Tria un producte.';
  if (!input.campaignId) return 'Tria una campanya.';
  if (!DATA_TYPES.includes(input.dataType)) return 'Tria un tipus de dada.';
  if (input.forecastNext && !FORECASTS.includes(input.forecastNext)) {
    return 'Previsió per a la propera campanya no vàlida.';
  }
  if (input.status && !STATUSES.includes(input.status)) return 'Estat no vàlid.';
  if (input.volume) {
    const volume = Number(input.volume);
    if (!Number.isFinite(volume)) return 'El volum ha de ser un número de litres.';
    if (volume <= 0) return 'El volum en litres ha de ser positiu, o quedar buit.';
  }
  if (input.forecastNext === 'ALTRES' && !input.notes) {
    return 'La previsió ALTRES exigeix una explicació a les observacions.';
  }
  return null;
}

export async function createOpportunity(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const clientId = String(formData.get('clientId') ?? '');
  const input = read(formData);
  const problem = validate(input);
  if (problem) return { ok: false, error: problem };

  try {
    await query(session, async (q) => {
      await q.run(
        `insert into public.opportunities
           (workspace_id, client_id, product_id, campaign_id, data_type, volume_liters,
            forecast_next, status, notes, source, owner_id)
         values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::app.opportunity_data_type,
                 nullif($6,'')::numeric, nullif($7,'')::app.forecast_next,
                 coalesce(nullif($8,''), 'OBERTA')::app.opportunity_status,
                 nullif($9,''), 'CRM', $10::uuid)`,
        [
          session.workspaceId, clientId, input.productId, input.campaignId, input.dataType,
          input.volume, input.forecastNext, input.status, input.notes, session.userId,
        ],
      );
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');
  return { ok: true };
}

export async function updateOpportunity(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const clientId = String(formData.get('clientId') ?? '');
  const opportunityId = String(formData.get('opportunityId') ?? '');
  const input = read(formData);
  const problem = validate(input);
  if (problem) return { ok: false, error: problem };

  try {
    await query(session, async (q) => {
      await q.run(
        `update public.opportunities
            set product_id = $3::uuid, campaign_id = $4::uuid,
                data_type = $5::app.opportunity_data_type,
                volume_liters = nullif($6,'')::numeric,
                forecast_next = nullif($7,'')::app.forecast_next,
                status = coalesce(nullif($8,''), 'OBERTA')::app.opportunity_status,
                notes = nullif($9,'')
          where id = $2::uuid and client_id = $1::uuid and deleted_at is null`,
        [
          clientId, opportunityId, input.productId, input.campaignId, input.dataType,
          input.volume, input.forecastNext, input.status, input.notes,
        ],
      );
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');
  return { ok: true };
}

/** Soft delete: a purchase that was recorded once never silently disappears. */
export async function removeOpportunity(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const clientId = String(formData.get('clientId') ?? '');
  const opportunityId = String(formData.get('opportunityId') ?? '');
  try {
    await query(session, async (q) => {
      await q.run(
        `update public.opportunities set deleted_at = now()
          where id = $2::uuid and client_id = $1::uuid and deleted_at is null`,
        [clientId, opportunityId],
      );
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');
  return { ok: true };
}
