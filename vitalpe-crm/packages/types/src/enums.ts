/**
 * Enumerated domains — mirror of the `app.*` PostgreSQL enums declared in
 * `supabase/migrations/20260723090000_core.sql`.
 *
 * The strings are copied CHARACTER BY CHARACTER from the SQL. Several of them
 * look like typos in Catalan and are deliberately kept as-is, because the
 * database is the source of truth and any "fix" here would produce a value the
 * database rejects at write time:
 *
 *   - 'PREVISIO CONFIRMADA'  (no accent on PREVISIÓ)
 *   - 'INTERES CONCRET', 'TE UN ALTRE PROVEIDOR', 'REPETIRA COMANDA',
 *     'NO COMPRARA', 'EN PROCES', 'IMPORTACIO', 'MOBIL', 'DO PENEDES'
 *   - 'CANCEL·LAT' / 'CANCEL·LADA' use U+00B7 MIDDLE DOT (the Catalan ela
 *     geminada), not a full stop and not a bullet.
 *
 * Every enum exports BOTH a runtime `as const` array (used to build UI selects
 * and to drive `z.enum`) and the literal union type derived from it.
 */

/** `app.user_role` */
export const USER_ROLES = ['ADMIN', 'GERENT', 'COMERCIAL'] as const;
export type UserRole = (typeof USER_ROLES)[number];

/** `app.membership_status` */
export const MEMBERSHIP_STATUSES = ['PENDENT', 'ACTIU', 'DESACTIVAT'] as const;
export type MembershipStatus = (typeof MEMBERSHIP_STATUSES)[number];

/** `app.invitation_status` */
export const INVITATION_STATUSES = ['PENDENT', 'ACCEPTADA', 'REVOCADA', 'CADUCADA'] as const;
export type InvitationStatus = (typeof INVITATION_STATUSES)[number];

/** `app.classification` */
export const CLASSIFICATIONS = [
  'ACTIU SEGUR',
  'POTENCIAL INTERESSAT',
  'POTENCIAL AMB UN ALTRE PROVEIDOR',
  'NO POTENCIAL',
] as const;
export type Classification = (typeof CLASSIFICATIONS)[number];

/** `app.verification_status` */
export const VERIFICATION_STATUSES = [
  'ACTIVA',
  'INACTIVA',
  'PENDENT DE VERIFICAR',
  'DUBTOSA',
] as const;
export type VerificationStatus = (typeof VERIFICATION_STATUSES)[number];

/** `app.contact_type` */
export const CONTACT_TYPES = ['GENERAL', 'DIRECTE'] as const;
export type ContactType = (typeof CONTACT_TYPES)[number];

/** `app.location_type` */
export const LOCATION_TYPES = ['SEU', 'MAGATZEM', 'VISITA', 'ALTRES'] as const;
export type LocationType = (typeof LOCATION_TYPES)[number];

/** `app.opportunity_data_type` — note 'PREVISIO' carries no accent in SQL. */
export const OPPORTUNITY_DATA_TYPES = [
  'COMPRA REAL',
  'PREVISIO CONFIRMADA',
  'POSSIBLE COMPRA',
] as const;
export type OpportunityDataType = (typeof OPPORTUNITY_DATA_TYPES)[number];

/** `app.forecast_next` */
export const FORECAST_NEXT_VALUES = [
  'REPETIR COMANDA',
  'NO DETERMINAT',
  'NO COMPRARAN',
  'ALTRES',
] as const;
export type ForecastNext = (typeof FORECAST_NEXT_VALUES)[number];

/** `app.opportunity_status` */
export const OPPORTUNITY_STATUSES = ['OBERTA', 'GUANYADA', 'PERDUDA', 'TANCADA'] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

/** `app.activity_type` */
export const ACTIVITY_TYPES = [
  'TRUCADA',
  'CORREU',
  'VISITA',
  'MOSTRES',
  'OFERTA',
  'NOTA INTERNA',
  'ALTRES',
] as const;
export type ActivityType = (typeof ACTIVITY_TYPES)[number];

/** `app.activity_result` */
export const ACTIVITY_RESULTS = [
  'INTERES CONCRET',
  'DEMANA PREUS',
  'DEMANA MOSTRES',
  'ACORDAR VISITA',
  'TE UN ALTRE PROVEIDOR',
  'REPETIRA COMANDA',
  'NO DETERMINAT',
  'NO COMPRARA',
  'NO COMPRA VI A GRANEL',
  'TANCAT / INACTIU',
  'ALTRES',
] as const;
export type ActivityResult = (typeof ACTIVITY_RESULTS)[number];

/** `app.task_kind` */
export const TASK_KINDS = ['TASCA', 'RECORDATORI'] as const;
export type TaskKind = (typeof TASK_KINDS)[number];

/** `app.task_status` — 'CANCEL·LAT' uses U+00B7 MIDDLE DOT. */
export const TASK_STATUSES = ['PENDENT', 'FET', 'AJORNAT', 'CANCEL·LAT'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

/** `app.task_priority` */
export const TASK_PRIORITIES = ['ALTA', 'MITJANA', 'BAIXA'] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

/** `app.commercial_action` */
export const COMMERCIAL_ACTIONS = [
  'TRUCAR',
  'VISITA',
  'MOSTRES',
  'ENVIAR CORREU',
  'ENVIAR PREUS',
  'ENVIAR OFERTA',
  'VERIFICAR EMPRESA',
  'ALTRES',
] as const;
export type CommercialAction = (typeof COMMERCIAL_ACTIONS)[number];

/** `app.sample_subtype` */
export const SAMPLE_SUBTYPES = [
  'PORTAR MOSTRES AL CLIENT',
  'CATA A VITALPE',
  'PENDENT DE CONCRETAR',
] as const;
export type SampleSubtype = (typeof SAMPLE_SUBTYPES)[number];

/** `app.visit_status` — 'CANCEL·LADA' uses U+00B7 MIDDLE DOT. */
export const VISIT_STATUSES = ['PLANIFICADA', 'CONFIRMADA', 'FETA', 'CANCEL·LADA'] as const;
export type VisitStatus = (typeof VISIT_STATUSES)[number];

/** `app.sync_status` */
export const SYNC_STATUSES = ['NO SINCRONITZAT', 'PENDENT', 'SINCRONITZAT', 'ERROR'] as const;
export type SyncStatus = (typeof SYNC_STATUSES)[number];

/** `app.change_origin` */
export const CHANGE_ORIGINS = [
  'CRM',
  'GOOGLE CALENDAR',
  'IMPORTACIO',
  'VEU',
  'MOBIL',
  'SISTEMA',
] as const;
export type ChangeOrigin = (typeof CHANGE_ORIGINS)[number];

/** `app.voice_stage_status` */
export const VOICE_STAGE_STATUSES = [
  'PENDENT',
  'EN PROCES',
  'FET',
  'ERROR',
  'NO DISPONIBLE',
] as const;
export type VoiceStageStatus = (typeof VOICE_STAGE_STATUSES)[number];

/** `app.geofence_event_type` */
export const GEOFENCE_EVENT_TYPES = ['ENTRADA', 'SORTIDA'] as const;
export type GeofenceEventType = (typeof GEOFENCE_EVENT_TYPES)[number];

/** `app.import_status` */
export const IMPORT_STATUSES = [
  'BORRADOR',
  'INSPECCIONAT',
  'MAPEJAT',
  'NORMALITZAT',
  'APLICAT',
  'DESFET',
  'ERROR',
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/** `app.dedupe_decision` */
export const DEDUPE_DECISIONS = [
  'CREAR COM A NOVA',
  'ACTUALITZAR EXISTENT',
  'IGNORAR',
  'FUSIONAR',
  'MANTENIR SEPARADES',
  'PENDENT',
] as const;
export type DedupeDecision = (typeof DEDUPE_DECISIONS)[number];

// ---------------------------------------------------------------------------
// Closed sets that live in CHECK constraints rather than in an `app.*` enum.
// Same treatment: a const array plus the union type.
// ---------------------------------------------------------------------------

/** `public.client_types` seed rows (the table is open, these are the seeds). */
export const CLIENT_TYPE_CODES = [
  'EMBOTELLADOR',
  'ELABORADOR',
  'COOPERATIVA',
  'ALTRES',
] as const;
export type ClientTypeCode = (typeof CLIENT_TYPE_CODES)[number];

/** `public.products.category` CHECK. */
export const PRODUCT_CATEGORIES = [
  'BASE CAVA',
  'DO PENEDES',
  'DO CATALUNYA',
  'ALTRES / SENSE DO',
] as const;
export type ProductCategory = (typeof PRODUCT_CATEGORIES)[number];

/** `public.campaigns.status` CHECK. */
export const CAMPAIGN_STATUSES = ['OBERTA', 'TANCADA', 'FUTURA'] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

/** `public.geofence_events.confidence` CHECK — the arrival confidence scale. */
export const ARRIVAL_CONFIDENCES = ['ALTA', 'MITJANA', 'BAIXA', 'AMBIGUA'] as const;
export type ArrivalConfidence = (typeof ARRIVAL_CONFIDENCES)[number];

/** `public.import_rows.outcome` CHECK. */
export const IMPORT_ROW_OUTCOMES = [
  'PENDENT',
  'IMPORTADA',
  'IGNORADA',
  'REBUTJADA',
  'EXCLOSA',
  'DUPLICADA',
] as const;
export type ImportRowOutcome = (typeof IMPORT_ROW_OUTCOMES)[number];

/** `public.unmapped_values.kind` CHECK. */
export const UNMAPPED_VALUE_KINDS = [
  'PRODUCTE',
  'CAMPANYA',
  'TIPUS EMPRESA',
  'RESULTAT',
  'ACCIO',
  'ALTRES',
] as const;
export type UnmappedValueKind = (typeof UNMAPPED_VALUE_KINDS)[number];

/** `public.v_client_geo_status.geo_status` derived values. */
export const GEO_STATUSES = ['GEOLOCALITZAT', 'PENDENT DE GEOLOCALITZAR'] as const;
export type GeoStatus = (typeof GEO_STATUSES)[number];

/** `public.geofence_registrations.status` CHECK. */
export const GEOFENCE_REGISTRATION_STATUSES = ['ACTIVA', 'RETIRADA', 'CADUCADA'] as const;
export type GeofenceRegistrationStatus = (typeof GEOFENCE_REGISTRATION_STATUSES)[number];

/** `public.voice_notes.retention_policy` CHECK. */
export const VOICE_RETENTION_POLICIES = [
  'KEEP',
  'DELETE_AFTER_TRANSCRIPTION',
  'DELETE_AFTER_CONFIRM',
  'KEEP_DAYS',
] as const;
export type VoiceRetentionPolicy = (typeof VOICE_RETENTION_POLICIES)[number];
