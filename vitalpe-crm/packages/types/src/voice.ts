/**
 * The proposal contract (brief §24.6).
 *
 * A voice note — or the deterministic REGISTRE RÀPID parser, which produces the
 * exact same shape so the preview UI is identical with or without AI — yields an
 * envelope containing a list of PROPOSED actions. Nothing is ever applied
 * without a human confirming it.
 *
 * The action list below is CLOSED. Destructive or privileged operations
 * (deleting a company, merging companies, deleting history, CONFIRMING a
 * classification, inviting a user, changing a role or permissions, sending an
 * email, changing integrations) are deliberately absent: they are not merely
 * rejected at runtime, they are UNREPRESENTABLE in this type, so no amount of
 * model creativity can produce one.
 */

import type {
  ActivityResult,
  ActivityType,
  Classification,
  CommercialAction,
  ContactType,
  ForecastNext,
  OpportunityDataType,
  OpportunityStatus,
  SampleSubtype,
  TaskPriority,
} from './enums.js';

/** The complete, closed list of proposable action types (brief §24.6). */
export const VOICE_ACTION_TYPES = [
  'CREATE_NOTE',
  'CREATE_ACTIVITY',
  'CREATE_TASK',
  'CREATE_REMINDER',
  'CREATE_VISIT',
  'RESCHEDULE_VISIT',
  'CREATE_OPPORTUNITY',
  'UPDATE_OPPORTUNITY',
  'UPDATE_CONTACT',
  'UPDATE_CLIENT',
  'PROPOSE_CLASSIFICATION',
  'COMPLETE_TASK',
  'ADD_RESULT',
  'ADD_SAMPLES',
  'ADD_OFFER',
  'NO_CHANGE',
] as const;
export type VoiceActionType = (typeof VOICE_ACTION_TYPES)[number];

export interface CreateNoteAction {
  type: 'CREATE_NOTE';
  clientId?: string | null;
  text: string;
}

export interface CreateActivityAction {
  type: 'CREATE_ACTIVITY';
  clientId?: string | null;
  activityType: ActivityType;
  /** ISO date (YYYY-MM-DD). Defaults to today at apply time when absent. */
  occurredOn?: string | null;
  result?: ActivityResult | null;
  notes?: string | null;
  productId?: string | null;
  campaignId?: string | null;
}

export interface CreateTaskAction {
  type: 'CREATE_TASK';
  clientId?: string | null;
  action: CommercialAction;
  otherAction?: string | null;
  sampleSubtype?: SampleSubtype | null;
  title?: string | null;
  /** ISO datetime. NULL means an undated "next action". */
  dueAt?: string | null;
  durationMinutes?: number | null;
  priority?: TaskPriority | null;
  notes?: string | null;
  productId?: string | null;
  campaignId?: string | null;
}

export interface CreateReminderAction {
  type: 'CREATE_REMINDER';
  clientId?: string | null;
  title: string;
  dueAt: string;
  notes?: string | null;
}

export interface CreateVisitAction {
  type: 'CREATE_VISIT';
  clientId: string;
  locationId?: string | null;
  title?: string | null;
  objective?: string | null;
  startsAt: string;
  endsAt: string;
  priority?: TaskPriority | null;
}

export interface RescheduleVisitAction {
  type: 'RESCHEDULE_VISIT';
  visitId: string;
  startsAt: string;
  endsAt?: string | null;
  reason?: string | null;
}

export interface CreateOpportunityAction {
  type: 'CREATE_OPPORTUNITY';
  clientId: string;
  productId: string;
  campaignId: string;
  dataType: OpportunityDataType;
  volumeLiters?: number | null;
  forecastNext?: ForecastNext | null;
  notes?: string | null;
}

export interface UpdateOpportunityAction {
  type: 'UPDATE_OPPORTUNITY';
  opportunityId: string;
  volumeLiters?: number | null;
  forecastNext?: ForecastNext | null;
  status?: OpportunityStatus | null;
  notes?: string | null;
}

export interface UpdateContactAction {
  type: 'UPDATE_CONTACT';
  contactId?: string | null;
  clientId?: string | null;
  firstName?: string | null;
  lastName?: string | null;
  roleTitle?: string | null;
  phone?: string | null;
  email?: string | null;
  contactType?: ContactType | null;
  isPrimary?: boolean | null;
  notes?: string | null;
}

export interface UpdateClientAction {
  type: 'UPDATE_CLIENT';
  clientId: string;
  name?: string | null;
  legalName?: string | null;
  taxId?: string | null;
  municipality?: string | null;
  comarca?: string | null;
  province?: string | null;
  website?: string | null;
  clientTypeCode?: string | null;
  otherClientType?: string | null;
  generalNotes?: string | null;
}

/**
 * PROPOSE only. There is no CONFIRM_CLASSIFICATION variant: confirming is a
 * human-only operation (`app.confirm_classification` refuses without auth.uid()).
 */
export interface ProposeClassificationAction {
  type: 'PROPOSE_CLASSIFICATION';
  clientId: string;
  classification: Classification;
  reason?: string | null;
}

export interface CompleteTaskAction {
  type: 'COMPLETE_TASK';
  taskId: string;
  result: ActivityResult;
  notes?: string | null;
}

export interface AddResultAction {
  type: 'ADD_RESULT';
  clientId?: string | null;
  taskId?: string | null;
  activityId?: string | null;
  result: ActivityResult;
  notes?: string | null;
}

export interface AddSamplesAction {
  type: 'ADD_SAMPLES';
  clientId: string;
  sampleSubtype?: SampleSubtype | null;
  productId?: string | null;
  dueAt?: string | null;
  notes?: string | null;
}

export interface AddOfferAction {
  type: 'ADD_OFFER';
  clientId: string;
  productId?: string | null;
  campaignId?: string | null;
  volumeLiters?: number | null;
  dueAt?: string | null;
  notes?: string | null;
}

export interface NoChangeAction {
  type: 'NO_CHANGE';
  reason?: string | null;
}

export type VoiceAction =
  | CreateNoteAction
  | CreateActivityAction
  | CreateTaskAction
  | CreateReminderAction
  | CreateVisitAction
  | RescheduleVisitAction
  | CreateOpportunityAction
  | UpdateOpportunityAction
  | UpdateContactAction
  | UpdateClientAction
  | ProposeClassificationAction
  | CompleteTaskAction
  | AddResultAction
  | AddSamplesAction
  | AddOfferAction
  | NoChangeAction;

/** Envelope returned by the interpreter (AI) and by REGISTRE RÀPID alike. */
export interface VoiceProposal {
  /** Company the note is about, or NULL when it could not be resolved. */
  clientId: string | null;
  summary: string;
  /** BCP-47-ish tag as detected ('ca', 'es', …). */
  language: string;
  /** 0..1 */
  confidence: number;
  /** Human-readable things the parser refused to guess. */
  ambiguities: string[];
  actions: VoiceAction[];
}
