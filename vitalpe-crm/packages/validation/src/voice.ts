/**
 * `voiceProposalSchema` — the gate every AI interpretation must pass through.
 *
 * ===========================================================================
 *  WHAT IS DELIBERATELY MISSING FROM THIS FILE
 * ===========================================================================
 * There is NO schema variant, and therefore NO representable value, for any of:
 *
 *   - deleting a company (or any hard delete)
 *   - merging companies
 *   - deleting or rewriting history (activities are append-only)
 *   - CONFIRMING a classification  (only PROPOSE_CLASSIFICATION exists;
 *     `app.confirm_classification` refuses without a human `auth.uid()`)
 *   - inviting a user
 *   - changing a role or any permission
 *   - sending an e-mail or any outbound message
 *   - changing an integration (Google Calendar, tokens, webhooks)
 *
 * These are not "rejected at runtime by a rule someone can relax later": the
 * discriminated union below has no member that could carry them, and every
 * member is `.strict()`, so an unexpected key fails parsing too. A model that
 * decides to be creative produces a parse error, not a destructive write.
 *
 * Field names are camelCase here — unlike the table schemas — because this is a
 * JSON contract with the interpreter, stored verbatim in
 * `voice_interpretation_proposals.proposal_original`, not a PostgREST payload.
 */

import { z } from 'zod';
import {
  ACTIVITY_RESULTS,
  ACTIVITY_TYPES,
  CLASSIFICATIONS,
  COMMERCIAL_ACTIONS,
  CONTACT_TYPES,
  FORECAST_NEXT_VALUES,
  OPPORTUNITY_DATA_TYPES,
  OPPORTUNITY_STATUSES,
  SAMPLE_SUBTYPES,
  TASK_PRIORITIES,
} from '@vitalpe/types';
import { isBlank, isoDate, isoDateTime, optionalText, positiveVolume, requiredText, uuid } from './common.js';

const clientIdField = uuid.nullish();

const createNote = z
  .object({
    type: z.literal('CREATE_NOTE'),
    clientId: clientIdField,
    text: requiredText('La nota no pot estar buida.'),
  })
  .strict();

const createActivity = z
  .object({
    type: z.literal('CREATE_ACTIVITY'),
    clientId: clientIdField,
    activityType: z.enum(ACTIVITY_TYPES),
    occurredOn: isoDate.nullish(),
    result: z.enum(ACTIVITY_RESULTS).nullish(),
    notes: optionalText,
    productId: uuid.nullish(),
    campaignId: uuid.nullish(),
  })
  .strict();

const createTask = z
  .object({
    type: z.literal('CREATE_TASK'),
    clientId: clientIdField,
    action: z.enum(COMMERCIAL_ACTIONS),
    otherAction: optionalText,
    sampleSubtype: z.enum(SAMPLE_SUBTYPES).nullish(),
    title: optionalText,
    /** null is meaningful: an undated "next action". */
    dueAt: isoDateTime.nullish(),
    durationMinutes: z.number().int().min(5).max(1440).nullish(),
    priority: z.enum(TASK_PRIORITIES).nullish(),
    notes: optionalText,
    productId: uuid.nullish(),
    campaignId: uuid.nullish(),
  })
  .strict();

const createReminder = z
  .object({
    type: z.literal('CREATE_REMINDER'),
    clientId: clientIdField,
    title: requiredText('El recordatori necessita un títol.'),
    dueAt: isoDateTime,
    notes: optionalText,
  })
  .strict();

const createVisit = z
  .object({
    type: z.literal('CREATE_VISIT'),
    clientId: uuid,
    locationId: uuid.nullish(),
    title: optionalText,
    objective: optionalText,
    startsAt: isoDateTime,
    endsAt: isoDateTime,
    priority: z.enum(TASK_PRIORITIES).nullish(),
  })
  .strict();

const rescheduleVisit = z
  .object({
    type: z.literal('RESCHEDULE_VISIT'),
    visitId: uuid,
    startsAt: isoDateTime,
    endsAt: isoDateTime.nullish(),
    reason: optionalText,
  })
  .strict();

const createOpportunity = z
  .object({
    type: z.literal('CREATE_OPPORTUNITY'),
    clientId: uuid,
    productId: uuid,
    campaignId: uuid,
    dataType: z.enum(OPPORTUNITY_DATA_TYPES),
    volumeLiters: positiveVolume.nullish(),
    forecastNext: z.enum(FORECAST_NEXT_VALUES).nullish(),
    notes: optionalText,
  })
  .strict();

const updateOpportunity = z
  .object({
    type: z.literal('UPDATE_OPPORTUNITY'),
    opportunityId: uuid,
    volumeLiters: positiveVolume.nullish(),
    forecastNext: z.enum(FORECAST_NEXT_VALUES).nullish(),
    status: z.enum(OPPORTUNITY_STATUSES).nullish(),
    notes: optionalText,
  })
  .strict();

const updateContact = z
  .object({
    type: z.literal('UPDATE_CONTACT'),
    contactId: uuid.nullish(),
    clientId: clientIdField,
    firstName: optionalText,
    lastName: optionalText,
    roleTitle: optionalText,
    phone: optionalText,
    email: optionalText,
    contactType: z.enum(CONTACT_TYPES).nullish(),
    isPrimary: z.boolean().nullish(),
    notes: optionalText,
  })
  .strict();

const updateClient = z
  .object({
    type: z.literal('UPDATE_CLIENT'),
    clientId: uuid,
    name: optionalText,
    legalName: optionalText,
    taxId: optionalText,
    municipality: optionalText,
    comarca: optionalText,
    province: optionalText,
    website: optionalText,
    clientTypeCode: optionalText,
    otherClientType: optionalText,
    generalNotes: optionalText,
  })
  .strict();

const proposeClassification = z
  .object({
    type: z.literal('PROPOSE_CLASSIFICATION'),
    clientId: uuid,
    classification: z.enum(CLASSIFICATIONS),
    reason: optionalText,
  })
  .strict();

const completeTask = z
  .object({
    type: z.literal('COMPLETE_TASK'),
    taskId: uuid,
    result: z.enum(ACTIVITY_RESULTS),
    notes: optionalText,
  })
  .strict();

const addResult = z
  .object({
    type: z.literal('ADD_RESULT'),
    clientId: clientIdField,
    taskId: uuid.nullish(),
    activityId: uuid.nullish(),
    result: z.enum(ACTIVITY_RESULTS),
    notes: optionalText,
  })
  .strict();

const addSamples = z
  .object({
    type: z.literal('ADD_SAMPLES'),
    clientId: uuid,
    sampleSubtype: z.enum(SAMPLE_SUBTYPES).nullish(),
    productId: uuid.nullish(),
    dueAt: isoDateTime.nullish(),
    notes: optionalText,
  })
  .strict();

const addOffer = z
  .object({
    type: z.literal('ADD_OFFER'),
    clientId: uuid,
    productId: uuid.nullish(),
    campaignId: uuid.nullish(),
    volumeLiters: positiveVolume.nullish(),
    dueAt: isoDateTime.nullish(),
    notes: optionalText,
  })
  .strict();

const noChange = z
  .object({
    type: z.literal('NO_CHANGE'),
    reason: optionalText,
  })
  .strict();

/**
 * The closed action list. `z.discriminatedUnion` gives a precise error
 * ("tipus d'acció no permès, valors vàlids: …") instead of dumping every branch.
 */
const voiceActionUnion = z.discriminatedUnion(
  'type',
  [
    createNote,
    createActivity,
    createTask,
    createReminder,
    createVisit,
    rescheduleVisit,
    createOpportunity,
    updateOpportunity,
    updateContact,
    updateClient,
    proposeClassification,
    completeTask,
    addResult,
    addSamples,
    addOffer,
    noChange,
  ],
  { errorMap: () => ({ message: 'Tipus d’acció no permès.' }) },
);

function requireNotesForAltres(
  result: string | null | undefined,
  notes: string | null | undefined,
  ctx: z.RefinementCtx,
): void {
  if (result === 'ALTRES' && isBlank(notes)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['notes'],
      message: 'Amb el resultat «ALTRES» cal escriure una observació que l’expliqui.',
    });
  }
}

/**
 * Cross-field rules. They live on the union rather than on each member because
 * zod v3's `discriminatedUnion` only accepts plain `ZodObject`s as options.
 * Every rule below has a CHECK constraint or a `raise exception` behind it.
 */
export const voiceActionSchema = voiceActionUnion.superRefine((value, ctx) => {
  switch (value.type) {
    case 'CREATE_ACTIVITY':
      requireNotesForAltres(value.result, value.notes, ctx);
      break;
    case 'CREATE_TASK':
      if (value.action === 'ALTRES' && isBlank(value.otherAction)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['otherAction'],
          message: 'Amb l’acció «ALTRES» cal explicar quina acció és.',
        });
      }
      break;
    case 'CREATE_VISIT': {
      const starts = Date.parse(value.startsAt);
      const ends = Date.parse(value.endsAt);
      if (!Number.isNaN(starts) && !Number.isNaN(ends) && ends <= starts) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endsAt'],
          message: 'L’hora de fi ha de ser posterior a la d’inici.',
        });
      }
      break;
    }
    case 'RESCHEDULE_VISIT': {
      if (value.endsAt === null || value.endsAt === undefined) break;
      const starts = Date.parse(value.startsAt);
      const ends = Date.parse(value.endsAt);
      if (!Number.isNaN(starts) && !Number.isNaN(ends) && ends <= starts) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['endsAt'],
          message: 'L’hora de fi ha de ser posterior a la d’inici.',
        });
      }
      break;
    }
    case 'CREATE_OPPORTUNITY':
    case 'UPDATE_OPPORTUNITY':
      if (value.forecastNext === 'ALTRES' && isBlank(value.notes)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['notes'],
          message: 'Amb la previsió «ALTRES» cal escriure una observació que l’expliqui.',
        });
      }
      break;
    case 'PROPOSE_CLASSIFICATION':
      if (value.classification === 'NO POTENCIAL' && isBlank(value.reason)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['reason'],
          message: 'Per proposar «NO POTENCIAL» cal indicar-ne el motiu.',
        });
      }
      break;
    case 'COMPLETE_TASK':
      requireNotesForAltres(value.result, value.notes, ctx);
      break;
    case 'ADD_RESULT':
      requireNotesForAltres(value.result, value.notes, ctx);
      if (
        (value.taskId === null || value.taskId === undefined) &&
        (value.activityId === null || value.activityId === undefined) &&
        (value.clientId === null || value.clientId === undefined)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['taskId'],
          message: 'Cal dir a quina tasca, activitat o empresa s’afegeix el resultat.',
        });
      }
      break;
    case 'UPDATE_CONTACT':
      if (
        (value.contactId === null || value.contactId === undefined) &&
        (value.clientId === null || value.clientId === undefined)
      ) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['contactId'],
          message: 'Cal dir quin contacte o de quina empresa s’actualitza.',
        });
      }
      break;
    default:
      break;
  }
});

/** The envelope the interpreter (and REGISTRE RÀPID) returns. */
export const voiceProposalSchema = z
  .object({
    /** null when the company could not be resolved — never a guessed id. */
    clientId: uuid.nullable(),
    summary: z.string(),
    language: z
      .string()
      .min(2, 'Idioma no vàlid.')
      .max(16, 'Idioma no vàlid.'),
    confidence: z
      .number()
      .min(0, 'La confiança ha d’estar entre 0 i 1.')
      .max(1, 'La confiança ha d’estar entre 0 i 1.'),
    ambiguities: z.array(z.string()),
    actions: z
      .array(voiceActionSchema)
      .min(1, 'Una proposta ha de contenir com a mínim una acció (o NO_CHANGE).'),
  })
  .strict();

export type VoiceActionInput = z.infer<typeof voiceActionSchema>;
export type VoiceProposalInput = z.infer<typeof voiceProposalSchema>;
