import { describe, expect, it } from 'vitest';
import {
  cancelVisitSchema,
  completeTaskSchema,
  postponeTaskSchema,
  scheduleUndatedTaskSchema,
  taskSchema,
  visitSchema,
} from './ops.js';
import { parseOrThrow, safeParse } from './errors.js';

const CLIENT = '11111111-1111-4111-8111-111111111111';
const TASK = '22222222-2222-4222-8222-222222222222';
const VISIT = '33333333-3333-4333-8333-333333333333';

const messagesOf = (schema: Parameters<typeof safeParse>[0], data: unknown): string[] => {
  const result = safeParse(schema, data);
  return result.success ? [] : result.error.issues.map((i) => `${i.path}: ${i.message}`);
};

describe('taskSchema', () => {
  it('accepts a task with a date', () => {
    const parsed = parseOrThrow(taskSchema, {
      action: 'TRUCAR',
      client_id: CLIENT,
      due_at: '2026-08-01T09:00:00Z',
    });
    expect(parsed.priority).toBe('MITJANA');
    expect(parsed.kind).toBe('TASCA');
    expect('status' in (parsed as Record<string, unknown>)).toBe(false);
  });

  it('accepts an undated next action — due_at null is meaningful, not an error', () => {
    expect(safeParse(taskSchema, { action: 'TRUCAR', client_id: CLIENT, due_at: null }).success).toBe(
      true,
    );
    expect(safeParse(taskSchema, { action: 'TRUCAR', client_id: CLIENT }).success).toBe(true);
  });

  it('requires an explanation for action ALTRES', () => {
    expect(messagesOf(taskSchema, { action: 'ALTRES' })).toContain(
      'other_action: Amb l’acció «ALTRES» cal explicar quina acció és.',
    );
    expect(safeParse(taskSchema, { action: 'ALTRES', other_action: 'Passar per la cooperativa' }).success).toBe(
      true,
    );
  });

  it('keeps the duration between 5 and 1440 minutes', () => {
    expect(safeParse(taskSchema, { action: 'VISITA', duration_minutes: 4 }).success).toBe(false);
    expect(safeParse(taskSchema, { action: 'VISITA', duration_minutes: 1441 }).success).toBe(false);
    expect(safeParse(taskSchema, { action: 'VISITA', duration_minutes: 60 }).success).toBe(true);
  });

  it('rejects an action outside the enum', () => {
    expect(safeParse(taskSchema, { action: 'TRUCAR-LI' }).success).toBe(false);
  });

  it('has no field for status or result — completing goes through complete_task', () => {
    const parsed = parseOrThrow(taskSchema, { action: 'TRUCAR' }) as Record<string, unknown>;
    expect('status' in parsed).toBe(false);
    expect('result' in parsed).toBe(false);
    expect('completed_at' in parsed).toBe(false);
  });
});

describe('completeTaskSchema', () => {
  it('accepts a result', () => {
    expect(safeParse(completeTaskSchema, { task_id: TASK, result: 'DEMANA PREUS' }).success).toBe(
      true,
    );
  });

  it('requires a result (RESULTAT_OBLIGATORI)', () => {
    expect(messagesOf(completeTaskSchema, { task_id: TASK })).toContain(
      'result: Cal indicar el resultat per tancar la tasca.',
    );
    expect(messagesOf(completeTaskSchema, { task_id: TASK, result: null })).toContain(
      'result: Cal indicar el resultat per tancar la tasca.',
    );
  });

  it('requires an observation for ALTRES (OBSERVACIONS_OBLIGATORIES_ALTRES)', () => {
    expect(messagesOf(completeTaskSchema, { task_id: TASK, result: 'ALTRES' })).toContain(
      'notes: Amb el resultat «ALTRES» cal escriure una observació que l’expliqui.',
    );
    expect(messagesOf(completeTaskSchema, { task_id: TASK, result: 'ALTRES', notes: ' ' })).toHaveLength(
      1,
    );
    expect(
      safeParse(completeTaskSchema, { task_id: TASK, result: 'ALTRES', notes: 'Ens deriven' })
        .success,
    ).toBe(true);
  });

  it('accepts every result in the enum', () => {
    for (const result of ['INTERES CONCRET', 'NO COMPRA VI A GRANEL', 'TANCAT / INACTIU']) {
      expect(safeParse(completeTaskSchema, { task_id: TASK, result }).success).toBe(true);
    }
  });
});

describe('postponeTaskSchema', () => {
  it('requires a new date (NOVA_DATA_OBLIGATORIA)', () => {
    expect(safeParse(postponeTaskSchema, { task_id: TASK }).success).toBe(false);
    expect(safeParse(postponeTaskSchema, { task_id: TASK, new_due_at: null }).success).toBe(false);
    expect(
      safeParse(postponeTaskSchema, { task_id: TASK, new_due_at: '2026-08-01T09:00:00Z' }).success,
    ).toBe(true);
  });

  it('rejects a date that is not a timestamp', () => {
    expect(safeParse(postponeTaskSchema, { task_id: TASK, new_due_at: 'demà' }).success).toBe(false);
  });
});

describe('scheduleUndatedTaskSchema', () => {
  it('requires the new date', () => {
    expect(safeParse(scheduleUndatedTaskSchema, { task_id: TASK }).success).toBe(false);
    expect(
      safeParse(scheduleUndatedTaskSchema, { task_id: TASK, due_at: '2026-08-01T09:00:00Z' }).success,
    ).toBe(true);
  });
});

describe('visitSchema', () => {
  const base = {
    client_id: CLIENT,
    starts_at: '2026-08-01T09:00:00Z',
    ends_at: '2026-08-01T10:00:00Z',
  };

  it('accepts a well-ordered visit', () => {
    const parsed = parseOrThrow(visitSchema, base);
    expect(parsed.status).toBe('PLANIFICADA');
    expect(parsed.reminders_minutes).toEqual([60]);
  });

  it('requires ends_at to be after starts_at (visits_time_order)', () => {
    expect(
      messagesOf(visitSchema, { ...base, ends_at: '2026-08-01T08:00:00Z' }),
    ).toContain('ends_at: L’hora de fi ha de ser posterior a la d’inici.');
  });

  it('rejects a zero-length visit', () => {
    expect(safeParse(visitSchema, { ...base, ends_at: base.starts_at }).success).toBe(false);
  });

  it('requires both timestamps', () => {
    expect(safeParse(visitSchema, { client_id: CLIENT }).success).toBe(false);
  });
});

describe('cancelVisitSchema', () => {
  it('requires a reason so history keeps its explanation', () => {
    expect(safeParse(cancelVisitSchema, { visit_id: VISIT }).success).toBe(false);
    expect(safeParse(cancelVisitSchema, { visit_id: VISIT, reason: '  ' }).success).toBe(false);
    expect(
      safeParse(cancelVisitSchema, { visit_id: VISIT, reason: 'El client ho ha ajornat' }).success,
    ).toBe(true);
  });
});
