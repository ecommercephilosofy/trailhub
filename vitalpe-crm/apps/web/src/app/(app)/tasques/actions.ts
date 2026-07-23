'use server';

import { revalidatePath } from 'next/cache';
import { isManager, query, requireSession } from '@/lib/auth';
import { friendlyError } from '@/lib/db';

/**
 * Reassignment, the one write TASQUES owns that the shared task actions do not.
 *
 * Only a manager may do it, and the check is made twice on purpose: here, so
 * the user gets a sentence in Catalan instead of a rejected statement, and in
 * the database, where the RLS policy on `public.tasks` is the real boundary.
 */
export interface ReassignResult {
  ok: boolean;
  error?: string;
}

export async function reassignTask(formData: FormData): Promise<ReassignResult> {
  const session = await requireSession();
  if (!isManager(session.role)) {
    return { ok: false, error: 'Només un GERENT o un ADMIN pot reassignar tasques.' };
  }
  const taskId = String(formData.get('taskId') ?? '').trim();
  const assignedTo = String(formData.get('assignedTo') ?? '').trim();
  if (!taskId) return { ok: false, error: 'Falta la tasca.' };
  if (!assignedTo) return { ok: false, error: 'Cal triar un comercial.' };

  try {
    await query(session, async (q) => {
      const member = await q.one<{ id: string }>(
        `select p.id from public.profiles p
           join public.workspace_memberships m
             on m.user_id = p.id and m.workspace_id = $2 and m.status = 'ACTIU'
          where p.id = $1 and p.is_active`,
        [assignedTo, session.workspaceId],
      );
      if (!member) throw new Error('Aquest usuari no és a l’espai de treball.');
      await q.run(
        `update public.tasks set assigned_to = $2
          where id = $1 and workspace_id = $3 and deleted_at is null`,
        [taskId, assignedTo, session.workspaceId],
      );
      // A visit and its task always belong to the same person.
      await q.run(
        `update public.visits set user_id = $2
          where task_id = $1 and workspace_id = $3 and deleted_at is null`,
        [taskId, assignedTo, session.workspaceId],
      );
    });
  } catch (error) {
    return { ok: false, error: friendlyError(error) };
  }

  revalidatePath('/tasques');
  revalidatePath('/calendari');
  revalidatePath('/inici');
  return { ok: true };
}
