// Mock backend functions. Same signatures the real backend would expose —
// swap implementations for Meta Marketing API / Claude API / Discord webhooks in production.

import {
  AdsPerformanceDaily, AdsPerformanceAgg, AdStats, SyncRuns, GeneratedScripts,
  ScriptBuilderDrafts, AvatarProfiles, AngleLibrary, DesireLibrary, ProblemLibrary,
  NotificationsLog, MarketResearchRuns, getSettings,
} from './entities'
import { aggregateDaily, labelFor, computeFatigue, DEFAULT_THRESHOLDS, marginThresholds } from '@/lib/perf'
import { parseAdName, parseCountry } from '@/lib/naming'
import { REAL_DAILY_ROWS, REAL_SYNC_META } from './realData'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)]

// ---------- Meta Sync ----------
// Loads the real Isabella Fontana (ES + MX) dataset, replacing whatever dailies exist.
// Rows sharing an ad name across campaigns/accounts arrive pre-blended (sums; ratios recomputed).
export async function syncMetaAds({ dateStart, dateEnd } = {}) {
  const t0 = Date.now()
  const existing = await AdsPerformanceDaily.list('-date', 10000)
  for (const r of existing) await AdsPerformanceDaily.delete(r.id)
  await AdsPerformanceDaily.bulkCreate(REAL_DAILY_ROWS.map((r) => ({ ...r, country: parseCountry(r.campaign_name, r.ad_name) })))

  // Refresh AdStats: one per ad, best ROAS ever observed in a daily row
  const byAd = new Map()
  for (const r of REAL_DAILY_ROWS) {
    const cur = byAd.get(r.ad_id) || { ad_name: r.ad_name, bestRoas: 0, creative_type: r.creative_type }
    if ((r.roas || 0) > cur.bestRoas) cur.bestRoas = r.roas
    byAd.set(r.ad_id, cur)
  }
  const oldStats = await AdStats.list(null, 2000)
  const statByAdId = new Map(oldStats.map((s) => [s.ad_id, s]))
  for (const [adId, info] of byAd) {
    const parsed = parseAdName(info.ad_name)
    const payload = {
      ad_id: adId, ad_name: info.ad_name, best_roas_ever: +info.bestRoas.toFixed(2),
      product: 'Isabella Fontana', parsed_format: parsed.format || (info.creative_type === 'VIDEO' ? 'UGC' : 'IMAGE'),
      parsed_hook: parsed.hook_type || null, country: parseCountry(info.ad_name),
    }
    const prev = statByAdId.get(adId)
    if (prev) await AdStats.update(prev.id, { ...payload, best_roas_ever: Math.max(prev.best_roas_ever || 0, payload.best_roas_ever) })
    else await AdStats.create(payload)
  }

  await buildAdsPerformanceAggFromDaily('LAST_7D')
  // La memoria creativa evoluciona con cada sync: veredictos PROVEN/FAILED/FATIGUED por hook/formato/país
  const { rebuildLearningsFromMetrics } = await import('./creativeAgent')
  await rebuildLearningsFromMetrics()
  const detail = `${byAd.size} ads · ${REAL_DAILY_ROWS.length} filas · ${REAL_SYNC_META.date_range.since} → ${REAL_SYNC_META.date_range.until} · Isabella Fontana ES+MX (blended)`
  await SyncRuns.create({ run_type: 'META_SYNC', status: 'SUCCESS', detail, duration_ms: Date.now() - t0 })
  return { ok: true, ads: byAd.size, rows: REAL_DAILY_ROWS.length, source: 'meta_real' }
}

export async function buildAdsPerformanceAggFromDaily(windowKey = 'LAST_7D') {
  const days = windowKey === 'LAST_1D' ? 1 : windowKey === 'LAST_3D' ? 3 : 7
  const cutoff = new Date(Date.now() - (days - 1) * 86400000).toISOString().slice(0, 10)
  const daily = await AdsPerformanceDaily.list('-date', 5000)
  const settings = await getSettings()
  // Labels gobernados por unit economics (CashPilot): breakeven ROAS = 1/GM%
  const thresholds = marginThresholds(settings?.margin_config, settings?.metric_thresholds_manual || DEFAULT_THRESHOLDS)
  const aggs = aggregateDaily(daily.filter((r) => r.date >= cutoff))
  const existing = await AdsPerformanceAgg.filter({ window: windowKey })
  for (const e of existing) await AdsPerformanceAgg.delete(e.id)
  for (const a of aggs) {
    const { label, action } = labelFor(a, thresholds)
    const fatigue = computeFatigue(a)
    await AdsPerformanceAgg.create({
      window: windowKey, ad_id: a.ad_id, ad_name: a.ad_name, country: a.country || null,
      spend: +a.spend.toFixed(2), conversion_value: +a.conversion_value.toFixed(2), roas: +a.roas.toFixed(2),
      impressions: a.impressions, link_clicks: a.link_clicks, conversions: a.conversions,
      ctr: +a.ctr.toFixed(2), hook_rate: +a.hook_rate.toFixed(1), hold_rate: +a.hold_rate.toFixed(1),
      label, action, fatigue_flag: fatigue.flag, fatigue_reasons: fatigue.reasons || [],
    })
  }
  return aggs.length
}

// ---------- Script generation ----------
const HOOK_TEMPLATES = {
  CONSPIRACY: (c) => `Lo que ${c.industry} no quiere que sepas sobre ${c.painShort}.`,
  QUESTION: (c) => `¿${c.avatarQuestion}? Mira esto.`,
  STATISTIC: (c) => `El ${c.stat}% de la gente ${c.painShort} y ni lo sabe. Yo era una de ellas.`,
  PERSONAL_STORY: (c) => `Llevaba ${c.timeframe} ${c.painShort}. Hasta que probé esto.`,
  CONTRADICTION: (c) => `No ${c.commonAdvice}. En serio, no funciona. Haz esto en su lugar.`,
  VISUAL_DEMO: (c) => `Mira lo que pasa cuando ${c.demoAction}. *demo on-screen*`,
  RESULT_FIRST: (c) => `${c.result}. Así es como lo conseguí.`,
  DOCUMENTARY: (c) => `Esta es la historia de cómo ${c.brandStory}.`,
  HUMOR: (c) => `${c.humorSetup}. Yo descubrí esto.`,
  CHALLENGE: (c) => `Reto: ${c.challenge} durante 7 noches. Esto es lo que pasó.`,
}

function buildHookContext({ product, avatar, problem, desire, angle }) {
  return {
    industry: 'la industria del descanso',
    painShort: problem?.nombre?.toLowerCase() || 'durmiendo mal',
    avatarQuestion: avatar?.pains?.[0] ? `Tú también sufres ${avatar.pains[0].toLowerCase()}` : `Tú también duermes mal`,
    stat: 73, timeframe: '2 años',
    commonAdvice: angle?.key_objection_to_crush ? `intentes arreglar "${angle.key_objection_to_crush.toLowerCase()}"` : 'sigas los consejos de siempre',
    demoAction: `uso ${product} por primera vez`,
    result: desire?.core_desire?.split('—')[0]?.trim() || 'Dormí 7 horas del tirón',
    brandStory: `${product} lleva décadas en farmacias francesas`,
    humorSetup: 'Mi vecino descubrió el karaoke a las 2AM',
    challenge: `usar ${product} cada noche`,
  }
}

export async function generateScript(params) {
  const t0 = Date.now()
  const { product, format, hook_type, avatar_id, angle_ids = [], desire_ids = [], problem_ids = [], quantity = 1, duration_sec = 35, instructions = '', created_by_user_id } = params
  await sleep(1500)
  const [avatar, angles, desires, problems, settings] = await Promise.all([
    avatar_id ? AvatarProfiles.get(avatar_id) : null,
    Promise.all(angle_ids.map((id) => AngleLibrary.get(id))),
    Promise.all(desire_ids.map((id) => DesireLibrary.get(id))),
    Promise.all(problem_ids.map((id) => ProblemLibrary.get(id))),
    getSettings(),
  ])
  const angle = angles[0], desire = desires[0], problem = problems[0]
  const created = []
  for (let i = 0; i < quantity; i++) {
    const ctx = buildHookContext({ product, avatar, problem, desire, angle })
    const hookFn = HOOK_TEMPLATES[hook_type] || HOOK_TEMPLATES.QUESTION
    const hook = hookFn(ctx)
    const sec = (p) => Math.round(duration_sec * p)
    const full_script = [
      `HOOK (0-${sec(0.1)}s): ${hook}`,
      ``,
      `PROBLEMA (${sec(0.1)}-${sec(0.3)}s): ${problem?.description || `${avatar?.pains?.[0] || 'El problema'} te roba el descanso cada noche.`}`,
      ``,
      `AGITACIÓN (${sec(0.3)}-${sec(0.45)}s): ${problem?.why_past_failed ? `Ya probaste de todo: ${problem.past_solutions_tried?.join(', ')}. ${problem.why_past_failed}` : 'Y todo lo que has probado hasta ahora no ha funcionado.'}`,
      ``,
      `MECANISMO (${sec(0.45)}-${sec(0.7)}s): ${angle?.mechanism || `${product} funciona de forma diferente.`} ${problem?.unique_mechanism_behind_solution || ''}`,
      ``,
      `PRUEBA (${sec(0.7)}-${sec(0.85)}s): ${angle?.proof_strategy || 'Demo on-screen + testimonio rápido.'}`,
      ``,
      `CTA (${sec(0.85)}-${duration_sec}s): ${angle?.promise || `Prueba ${product} esta noche.`} Link abajo.`,
      instructions ? `\n[Instrucciones extra: ${instructions}]` : '',
    ].join('\n')
    const variant = quantity > 1 ? ` — v${i + 1}` : ''
    const rec = await GeneratedScripts.create({
      title: `${format} ${avatar?.nombre?.split('(')[0]?.trim() || product} · ${hook_type || 'AUTO'}${variant}`,
      product, format, hook_type, status: 'DRAFT', duration_sec, language: settings?.language_default || 'es',
      avatar_id: avatar?.id || null, angle_id: angle?.id || null, desire_id: desire?.id || null, problem_id: problem?.id || null,
      hook, full_script, cta: angle?.promise ? `${angle.promise} → link en bio` : 'Consíguelo ahora → link en bio',
      on_screen_text: [hook.slice(0, 40), angle?.promise || '', 'Garantía 30 noches', 'Link abajo ⬇️'].filter(Boolean),
      shotlist: ['Plano selfie hook', 'B-roll problema', 'Demo producto macro', 'Resultado/testimonio', 'Packshot CTA'],
      broll_suggestions: ['Despertador 3AM', 'App medición dB', 'Producto en mesilla'],
      editing_checklist: ['Hook on-screen <2s', 'Subtítulos quemados', 'CTA visual 3s final', 'Música -18dB', 'Sin claims prohibidos: ' + (settings?.banned_claims?.join(', ') || '—')],
      based_on: { method: 'AI_GENERATED', model: settings?.ai_router_config?.script_generation || 'claude-fable-5', research: { avatar: avatar?.nombre, angle: angle?.nombre, desire: desire?.nombre } },
      created_by_user_id,
    })
    created.push(rec)
  }
  await SyncRuns.create({ run_type: 'GENERATE_SCRIPTS', status: 'SUCCESS', detail: `${created.length} scripts ${format} ${product}`, duration_ms: Date.now() - t0 })
  return { ok: true, created: created.map((c) => c.id), count: created.length }
}

// ---------- Ad intelligence ----------
export async function analyzeAdIntelligence(agg, { adStats, mappedScript } = {}) {
  await sleep(900)
  const lines = []
  const t = DEFAULT_THRESHOLDS
  if (agg.label === 'WINNER') lines.push(`🏆 WINNER (ROAS ${agg.roas?.toFixed(2)}x con ${agg.spend?.toFixed(0)}€). Prioridad: escalar presupuesto +20-30% y producir 2-3 iteraciones manteniendo estructura.`)
  if (agg.label === 'LOSER') lines.push(`❌ LOSER (ROAS ${agg.roas?.toFixed(2)}x). Recomendación: pausar y reciclar solo los elementos con métrica sana.`)
  if (agg.label === 'REGULAR') lines.push(`➖ REGULAR. Tiene base: iterar el elemento más débil antes de matar.`)
  if (agg.hook_rate > 0) {
    if (agg.hook_rate < 18) lines.push(`Hook débil: solo ${agg.hook_rate?.toFixed(1)}% pasa de 3s (objetivo ≥${t.hook_rate_good}%). Reescribir los 2 primeros segundos: patrón interrupt visual + texto on-screen inmediato.`)
    else if (agg.hook_rate >= t.hook_rate_good) lines.push(`Hook fuerte (${agg.hook_rate?.toFixed(1)}%). Reutilizar este hook en otros formatos/avatares.`)
  }
  if (agg.hold_rate > 0 && agg.hold_rate < t.hold_rate_good) lines.push(`Hold rate bajo (${agg.hold_rate?.toFixed(1)}%): el cuerpo pierde gente. Acortar la sección de mecanismo y meter prueba visual antes del segundo 10.`)
  if (agg.ctr < 1) lines.push(`CTR ${agg.ctr?.toFixed(2)}%: la creatividad retiene pero no empuja al click. Añadir CTA visual intermedio (segundo ~60%) además del final.`)
  if (agg.fatigue_flag) lines.push(`⚠️ Fatiga detectada: ${(agg.fatigue_reasons || []).join(' · ')}. Refrescar con hook nuevo manteniendo cuerpo.`)
  if (adStats?.best_roas_ever && adStats.best_roas_ever > (agg.roas || 0) * 1.3) lines.push(`Histórico: llegó a ROAS ${adStats.best_roas_ever}x. La caída sugiere fatiga o cambio de audiencia, no creatividad mala.`)
  if (!lines.length) lines.push('Sin señales fuertes: dejar correr 2-3 días más para acumular datos.')
  const analysis_text = lines.join('\n\n')

  const scriptBase = mappedScript?.full_script || mappedScript?.texto_script_cached || `HOOK: [reescribir basado en el hook ganador]\n\nPROBLEMA: ...\n\nMECANISMO: ...\n\nCTA: ...`
  const draft = await ScriptBuilderDrafts.create({
    source_ad_id: agg.ad_id, source_ad_name: agg.ad_name,
    format: adStats?.parsed_format || 'UGC',
    ai_analysis_notes: analysis_text,
    current_script_text: `=== SCRIPT ===\n${scriptBase}\n\n=== ON-SCREEN ===\n${(mappedScript?.on_screen_text || []).join('\n')}\n\n=== SHOTLIST ===\n${(mappedScript?.shotlist || []).join('\n')}\n\n=== B-ROLL ===\n${(mappedScript?.broll_suggestions || []).join('\n')}\n\n=== CTA ===\n${mappedScript?.cta || ''}\n\n=== EDITING CHECKLIST ===\n${(mappedScript?.editing_checklist || []).join('\n')}`,
    performance_snapshot_json: { roas: agg.roas, spend: agg.spend, label: agg.label, hook_rate: agg.hook_rate, hold_rate: agg.hold_rate, window: agg.window },
    status: 'DRAFT',
  })
  return { analysis_text, draft_id: draft.id }
}

// ---------- Discord notifications (mock → NotificationsLog + optional webhook) ----------
async function notify({ type, target_user_id, title, body }) {
  const settings = await getSettings()
  await NotificationsLog.create({ type, target_user_id: target_user_id || null, title, body, read: false })
  if (settings?.discord_notifications_enabled && settings?.discord_webhook_tasks) {
    // Real impl: fetch(webhook, {method:'POST', body: JSON.stringify({content: `**${title}**\n${body}`})})
    console.info('[Discord webhook]', title, body)
  }
  return { ok: true }
}

export const notifyTaskAssignment = ({ task, assignee }) =>
  notify({ type: 'TASK_ASSIGNED', target_user_id: assignee?.user_id || assignee?.id, title: `Nueva tarea: ${task.title}`, body: `Prioridad ${task.priority || 'MEDIUM'}${task.due_date ? ` · due ${task.due_date}` : ''}` })

export const notifyVideoUpdate = ({ video, newStatus, byName }) =>
  notify({ type: 'VIDEO_STATUS', target_user_id: video.assigned_editor_user_id, title: `Video "${video.title}" → ${newStatus}`, body: byName ? `Actualizado por ${byName}` : '' })

export const notifyVideoAnnotation = ({ video, annotation }) =>
  notify({ type: 'VIDEO_NOTE', target_user_id: video.assigned_editor_user_id, title: `Anotación ${annotation.severity} en "${video.title}"`, body: `${annotation.author_name}: "${annotation.text.slice(0, 80)}"` })

// ---------- Research PDF import ----------
export async function analyzeResearchPDF({ fileName } = {}) {
  await sleep(1800)
  return {
    ok: true, fileName,
    avatars: [
      { nombre: 'Teletrabajador con obras al lado', descripcion: 'Trabaja desde casa y las obras del edificio le impiden concentrarse. 28-45 años.', pains: ['Ruido de obras', 'Reuniones interrumpidas'], avatar_id: 'AV-TELETRABAJO' },
      { nombre: 'Abuelo cuidador de día', descripcion: 'Duerme siestas para compensar noches cortas cuidando nietos.', pains: ['Sueño fragmentado', 'Siesta imposible con ruido'], avatar_id: 'AV-ABUELO' },
    ],
    angles: [
      { nombre: 'El despacho silencioso instantáneo', promise: 'Concentración de biblioteca en tu salón', angle_id: 'ANG-DESPACHO' },
      { nombre: 'Siesta sagrada', promise: '20 minutos de siesta real aunque haya fútbol en el salón', angle_id: 'ANG-SIESTA' },
    ],
    desires: [
      { nombre: 'Productividad sin mudarse', core_desire: 'Rendir como en una oficina premium sin salir de casa', desire_id: 'DES-PRODUCTIVIDAD' },
    ],
    problems: [
      { nombre: 'Ruido de obras imprevisible', description: 'Taladros intermitentes: imposible habituarse, cada arranque dispara cortisol.', problem_id: 'PRB-OBRAS' },
    ],
  }
}

export async function importSelectedElements({ avatars = [], angles = [], desires = [], problems = [] }) {
  await sleep(400)
  for (const a of avatars) await AvatarProfiles.create({ ...a, is_active: true, performance_score: null, total_spend: 0, tests_count: 0, products: [] })
  for (const a of angles) await AngleLibrary.create({ ...a, performance_score: null, products: [] })
  for (const d of desires) await DesireLibrary.create({ ...d, performance_score: null, products: [] })
  for (const p of problems) await ProblemLibrary.create({ ...p, performance_score: null, products: [] })
  await SyncRuns.create({ run_type: 'PDF_IMPORT', status: 'SUCCESS', detail: `${avatars.length} avatares, ${angles.length} ángulos, ${desires.length} deseos, ${problems.length} problemas`, duration_ms: 2200 })
  return { ok: true, counts: { avatars: avatars.length, angles: angles.length, desires: desires.length, problems: problems.length } }
}

// ---------- Market research ----------
export async function runMarketResearch({ topic }) {
  const run = await MarketResearchRuns.create({ run_type: 'AI_GENERAL', query: topic, status: 'RUNNING', logs: ['Iniciando análisis…'] })
  await sleep(2200)
  await MarketResearchRuns.update(run.id, {
    status: 'SUCCESS',
    logs: ['Iniciando análisis…', 'Analizadas 6 fuentes de mercado', 'Detectados 11 pain points', '3 ángulos candidatos extraídos'],
    findings_summary: `Sobre "${topic}": el mercado está saturado de mensajes de "bloqueo total". Hueco detectado: atenuación selectiva (oír lo importante, bloquear lo molesto). Recomendación: ángulo de seguridad para madres + demo de despertador audible.`,
    elements_created: 0,
  })
  return { ok: true, run_id: run.id }
}

export async function runMarketResearchFromReddit({ subreddit }) {
  const run = await MarketResearchRuns.create({ run_type: 'REDDIT', query: `r/${subreddit}`, status: 'RUNNING', logs: [`Scrapeando r/${subreddit}…`] })
  await sleep(2500)
  await MarketResearchRuns.update(run.id, {
    status: 'SUCCESS',
    logs: [`Scrapeando r/${subreddit}…`, '180 posts analizados', '14 quejas recurrentes agrupadas', '2 objeciones nuevas candidatas'],
    findings_summary: `r/${subreddit}: queja dominante — los tapones de espuma se caen o duelen al dormir de lado (29 menciones). Lenguaje literal de usuarios: "me despierto con el tapón en la almohada". Usar esa frase exacta como hook candidato.`,
    elements_created: 1,
  })
  return { ok: true, run_id: run.id }
}
