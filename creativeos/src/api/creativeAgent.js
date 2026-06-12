// Creative Agent — replica el proceso del ads-agent (weekly_prompt_v2):
// datos propios multi-ventana + inspiración/competencia + investigación + MEMORIA evolutiva
// → ideas 100% nuevas (new_idea) con framework Schwartz, excluyendo lo ya probado que falló.
//
// Memoria en 2 capas:
//  - CreativeLearnings: veredictos por dimensión (HOOK_TYPE/FORMAT/COUNTRY/SERIES) derivados
//    de métricas reales. Evoluciona en cada sync: evidencia acumulada + historial de cambios.
//  - AgentMemory (singleton): inspiration_ids_used + idea_signatures_used (equivalente a
//    weekly_state.json del ads-agent) → nunca repetir fuente ni patrón.

import {
  AdsPerformanceDaily, AdStats, InspirationAds, ResearchFindings,
  AvatarProfiles, AngleLibrary, DesireLibrary, GeneratedScripts,
  CreativeLearnings, ScriptIdeas, AgentMemory, getSettings,
} from './entities'
import { aggregateDaily, computeFatigue, breakEvenRoas, DEFAULT_MARGINS } from '@/lib/perf'
import { parseAdName, parseCountry } from '@/lib/naming'

const COUNTRY_LABEL = { ES: 'España', MX: 'México', US: 'USAH (hispanos EE.UU.)' }

// ---------- Capa 1: aprendizajes desde métricas ----------

function seriesOf(adName = '') {
  const m = adName.match(/^([A-Z]+)\d/)
  return m ? m[1] : null
}

async function getMemory() {
  const all = await AgentMemory.list()
  let mem = all.find((m) => m.singleton === 'main')
  if (!mem) mem = await AgentMemory.create({ singleton: 'main', inspiration_ids_used: [], idea_signatures_used: [] })
  return mem
}

export async function rebuildLearningsFromMetrics() {
  const [daily, adStats, settings] = await Promise.all([
    AdsPerformanceDaily.list('-date', 10000), AdStats.list(null, 2000), getSettings(),
  ])
  const margins = settings?.margin_config || DEFAULT_MARGINS
  const be = breakEvenRoas(margins) || 1.3
  const scaleCut = be * (margins.scale_mult || 1.4)
  const statByAdId = new Map(adStats.map((s) => [s.ad_id, s]))
  const aggs = aggregateDaily(daily)

  // Agrupa ads por dimensión → suma spend/revenue (ponderado por gasto vía suma/suma)
  const buckets = new Map() // key: `${dimension}::${key}` → { spend, revenue, ads:[], fatigued }
  const push = (dimension, key, a, fatigued) => {
    if (!key) return
    const k = `${dimension}::${key}`
    const b = buckets.get(k) || { dimension, key, spend: 0, revenue: 0, ads: [], fatigued: 0 }
    b.spend += a.spend
    b.revenue += a.conversion_value
    b.ads.push({ ad_name: a.ad_name, spend: +a.spend.toFixed(0), roas: +a.roas.toFixed(2) })
    if (fatigued) b.fatigued++
    buckets.set(k, b)
  }

  for (const a of aggs) {
    const st = statByAdId.get(a.ad_id)
    const parsed = parseAdName(a.ad_name)
    const fatigued = computeFatigue(a).flag
    const hook = st?.parsed_hook || parsed.hook_type
    const format = st?.parsed_format || parsed.format || a.creative_type
    const country = a.country || parseCountry(a.campaign_name, a.ad_name)
    push('HOOK_TYPE', hook, a, fatigued)
    push('FORMAT', format, a, fatigued)
    push('COUNTRY', country, a, fatigued)
    push('SERIES', seriesOf(a.ad_name), a, fatigued)
    if (hook && country) push('HOOK_X_COUNTRY', `${hook}@${country}`, a, fatigued)
  }

  const MIN_SPEND = 50 // por debajo no hay señal — INCONCLUSIVE
  const existing = await CreativeLearnings.list(null, 1000)
  const byKey = new Map(existing.map((l) => [`${l.dimension}::${l.key}`, l]))
  const today = new Date().toISOString().slice(0, 10)
  let updated = 0, created = 0

  for (const b of buckets.values()) {
    const roas = b.spend > 0 ? b.revenue / b.spend : 0
    let verdict = 'INCONCLUSIVE'
    if (b.spend >= MIN_SPEND) {
      if (roas >= scaleCut) verdict = 'PROVEN'
      else if (roas >= be) verdict = 'PROMISING'
      else if (roas < be * 0.7) verdict = 'FAILED'
      else verdict = 'INCONCLUSIVE'
    }
    if (b.fatigued > 0 && verdict !== 'FAILED' && b.fatigued >= Math.ceil(b.ads.length / 2)) verdict = 'FATIGUED'

    const payload = {
      dimension: b.dimension, key: b.key, verdict,
      avg_roas: +roas.toFixed(2), total_spend: +b.spend.toFixed(0),
      breakeven_used: +be.toFixed(2), ads_count: b.ads.length,
      evidence: b.ads.sort((x, y) => y.spend - x.spend).slice(0, 6),
      last_seen_date: today, source: 'METRICS',
    }
    const prev = byKey.get(`${b.dimension}::${b.key}`)
    if (prev) {
      if (prev.source === 'MANUAL') continue // los aprendizajes manuales no se pisan
      const history = prev.verdict !== verdict
        ? [...(prev.history || []), { date: today, from: prev.verdict, to: verdict }]
        : (prev.history || [])
      await CreativeLearnings.update(prev.id, { ...payload, history })
      updated++
    } else {
      await CreativeLearnings.create({ ...payload, history: [] })
      created++
    }
  }
  return { created, updated, breakeven: +be.toFixed(2) }
}

// ---------- Capa 2: generación de ideas nuevas con memoria ----------

function learningFor(learnings, dimension, key) {
  return learnings.find((l) => l.dimension === dimension && l.key === key)
}

function discardReason(l) {
  if (!l) return null
  if (l.verdict === 'FAILED') return `ya lo probamos y FALLÓ: ROAS ${l.avg_roas} con ${l.total_spend}€ (breakeven ${l.breakeven_used}) — ${(l.evidence || []).slice(0, 2).map((e) => e.ad_name).join(', ')}`
  if (l.verdict === 'FATIGUED') return `FATIGADO en cuenta: ${l.ads_count} ads con señales de fatiga (ROAS ${l.avg_roas})`
  return null
}

const AWARENESS_BY_INTENSITY = (i) => (i >= 9 ? 'problem-aware' : i >= 7 ? 'solution-aware' : 'unaware')

function buildIdea({ inspiration, angle, desire, avatar, hookType, country, learnings, signature }) {
  const countryName = COUNTRY_LABEL[country] || country
  const cLearn = learningFor(learnings, 'COUNTRY', country)
  const voice = avatar?.language_style || avatar?.language_sample || ''
  const hookLine = angle?.hook_idea || angle?.promise || `${desire?.nombre || 'El deseo'} — sin que cambies nada de tu rutina`

  const hooks = [
    { label: '1A — Voice of customer', text: voice ? `"${String(voice).replace(/^"|"$/g, '').slice(0, 110)}"` : hookLine, source: avatar ? `Avatar: ${avatar.nombre || avatar.avatar_name}` : 'Research' },
    { label: '1B — Mecanismo', text: angle?.mechanism ? `${angle.mechanism} — y por eso todo lo demás te falló.` : hookLine, source: angle ? `Angle: ${angle.nombre || angle.angle_name}` : 'Research' },
    { label: '1C — Inspiración traducida', text: inspiration ? `[Patrón ${inspiration.brand}] ${inspiration.notes || inspiration.title}` : hookLine, source: inspiration ? `Inspiración: ${inspiration.brand} (${inspiration.title})` : 'Libs internas' },
  ]

  const sections = [
    { name: 'AGITACIÓN', detail: `Espejo del dolor del segmento "${desire?.core_desire || desire?.nombre || 'deseo dominante'}" con lenguaje literal del cliente. Sin producto aún.` },
    { name: 'DIAGNÓSTICO', detail: angle?.key_objection_to_crush ? `Por qué falló lo anterior: ${angle.key_objection_to_crush}` : 'Por qué las soluciones típicas atacan el síntoma y no la causa.' },
    { name: 'MECANISMO', detail: angle?.mechanism || 'Mecanismo único específico + traducción a beneficio inmediato (Schwartz: specific, unique, credible).' },
    { name: 'CTA', detail: `Oferta + garantía + urgencia suave. Segmento: ${countryName}.` },
  ]

  return {
    category: 'new_idea',
    title: `${hookType} × ${(desire?.nombre || 'deseo').slice(0, 30)} × ${countryName}`,
    based_on: inspiration
      ? { type: 'inspiration', reference: `${inspiration.brand} — ${inspiration.title}`, inspiration_id: inspiration.id }
      : { type: 'research', reference: angle ? `Angle: ${angle.nombre || angle.angle_name}` : `Desire: ${desire?.nombre}` },
    audience: `${country} — ${avatar?.nombre || avatar?.avatar_name || 'avatar principal'}${cLearn ? ` (ROAS segmento ${cLearn.avg_roas}, ${cLearn.total_spend}€)` : ''}`,
    audience_segment_data: cLearn ? { geo: country, current_roas: cLearn.avg_roas, spend: cLearn.total_spend, verdict: cLearn.verdict } : { geo: country },
    hook_type: hookType,
    format: inspiration?.format || (angle?.best_formats || ['UGC'])[0],
    voice_of_customer_sources: [
      avatar?.language_sample || avatar?.language_style ? { source: `Avatar ${avatar.nombre || avatar.avatar_name}`, quote: String(avatar.language_sample || avatar.language_style).slice(0, 140) } : null,
      desire ? { source: `Desire ${desire.nombre}`, quote: desire.core_desire || '' } : null,
    ].filter(Boolean),
    schwartz_awareness: AWARENESS_BY_INTENSITY(desire?.intensity || 8),
    sophistication_stage: 3,
    breakthrough_diagnosis: {
      mass_desire_channeled: desire?.core_desire || desire?.nombre || '—',
      performance_or_identification: ['PERSONAL_STORY', 'DOCUMENTARY', 'HUMOR'].includes(hookType) ? 'identification' : 'performance',
      mechanism_specificity: angle?.mechanism || 'definir en producción',
      why_this_wins: `Canaliza un deseo ya validado (${desire?.nombre || '—'}) con un hook ${hookType} que ${learningFor(learnings, 'HOOK_TYPE', hookType)?.verdict === 'PROVEN' ? 'YA ha demostrado ROAS sobre breakeven en cuenta' : 'no está quemado en cuenta'} y mecanismo específico.`,
    },
    hooks, sections,
    duration_sec: 35,
    signature,
    status: 'NEW',
  }
}

export async function generateNewIdeas({ quantity = 3, country: forcedCountry } = {}) {
  // 0) memoria + aprendizajes al día
  await rebuildLearningsFromMetrics()
  const [learnings, memory, inspirationAll, findings, avatars, angles, desires] = await Promise.all([
    CreativeLearnings.list(null, 1000), getMemory(),
    InspirationAds.list('-created_date', 200),
    ResearchFindings.list('-created_date', 50),
    AvatarProfiles.list(null, 200), AngleLibrary.list(null, 300), DesireLibrary.list(null, 300),
  ])
  const usedIds = new Set(memory.inspiration_ids_used || [])
  const usedSigs = new Set(memory.idea_signatures_used || [])

  // mejor país por aprendizajes (PROVEN/PROMISING con más spend)
  const countryLearnings = learnings.filter((l) => l.dimension === 'COUNTRY')
  const bestCountry = forcedCountry
    || countryLearnings.filter((l) => ['PROVEN', 'PROMISING'].includes(l.verdict)).sort((a, b) => b.total_spend - a.total_spend)[0]?.key
    || countryLearnings.sort((a, b) => b.avg_roas - a.avg_roas)[0]?.key || 'ES'

  // candidatos hook desde inspiración (no usada) + libs internas
  const discards = []
  const ideas = []
  const activeAngles = angles.filter((a) => a.is_active !== false)
  const activeDesires = desires.filter((d) => d.is_active !== false).sort((a, b) => (b.intensity || b.performance_score || 0) - (a.intensity || a.performance_score || 0))
  const activeAvatars = avatars.filter((a) => a.is_active !== false)
  // angles/avatars de research más reciente primero (source con "Market Research")
  activeAngles.sort((a, b) => (String(b.source || '').includes('Market Research') ? 1 : 0) - (String(a.source || '').includes('Market Research') ? 1 : 0))

  const checkHook = (hookType, originLabel) => {
    const l = learningFor(learnings, 'HOOK_TYPE', hookType) || learningFor(learnings, 'HOOK_X_COUNTRY', `${hookType}@${bestCountry}`)
    const reason = discardReason(l)
    if (reason) { discards.push({ origin: originLabel, hook_type: hookType, reason }); return false }
    return true
  }

  const takeAngle = (i) => activeAngles[i % Math.max(activeAngles.length, 1)]
  const takeDesire = (i) => activeDesires[i % Math.max(activeDesires.length, 1)]
  const takeAvatar = (i) => activeAvatars[i % Math.max(activeAvatars.length, 1)]

  // 1) inspiración primero (regla ads-agent: new_idea = 100% inspiración, excluyendo usadas)
  let cursor = 0
  for (const insp of inspirationAll) {
    if (ideas.length >= quantity) break
    if (usedIds.has(insp.id)) { discards.push({ origin: `Inspiración ${insp.brand}`, hook_type: insp.hook_type, reason: 'ya usada en ideas anteriores (memoria)' }); continue }
    const hookType = insp.hook_type || 'VISUAL_DEMO'
    if (!checkHook(hookType, `Inspiración ${insp.brand} — ${insp.title}`)) continue
    const signature = `new_idea:${hookType}:${insp.brand}:${bestCountry}`.toUpperCase()
    if (usedSigs.has(signature)) { discards.push({ origin: `Inspiración ${insp.brand}`, hook_type: hookType, reason: 'patrón ya generado antes (signature en memoria)' }); continue }
    ideas.push(buildIdea({
      inspiration: insp, angle: takeAngle(cursor), desire: takeDesire(cursor), avatar: takeAvatar(cursor),
      hookType, country: bestCountry, learnings, signature,
    }))
    usedIds.add(insp.id); usedSigs.add(signature); cursor++
  }

  // 2) completar con research/libs internas usando hooks PROVEN o no quemados
  const HOOK_POOL = ['QUESTION', 'PERSONAL_STORY', 'VISUAL_DEMO', 'STATISTIC', 'CONTRADICTION', 'RESULT_FIRST', 'CONSPIRACY', 'CHALLENGE']
  const ranked = HOOK_POOL
    .map((h) => ({ h, l: learningFor(learnings, 'HOOK_TYPE', h) }))
    .sort((a, b) => (b.l?.verdict === 'PROVEN' ? b.l.avg_roas : 0) - (a.l?.verdict === 'PROVEN' ? a.l.avg_roas : 0))
  for (const { h } of ranked) {
    if (ideas.length >= quantity) break
    if (!checkHook(h, 'Pool interno')) continue
    const signature = `new_idea:${h}:RESEARCH:${bestCountry}`.toUpperCase()
    if (usedSigs.has(signature)) continue
    ideas.push(buildIdea({
      inspiration: null, angle: takeAngle(cursor), desire: takeDesire(cursor), avatar: takeAvatar(cursor),
      hookType: h, country: bestCountry, learnings, signature,
    }))
    usedSigs.add(signature); cursor++
  }

  // 3) persistir ideas + memoria (evoluciona)
  const createdIdeas = []
  for (const idea of ideas) createdIdeas.push(await ScriptIdeas.create(idea))
  await AgentMemory.update(memory.id, {
    inspiration_ids_used: [...usedIds], idea_signatures_used: [...usedSigs],
    last_generated: new Date().toISOString(),
  })

  return {
    success: true,
    ideas: createdIdeas,
    discards,
    context: {
      country: bestCountry,
      learnings_count: learnings.length,
      proven: learnings.filter((l) => l.verdict === 'PROVEN').map((l) => `${l.dimension}:${l.key}`),
      failed: learnings.filter((l) => l.verdict === 'FAILED').map((l) => `${l.dimension}:${l.key}`),
      research_findings: findings.length,
      inspiration_available: inspirationAll.filter((i) => !usedIds.has(i.id)).length,
    },
  }
}

// Convierte una idea en GeneratedScript DRAFT → entra al flujo normal (aprobar → VideoOps)
export async function ideaToScript(idea) {
  const sec = (p, total = idea.duration_sec || 35) => Math.round(total * p)
  const full_script = [
    `HOOK (0-${sec(0.1)}s): ${idea.hooks?.[0]?.text || ''}`,
    `  · Alt 1B: ${idea.hooks?.[1]?.text || ''}`,
    `  · Alt 1C: ${idea.hooks?.[2]?.text || ''}`,
    '',
    ...(idea.sections || []).map((s, i) => `${s.name} (${sec(0.1 + i * 0.22)}-${sec(Math.min(0.1 + (i + 1) * 0.22, 1))}s): ${s.detail}\n`),
    `[Diagnóstico Schwartz: ${idea.breakthrough_diagnosis?.why_this_wins || ''}]`,
    `[Basado en: ${idea.based_on?.reference || ''} · Audiencia: ${idea.audience || ''}]`,
  ].join('\n')
  const rec = await GeneratedScripts.create({
    title: `[NEW IDEA] ${idea.title}`,
    product: 'Isabella Fontana', format: idea.format || 'UGC', hook_type: idea.hook_type,
    status: 'DRAFT', duration_sec: idea.duration_sec || 35, language: 'es',
    hook: idea.hooks?.[0]?.text || '', full_script,
    cta: idea.sections?.find((s) => s.name === 'CTA')?.detail || '',
    on_screen_text: [], shotlist: [], broll_suggestions: [],
    editing_checklist: ['Hook en <2s', 'Subtítulos quemados', 'CTA visual final', 'VO español natural del segmento'],
    based_on: idea.based_on, source: 'CREATIVE_AGENT', idea_id: idea.id,
  })
  await ScriptIdeas.update(idea.id, { status: 'SCRIPTED', generated_script_id: rec.id })
  return rec
}
