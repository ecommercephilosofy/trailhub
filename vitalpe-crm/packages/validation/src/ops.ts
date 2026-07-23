/**
 * Write schemas for tasks and visits.
 *
 * Mirrors the CHECK constraints on `public.tasks` / `public.visits`
 * (migration 20260723092000) and the guard clauses inside `app.complete_task`
 * and `app.postpone_task` (migration 20260723094000).
 */

import { z } from 'zod';
import {
  ACTIVITY_RESULTS,
  COMMERCIAL_ACTIONS,
  SAMPLE_SUBTYPES,
  TASK_KINDS,
  TASK_PRIORITIES,
  VISIT_STATUSES,
} from '@vitalpe/types';
import { isBlank, isoDateTime, optionalText, uuid } from './common.js';

// ---------------------------------------------------------------------------
// tasks
// ---------------------------------------------------------------------------

/**
 * `public.tasks`
 *  - `tasks_other_action_needs_explanation`: action ALTRES needs `other_action`
 *  - `duration_minutes between 5 and 1440`
 *
 * `due_at` may be null on purpose: that is an undated "next action" attached to
 * the company, which never shows on the daily dashboard and is never overdue.
 * `status`, `result` and `completed_at` are NOT settable here — completing goes
 * through {@link completeTaskSchema} / `app.complete_task`, which also writes
 * the history entry.
 */
export const taskSchema = z
  .object({
    workspace_id: uuid.optional(),
    kind: z.enum(TASK_KINDS).default('TASCA'),
    action: z.enum(COMMERCIAL_ACTIONS),
    other_action: optionalText,
    sample_subtype: z.enum(SAMPLE_SUBTYPES).nullish(),
    client_id: uuid.nullish(),
    product_id: uuid.nullish(),
    campaign_id: uuid.nullish(),
    title: optionalText,
    due_at: isoDateTime.nullish(),
    duration_minutes: z
      .number()
      .int()
      .min(5, 'La durada ha d’estar entre 5 i 1440 minuts.')
      .max(1440, 'La durada ha d’estar entre 5 i 1440 minuts.')
      .nullish(),
    priority: z.enum(TASK_PRIORITIES).default('MITJANA'),
    notes: optionalText,
    assigned_to: uuid.nullish(),
    visit_id: uuid.nullish(),
    source_task_id: uuid.nullish(),
    source_voice_note_id: uuid.nullish(),
    sync_to_google: z.boolean().default(false),
  })
  .superRefine((value, ctx) => {
    if (value.action === 'ALTRES' && isBlank(value.other_action)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['other_action'],
        message: 'Amb l’acció «ALTRES» cal explicar quina acció és.',
      });
    }
  });

export type TaskInput = z.infer<typeof taskSchema>;

/**
 * `app.complete_task(p_task_id, p_result, p_notes)`.
 * A result is always required, and ALTRES always needs an observation:
 * completing a commercial task writes history, and history without a result is
 * worth nothing.
 */
export const completeTaskSchema = z
  .object({
    task_id: uuid,
    result: z.enum(ACTIVITY_RESULTS, {
      required_error: 'Cal indicar el resultat per tancar la tasca.',
      invalid_type_error: 'Cal indicar el resultat per tancar la tasca.',
    }),
    notes: optionalText,
  })
  .superRefine((value, ctx) => {
    if (value.result === 'ALTRES' && isBlank(value.notes)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['notes'],
        message: 'Amb el resultat «ALTRES» cal escriure una observació que l’expliqui.',
      });
    }
  });

export type CompleteTaskInput = z.infer<typeof completeTaskSchema>;

/**
 * `app.postpone_task(p_task_id, p_new_due, p_note)`.
 * Postponing keeps the same row — identity and history are preserved — but it
 * cannot happen without a new date.
 */
export const postponeTaskSchema = z.object({
  task_id: uuid,
  new_due_at: isoDateTime.refine((value) => value.length > 0, {
    message: 'Cal indicar la nova data per ajornar la tasca.',
  }),
  note: optionalText,
});

export type PostponeTaskInput = z.infer<typeof postponeTaskSchema>;

/** `app.schedule_undated_task`: give a next action a date without cloning it. */
export const scheduleUndatedTaskSchema = z.object({
  task_id: uuid,
  due_at: isoDateTime,
});

export type ScheduleUndatedTaskInput = z.infer<typeof scheduleUndatedTaskSchema>;

// ---------------------------------------------------------------------------
// visits
// ---------------------------------------------------------------------------

/** `public.visits` / `visits_time_order check (ends_at > starts_at)`. */
export const visitSchema = z
  .object({
    workspace_id: uuid.optional(),
    client_id: uuid,
    location_id: uuid.nullish(),
    user_id: uuid.nullish(),
    title: optionalText,
    objective: optionalText,
    important_info: optionalText,
    starts_at: isoDateTime,
    ends_at: isoDateTime,
    status: z.enum(VISIT_STATUSES).default('PLANIFICADA'),
    reminders_minutes: z.array(z.number().int().min(0).max(40320)).default([60]),
    notes_before: optionalText,
    created_from_voice: z.boolean().default(false),
    sync_to_google: z.boolean().default(true),
    priority: z.enum(TASK_PRIORITIES).default('MITJANA'),
  })
  .superRefine((value, ctx) => {
    const starts = Date.parse(value.starts_at);
    const ends = Date.parse(value.ends_at);
    if (Number.isNaN(starts) || Number.isNaN(ends)) return;
    if (ends <= starts) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['ends_at'],
        message: 'L’hora de fi ha de ser posterior a la d’inici.',
      });
    }
  });

export type VisitInput = z.infer<typeof visitSchema>;

/** `app.cancel_visit`: cancelling never destroys history, but needs a reason. */
export const cancelVisitSchema = z.object({
  visit_id: uuid,
  reason: z
    .string({ required_error: 'Cal indicar el motiu de la cancel·lació.' })
    .trim()
    .min(1, 'Cal indicar el motiu de la cancel·lació.'),
});

export type CancelVisitInput = z.infer<typeof cancelVisitSchema>;
