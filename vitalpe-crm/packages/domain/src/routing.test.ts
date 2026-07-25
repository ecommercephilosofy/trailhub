import { describe, expect, it } from 'vitest';
import { municipalityKey, zoneFor } from './zones';
import { groupByZone, nextMonday, planWeek, scoreCandidate, type RouteCandidate } from './routing';

const NOW = new Date('2026-07-25T09:00:00.000Z'); // Saturday

function candidate(over: Partial<RouteCandidate> = {}): RouteCandidate {
  return {
    clientId: over.clientId ?? crypto.randomUUID(),
    name: over.name ?? 'CELLER DE PROVA',
    // `??` would turn an explicit null back into a default, which is exactly
    // the case these tests need to exercise.
    municipality: 'municipality' in over ? (over.municipality ?? null) : 'SUBIRATS',
    province: 'province' in over ? (over.province ?? null) : 'BARCELONA',
    classification: over.classification ?? null,
    priority: over.priority ?? null,
    openTasks: over.openTasks ?? 0,
    overdueTasks: over.overdueTasks ?? 0,
    nextDueAt: over.nextDueAt ?? null,
    lastContactAt: over.lastContactAt ?? null,
    volumeLiters: over.volumeLiters ?? null,
    ...(over.hasScheduledVisit === undefined ? {} : { hasScheduledVisit: over.hasScheduledVisit }),
  };
}

describe('zones: la geografia és real o no s’afirma', () => {
  it('agrupa els municipis del Penedès a la mateixa comarca', () => {
    expect(zoneFor("SANT SADURNÍ D'ANOIA").zone).toBe('ALT PENEDÈS');
    expect(zoneFor('SUBIRATS').zone).toBe('ALT PENEDÈS');
    expect(zoneFor('VILAFRANCA DEL PENEDÈS').zone).toBe('ALT PENEDÈS');
    expect(zoneFor('FONT-RUBÍ').zone).toBe('ALT PENEDÈS');
  });

  it('tolera les variants d’escriptura del full', () => {
    // Curly vs straight apostrophe, lower case, and the "A | B" form.
    expect(zoneFor('Sant Sadurní d’Anoia').zone).toBe('ALT PENEDÈS');
    expect(zoneFor('SANT PERE DE RIUDEBITLLES | SUBIRATS').zone).toBe('ALT PENEDÈS');
    expect(municipalityKey('Sant Sadurní d’Anoia')).toBe("SANT SADURNI D'ANOIA");
  });

  it('no barreja comarques diferents', () => {
    expect(zoneFor('BATEA').zone).toBe('TERRA ALTA');
    expect(zoneFor('VILA-RODONA').zone).toBe('ALT CAMP');
    expect(zoneFor('BATEA').zone).not.toBe(zoneFor('SUBIRATS').zone);
  });

  it('un municipi desconegut és zona d’ell mateix, i ho diu', () => {
    const result = zoneFor('POBLE INEXISTENT');
    expect(result.known).toBe(false);
    expect(result.zone).toBe('POBLE INEXISTENT');
  });

  it('fora de Catalunya agrupa per província, no per comarca inventada', () => {
    expect(zoneFor('REQUENA', 'VALENCIA').zone).toContain('FORA DE CATALUNYA');
    expect(zoneFor('ALMENDRALEJO', 'BADAJOZ').zone).toContain('EXTREMADURA');
  });

  it('sense municipi no es pot enrutar', () => {
    expect(zoneFor(null).zone).toBe('SENSE MUNICIPI');
  });
});

describe('puntuació: cada motiu és explicable', () => {
  it('una tasca vençuda pesa més que una d’oberta', () => {
    const overdue = scoreCandidate(candidate({ openTasks: 1, overdueTasks: 1 }), NOW);
    const open = scoreCandidate(candidate({ openTasks: 1 }), NOW);
    expect(overdue.score).toBeGreaterThan(open.score);
    expect(overdue.reasons).toContain('1 tasca vençuda');
  });

  it('el silenci llarg puja la prioritat i diu quants dies', () => {
    const quiet = scoreCandidate(
      candidate({ lastContactAt: new Date(NOW.getTime() - 300 * 86_400_000) }),
      NOW,
    );
    const recent = scoreCandidate(
      candidate({ lastContactAt: new Date(NOW.getTime() - 5 * 86_400_000) }),
      NOW,
    );
    expect(quiet.score).toBeGreaterThan(recent.score);
    expect(quiet.reasons.some((r) => r.includes('300 dies'))).toBe(true);
    expect(quiet.daysSinceContact).toBe(300);
  });

  it('el volum compta però no ho decideix tot', () => {
    const huge = scoreCandidate(candidate({ volumeLiters: 500_000 }), NOW);
    const overdue = scoreCandidate(candidate({ openTasks: 3, overdueTasks: 3 }), NOW);
    expect(huge.score).toBeLessThan(overdue.score);
    expect(huge.reasons.some((r) => r.includes('L en joc'))).toBe(true);
  });

  it('cap senyal sol pot dominar-ho tot', () => {
    const many = scoreCandidate(candidate({ openTasks: 40, overdueTasks: 40 }), NOW);
    const few = scoreCandidate(candidate({ openTasks: 3, overdueTasks: 3 }), NOW);
    // Capped: forty overdue tasks is not thirteen times three.
    expect(many.score).toBeLessThan(few.score * 3);
  });

  it('un client mai contactat es marca com a tal', () => {
    expect(scoreCandidate(candidate(), NOW).reasons).toContain('mai contactat');
  });
});

describe('pla setmanal', () => {
  const penedes = (n: number, over: Partial<RouteCandidate> = {}) =>
    Array.from({ length: n }, (_, i) =>
      candidate({ name: `PENEDES ${i}`, municipality: 'SUBIRATS', overdueTasks: 2, ...over }),
    );
  const terraAlta = (n: number) =>
    Array.from({ length: n }, (_, i) =>
      candidate({ name: `TERRA ALTA ${i}`, municipality: 'BATEA', province: 'TARRAGONA', overdueTasks: 1 }),
    );

  it('un dia és una zona: no barreja comarques en la mateixa jornada', () => {
    const plan = planWeek([...penedes(6), ...terraAlta(4)], { now: NOW });
    expect(plan.days.length).toBeGreaterThanOrEqual(2);
    for (const day of plan.days) {
      const zones = new Set(day.stops.map((s) => s.zone));
      expect(zones.size).toBe(1);
      expect([...zones][0]).toBe(day.zone);
    }
  });

  it('la zona amb més feina va primer', () => {
    const plan = planWeek([...penedes(6), ...terraAlta(4)], { now: NOW });
    expect(plan.days[0]!.zone).toBe('ALT PENEDÈS');
  });

  it('no proposa un viatge per un sol client', () => {
    const lonely = [candidate({ municipality: 'BATEA', province: 'TARRAGONA', overdueTasks: 5 })];
    const plan = planWeek([...penedes(6), ...lonely], { now: NOW });
    expect(plan.days.some((d) => d.zone === 'TERRA ALTA')).toBe(false);
  });

  it('respecta el màxim de visites per dia', () => {
    const plan = planWeek(penedes(30), { now: NOW, maxStopsPerDay: 4 });
    for (const day of plan.days) expect(day.stops.length).toBeLessThanOrEqual(4);
  });

  it('només dies laborables, començant en dilluns', () => {
    const plan = planWeek([...penedes(6), ...terraAlta(4)], { now: NOW });
    expect(plan.weekStart).toBe('2026-07-27'); // the Monday after Saturday 25/07
    for (const day of plan.days) expect(day.weekdayIndex).toBeLessThanOrEqual(5);
  });

  it('qui ja té visita programada no es torna a proposar', () => {
    const booked = candidate({
      name: 'JA PROGRAMADA', municipality: 'SUBIRATS', overdueTasks: 9, hasScheduledVisit: true,
    });
    const plan = planWeek([...penedes(6), booked], { now: NOW });
    const names = plan.days.flatMap((d) => d.stops.map((s) => s.candidate.name));
    expect(names).not.toContain('JA PROGRAMADA');
    expect(plan.alreadyScheduled.map((s) => s.candidate.name)).toContain('JA PROGRAMADA');
  });

  it('els clients sense municipi es reporten a part, no s’endevinen', () => {
    const nowhere = candidate({ name: 'SENSE ADREÇA', municipality: null, province: null, overdueTasks: 4 });
    const plan = planWeek([...penedes(6), nowhere], { now: NOW });
    expect(plan.unroutable.map((s) => s.candidate.name)).toContain('SENSE ADREÇA');
    const routed = plan.days.flatMap((d) => d.stops.map((s) => s.candidate.name));
    expect(routed).not.toContain('SENSE ADREÇA');
  });

  it('les zones que no caben queden ajornades, no perdudes', () => {
    const many = [
      ...penedes(6),
      ...terraAlta(4),
      ...Array.from({ length: 4 }, (_, i) =>
        candidate({ name: `CAMP ${i}`, municipality: 'VILA-RODONA', province: 'TARRAGONA', overdueTasks: 1 })),
    ];
    const plan = planWeek(many, { now: NOW, workingDays: [1] });
    expect(plan.days).toHaveLength(1);
    expect(plan.deferred.length).toBeGreaterThan(0);
  });

  it('cada parada porta els seus motius', () => {
    const plan = planWeek(penedes(6, { priority: 'ALTA', classification: 'ACTIU SEGUR' }), { now: NOW });
    for (const stop of plan.days[0]!.stops) {
      expect(stop.reasons.length).toBeGreaterThan(0);
      expect(stop.score).toBeGreaterThan(0);
    }
  });

  it('nextMonday és idempotent si ja és dilluns', () => {
    const monday = new Date('2026-07-27T08:00:00.000Z');
    expect(nextMonday(monday).toISOString().slice(0, 10)).toBe('2026-07-27');
  });

  it('groupByZone ordena per valor del dia', () => {
    const stops = [...penedes(6), ...terraAlta(4)].map((c) => scoreCandidate(c, NOW));
    const zones = groupByZone(stops, 5);
    expect(zones[0]!.zone).toBe('ALT PENEDÈS');
    expect(zones[0]!.dayValue).toBeGreaterThanOrEqual(zones[1]!.dayValue);
  });
});
