/**
 * Row shapes for the main tables, mirroring the columns declared in
 * `supabase/migrations/2026072309{1,2,3,4}000_*.sql`.
 *
 * Conventions:
 *  - property names are the SQL column names (snake_case), so a row can be fed
 *    straight into / out of PostgREST without a mapping layer;
 *  - `uuid`, `date`, `timestamptz` and `numeric` all surface as `string` /
 *    `number` exactly as supabase-js returns them (`numeric` comes back as a
 *    number for the magnitudes used here);
 *  - GENERATED ALWAYS columns are included and typed `| null` because
 *    `app.normalize_*` returns NULL for empty input; they are never written.
 */

import type {
  ActivityResult,
  ActivityType,
  ChangeOrigin,
  Classification,
  CommercialAction,
  ContactType,
  ForecastNext,
  ImportStatus,
  LocationType,
  OpportunityDataType,
  OpportunityStatus,
  ProductCategory,
  CampaignStatus,
  SampleSubtype,
  TaskKind,
  TaskPriority,
  TaskStatus,
  VerificationStatus,
  VisitStatus,
  VoiceRetentionPolicy,
  VoiceStageStatus,
} from './enums.js';

/** `public.workspaces` */
export interface Workspace {
  id: string;
  name: string;
  slug: string;
  timezone: string;
  locale: string;
  settings: Record<string, unknown>;
  created_at: string;
  updated_at: string;
}

/** `public.profiles` */
export interface Profile {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string;
  phone: string | null;
  avatar_url: string | null;
  locale: string;
  timezone: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

/** `public.client_types` */
export interface ClientTypeRow {
  code: string;
  label: string;
  sort_order: number;
  is_active: boolean;
  requires_explanation: boolean;
}

/** `public.clients` */
export interface Client {
  id: string;
  workspace_id: string;

  name: string;
  /** GENERATED: `app.normalize_company(name)` */
  name_norm: string | null;
  legal_name: string | null;
  tax_id: string | null;
  /** GENERATED: `app.normalize_text(tax_id)` */
  tax_id_norm: string | null;

  municipality: string | null;
  comarca: string | null;
  province: string | null;
  country: string;
  website: string | null;
  /** GENERATED: `app.normalize_domain(website)` */
  website_domain: string | null;

  client_type_code: string | null;
  other_client_type: string | null;

  do_cava: boolean;
  do_penedes: boolean;
  do_catalunya: boolean;
  do_altres: boolean;

  proposed_classification: Classification | null;
  confirmed_classification: Classification | null;
  classification_confirmed_at: string | null;
  classification_confirmed_by: string | null;
  not_potential_reason: string | null;

  verification_status: VerificationStatus;
  last_verified_at: string | null;
  verification_source: string | null;
  verification_note: string | null;

  general_notes: string | null;
  owner_id: string | null;

  external_account_code: string | null;
  is_demo: boolean;

  created_at: string;
  updated_at: string;
  updated_by: string | null;
  deleted_at: string | null;
  deleted_reason: string | null;
}

/** `public.client_aliases` */
export interface ClientAlias {
  id: string;
  workspace_id: string;
  client_id: string;
  alias: string;
  /** GENERATED: `app.normalize_company(alias)` */
  alias_norm: string | null;
  source: string | null;
  is_visible: boolean;
  created_at: string;
}

/** `public.contacts` */
export interface Contact {
  id: string;
  workspace_id: string;
  client_id: string;
  first_name: string | null;
  last_name: string | null;
  role_title: string | null;
  phone_original: string | null;
  /** GENERATED: `app.normalize_phone(phone_original)` */
  phone: string | null;
  email_original: string | null;
  /** GENERATED: `app.normalize_email(email_original)` */
  email: string | null;
  contact_type: ContactType;
  is_primary: boolean;
  is_active: boolean;
  notes: string | null;
  source: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** `public.client_locations` */
export interface ClientLocation {
  id: string;
  workspace_id: string;
  client_id: string;
  name: string | null;
  location_type: LocationType;
  street: string | null;
  postal_code: string | null;
  municipality: string | null;
  comarca: string | null;
  province: string | null;
  country: string;
  formatted_address: string | null;
  latitude: number | null;
  longitude: number | null;
  accuracy_meters: number | null;
  geocode_source: string | null;
  geocoded_at: string | null;
  verified_by_user: boolean;
  is_primary: boolean;
  geofence_enabled: boolean;
  geofence_radius_m: number;
  notes: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** `public.client_assignments` */
export interface ClientAssignment {
  id: string;
  workspace_id: string;
  client_id: string;
  user_id: string;
  is_owner: boolean;
  assigned_at: string;
  assigned_by: string | null;
  is_active: boolean;
}

/** `public.client_verifications` */
export interface ClientVerification {
  id: string;
  workspace_id: string;
  client_id: string;
  status: VerificationStatus;
  verified_at: string;
  source: string;
  note: string | null;
  user_id: string | null;
  created_at: string;
}

/** `public.products` */
export interface Product {
  id: string;
  name: string;
  /** GENERATED: `app.normalize_text(name)` */
  name_norm: string | null;
  category: ProductCategory;
  is_organic: boolean;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** `public.product_aliases` */
export interface ProductAlias {
  id: string;
  product_id: string;
  alias: string;
  /** GENERATED: `app.normalize_text(alias)` */
  alias_norm: string | null;
  source: string | null;
  created_at: string;
}

/** `public.campaigns` */
export interface Campaign {
  id: string;
  name: string;
  /** GENERATED: `app.normalize_text(name)` */
  name_norm: string | null;
  year_start: number;
  year_end: number | null;
  status: CampaignStatus;
  starts_on: string | null;
  ends_on: string | null;
  created_at: string;
  updated_at: string;
}

/** `public.opportunities` — grain: EMPRESA x PRODUCTE x CAMPANYA x TIPUS DE DADA */
export interface Opportunity {
  id: string;
  workspace_id: string;
  client_id: string;
  product_id: string;
  campaign_id: string;
  data_type: OpportunityDataType;
  volume_liters: number | null;
  forecast_next: ForecastNext | null;
  status: OpportunityStatus;
  probability: number | null;
  notes: string | null;
  source: string | null;
  owner_id: string | null;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
}

/** `public.opportunity_deliveries` */
export interface OpportunityDelivery {
  id: string;
  workspace_id: string;
  opportunity_id: string;
  guide_number: string | null;
  guide_date: string | null;
  volume_liters: number | null;
  raw_product: string | null;
  source: string | null;
  created_at: string;
}

/** `public.activities` — the immutable commercial history. */
export interface Activity {
  id: string;
  workspace_id: string;
  client_id: string;
  occurred_on: string;
  activity_type: ActivityType;
  product_id: string | null;
  campaign_id: string | null;
  result: ActivityResult | null;
  notes: string | null;
  user_id: string | null;
  source_task_id: string | null;
  source_visit_id: string | null;
  source_voice_note_id: string | null;
  corrects_activity_id: string | null;
  origin: ChangeOrigin;
  created_at: string;
  deleted_at: string | null;
  deleted_reason: string | null;
}

/** `public.tasks` — covers tasks, reminders and undated "next actions". */
export interface Task {
  id: string;
  workspace_id: string;
  kind: TaskKind;
  action: CommercialAction;
  other_action: string | null;
  sample_subtype: SampleSubtype | null;
  client_id: string | null;
  product_id: string | null;
  campaign_id: string | null;
  title: string | null;
  /** NULL = undated "next action": never on the daily dashboard, never overdue. */
  due_at: string | null;
  duration_minutes: number | null;
  priority: TaskPriority;
  status: TaskStatus;
  result: ActivityResult | null;
  notes: string | null;
  postponed_to: string | null;
  created_by: string | null;
  assigned_to: string | null;
  visit_id: string | null;
  source_task_id: string | null;
  source_voice_note_id: string | null;
  sync_to_google: boolean;
  created_at: string;
  updated_at: string;
  completed_at: string | null;
  deleted_at: string | null;
}

/** `public.visits` */
export interface Visit {
  id: string;
  workspace_id: string;
  client_id: string;
  location_id: string | null;
  user_id: string | null;
  title: string | null;
  objective: string | null;
  important_info: string | null;
  starts_at: string;
  ends_at: string;
  status: VisitStatus;
  result: ActivityResult | null;
  task_id: string | null;
  reminders_minutes: number[];
  notes_before: string | null;
  notes_after: string | null;
  created_from_voice: boolean;
  created_from_google: boolean;
  created_at: string;
  updated_at: string;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  cancellation_origin: ChangeOrigin | null;
  deleted_at: string | null;
}

/** `public.voice_notes` */
export interface VoiceNote {
  id: string;
  workspace_id: string;
  user_id: string;
  client_id: string | null;
  origin_context: string | null;
  audio_path: string | null;
  audio_duration_s: number | null;
  audio_format: string | null;
  audio_bytes: number | null;
  detected_language: string | null;
  transcript: string | null;
  transcription_status: VoiceStageStatus;
  transcription_provider: string | null;
  summary: string | null;
  interpretation_status: VoiceStageStatus;
  interpretation_provider: string | null;
  model_version: string | null;
  confidence: number | null;
  retention_policy: VoiceRetentionPolicy;
  retention_days: number | null;
  audio_deleted_at: string | null;
  confirmed_at: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
}

/** `public.voice_interpretation_proposals` */
export interface VoiceInterpretationProposal {
  id: string;
  workspace_id: string;
  voice_note_id: string;
  transcript_original: string | null;
  proposal_original: unknown;
  proposal_edited: unknown | null;
  confirmed_actions: unknown | null;
  discarded_actions: unknown | null;
  ambiguities: unknown;
  confidence: number | null;
  confirmed_by: string | null;
  confirmed_at: string | null;
  idempotency_key: string;
  applied_at: string | null;
  created_at: string;
}

/** `public.geofence_registrations` */
export interface GeofenceRegistration {
  id: string;
  workspace_id: string;
  user_id: string;
  device_id: string | null;
  client_id: string;
  location_id: string;
  region_id: string;
  radius_m: number;
  priority: number;
  selection_reason: string;
  registered_at: string;
  expires_at: string | null;
  status: string;
}

/** `public.geofence_events` */
export interface GeofenceEvent {
  id: string;
  workspace_id: string;
  user_id: string;
  client_id: string | null;
  location_id: string | null;
  event_type: 'ENTRADA' | 'SORTIDA';
  occurred_at: string;
  notification_shown: boolean;
  client_opened: boolean;
  rejected_by_user: boolean;
  confidence: 'ALTA' | 'MITJANA' | 'BAIXA' | 'AMBIGUA';
  created_at: string;
}

/** `public.notification_settings` */
export interface NotificationSettings {
  user_id: string;
  workspace_id: string;
  visit_reminder_minutes: number;
  notify_visit_reminder: boolean;
  notify_overdue_tasks: boolean;
  notify_assigned_tasks: boolean;
  notify_visit_changed: boolean;
  notify_sync_errors: boolean;
  notify_client_arrival: boolean;
  suppress_duplicate_google_reminders: boolean;
  hide_client_name_on_lockscreen: boolean;
  geofence_cooldown_hours: number;
  geofence_default_radius_m: number;
  max_geofence_regions: number;
  updated_at: string;
}

/** `public.imports` */
export interface Import {
  id: string;
  workspace_id: string;
  label: string;
  status: ImportStatus;
  started_at: string;
  finished_at: string | null;
  created_by: string | null;
  stats: Record<string, unknown>;
  notes: string | null;
  undone_at: string | null;
  undone_by: string | null;
}

/** `public.import_rows` */
export interface ImportRow {
  id: string;
  import_id: string;
  import_sheet_id: string;
  row_number: number;
  raw: Record<string, unknown>;
  normalized: Record<string, unknown> | null;
  outcome: string;
  outcome_reason: string | null;
  entities_created: Record<string, unknown>;
  error: string | null;
  created_at: string;
}

/** `public.duplicate_candidates` */
export interface DuplicateCandidate {
  id: string;
  workspace_id: string;
  import_id: string | null;
  left_client_id: string | null;
  right_client_id: string | null;
  candidate_name: string | null;
  import_row_id: string | null;
  score: number;
  signals: Record<string, boolean>;
  is_deterministic: boolean;
  decision: string;
  decided_by: string | null;
  decided_at: string | null;
  decision_note: string | null;
  created_at: string;
}

/**
 * `public.v_client_derived` — derived facts computed by the view, never stored.
 */
export interface ClientDerived {
  client_id: string;
  workspace_id: string;
  last_contact_on: string | null;
  last_result: ActivityResult | null;
  pending_tasks: number;
  overdue_tasks: number;
  undated_tasks: number;
  next_task_at: string | null;
  next_visit_at: string | null;
  next_visit_id: string | null;
  opportunities_count: number;
  primary_contact_id: string | null;
  primary_contact_name: string | null;
  primary_contact_phone: string | null;
  primary_contact_email: string | null;
  has_classification_discrepancy: boolean;
  verification_is_stale: boolean;
}

/** `public.v_client_geo_status` */
export interface ClientGeoStatus {
  client_id: string;
  workspace_id: string;
  locations_count: number;
  geocoded_count: number;
  geo_status: 'GEOLOCALITZAT' | 'PENDENT DE GEOLOCALITZAR';
}
