'use server';

import { revalidatePath } from 'next/cache';
import { query, requireSession } from '@/lib/auth';
import { friendlyError } from '@/lib/db';

/**
 * Task server actions.
 *
 * Every one of these delegates to a database function (`app.complete_task`,
 * `app.postpone_task`, …) so the rules — a completed commercial task always
 * writes history, postponing always needs a new date, scheduling an undated
 * task never clones it — live in one place and hold no matter which client
 * calls them.
 */

export interface ActionResult {
  ok: boolean;
  error?: string;
}

export async function completeTask(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const taskId = String(formData.get('taskId') ?? '');
  const result = String(formData.get('result') ?? '');
  const notes = String(formData.get('notes') ?? '').trim() || null;

  if (!result) return { ok: false, error: 'Cal indicar un resultat.' };
  if (result === 'ALTRES' && !notes) {
    return { ok: false, error: 'El resultat ALTRES exigeix una observació.' };
  }

  try {
    await query(session, async (q) => {
      await q.run(`select app.complete_task($1, $2::app.activity_result, $3)`, [taskId, result, notes]);
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath('/inici');
  revalidatePath('/tasques');
  revalidatePath('/clients', 'layout');
  return { ok: true };
}

export async function postponeTask(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const taskId = String(formData.get('taskId') ?? '');
  const newDate = String(formData.get('newDate') ?? '');
  if (!newDate) return { ok: false, error: 'Per ajornar cal una data nova.' };

  try {
    await query(session, async (q) => {
      await q.run(`select app.postpone_task($1, $2::timestamptz, $3)`, [
        taskId,
        new Date(newDate).toISOString(),
        String(formData.get('notes') ?? '').trim() || null,
      ]);
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath('/inici');
  revalidatePath('/tasques');
  return { ok: true };
}

export async function scheduleUndatedTask(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const taskId = String(formData.get('taskId') ?? '');
  const due = String(formData.get('due') ?? '');
  if (!due) return { ok: false, error: 'Cal una data.' };
  try {
    await query(session, async (q) => {
      await q.run(`select app.schedule_undated_task($1, $2::timestamptz)`, [
        taskId,
        new Date(due).toISOString(),
      ]);
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath('/inici');
  revalidatePath('/tasques');
  revalidatePath('/clients', 'layout');
  return { ok: true };
}

export async function createTask(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const clientId = String(formData.get('clientId') ?? '') || null;
  const action = String(formData.get('action') ?? 'TRUCAR');
  const otherAction = String(formData.get('otherAction') ?? '').trim() || null;
  const kind = String(formData.get('kind') ?? 'TASCA');
  const priority = String(formData.get('priority') ?? 'MITJANA');
  const due = String(formData.get('due') ?? '').trim();
  const notes = String(formData.get('notes') ?? '').trim() || null;
  const sampleSubtype = String(formData.get('sampleSubtype') ?? '').trim() || null;

  if (action === 'ALTRES' && !otherAction) {
    return { ok: false, error: "L'acció ALTRES exigeix una explicació." };
  }

  try {
    await query(session, async (q) => {
      await q.run(
        `insert into public.tasks
           (workspace_id, kind, action, other_action, sample_subtype, client_id, title,
            due_at, priority, status, assigned_to, created_by, notes)
         values ($1, $2::app.task_kind, $3::app.commercial_action, $4,
                 nullif($5,'')::app.sample_subtype, $6, $7,
                 case when $8 = '' then null else $8::timestamptz end,
                 $9::app.task_priority, 'PENDENT', $10, $10, $11)`,
        [
          session.workspaceId, kind, action, otherAction, sampleSubtype, clientId,
          String(formData.get('title') ?? '').trim() || (otherAction ?? action),
          due ? new Date(due).toISOString() : '', priority, session.userId, notes,
        ],
      );
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath('/inici');
  revalidatePath('/tasques');
  if (clientId) revalidatePath(`/clients/${clientId}`);
  return { ok: true };
}

export async function cancelTask(formData: FormData): Promise<ActionResult> {
  const session = await requireSession();
  const taskId = String(formData.get('taskId') ?? '');
  const reason = String(formData.get('reason') ?? '').trim();
  try {
    await query(session, async (q) => {
      await q.run(
        `update public.tasks
            set status = 'CANCEL·LAT',
                notes = case when $2 = '' then notes else coalesce(notes || E'\n', '') || $2 end
          where id = $1 and deleted_at is null`,
        [taskId, reason],
      );
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }
  revalidatePath('/inici');
  revalidatePath('/tasques');
  return { ok: true };
}
