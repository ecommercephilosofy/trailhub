import { describe, expect, it } from 'vitest';
import { COMMERCIAL_ACTIONS } from '@vitalpe/types';
import {
  activityTypeForAction,
  canComplete,
  canPostpone,
  canSchedule,
  isOverdue,
  isUndated,
  nextStatusOnComplete,
  sortTasks,
  type TaskLike,
} from './taskRules.js';

const NOW = new Date('2026-07-23T10:00:00Z');

const task = (overrides: Partial<TaskLike> = {}): TaskLike => ({
  status: 'PENDENT',
  action: 'TRUCAR',
  due_at: null,
  priority: 'MITJANA',
  deleted_at: null,
  ...overrides,
});

describe('canComplete', () => {
  it('accepts a pending task with a result', () => {
    expect(canComplete(task(), 'DEMANA PREUS')).toEqual({ ok: true });
  });

  it('refuses a deleted task, like app.complete_task raising TASCA_NO_TROBADA', () => {
    expect(canComplete(task({ deleted_at: '2026-07-01T00:00:00Z' }), 'DEMANA PREUS')).toEqual({
      ok: false,
      error: 'TASCA_NO_TROBADA',
    });
  });

  it('refuses a task that is already done', () => {
    expect(canComplete(task({ status: 'FET' }), 'DEMANA PREUS')).toEqual({
      ok: false,
      error: 'TASCA_JA_FETA',
    });
  });

  it('requires a result — history without one is worth nothing', () => {
    expect(canComplete(task(), null)).toEqual({ ok: false, error: 'RESULTAT_OBLIGATORI' });
    expect(canComplete(task(), undefined)).toEqual({ ok: false, error: 'RESULTAT_OBLIGATORI' });
  });

  it('requires an observation when the result is ALTRES', () => {
    expect(canComplete(task(), 'ALTRES')).toEqual({
      ok: false,
      error: 'OBSERVACIONS_OBLIGATORIES_ALTRES',
    });
    expect(canComplete(task(), 'ALTRES', '   ')).toEqual({
      ok: false,
      error: 'OBSERVACIONS_OBLIGATORIES_ALTRES',
    });
    expect(canComplete(task(), 'ALTRES', 'Ens deriven al grup')).toEqual({ ok: true });
  });

  it('checks the conditions in the same order as the SQL', () => {
    // Deleted AND already done AND no result: the SQL reports "not found" first.
    expect(
      canComplete(task({ deleted_at: '2026-01-01T00:00:00Z', status: 'FET' }), null),
    ).toEqual({ ok: false, error: 'TASCA_NO_TROBADA' });
  });

  it('lets an AJORNAT task be completed', () => {
    expect(canComplete(task({ status: 'AJORNAT' }), 'ACORDAR VISITA')).toEqual({ ok: true });
  });
});

describe('nextStatusOnComplete', () => {
  it('is always FET', () => {
    expect(nextStatusOnComplete()).toBe('FET');
  });
});

describe('activityTypeForAction', () => {
  it('reproduces the CASE inside app.complete_task', () => {
    expect(activityTypeForAction('TRUCAR')).toBe('TRUCADA');
    expect(activityTypeForAction('VISITA')).toBe('VISITA');
    expect(activityTypeForAction('MOSTRES')).toBe('MOSTRES');
    expect(activityTypeForAction('ENVIAR CORREU')).toBe('CORREU');
    expect(activityTypeForAction('ENVIAR PREUS')).toBe('OFERTA');
    expect(activityTypeForAction('ENVIAR OFERTA')).toBe('OFERTA');
    expect(activityTypeForAction('VERIFICAR EMPRESA')).toBe('NOTA INTERNA');
    expect(activityTypeForAction('ALTRES')).toBe('ALTRES');
  });

  it('maps every action in the enum', () => {
    for (const action of COMMERCIAL_ACTIONS) {
      expect(activityTypeForAction(action)).toBeTruthy();
    }
  });
});

describe('undated tasks', () => {
  it('recognises a next action with no date', () => {
    expect(isUndated(task({ due_at: null }))).toBe(true);
    expect(isUndated(task({ due_at: '2026-07-01T10:00:00Z' }))).toBe(false);
  });

  it('never marks an undated task as overdue, however old it is', () => {
    expect(isOverdue(task({ due_at: null }), NOW)).toBe(false);
  });

  it('can be given a date, but only while PENDENT and undated', () => {
    expect(canSchedule(task({ due_at: null }))).toBe(true);
    expect(canSchedule(task({ due_at: '2026-08-01T10:00:00Z' }))).toBe(false);
    expect(canSchedule(task({ due_at: null, status: 'FET' }))).toBe(false);
    expect(canSchedule(task({ due_at: null, deleted_at: '2026-01-01T00:00:00Z' }))).toBe(false);
  });
});

describe('isOverdue', () => {
  it('is true for a pending task whose date has passed', () => {
    expect(isOverdue(task({ due_at: '2026-07-22T10:00:00Z' }), NOW)).toBe(true);
  });

  it('is false for a future date, a done task or a deleted task', () => {
    expect(isOverdue(task({ due_at: '2026-07-24T10:00:00Z' }), NOW)).toBe(false);
    expect(isOverdue(task({ due_at: '2026-07-22T10:00:00Z', status: 'FET' }), NOW)).toBe(false);
    expect(isOverdue(task({ due_at: '2026-07-22T10:00:00Z', status: 'CANCEL·LAT' }), NOW)).toBe(
      false,
    );
    expect(
      isOverdue(task({ due_at: '2026-07-22T10:00:00Z', deleted_at: '2026-07-22T11:00:00Z' }), NOW),
    ).toBe(false);
  });

  it('is false at exactly the due instant', () => {
    expect(isOverdue(task({ due_at: NOW.toISOString() }), NOW)).toBe(false);
  });
});

describe('sortTasks', () => {
  it('orders by due date first, then by priority ALTA -> MITJANA -> BAIXA', () => {
    const input: TaskLike[] = [
      task({ due_at: '2026-07-24T09:00:00Z', priority: 'BAIXA' }),
      task({ due_at: '2026-07-23T09:00:00Z', priority: 'BAIXA' }),
      task({ due_at: '2026-07-23T09:00:00Z', priority: 'ALTA' }),
      task({ due_at: '2026-07-23T09:00:00Z', priority: 'MITJANA' }),
    ];
    const sorted = sortTasks(input);
    expect(sorted.map((t) => [t.due_at, t.priority])).toEqual([
      ['2026-07-23T09:00:00Z', 'ALTA'],
      ['2026-07-23T09:00:00Z', 'MITJANA'],
      ['2026-07-23T09:00:00Z', 'BAIXA'],
      ['2026-07-24T09:00:00Z', 'BAIXA'],
    ]);
  });

  it('puts undated next actions last, whatever their priority', () => {
    const input: TaskLike[] = [
      task({ due_at: null, priority: 'ALTA' }),
      task({ due_at: '2026-08-01T09:00:00Z', priority: 'BAIXA' }),
    ];
    expect(sortTasks(input).map((t) => t.due_at)).toEqual(['2026-08-01T09:00:00Z', null]);
  });

  it('sorts undated tasks among themselves by priority', () => {
    const input: TaskLike[] = [
      task({ due_at: null, priority: 'BAIXA' }),
      task({ due_at: null, priority: 'ALTA' }),
      task({ due_at: null, priority: 'MITJANA' }),
    ];
    expect(sortTasks(input).map((t) => t.priority)).toEqual(['ALTA', 'MITJANA', 'BAIXA']);
  });

  it('is stable and does not mutate the input', () => {
    const a = task({ due_at: '2026-07-23T09:00:00Z', priority: 'ALTA', action: 'TRUCAR' });
    const b = task({ due_at: '2026-07-23T09:00:00Z', priority: 'ALTA', action: 'VISITA' });
    const input = [a, b];
    const sorted = sortTasks(input);
    expect(sorted[0]).toBe(a);
    expect(sorted[1]).toBe(b);
    expect(input[0]).toBe(a);
  });

  it('handles an empty list', () => {
    expect(sortTasks([])).toEqual([]);
  });
});

describe('canPostpone', () => {
  it('needs a new date, like app.postpone_task raising NOVA_DATA_OBLIGATORIA', () => {
    expect(canPostpone(null)).toBe(false);
    expect(canPostpone(undefined)).toBe(false);
    expect(canPostpone('not a date')).toBe(false);
    expect(canPostpone('2026-08-01T09:00:00Z')).toBe(true);
  });
});
