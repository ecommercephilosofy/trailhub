'use server';

import { revalidatePath } from 'next/cache';
import { isManager, query, requireSession } from '@/lib/auth';
import { friendlyError } from '@/lib/db';
import { pushVisit, queueVisitSync } from '@/app/api/google/sync-engine';

/**
 * Visit server actions.
 *
 * Every one of them is a single round trip that ends with the database in a
 * consistent state:
 *
 *  - creating goes through `app.create_visit_with_task`, so a visit and its
 *    paired VISITA task are born in the same transaction — never one without
 *    the other;
 *  - cancelling goes through `app.cancel_visit`, which marks the visit
 *    CANCEL·LADA and the task CANCEL·LAT and **never deletes**;
 *  - rescheduling (including a drag-and-drop) updates the visit and its task
 *    inside one `withUser` transaction. The audit trail is written by the
 *    database trigger, and the company's next visit is a column of
 *    `v_client_derived` — a view, so it can never go stale.
 *
 * The calendar push happens *after* the CRM write has committed. Saving in the
 * CRM must never depend on a third party being reachable.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
  visitId?: string;
  sync?: string;
}

const MADRID = 'Europe/Madrid';

/**
 * `datetime-local` gives a wall-clock string with no zone. The user is always
 * working in Europe/Madrid, so it is interpreted there — not in the server's
 * zone, which in production is UTC and would silently shift every visit.
 */
function madridToInstant(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/.exec(value.trim());
  if (!match) {
    const fallback = new Date(value);
    return Number.isNaN(fallback.getTime()) ? null : fallback;
  }
  const [, y, mo, d, h, mi] = match as unknown as [string, string, string, string, string, string];
  const naiveUtc = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi));
  // Two passes: the offset is looked up at the candidate instant, which is
  // correct on every day of the year including the two DST switches.
  let guess = naiveUtc;
  for (let i = 0; i < 2; i += 1) {
    guess = naiveUtc - offsetAt(new Date(guess));
  }
  const result = new Date(guess);
  return Number.isNaN(result.getTime()) ? null : result;
}

function offsetAt(instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: MADRID,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(instant);
  const read = (type: string): number => Number(parts.find((p) => p.type === type)?.value ?? '0');
  const asUtc = Date.UTC(
    read('year'),
    read('month') - 1,
    read('day'),
    read('hour') % 24,
    read('minute'),
    read('second'),
  );
  return asUtc - instant.getTime();
}

function minutesBetween(start: Date, end: Date): number {
  return Math.max(5, Math.min(1440, Math.round((end.getTime() - start.getTime()) / 60000)));
}

function parseReminders(raw: string): number[] {
  const values = raw
    .split(/[,\s]+/)
    .map((v) => Number.parseInt(v, 10))
    .filter((v) => Number.isFinite(v) && v >= 0 && v <= 40320);
  return values.length > 0 ? [...new Set(values)].sort((a, b) => a - b) : [60];
}

function refresh(clientId?: string | null): void {
  revalidatePath('/calendari');
  revalidatePath('/tasques');
  revalidatePath('/inici');
  if (clientId) revalidatePath(`/clients/${clientId}`);
  revalidatePath('/clients', 'layout');
}

/**
 * Best-effort calendar push. A failure is reported, never thrown: the visit is
 * already safely in the CRM and the link is left in a state the resync retries.
 */
async function syncAfterWrite(visitId: string, userId: string): Promise<string> {
  try {
    await queueVisitSync(visitId);
    const report = await pushVisit(visitId, userId);
    return `${report.outcome} · ${report.message}`;
  } catch (error) {
    return `ERROR · ${error instanceof Error ? error.message : String(error)}`;
  }
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createVisit(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const clientId = String(formData.get('clientId') ?? '').trim();
  const locationId = String(formData.get('locationId') ?? '').trim() || null;
  const startRaw = String(formData.get('startsAt') ?? '').trim();
  const endRaw = String(formData.get('endsAt') ?? '').trim();
  const objective = String(formData.get('objective') ?? '').trim() || null;
  const importantInfo = String(formData.get('importantInfo') ?? '').trim() || null;
  const priority = String(formData.get('priority') ?? 'MITJANA');
  const reminders = parseReminders(String(formData.get('reminders') ?? '60'));
  const syncToGoogle = String(formData.get('syncToGoogle') ?? '') === 'on';
  const requestedUser = String(formData.get('assignedTo') ?? '').trim();
  const assignedTo = isManager(session.role) && requestedUser ? requestedUser : session.userId;

  if (!clientId) return { ok: false, error: 'Cal triar una empresa.' };
  const starts = madridToInstant(startRaw);
  const ends = madridToInstant(endRaw);
  if (!starts) return { ok: false, error: "Cal indicar la data i l'hora d'inici." };
  if (!ends) return { ok: false, error: "Cal indicar l'hora de fi." };
  if (ends <= starts) return { ok: false, error: "L'hora de fi ha de ser posterior a la d'inici." };

  let visitId: string;
  try {
    const created = await query(session, async (q) => {
      const row = await q.one<{ visit_id: string; task_id: string }>(
        `select visit_id, task_id from app.create_visit_with_task(
            $1, $2, $3, $4::timestamptz, $5::timestamptz, $6, $7, $8,
            $9::app.task_priority, $10, false)`,
        [
          session.workspaceId,
          clientId,
          assignedTo,
          starts.toISOString(),
          ends.toISOString(),
          locationId,
          'VISITA',
          objective,
          priority,
          syncToGoogle,
        ],
      );
      if (!row) throw new Error('EMPRESA_NO_TROBADA');
      await q.run(
        `update public.visits
            set important_info = $2, reminders_minutes = $3::int[], notes_before = $2
          where id = $1`,
        [row.visit_id, importantInfo, `{${reminders.join(',')}}`],
      );
      return row;
    });
    visitId = created.visit_id;
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }

  const sync = syncToGoogle ? await syncAfterWrite(visitId, assignedTo) : 'NO SINCRONITZAT';
  refresh(clientId);
  return { ok: true, visitId, sync };
}

// ---------------------------------------------------------------------------
// Edit
// ---------------------------------------------------------------------------

export async function updateVisit(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const visitId = String(formData.get('visitId') ?? '').trim();
  const locationId = String(formData.get('locationId') ?? '').trim() || null;
  const starts = madridToInstant(String(formData.get('startsAt') ?? ''));
  const ends = madridToInstant(String(formData.get('endsAt') ?? ''));
  const objective = String(formData.get('objective') ?? '').trim() || null;
  const importantInfo = String(formData.get('importantInfo') ?? '').trim() || null;
  const priority = String(formData.get('priority') ?? 'MITJANA');
  const reminders = parseReminders(String(formData.get('reminders') ?? '60'));
  const syncToGoogle = String(formData.get('syncToGoogle') ?? '') === 'on';
  const requestedUser = String(formData.get('assignedTo') ?? '').trim();

  if (!visitId) return { ok: false, error: 'Falta la visita.' };
  if (!starts || !ends) return { ok: false, error: 'Cal indicar la data i les hores.' };
  if (ends <= starts) return { ok: false, error: "L'hora de fi ha de ser posterior a la d'inici." };

  let clientId: string | null = null;
  let owner = session.userId;
  try {
    const row = await query(session, async (q) => {
      const visit = await q.one<{ client_id: string; task_id: string | null; user_id: string | null }>(
        `select client_id, task_id, user_id from public.visits where id = $1 and deleted_at is null`,
        [visitId],
      );
      if (!visit) throw new Error('La visita ja no existeix.');
      const nextOwner =
        isManager(session.role) && requestedUser ? requestedUser : visit.user_id ?? session.userId;
      await q.run(
        `update public.visits
            set location_id = $2, starts_at = $3::timestamptz, ends_at = $4::timestamptz,
                objective = $5, important_info = $6, reminders_minutes = $7::int[], user_id = $8
          where id = $1 and deleted_at is null`,
        [
          visitId,
          locationId,
          starts.toISOString(),
          ends.toISOString(),
          objective,
          importantInfo,
          `{${reminders.join(',')}}`,
          nextOwner,
        ],
      );
      if (visit.task_id) {
        await q.run(
          `update public.tasks
              set due_at = $2::timestamptz, duration_minutes = $3,
                  priority = $4::app.task_priority, sync_to_google = $5, assigned_to = $6
            where id = $1 and deleted_at is null`,
          [visit.task_id, starts.toISOString(), minutesBetween(starts, ends), priority, syncToGoogle, nextOwner],
        );
      }
      return { clientId: visit.client_id, owner: nextOwner };
    });
    clientId = row.clientId;
    owner = row.owner;
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }

  const sync = syncToGoogle ? await syncAfterWrite(visitId, owner) : 'NO SINCRONITZAT';
  refresh(clientId);
  return { ok: true, visitId, sync };
}

// ---------------------------------------------------------------------------
// Reschedule (drag-and-drop and the "REPROGRAMAR" panel)
// ---------------------------------------------------------------------------

/**
 * Moves a visit to a new slot.
 *
 * One action, one transaction: visit times, the paired task's due date and its
 * duration all move together. The audit row is written by the trigger on
 * `public.visits`, the Google push is queued afterwards, and the company's next
 * visit follows automatically because it is derived, not stored. A component
 * never patches several tables itself.
 */
export async function rescheduleVisit(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const visitId = String(formData.get('visitId') ?? '').trim();
  const startRaw = String(formData.get('startsAt') ?? '').trim();
  const explicitEnd = String(formData.get('endsAt') ?? '').trim();
  if (!visitId) return { ok: false, error: 'Falta la visita.' };

  const starts = madridToInstant(startRaw);
  if (!starts) return { ok: false, error: 'La nova data no és vàlida.' };

  let clientId: string | null = null;
  let owner = session.userId;
  try {
    const row = await query(session, async (q) => {
      const visit = await q.one<{
        client_id: string;
        task_id: string | null;
        user_id: string | null;
        starts_at: string;
        ends_at: string;
        status: string;
      }>(
        `select client_id, task_id, user_id, starts_at, ends_at, status::text as status
           from public.visits where id = $1 and deleted_at is null for update`,
        [visitId],
      );
      if (!visit) throw new Error('La visita ja no existeix.');
      if (visit.status === 'CANCEL·LADA') {
        throw new Error('No es pot reprogramar una visita cancel·lada.');
      }
      if (visit.status === 'FETA') {
        throw new Error('No es pot reprogramar una visita ja feta.');
      }

      const previousMinutes = Math.max(
        5,
        Math.round(
          (new Date(visit.ends_at).getTime() - new Date(visit.starts_at).getTime()) / 60000,
        ),
      );
      const ends =
        (explicitEnd ? madridToInstant(explicitEnd) : null) ??
        new Date(starts.getTime() + previousMinutes * 60000);
      if (ends <= starts) throw new Error('HORA_FI_ANTERIOR_A_INICI');

      await q.run(
        `update public.visits
            set starts_at = $2::timestamptz, ends_at = $3::timestamptz
          where id = $1 and deleted_at is null`,
        [visitId, starts.toISOString(), ends.toISOString()],
      );
      if (visit.task_id) {
        await q.run(
          `update public.tasks
              set due_at = $2::timestamptz, duration_minutes = $3
            where id = $1 and deleted_at is null and status <> 'FET'`,
          [visit.task_id, starts.toISOString(), minutesBetween(starts, ends)],
        );
      }
      return { clientId: visit.client_id, owner: visit.user_id ?? session.userId };
    });
    clientId = row.clientId;
    owner = row.owner;
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }

  const sync = await syncAfterWrite(visitId, owner);
  refresh(clientId);
  return { ok: true, visitId, sync };
}

// ---------------------------------------------------------------------------
// Cancel
// ---------------------------------------------------------------------------

export async function cancelVisit(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const visitId = String(formData.get('visitId') ?? '').trim();
  const reason = String(formData.get('reason') ?? '').trim();
  if (!visitId) return { ok: false, error: 'Falta la visita.' };
  if (!reason) return { ok: false, error: 'Cal indicar el motiu de la cancel·lació.' };

  let clientId: string | null = null;
  let owner = session.userId;
  try {
    const row = await query(session, async (q) => {
      const visit = await q.one<{ client_id: string; user_id: string | null }>(
        `select client_id, user_id from public.visits where id = $1 and deleted_at is null`,
        [visitId],
      );
      if (!visit) throw new Error('La visita ja no existeix.');
      // Marks CANCEL·LADA + task CANCEL·LAT. Never deletes: the history stays.
      await q.run(`select app.cancel_visit($1, $2, 'CRM'::app.change_origin)`, [visitId, reason]);
      return { clientId: visit.client_id, owner: visit.user_id ?? session.userId };
    });
    clientId = row.clientId;
    owner = row.owner;
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }

  const sync = await syncAfterWrite(visitId, owner);
  refresh(clientId);
  return { ok: true, visitId, sync };
}

// ---------------------------------------------------------------------------
// Complete / record the result
// ---------------------------------------------------------------------------

/**
 * Completing a visit closes its paired task through `app.complete_task`, which
 * writes the commercial history entry and sets the visit to FETA. One call, one
 * transaction, no duplicated rules here.
 */
export async function completeVisit(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const visitId = String(formData.get('visitId') ?? '').trim();
  const result = String(formData.get('result') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim() || null;
  if (!visitId) return { ok: false, error: 'Falta la visita.' };
  if (!result) return { ok: false, error: 'Cal indicar un resultat.' };
  if (result === 'ALTRES' && !notes) {
    return { ok: false, error: 'El resultat ALTRES exigeix una observació.' };
  }

  let clientId: string | null = null;
  let owner = session.userId;
  try {
    const row = await query(session, async (q) => {
      const visit = await q.one<{ client_id: string; task_id: string | null; user_id: string | null }>(
        `select client_id, task_id, user_id from public.visits where id = $1 and deleted_at is null`,
        [visitId],
      );
      if (!visit) throw new Error('La visita ja no existeix.');
      if (visit.task_id) {
        await q.run(`select app.complete_task($1, $2::app.activity_result, $3)`, [
          visit.task_id,
          result,
          notes,
        ]);
      } else {
        await q.run(
          `update public.visits
              set status = 'FETA', result = $2::app.activity_result, notes_after = $3
            where id = $1`,
          [visitId, result, notes],
        );
      }
      return { clientId: visit.client_id, owner: visit.user_id ?? session.userId };
    });
    clientId = row.clientId;
    owner = row.owner;
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }

  const sync = await syncAfterWrite(visitId, owner);
  refresh(clientId);
  return { ok: true, visitId, sync };
}

// ---------------------------------------------------------------------------
// Manual resync of a single visit
// ---------------------------------------------------------------------------

export async function resyncVisit(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const visitId = String(formData.get('visitId') ?? '').trim();
  if (!visitId) return { ok: false, error: 'Falta la visita.' };
  const owner = await query(session, (q) =>
    q.one<{ user_id: string | null }>(`select user_id from public.visits where id = $1`, [visitId]),
  );
  const sync = await syncAfterWrite(visitId, owner?.user_id ?? session.userId);
  refresh(null);
  return { ok: true, visitId, sync };
}
