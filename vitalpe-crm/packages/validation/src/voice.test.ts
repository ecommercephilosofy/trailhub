import { describe, expect, it } from 'vitest';
import { VOICE_ACTION_TYPES, type VoiceProposal } from '@vitalpe/types';
import { quickCapture } from '@vitalpe/domain';
import { safeParse, parseOrThrow } from './errors.js';
import { voiceActionSchema, voiceProposalSchema, type VoiceProposalInput } from './voice.js';

const CLIENT = '11111111-1111-4111-8111-111111111111';
const PRODUCT = '22222222-2222-4222-8222-222222222222';
const CAMPAIGN = '33333333-3333-4333-8333-333333333333';
const TASK = '44444444-4444-4444-8444-444444444444';
const VISIT = '55555555-5555-4555-8555-555555555555';
const OPPORTUNITY = '66666666-6666-4666-8666-666666666666';
const CONTACT = '77777777-7777-4777-8777-777777777777';

const envelope = (actions: unknown[]): unknown => ({
  clientId: CLIENT,
  summary: 'resum',
  language: 'ca',
  confidence: 0.8,
  ambiguities: [],
  actions,
});

const acceptsAction = (action: unknown): boolean => safeParse(voiceActionSchema, action).success;

describe('voiceActionSchema — the closed action list', () => {
  it('accepts one well-formed example of every allowed type', () => {
    const examples: Record<string, unknown> = {
      CREATE_NOTE: { type: 'CREATE_NOTE', clientId: CLIENT, text: 'Han canviat de gerent.' },
      CREATE_ACTIVITY: {
        type: 'CREATE_ACTIVITY',
        clientId: CLIENT,
        activityType: 'TRUCADA',
        result: 'DEMANA PREUS',
      },
      CREATE_TASK: { type: 'CREATE_TASK', clientId: CLIENT, action: 'TRUCAR', dueAt: null },
      CREATE_REMINDER: {
        type: 'CREATE_REMINDER',
        clientId: CLIENT,
        title: 'Trucar',
        dueAt: '2026-08-01T09:00:00Z',
      },
      CREATE_VISIT: {
        type: 'CREATE_VISIT',
        clientId: CLIENT,
        startsAt: '2026-08-01T09:00:00Z',
        endsAt: '2026-08-01T10:00:00Z',
      },
      RESCHEDULE_VISIT: {
        type: 'RESCHEDULE_VISIT',
        visitId: VISIT,
        startsAt: '2026-08-02T09:00:00Z',
      },
      CREATE_OPPORTUNITY: {
        type: 'CREATE_OPPORTUNITY',
        clientId: CLIENT,
        productId: PRODUCT,
        campaignId: CAMPAIGN,
        dataType: 'POSSIBLE COMPRA',
        volumeLiters: 5000,
      },
      UPDATE_OPPORTUNITY: {
        type: 'UPDATE_OPPORTUNITY',
        opportunityId: OPPORTUNITY,
        status: 'GUANYADA',
      },
      UPDATE_CONTACT: { type: 'UPDATE_CONTACT', contactId: CONTACT, roleTitle: 'Enòleg' },
      UPDATE_CLIENT: { type: 'UPDATE_CLIENT', clientId: CLIENT, municipality: 'Vilafranca' },
      PROPOSE_CLASSIFICATION: {
        type: 'PROPOSE_CLASSIFICATION',
        clientId: CLIENT,
        classification: 'POTENCIAL INTERESSAT',
      },
      COMPLETE_TASK: { type: 'COMPLETE_TASK', taskId: TASK, result: 'ACORDAR VISITA' },
      ADD_RESULT: { type: 'ADD_RESULT', taskId: TASK, result: 'DEMANA MOSTRES' },
      ADD_SAMPLES: { type: 'ADD_SAMPLES', clientId: CLIENT, sampleSubtype: 'CATA A VITALPE' },
      ADD_OFFER: { type: 'ADD_OFFER', clientId: CLIENT, productId: PRODUCT },
      NO_CHANGE: { type: 'NO_CHANGE', reason: 'Només és una salutació.' },
    };

    for (const type of VOICE_ACTION_TYPES) {
      expect(Object.keys(examples), `example missing for ${type}`).toContain(type);
      expect(acceptsAction(examples[type]), `${type} should parse`).toBe(true);
    }
  });

  it('covers exactly the 16 types listed in the brief, no more', () => {
    expect(VOICE_ACTION_TYPES).toHaveLength(16);
  });
});

describe('voiceActionSchema — forbidden operations are unrepresentable', () => {
  it.each([
    ['DELETE_CLIENT', { type: 'DELETE_CLIENT', clientId: CLIENT }],
    ['MERGE_CLIENTS', { type: 'MERGE_CLIENTS', surviving: CLIENT, merged: CONTACT }],
    ['DELETE_ACTIVITY', { type: 'DELETE_ACTIVITY', activityId: TASK }],
    ['DELETE_HISTORY', { type: 'DELETE_HISTORY', clientId: CLIENT }],
    ['CONFIRM_CLASSIFICATION', { type: 'CONFIRM_CLASSIFICATION', clientId: CLIENT, classification: 'ACTIU SEGUR' }],
    ['INVITE_USER', { type: 'INVITE_USER', email: 'algu@example.com' }],
    ['CHANGE_ROLE', { type: 'CHANGE_ROLE', userId: CLIENT, role: 'ADMIN' }],
    ['SET_PERMISSIONS', { type: 'SET_PERMISSIONS', userId: CLIENT, permissions: ['*'] }],
    ['SEND_EMAIL', { type: 'SEND_EMAIL', to: 'algu@example.com', body: 'hola' }],
    ['CHANGE_INTEGRATION', { type: 'CHANGE_INTEGRATION', provider: 'google', enabled: false }],
  ])('rejects %s', (_name, action) => {
    expect(acceptsAction(action)).toBe(false);
  });

  it('has no CONFIRM_CLASSIFICATION variant at all — only PROPOSE', () => {
    expect(VOICE_ACTION_TYPES).toContain('PROPOSE_CLASSIFICATION');
    expect(VOICE_ACTION_TYPES as readonly string[]).not.toContain('CONFIRM_CLASSIFICATION');
  });

  it('rejects an allowed action smuggling an extra field (schemas are strict)', () => {
    expect(
      acceptsAction({
        type: 'UPDATE_CLIENT',
        clientId: CLIENT,
        municipality: 'Vilafranca',
        deleted_at: '2026-07-23T00:00:00Z',
      }),
    ).toBe(false);
    expect(
      acceptsAction({
        type: 'PROPOSE_CLASSIFICATION',
        clientId: CLIENT,
        classification: 'ACTIU SEGUR',
        confirmed_classification: 'ACTIU SEGUR',
      }),
    ).toBe(false);
  });

  it('reports an unknown action type in Catalan', () => {
    const result = safeParse(voiceActionSchema, { type: 'DELETE_CLIENT' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0]?.message).toContain('acció');
  });
});

describe('voiceActionSchema — the same rules the database enforces', () => {
  it('CREATE_ACTIVITY with result ALTRES needs notes', () => {
    expect(acceptsAction({ type: 'CREATE_ACTIVITY', activityType: 'ALTRES', result: 'ALTRES' })).toBe(
      false,
    );
    expect(
      acceptsAction({
        type: 'CREATE_ACTIVITY',
        activityType: 'ALTRES',
        result: 'ALTRES',
        notes: 'Ens deriven al grup',
      }),
    ).toBe(true);
  });

  it('CREATE_TASK with action ALTRES needs otherAction', () => {
    expect(acceptsAction({ type: 'CREATE_TASK', action: 'ALTRES' })).toBe(false);
    expect(acceptsAction({ type: 'CREATE_TASK', action: 'ALTRES', otherAction: 'Passar-hi' })).toBe(
      true,
    );
  });

  it('CREATE_VISIT needs endsAt after startsAt', () => {
    expect(
      acceptsAction({
        type: 'CREATE_VISIT',
        clientId: CLIENT,
        startsAt: '2026-08-01T10:00:00Z',
        endsAt: '2026-08-01T09:00:00Z',
      }),
    ).toBe(false);
  });

  it('RESCHEDULE_VISIT checks the order only when endsAt is given', () => {
    expect(
      acceptsAction({ type: 'RESCHEDULE_VISIT', visitId: VISIT, startsAt: '2026-08-01T10:00:00Z' }),
    ).toBe(true);
    expect(
      acceptsAction({
        type: 'RESCHEDULE_VISIT',
        visitId: VISIT,
        startsAt: '2026-08-01T10:00:00Z',
        endsAt: '2026-08-01T09:00:00Z',
      }),
    ).toBe(false);
  });

  it('opportunities reject a non-positive volume and require notes for forecast ALTRES', () => {
    const base = {
      type: 'CREATE_OPPORTUNITY',
      clientId: CLIENT,
      productId: PRODUCT,
      campaignId: CAMPAIGN,
      dataType: 'COMPRA REAL',
    };
    expect(acceptsAction({ ...base, volumeLiters: 0 })).toBe(false);
    expect(acceptsAction({ ...base, forecastNext: 'ALTRES' })).toBe(false);
    expect(acceptsAction({ ...base, forecastNext: 'ALTRES', notes: 'Volen BIB' })).toBe(true);
    expect(
      acceptsAction({ type: 'UPDATE_OPPORTUNITY', opportunityId: OPPORTUNITY, forecastNext: 'ALTRES' }),
    ).toBe(false);
  });

  it('PROPOSE_CLASSIFICATION NO POTENCIAL needs a reason', () => {
    expect(
      acceptsAction({ type: 'PROPOSE_CLASSIFICATION', clientId: CLIENT, classification: 'NO POTENCIAL' }),
    ).toBe(false);
    expect(
      acceptsAction({
        type: 'PROPOSE_CLASSIFICATION',
        clientId: CLIENT,
        classification: 'NO POTENCIAL',
        reason: 'Ha tancat',
      }),
    ).toBe(true);
  });

  it('COMPLETE_TASK and ADD_RESULT need notes for result ALTRES', () => {
    expect(acceptsAction({ type: 'COMPLETE_TASK', taskId: TASK, result: 'ALTRES' })).toBe(false);
    expect(acceptsAction({ type: 'ADD_RESULT', taskId: TASK, result: 'ALTRES' })).toBe(false);
    expect(
      acceptsAction({ type: 'ADD_RESULT', taskId: TASK, result: 'ALTRES', notes: 'Ens deriven' }),
    ).toBe(true);
  });

  it('ADD_RESULT and UPDATE_CONTACT need something to point at', () => {
    expect(acceptsAction({ type: 'ADD_RESULT', result: 'DEMANA PREUS' })).toBe(false);
    expect(acceptsAction({ type: 'UPDATE_CONTACT', firstName: 'Jordi' })).toBe(false);
    expect(acceptsAction({ type: 'UPDATE_CONTACT', clientId: CLIENT, firstName: 'Jordi' })).toBe(
      true,
    );
  });

  it('rejects an id that is not a uuid — no invented references', () => {
    expect(acceptsAction({ type: 'COMPLETE_TASK', taskId: 'la tasca de la Masia', result: 'ALTRES', notes: 'x' })).toBe(
      false,
    );
  });
});

describe('voiceProposalSchema — the envelope', () => {
  it('accepts a complete proposal', () => {
    const parsed = parseOrThrow(
      voiceProposalSchema,
      envelope([{ type: 'NO_CHANGE', reason: 'Res a fer' }]),
    );
    expect(parsed.clientId).toBe(CLIENT);
    expect(parsed.actions).toHaveLength(1);
  });

  it('allows a null clientId — an unresolved company is never guessed', () => {
    expect(
      safeParse(voiceProposalSchema, { ...(envelope([{ type: 'NO_CHANGE' }]) as object), clientId: null })
        .success,
    ).toBe(true);
  });

  it('requires at least one action', () => {
    expect(safeParse(voiceProposalSchema, envelope([])).success).toBe(false);
  });

  it('keeps confidence inside 0..1', () => {
    for (const confidence of [-0.1, 1.1, 'alta']) {
      expect(
        safeParse(voiceProposalSchema, {
          ...(envelope([{ type: 'NO_CHANGE' }]) as object),
          confidence,
        }).success,
      ).toBe(false);
    }
  });

  it('requires the ambiguities array to be present', () => {
    const { ambiguities: _drop, ...withoutAmbiguities } = envelope([
      { type: 'NO_CHANGE' },
    ]) as Record<string, unknown>;
    expect(safeParse(voiceProposalSchema, withoutAmbiguities).success).toBe(false);
  });

  it('rejects unknown top-level keys', () => {
    expect(
      safeParse(voiceProposalSchema, {
        ...(envelope([{ type: 'NO_CHANGE' }]) as object),
        applyImmediately: true,
      }).success,
    ).toBe(false);
  });

  it('rejects a proposal whose one bad action poisons the batch', () => {
    expect(
      safeParse(
        voiceProposalSchema,
        envelope([{ type: 'NO_CHANGE' }, { type: 'DELETE_CLIENT', clientId: CLIENT }]),
      ).success,
    ).toBe(false);
  });
});

describe('REGISTRE RÀPID produces a valid proposal', () => {
  const NOW = new Date('2026-07-23T10:00:00Z');
  const catalog = {
    clients: [{ id: CLIENT, name: 'Masia Romagosa S.L.' }],
    products: [{ id: PRODUCT, name: 'Base Cava Blanc' }],
    campaigns: [{ id: CAMPAIGN, name: 'Campanya 2026' }],
  };

  it.each([
    'Trucar a Masia Romagosa dimarts, urgent',
    'Trucat a Masia Romagosa, demana preus',
    'Portar mostres de Base Cava Blanc a Masia Romagosa el 15/09/2026',
    'Masia Romagosa: després de verema',
    'Masia Romagosa demà a les 10:30',
    'Masia Romagosa, comentari qualsevol',
    'Enviar preus a Masia Romagosa per la Campanya 2026',
    '',
  ])('the deterministic parser passes the AI gate: %s', (text) => {
    const proposal = quickCapture.parse(text, catalog, { now: NOW });
    const result = safeParse(voiceProposalSchema, proposal);
    if (!result.success) {
      throw new Error(`${text}: ${result.error.message}`);
    }
    expect(result.success).toBe(true);
  });
});

describe('type compatibility with @vitalpe/types', () => {
  it('the schema output and the hand-written type describe the same value', () => {
    // Compile-time assertions: both directions must be assignable, so
    // @vitalpe/domain (which builds a VoiceProposal) and @vitalpe/validation
    // (which parses one) can never disagree about the shape.
    const fromSchema = {} as VoiceProposalInput;
    const fromTypes: VoiceProposal = fromSchema;
    const backAgain: VoiceProposalInput = fromTypes;
    expect(typeof backAgain).toBe('object');
  });
});
