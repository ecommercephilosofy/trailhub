// Entidades = tablas Supabase (schema en supabase/schema.sql).
// El pipeline ads-agent publica las tablas de datos cada lunes (service key);
// el equipo escribe en las suyas (cards, annotations, bonus, chat) vía RLS.
import { createEntity } from './supabaseStore'

// ── Publicadas por el pipeline (solo lectura desde la app) ───────────────────
export const WeeklyReports = createEntity('weekly_reports', { pk: 'week_date' })
export const Briefs = createEntity('briefs', { pk: 'tracking_code' })
export const AdsWeekly = createEntity('ads_weekly')            // PK compuesta; solo list/filter
export const AdLifecycle = createEntity('ad_lifecycle', { pk: 'code' })
export const MetricsSnapshots = createEntity('metrics_snapshots', { pk: 'week_date' })
export const Mechanisms = createEntity('mechanisms')
export const CmoVerdicts = createEntity('cmo_verdicts', { pk: 'week_date' })
export const ChatContext = createEntity('chat_context', { pk: 'id' })
export const EditorWeekly = createEntity('editor_weekly', { pk: 'week_date' })
export const CreativeReviews = createEntity('creative_reviews')
export const AdThumbs = createEntity('ad_thumbs', { pk: 'ad_code' }) // vista sin dinero: ad_code/qb/thumb_path (todos los roles)
export const Brands = createEntity('brands')
export const BrandProfiles = createEntity('brand_profiles', { pk: 'brand' })
export const RunRequests = createEntity('run_requests')
export const LearnedPatterns = createEntity('learned_patterns', { pk: 'signature' })

// ── Del equipo ───────────────────────────────────────────────────────────────
export const Profiles = createEntity('profiles', { pk: 'user_id' })
export const Cards = createEntity('cards')
export const Annotations = createEntity('annotations')
export const BonusRules = createEntity('bonus_rules')
export const BonusLedger = createEntity('bonus_ledger')
export const Notifications = createEntity('notifications')
export const SettingsTable = createEntity('settings')
export const ChatMessages = createEntity('chat_messages')

export async function getSettings() {
  const row = await SettingsTable.get('main')
  return row?.data || {}
}

export async function saveSettings(data) {
  // upsert (no update): crea la fila 'main' si no existe — robusto en instancias
  // nuevas o si se limpió la tabla.
  return SettingsTable.upsert({ id: 'main', data })
}
