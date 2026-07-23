import { describe, expect, it } from 'vitest';
import { AMBIGUITIES, formatDateEs, formatTime24 } from './dates.js';
import {
  QUICK_CAPTURE_AMBIGUITIES,
  quickCapture,
  type QuickCaptureCatalog,
} from './quickCapture.js';

const NOW = new Date('2026-07-23T10:00:00Z'); // Thursday, 12:00 Europe/Madrid

const ROMAGOSA = '11111111-1111-4111-8111-111111111111';
const TORELLO = '22222222-2222-4222-8222-222222222222';
const BASE_CAVA = '33333333-3333-4333-8333-333333333333';
const CAMPANYA = '44444444-4444-4444-8444-444444444444';
const ROMAGOSA_VELL = '55555555-5555-4555-8555-555555555555';

const CATALOG: QuickCaptureCatalog = {
  clients: [
    { id: ROMAGOSA, name: 'Masia Romagosa S.L.', aliases: ['Cellers Romagosa'] },
    { id: TORELLO, name: 'Caves Torelló' },
  ],
  products: [{ id: BASE_CAVA, name: 'Base Cava Blanc', aliases: ['BCB'] }],
  campaigns: [{ id: CAMPANYA, name: 'Campanya 2026' }],
};

const parse = (text: string, catalog: QuickCaptureCatalog = CATALOG) =>
  quickCapture.parse(text, catalog, { now: NOW });

describe('quickCapture — company recognition', () => {
  it('finds a company whose legal form is written differently', () => {
    expect(parse('Trucar a Masia Romagosa SL demà').clientId).toBe(ROMAGOSA);
    expect(parse('Trucar a MASIA ROMAGOSA, S.L.U. demà').clientId).toBe(ROMAGOSA);
  });

  it('finds a company through an alias', () => {
    expect(parse('Enviar preus a Cellers Romagosa').clientId).toBe(ROMAGOSA);
  });

  it('folds accents', () => {
    expect(parse('Visitar Caves Torello').clientId).toBe(TORELLO);
    expect(parse('Visitar Caves Torelló').clientId).toBe(TORELLO);
  });

  it('refuses to guess from a partial name', () => {
    const proposal = parse('Trucar a Romagosa');
    expect(proposal.clientId).toBeNull();
    expect(proposal.ambiguities).toContain(QUICK_CAPTURE_AMBIGUITIES.CLIENT_NOT_FOUND);
  });

  it('flags an ambiguity instead of picking one of two matches', () => {
    const proposal = parse('Trucar a Masia Romagosa', {
      clients: [
        { id: ROMAGOSA, name: 'Masia Romagosa' },
        { id: ROMAGOSA_VELL, name: 'Masia Romagosa SL' }, // same normalised key
      ],
    });
    expect(proposal.clientId).toBeNull();
    expect(proposal.ambiguities).toContain(QUICK_CAPTURE_AMBIGUITIES.CLIENT_MULTIPLE);
  });

  it('prefers the longest matching name', () => {
    const proposal = parse('Trucar a Caves Torelló Germans', {
      clients: [
        { id: TORELLO, name: 'Caves Torelló' },
        { id: ROMAGOSA, name: 'Caves Torelló Germans' },
      ],
    });
    expect(proposal.clientId).toBe(ROMAGOSA);
  });

  it('does not complain about a missing company when the catalogue is empty', () => {
    expect(parse('Trucar a algú', {}).ambiguities).toEqual([]);
  });
});

describe('quickCapture — action, date and priority', () => {
  it('turns an action plus a date into a task', () => {
    const proposal = parse('Trucar a Masia Romagosa dimarts, urgent');
    expect(proposal.actions).toHaveLength(1);
    const action = proposal.actions[0];
    expect(action?.type).toBe('CREATE_TASK');
    if (action?.type !== 'CREATE_TASK') throw new Error('unreachable');
    expect(action.action).toBe('TRUCAR');
    expect(action.priority).toBe('ALTA');
    expect(action.clientId).toBe(ROMAGOSA);
    expect(formatDateEs(new Date(action.dueAt as string))).toBe('28/07/2026');
    expect(formatTime24(new Date(action.dueAt as string))).toBe('09:00');
  });

  it('turns an action with no date into an undated next action', () => {
    const proposal = parse('Enviar preus a Masia Romagosa');
    const action = proposal.actions[0];
    if (action?.type !== 'CREATE_TASK') throw new Error('expected CREATE_TASK');
    expect(action.action).toBe('ENVIAR PREUS');
    expect(action.dueAt).toBeNull();
    expect(action.priority).toBe('MITJANA');
  });

  it('reads the whole commercial-action vocabulary', () => {
    const actionOf = (text: string): string => {
      const first = parse(text).actions[0];
      return first?.type === 'CREATE_TASK' ? first.action : 'NONE';
    };
    expect(actionOf('Trucar a Masia Romagosa')).toBe('TRUCAR');
    expect(actionOf('Visitar Masia Romagosa')).toBe('VISITA');
    expect(actionOf('Portar mostres a Masia Romagosa')).toBe('MOSTRES');
    expect(actionOf('Enviar correu a Masia Romagosa')).toBe('ENVIAR CORREU');
    expect(actionOf('Enviar preus a Masia Romagosa')).toBe('ENVIAR PREUS');
    expect(actionOf('Enviar oferta a Masia Romagosa')).toBe('ENVIAR OFERTA');
    expect(actionOf('Verificar empresa Masia Romagosa')).toBe('VERIFICAR EMPRESA');
  });

  it('reads a low priority', () => {
    const action = parse('Trucar a Masia Romagosa, sense pressa').actions[0];
    if (action?.type !== 'CREATE_TASK') throw new Error('expected CREATE_TASK');
    expect(action.priority).toBe('BAIXA');
  });

  it('lets the earliest action keyword win', () => {
    const action = parse('Trucar a Masia Romagosa i enviar preus').actions[0];
    if (action?.type !== 'CREATE_TASK') throw new Error('expected CREATE_TASK');
    expect(action.action).toBe('TRUCAR');
  });
});

describe('quickCapture — results', () => {
  it('turns a result into an activity, with the matching activity type', () => {
    const proposal = parse('Trucat a Caves Torelló, demana preus');
    expect(proposal.actions).toHaveLength(1);
    const action = proposal.actions[0];
    if (action?.type !== 'CREATE_ACTIVITY') throw new Error('expected CREATE_ACTIVITY');
    expect(action.activityType).toBe('TRUCADA');
    expect(action.result).toBe('DEMANA PREUS');
    expect(action.clientId).toBe(TORELLO);
  });

  it('lets the longest result phrase win over a shorter overlapping one', () => {
    const action = parse('Masia Romagosa no compra vi a granel').actions[0];
    if (action?.type !== 'CREATE_ACTIVITY') throw new Error('expected CREATE_ACTIVITY');
    expect(action.result).toBe('NO COMPRA VI A GRANEL');
  });

  it('reads the negative results', () => {
    const resultOf = (text: string): string => {
      const first = parse(text).actions[0];
      return first?.type === 'CREATE_ACTIVITY' ? (first.result as string) : 'NONE';
    };
    expect(resultOf('Masia Romagosa no comprara res')).toBe('NO COMPRARA');
    expect(resultOf('Masia Romagosa ha tancat')).toBe('TANCAT / INACTIU');
    expect(resultOf('Masia Romagosa te un altre proveidor')).toBe('TE UN ALTRE PROVEIDOR');
    expect(resultOf('Masia Romagosa repetira comanda')).toBe('REPETIRA COMANDA');
  });

  it('adds a reminder when a past result also carries a future date', () => {
    const proposal = parse('Llamar a Caves Torelló mañana, piden precios');
    expect(proposal.actions.map((a) => a.type)).toEqual(['CREATE_ACTIVITY', 'CREATE_REMINDER']);
    const reminder = proposal.actions[1];
    if (reminder?.type !== 'CREATE_REMINDER') throw new Error('expected CREATE_REMINDER');
    expect(formatDateEs(new Date(reminder.dueAt))).toBe('24/07/2026');
  });
});

describe('quickCapture — fallbacks', () => {
  it('falls back to a reminder when there is a date but no action', () => {
    const proposal = parse('Masia Romagosa demà');
    const action = proposal.actions[0];
    if (action?.type !== 'CREATE_REMINDER') throw new Error('expected CREATE_REMINDER');
    expect(formatDateEs(new Date(action.dueAt))).toBe('24/07/2026');
  });

  it('falls back to a note when nothing at all is recognised', () => {
    const proposal = parse('Masia Romagosa, comentari qualsevol');
    const action = proposal.actions[0];
    if (action?.type !== 'CREATE_NOTE') throw new Error('expected CREATE_NOTE');
    expect(action.text).toBe('Masia Romagosa, comentari qualsevol');
    expect(action.clientId).toBe(ROMAGOSA);
  });

  it('always produces at least one action', () => {
    for (const text of ['', '   ', '???']) {
      expect(quickCapture.parse(text, CATALOG, { now: NOW }).actions.length).toBeGreaterThan(0);
    }
  });
});

describe('quickCapture — never guesses', () => {
  it('propagates the date ambiguity and creates no dated action', () => {
    const proposal = parse('Trucar a Masia Romagosa després de verema');
    expect(proposal.ambiguities).toContain(AMBIGUITIES.VEREMA);
    const action = proposal.actions[0];
    if (action?.type !== 'CREATE_TASK') throw new Error('expected CREATE_TASK');
    expect(action.dueAt).toBeNull();
  });

  it('proposes nothing destructive: only additive action types are reachable', () => {
    const reachable = new Set<string>();
    for (const text of [
      'Trucar a Masia Romagosa demà',
      'Trucat a Caves Torelló, demana preus',
      'Masia Romagosa demà',
      'Masia Romagosa, comentari',
      'Llamar a Caves Torelló mañana, piden precios',
    ]) {
      for (const action of parse(text).actions) reachable.add(action.type);
    }
    expect([...reachable].sort()).toEqual([
      'CREATE_ACTIVITY',
      'CREATE_NOTE',
      'CREATE_REMINDER',
      'CREATE_TASK',
    ]);
  });
});

describe('quickCapture — catalogue, language and confidence', () => {
  it('matches a product by name and by alias', () => {
    const byName = parse('Portar mostres de Base Cava Blanc a Masia Romagosa').actions[0];
    if (byName?.type !== 'CREATE_TASK') throw new Error('expected CREATE_TASK');
    expect(byName.productId).toBe(BASE_CAVA);

    const byAlias = parse('Portar mostres de BCB a Masia Romagosa').actions[0];
    if (byAlias?.type !== 'CREATE_TASK') throw new Error('expected CREATE_TASK');
    expect(byAlias.productId).toBe(BASE_CAVA);
  });

  it('matches a campaign', () => {
    const action = parse('Enviar preus a Masia Romagosa per la Campanya 2026').actions[0];
    if (action?.type !== 'CREATE_TASK') throw new Error('expected CREATE_TASK');
    expect(action.campaignId).toBe(CAMPANYA);
  });

  it('detects Catalan and Spanish', () => {
    expect(parse('Trucar a Masia Romagosa dimarts').language).toBe('ca');
    expect(parse('Llamar a Caves Torelló el lunes').language).toBe('es');
  });

  it('reports a confidence in 0..1 that drops with every ambiguity', () => {
    const confident = parse('Trucar a Masia Romagosa dimarts');
    const unsure = parse('Trucar a algú desconegut després de verema');
    expect(confident.confidence).toBeGreaterThan(unsure.confidence);
    for (const proposal of [confident, unsure]) {
      expect(proposal.confidence).toBeGreaterThanOrEqual(0);
      expect(proposal.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('keeps the original text as the summary', () => {
    expect(parse('  Trucar a Masia Romagosa  ').summary).toBe('Trucar a Masia Romagosa');
  });

  it('is deterministic: the same input always yields the same proposal', () => {
    const text = 'Portar mostres de BCB a Masia Romagosa dimarts, urgent';
    expect(JSON.stringify(parse(text))).toBe(JSON.stringify(parse(text)));
  });
});
