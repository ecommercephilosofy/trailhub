/**
 * Task rules — the client-side twin of `app.complete_task` / `app.postpone_task`
 * (migration 20260723094000) and of the CHECK constraints on `public.tasks`.
 *
 * The database enforces all of this anyway; duplicating it here exists so the
 * user is told what is missing BEFORE a round trip, and so the daily dashboard
 * sorts the same way everywhere.
 */

import type {
  ActivityResult,
  ActivityType,
  CommercialAction,
  TaskPriority,
  TaskStatus,
} from '@vitalpe/types';

/** The subset of a task row these rules need. Accepts a full `Task` as-is. */
export interface TaskLike {
  status: TaskStatus;
  action: CommercialAction;
  /** NULL = an undated "next action" attached to the company. */
  due_at?: string | Date | null;
  priority?: TaskPriority;
  deleted_at?: string | Date | null;
}

/** The errors `app.complete_task` raises, in the same order it checks them. */
export type CompleteTaskError =
  | 'TASCA_NO_TROBADA'
  | 'TASCA_JA_FETA'
  | 'RESULTAT_OBLIGATORI'
  | 'OBSERVACIONS_OBLIGATORIES_ALTRES';

export type CanCompleteResult = { ok: true } | { ok: false; error: CompleteTaskError };

/** Catalan message for each failure, ready to show in a form. */
export const COMPLETE_TASK_MESSAGES: Readonly<Record<CompleteTaskError, string>> = Object.freeze({
  TASCA_NO_TROBADA: 'La tasca no existeix o ja s’ha esborrat.',
  TASCA_JA_FETA: 'La tasca ja està feta.',
  RESULTAT_OBLIGATORI: 'Cal indicar el resultat per tancar la tasca.',
  OBSERVACIONS_OBLIGATORIES_ALTRES:
    'Amb el resultat «ALTRES» cal escriure una observació que l’expliqui.',
});

function isBlank(value: string | null | undefined): boolean {
  return value === null || value === undefined || value.trim() === '';
}

function toDate(value: string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Can this task be completed with this result?
 * Same checks, same order, as `app.complete_task`.
 */
export function canComplete(
  task: TaskLike,
  result: ActivityResult | null | undefined,
  notes?: string | null,
): CanCompleteResult {
  if (toDate(task.deleted_at) !== null) return { ok: false, error: 'TASCA_NO_TROBADA' };
  if (task.status === 'FET') return { ok: false, error: 'TASCA_JA_FETA' };
  if (result === null || result === undefined) return { ok: false, error: 'RESULTAT_OBLIGATORI' };
  if (result === 'ALTRES' && isBlank(notes)) {
    return { ok: false, error: 'OBSERVACIONS_OBLIGATORIES_ALTRES' };
  }
  return { ok: true };
}

/**
 * The status a task moves to when completed. Constant by design: the SQL sets
 * `status = 'FET'` unconditionally, and `tasks_completed_at_consistency`
 * requires `completed_at` to be set at the same moment.
 */
export function nextStatusOnComplete(): TaskStatus {
  return 'FET';
}

/**
 * `app.complete_task`'s CASE: which activity type the history entry gets.
 * Note ENVIAR PREUS and ENVIAR OFERTA both land on OFERTA, and
 * VERIFICAR EMPRESA on NOTA INTERNA.
 */
export function activityTypeForAction(action: CommercialAction): ActivityType {
  switch (action) {
    case 'TRUCAR':
      return 'TRUCADA';
    case 'VISITA':
      return 'VISITA';
    case 'MOSTRES':
      return 'MOSTRES';
    case 'ENVIAR CORREU':
      return 'CORREU';
    case 'ENVIAR PREUS':
      return 'OFERTA';
    case 'ENVIAR OFERTA':
      return 'OFERTA';
    case 'VERIFICAR EMPRESA':
      return 'NOTA INTERNA';
    default:
      return 'ALTRES';
  }
}

/**
 * An undated task is a "next action" attached to the company: it never appears
 * on the daily dashboard and — see {@link isOverdue} — can never be overdue.
 */
export function isUndated(task: Pick<TaskLike, 'due_at'>): boolean {
  return toDate(task.due_at) === null;
}

/**
 * Overdue = still PENDENT, has a date, that date is in the past, not deleted.
 * Mirrors `v_client_derived.overdue_tasks`.
 */
export function isOverdue(task: TaskLike, now: Date): boolean {
  if (toDate(task.deleted_at) !== null) return false;
  if (task.status !== 'PENDENT') return false;
  const due = toDate(task.due_at);
  if (due === null) return false; // undated tasks are never overdue
  return due.getTime() < now.getTime();
}

/** Priority rank: lower sorts first. */
export const PRIORITY_ORDER: Readonly<Record<TaskPriority, number>> = Object.freeze({
  ALTA: 0,
  MITJANA: 1,
  BAIXA: 2,
});

/**
 * Dashboard order: by due date first (soonest first, undated last), then by
 * priority ALTA -> MITJANA -> BAIXA. Stable for equal keys; the input array is
 * not mutated.
 */
export function sortTasks<T extends TaskLike>(tasks: readonly T[]): T[] {
  return tasks
    .map((task, index) => ({ task, index }))
    .sort((left, right) => {
      const dueLeft = toDate(left.task.due_at);
      const dueRight = toDate(right.task.due_at);
      if (dueLeft === null && dueRight !== null) return 1;
      if (dueLeft !== null && dueRight === null) return -1;
      if (dueLeft !== null && dueRight !== null) {
        const diff = dueLeft.getTime() - dueRight.getTime();
        if (diff !== 0) return diff;
      }
      const priorityLeft = PRIORITY_ORDER[left.task.priority ?? 'MITJANA'];
      const priorityRight = PRIORITY_ORDER[right.task.priority ?? 'MITJANA'];
      if (priorityLeft !== priorityRight) return priorityLeft - priorityRight;
      return left.index - right.index; // stable
    })
    .map((entry) => entry.task);
}

/** `app.postpone_task` refuses without a new date. */
export function canPostpone(newDue: Date | string | null | undefined): boolean {
  return toDate(newDue) !== null;
}

/**
 * `app.schedule_undated_task`: giving a date to a next action must not clone
 * it, and only applies to a PENDENT task that has no date yet.
 */
export function canSchedule(task: TaskLike): boolean {
  return toDate(task.deleted_at) === null && task.status === 'PENDENT' && isUndated(task);
}

export const taskRules = {
  canComplete,
  nextStatusOnComplete,
  activityTypeForAction,
  isOverdue,
  isUndated,
  sortTasks,
  canPostpone,
  canSchedule,
  PRIORITY_ORDER,
  COMPLETE_TASK_MESSAGES,
} as const;
