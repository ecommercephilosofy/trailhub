/**
 * Write schemas for the CRM entities.
 *
 * Every rule here has a CHECK constraint behind it in
 * `supabase/migrations/20260723091000_crm.sql`. The database stays the
 * authority; these schemas exist so a person gets a sentence they can act on
 * instead of a constraint name.
 *
 * Field names are the SQL column names (snake_case) because these payloads go
 * straight to PostgREST.
 */

import { z } from 'zod';
import {
  ACTIVITY_RESULTS,
  ACTIVITY_TYPES,
  CLASSIFICATIONS,
  CONTACT_TYPES,
  FORECAST_NEXT_VALUES,
  LOCATION_TYPES,
  OPPORTUNITY_DATA_TYPES,
  OPPORTUNITY_STATUSES,
  VERIFICATION_STATUSES,
} from '@vitalpe/types';
import { isBlank, isoDate, optionalText, positiveVolume, requiredText, uuid } from './common.js';

// ---------------------------------------------------------------------------
// clients
// ---------------------------------------------------------------------------

const clientBase = z.object({
  workspace_id: uuid.optional(),
  name: requiredText('El nom de l’empresa és obligatori.'),
  legal_name: optionalText,
  tax_id: optionalText,
  municipality: optionalText,
  comarca: optionalText,
  province: optionalText,
  country: z.string().trim().min(2).max(2).default('ES'),
  website: optionalText,
  client_type_code: optionalText,
  other_client_type: optionalText,
  do_cava: z.boolean().default(false),
  do_penedes: z.boolean().default(false),
  do_catalunya: z.boolean().default(false),
  do_altres: z.boolean().default(false),
  confirmed_classification: z.enum(CLASSIFICATIONS).nullish(),
  not_potential_reason: optionalText,
  verification_status: z.enum(VERIFICATION_STATUSES).default('PENDENT DE VERIFICAR'),
  verification_source: optionalText,
  verification_note: optionalText,
  general_notes: optionalText,
  owner_id: uuid.nullish(),
  external_account_code: optionalText,
  is_demo: z.boolean().default(false),
});

/**
 * `public.clients`
 *  - `clients_other_type_needs_explanation`: ALTRES needs `other_client_type`
 *  - `clients_not_potential_needs_reason`:  NO POTENCIAL needs a reason
 *
 * `proposed_classification` is deliberately absent: it is written only by
 * `app.refresh_proposed_classification`, never by a client.
 */
export const clientSchema = clientBase
  .superRefine((value, ctx) => {
    if (value.client_type_code === 'ALTRES' && isBlank(value.other_client_type)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['other_client_type'],
        message: 'Amb el tipus «ALTRES» cal explicar de quin tipus d’empresa es tracta.',
      });
    }
    if (value.confirmed_classification === 'NO POTENCIAL' && isBlank(value.not_potential_reason)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['not_potential_reason'],
        message: 'Per marcar una empresa com a «NO POTENCIAL» cal indicar-ne el motiu.',
      });
    }
  });

export type ClientInput = z.infer<typeof clientSchema>;

/** Partial update; the same two cross-field rules apply to whatever is sent. */
export const clientUpdateSchema = clientBase.partial().superRefine((value, ctx) => {
  if (value.client_type_code === 'ALTRES' && isBlank(value.other_client_type)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['other_client_type'],
      message: 'Amb el tipus «ALTRES» cal explicar de quin tipus d’empresa es tracta.',
    });
  }
  if (value.confirmed_classification === 'NO POTENCIAL' && isBlank(value.not_potential_reason)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['not_potential_reason'],
      message: 'Per marcar una empresa com a «NO POTENCIAL» cal indicar-ne el motiu.',
    });
  }
});

// ---------------------------------------------------------------------------
// contacts
// ---------------------------------------------------------------------------

/**
 * `public.contacts` / `contacts_needs_identity`: a contact with no name, no
 * e-mail and no phone identifies nobody.
 */
export const contactSchema = z
  .object({
    workspace_id: uuid.optional(),
    client_id: uuid,
    first_name: optionalText,
    last_name: optionalText,
    role_title: optionalText,
    phone_original: optionalText,
    email_original: optionalText,
    contact_type: z.enum(CONTACT_TYPES).default('GENERAL'),
    is_primary: z.boolean().default(false),
    is_active: z.boolean().default(true),
    notes: optionalText,
    source: optionalText,
  })
  .superRefine((value, ctx) => {
    const hasIdentity =
      !isBlank(value.first_name) ||
      !isBlank(value.last_name) ||
      !isBlank(value.email_original) ||
      !isBlank(value.phone_original);
    if (!hasIdentity) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['first_name'],
        message: 'Un contacte necessita com a mínim un nom, un cognom, un correu o un telèfon.',
      });
    }
  });

export type ContactInput = z.infer<typeof contactSchema>;

// ---------------------------------------------------------------------------
// client_locations
// ---------------------------------------------------------------------------

/**
 * `public.client_locations`
 *  - `client_locations_coords_pair`: never half-geocoded
 *  - `geofence_radius_m between 50 and 2000`
 */
export const clientLocationSchema = z
  .object({
    workspace_id: uuid.optional(),
    client_id: uuid,
    name: optionalText,
    location_type: z.enum(LOCATION_TYPES).default('SEU'),
    street: optionalText,
    postal_code: optionalText,
    municipality: optionalText,
    comarca: optionalText,
    province: optionalText,
    country: z.string().trim().min(2).max(2).default('ES'),
    formatted_address: optionalText,
    latitude: z
      .number()
      .min(-90, 'La latitud ha d’estar entre -90 i 90.')
      .max(90, 'La latitud ha d’estar entre -90 i 90.')
      .nullish(),
    longitude: z
      .number()
      .min(-180, 'La longitud ha d’estar entre -180 i 180.')
      .max(180, 'La longitud ha d’estar entre -180 i 180.')
      .nullish(),
    accuracy_meters: z.number().nonnegative().nullish(),
    geocode_source: optionalText,
    verified_by_user: z.boolean().default(false),
    is_primary: z.boolean().default(false),
    geofence_enabled: z.boolean().default(true),
    geofence_radius_m: z
      .number()
      .int('El radi ha de ser un nombre enter de metres.')
      .min(50, 'El radi del geofence ha d’estar entre 50 i 2000 metres.')
      .max(2000, 'El radi del geofence ha d’estar entre 50 i 2000 metres.')
      .default(120),
    notes: optionalText,
  })
  .superRefine((value, ctx) => {
    const hasLat = value.latitude !== null && value.latitude !== undefined;
    const hasLon = value.longitude !== null && value.longitude !== undefined;
    if (hasLat !== hasLon) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [hasLat ? 'longitude' : 'latitude'],
        message: 'Les coordenades van en parella: o latitud i longitud, o cap de les dues.',
      });
    }
  });

export type ClientLocationInput = z.infer<typeof clientLocationSchema>;

// ---------------------------------------------------------------------------
// opportunities
// ---------------------------------------------------------------------------

/**
 * `public.opportunities`
 *  - `volume_liters is null or volume_liters > 0`
 *  - `opportunities_forecast_altres_needs_note`: forecast ALTRES needs notes
 */
export const opportunitySchema = z
  .object({
    workspace_id: uuid.optional(),
    client_id: uuid,
    product_id: uuid,
    campaign_id: uuid,
    data_type: z.enum(OPPORTUNITY_DATA_TYPES),
    volume_liters: positiveVolume.nullish(),
    forecast_next: z.enum(FORECAST_NEXT_VALUES).nullish(),
    status: z.enum(OPPORTUNITY_STATUSES).default('OBERTA'),
    probability: z
      .number()
      .int()
      .min(0, 'La probabilitat ha d’estar entre 0 i 100.')
      .max(100, 'La probabilitat ha d’estar entre 0 i 100.')
      .nullish(),
    notes: optionalText,
    source: optionalText,
    owner_id: uuid.nullish(),
  })
  .superRefine((value, ctx) => {
    if (value.forecast_next === 'ALTRES' && isBlank(value.notes)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['notes'],
        message: 'Amb la previsió «ALTRES» cal escriure una observació que l’expliqui.',
      });
    }
  });

export type OpportunityInput = z.infer<typeof opportunitySchema>;

// ---------------------------------------------------------------------------
// activities
// ---------------------------------------------------------------------------

/**
 * `public.activities` / `activities_result_altres_needs_note`.
 * History is append-only: there is no schema for editing or deleting a row,
 * only for creating one (and `corrects_activity_id` to supersede it).
 */
export const activitySchema = z
  .object({
    workspace_id: uuid.optional(),
    client_id: uuid,
    occurred_on: isoDate.optional(),
    activity_type: z.enum(ACTIVITY_TYPES),
    product_id: uuid.nullish(),
    campaign_id: uuid.nullish(),
    result: z.enum(ACTIVITY_RESULTS).nullish(),
    notes: optionalText,
    user_id: uuid.nullish(),
    source_task_id: uuid.nullish(),
    source_visit_id: uuid.nullish(),
    source_voice_note_id: uuid.nullish(),
    corrects_activity_id: uuid.nullish(),
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

export type ActivityInput = z.infer<typeof activitySchema>;
