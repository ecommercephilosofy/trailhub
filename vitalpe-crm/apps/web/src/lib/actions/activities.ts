'use server';

import { revalidatePath } from 'next/cache';
import { query, requireSession } from '@/lib/auth';
import { friendlyError } from '@/lib/db';

/**
 * Commercial history + visits.
 *
 * The history is immutable by design: there is no DELETE policy on
 * `public.activities`, and only a manager may UPDATE one. The normal way to fix
 * something is `addCorrection`, which appends a new action pointing at the one
 * it corrects, so both the original and the correction stay visible.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const ACTIVITY_TYPES = ['TRUCADA', 'CORREU', 'VISITA', 'MOSTRES', 'OFERTA', 'NOTA INTERNA', 'ALTRES'];
const RESULTS = [
  'INTERES CONCRET', 'DEMANA PREUS', 'DEMANA MOSTRES', 'ACORDAR VISITA',
  'TE UN ALTRE PROVEIDOR', 'REPETIRA COMANDA', 'NO DETERMINAT', 'NO COMPRARA',
  'NO COMPRA VI A GRANEL', 'TANCAT / INACTIU', 'ALTRES',
];

interface ActivityInput {
  occurredOn: string;
  activityType: string;
  result: string;
  notes: string;
  productId: string;
  campaignId: string;
}

function read(formData: FormData): ActivityInput {
  const text = (key: string): string => String(formData.get(key) ?? '').trim();
  return {
    occurredOn: text('occurredOn'),
    activityType: text('activityType'),
    result: text('result'),
    notes: text('notes'),
    productId: text('productId'),
    campaignId: text('campaignId'),
  };
}

function validate(input: ActivityInput): string | null {
  if (!ACTIVITY_TYPES.includes(input.activityType)) return 'Tria un tipus d’acció.';
  if (input.result && !RESULTS.includes(input.result)) return 'Resultat no vàlid.';
  if (input.result === 'ALTRES' && !input.notes) {
    return 'El resultat ALTRES exigeix una observació.';
  }
  if (input.occurredOn && Number.isNaN(new Date(input.occurredOn).getTime())) {
    return 'La data no és vàlida.';
  }
  return null;
}

async function insertActivity(
  clientId: string,
  input: ActivityInput,
  correctsId: string | null,
): Promise<ActionResult> {
  const session = await requireSession();
  const problem = validate(input);
  if (problem) return { ok: false, error: problem };

  try {
    await query(session, async (q) => {
      await q.run(
        `insert into public.activities
           (workspace_id, client_id, occurred_on, activity_type, product_id, campaign_id,
            result, notes, user_id, corrects_activity_id, origin)
         values ($1::uuid, $2::uuid,
                 coalesce(nullif($3,'')::date, (now() at time zone 'Europe/Madrid')::date),
                 $4::app.activity_type, nullif($5,'')::uuid, nullif($6,'')::uuid,
                 nullif($7,'')::app.activity_result, nullif($8,''), $9::uuid,
                 nullif($10,'')::uuid, 'CRM')`,
        [
          session.workspaceId, clientId, input.occurredOn, input.activityType, input.productId,
          input.campaignId, input.result, input.notes, session.userId, correctsId ?? '',
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

/** Records an action that already happened. Refreshes the proposed classification. */
export async function createActivity(formData: FormData): Promise<ActionResult> {
  const clientId = String(formData.get('clientId') ?? '');
  if (!clientId) return { ok: false, error: 'Falta l’empresa.' };
  return insertActivity(clientId, read(formData), null);
}

/**
 * The normal way to fix the record: a new, dated action that says what the
 * right version is and points at the one it corrects. Nothing is overwritten.
 */
export async function addCorrection(formData: FormData): Promise<ActionResult> {
  const clientId = String(formData.get('clientId') ?? '');
  const corrects = String(formData.get('correctsId') ?? '').trim();
  if (!clientId) return { ok: false, error: 'Falta l’empresa.' };
  if (!corrects) return { ok: false, error: 'Falta l’acció que es corregeix.' };
  const input = read(formData);
  if (!input.notes) {
    return { ok: false, error: 'Explica què s’està corregint a les observacions.' };
  }
  return insertActivity(clientId, input, corrects);
}

/**
 * Direct edit of a recorded action. RLS grants UPDATE on activities to managers
 * only, and the audit trigger stores the before/after — a COMERCIAL gets a
 * refusal, not a silent no-op.
 */
export async function updateActivity(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const clientId = String(formData.get('clientId') ?? '');
  const activityId = String(formData.get('activityId') ?? '');
  const input = read(formData);
  const problem = validate(input);
  if (problem) return { ok: false, error: problem };

  try {
    const updated = await query(session, async (q) => {
      const row = await q.one<{ id: string }>(
        `update public.activities
            set occurred_on = coalesce(nullif($3,'')::date, occurred_on),
                activity_type = $4::app.activity_type,
                result = nullif($5,'')::app.activity_result,
                notes = nullif($6,'')
          where id = $2::uuid and client_id = $1::uuid and deleted_at is null
          returning id`,
        [clientId, activityId, input.occurredOn, input.activityType, input.result, input.notes],
      );
      return row;
    });
    if (!updated) {
      return {
        ok: false,
        error: 'No tens permisos per modificar l’historial. Afegeix una acció correctiva.',
      };
    }
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');
  return { ok: true };
}

/**
 * A visit and its task are born together, in one transaction, inside
 * `app.create_visit_with_task`. The calendar area owns everything after that.
 */
export async function createVisit(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const clientId = String(formData.get('clientId') ?? '');
  const startsAt = String(formData.get('startsAt') ?? '').trim();
  const minutes = Number.parseInt(String(formData.get('minutes') ?? '60'), 10);
  const locationId = String(formData.get('locationId') ?? '').trim();
  const title = String(formData.get('title') ?? '').trim();
  const objective = String(formData.get('objective') ?? '').trim();
  const syncToGoogle = formData.get('syncToGoogle') === 'on' || formData.get('syncToGoogle') === '1';

  if (!clientId) return { ok: false, error: 'Falta l’empresa.' };
  if (!startsAt) return { ok: false, error: 'Cal indicar la data i l’hora de la visita.' };
  const start = new Date(startsAt);
  if (Number.isNaN(start.getTime())) return { ok: false, error: 'La data no és vàlida.' };
  const duration = Number.isFinite(minutes) ? Math.min(1440, Math.max(5, minutes)) : 60;
  const end = new Date(start.getTime() + duration * 60_000);

  try {
    await query(session, async (q) => {
      await q.run(
        `select * from app.create_visit_with_task(
           $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $5::timestamptz,
           nullif($6,'')::uuid, nullif($7,''), nullif($8,''), 'MITJANA'::app.task_priority, $9, false)`,
        [
          session.workspaceId, clientId, session.userId, start.toISOString(), end.toISOString(),
          locationId, title, objective, syncToGoogle,
        ],
      );
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients');
  revalidatePath('/inici');
  return { ok: true };
}
