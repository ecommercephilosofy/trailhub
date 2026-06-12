// Market Research engine — pipeline de 6 pasos (RMBC + Mass Desires de Eugene Schwartz).
// Mock backend: misma firma que el backend real (Claude API + scraping). Swap en producción.

import {
  ResearchRuns, ResearchFindings, RedditExtracts, ContextDocuments,
  AvatarProfiles, DesireLibrary, AngleLibrary, getSettings,
} from './entities'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)

function runId() {
  const d = new Date()
  const ymd = d.toISOString().slice(0, 10).replace(/-/g, '')
  return `RR-${ymd}-${String(Math.floor(Math.random() * 900) + 100)}`
}

// ---------- Generador de finding (mock determinista por tema) ----------
function buildFinding(topic, rawData) {
  const t = topic.trim()
  const tl = t.toLowerCase()

  const step_2_analysis = [
    `## Análisis de mercado: ${cap(t)}`,
    ``,
    `**Tamaño de conversación:** volumen alto y sostenido en Reddit, foros de nicho y reseñas de Amazon. El mercado habla del problema con lenguaje emocional, no técnico.`,
    ``,
    `**Sofisticación del mercado (Schwartz):** Etapa 3-4 — el público ya conoce soluciones genéricas y desconfía de promesas directas. Necesita MECANISMO ÚNICO, no más promesas.`,
    ``,
    `**Temperatura emocional:** frustración acumulada tras probar 2-3 soluciones fallidas. El gatillo de compra dominante es "esto es diferente porque..." + prueba visual.`,
    ``,
    `**Gaps detectados:**`,
    `- Nadie está atacando la objeción principal de frente en los primeros 3 segundos`,
    `- Los competidores usan claims genéricos; el lenguaje real del cliente (citas literales) está sin explotar`,
    `- Hay un segmento secundario infra-atendido con mayor LTV potencial`,
  ].join('\n')

  const step_3_rmbc_insights = [
    `## RMBC — Resistencias y Creencias (${cap(t)})`,
    ``,
    `**Resistencia #1 — "Ya lo probé y no funcionó":** la mayor barrera no es el precio, es el historial de fracasos. Cada solución fallida sube el escepticismo. → Contrarrestar con mecanismo de POR QUÉ fallaron las anteriores.`,
    ``,
    `**Resistencia #2 — Desconfianza del canal:** "todo lo de los anuncios es basura china". → Prueba social verificable + autoridad (origen, certificaciones, años).`,
    ``,
    `**Resistencia #3 — Miedo al efecto secundario / incomodidad:** el cliente imagina el peor escenario antes de comprar. → Demo visual que muestre exactamente la experiencia.`,
    ``,
    `**Creencia explotable:** el cliente YA cree que su problema es real y serio (no hay que educarlo en el problema, solo en el mecanismo de la solución).`,
    ``,
    `**Belief chain para el copy:** problema real → las soluciones típicas fallan por X → existe un mecanismo distinto → prueba → riesgo cero.`,
  ].join('\n')

  const step_4_avatar_profile = {
    avatar_name: `Buscador frustrado — ${cap(t).slice(0, 40)}`,
    age: tl.match(/(\d{2})\s*[-a]\s*(\d{2})/) ? tl.match(/(\d{2})\s*[-a]\s*(\d{2})/)[0] : '30-55',
    gender: /\bmen\b|hombre/.test(tl) ? 'male' : /women|mujer/.test(tl) ? 'female' : 'any',
    core_beliefs: 'Mi problema es real aunque otros lo minimicen. Ya he probado lo obvio y no funcionó. Si algo de verdad funcionara, lo notaría en días, no meses.',
    hopes_dreams: [
      'Resolver el problema sin cambiar todo su estilo de vida',
      'Volver a sentirse "normal" — dejar de pensar en el problema a diario',
      'Encontrar ALGO que funcione y poder recomendarlo con orgullo',
    ],
    fears: [
      'Gastar otra vez en algo que no funciona (fatiga de comprador)',
      'Que el problema sea "suyo" y no tenga solución',
      'Efectos secundarios o incomodidad peor que el problema',
    ],
    past_solutions: ['Solución genérica de farmacia/Amazon', 'Remedios caseros', 'Apps / hábitos que abandonó en 2 semanas'],
    language_sample: `"Llevo años con esto y nadie me da una solución de verdad. He gastado un dineral en cosas que prometen mucho y luego nada. Si alguien sabe de algo que SÍ funcione, que me lo diga ya."`,
  }

  const step_5_mass_desires = [
    { desire: 'Alivio inmediato y visible', segment: 'Sufridores crónicos que ya probaron de todo', core_emotion: 'Esperanza escéptica', intensity: 9 },
    { desire: 'Recuperar el control de su vida', segment: 'Los que sienten que el problema decide por ellos', core_emotion: 'Frustración → empoderamiento', intensity: 8 },
    { desire: 'Validación — "no estoy loco, esto es real"', segment: 'Minimizados por entorno/médicos', core_emotion: 'Reivindicación', intensity: 7 },
    { desire: 'Solución sin esfuerzo ni cambio de hábitos', segment: 'Ocupados / baja disciplina', core_emotion: 'Deseo de simplicidad', intensity: 8 },
  ]

  const mkAngles = (desire) => ([
    {
      angle_name: `Mecanismo único — por qué todo lo demás falló`,
      target_audience: desire.segment,
      key_emotional_moment: 'El momento "ahhh, POR ESO no me funcionó nada antes"',
      story_arc: 'Fracasos previos → revelación del mecanismo oculto → solución que lo ataca → vida después',
      unique_solution_mechanism: 'La solución actúa sobre la CAUSA raíz que las alternativas ignoran',
      unique_problem_mechanism: 'El problema persiste porque las soluciones típicas atacan el síntoma, no el mecanismo',
      hook_idea: `Si ya probaste de todo para ${tl.slice(0, 35)} y nada funcionó, no es culpa tuya. Es esto.`,
    },
    {
      angle_name: `Demostración brutal en 5 segundos`,
      target_audience: 'Escépticos visuales — no leen, miran',
      key_emotional_moment: 'Ver la prueba con sus propios ojos sin que nadie les "venda"',
      story_arc: 'Demo on-screen inmediata → reacción genuina → explicación corta → CTA',
      unique_solution_mechanism: 'Resultado observable y medible en cámara',
      unique_problem_mechanism: 'La desconfianza se desactiva con evidencia visual, no con palabras',
      hook_idea: `Mira lo que pasa cuando... *demo on-screen* — sin cortes.`,
    },
    {
      angle_name: `La historia del que estaba peor que tú`,
      target_audience: 'Identificación por gravedad — "si a él le funcionó..."',
      key_emotional_moment: 'Reconocerse en el peor momento del protagonista',
      story_arc: 'Fondo del pozo → encuentro casual con la solución → escepticismo → prueba → transformación',
      unique_solution_mechanism: 'Prueba social extrema: caso límite resuelto',
      unique_problem_mechanism: 'El cliente cree que SU caso es especial e irresoluble',
      hook_idea: `Llevaba 6 años así. Lo que pasó en 2 semanas no me lo creía ni yo.`,
    },
    {
      angle_name: `Validación — el problema es real y no es culpa tuya`,
      target_audience: 'Minimizados por su entorno',
      key_emotional_moment: 'Sentirse por fin comprendido antes de que le vendan nada',
      story_arc: 'Espejo emocional → "no estás loco" → ciencia del problema → solución → comunidad',
      unique_solution_mechanism: 'Primera marca que valida en vez de minimizar',
      unique_problem_mechanism: 'La invalidación social impide buscar soluciones en serio',
      hook_idea: `"Exagerado". "No es para tanto". Si te lo han dicho, este video es para ti.`,
    },
    {
      angle_name: `Cero esfuerzo — funciona mientras vives tu vida`,
      target_audience: desire.segment === 'Ocupados / baja disciplina' ? desire.segment : 'Quemados de protocolos y hábitos',
      key_emotional_moment: 'Alivio al descubrir que NO hay que cambiar nada más',
      story_arc: 'Lista de todo lo que NO tendrás que hacer → la única cosa que sí → resultado',
      unique_solution_mechanism: 'Integración pasiva: una acción, cero mantenimiento',
      unique_problem_mechanism: 'Las soluciones que exigen disciplina fallan por abandono, no por ineficacia',
      hook_idea: `No tienes que cambiar tu rutina. No tienes que acordarte de nada. Solo esto.`,
    },
  ])

  const step_6_marketing_angles = {}
  for (const d of step_5_mass_desires) {
    const key = d.desire.toUpperCase().replace(/[^A-ZÁÉÍÓÚÑ0-9]+/g, '_').slice(0, 40)
    step_6_marketing_angles[key] = { desire: d.desire, angles: mkAngles(d) }
  }

  return {
    step_1_raw_data: rawData,
    step_2_analysis,
    step_3_rmbc_insights,
    step_4_avatar_profile,
    step_5_mass_desires,
    step_6_marketing_angles,
  }
}

// ---------- Pipeline ----------
const STEPS = [
  'Paso 1/6 — Scraping web (Reddit, foros, reseñas)…',
  'Paso 2/6 — Análisis profundo de mercado…',
  'Paso 3/6 — RMBC Framework (resistencias y creencias)…',
  'Paso 4/6 — Construyendo avatar psicográfico…',
  'Paso 5/6 — Mass Desires (Eugene Schwartz)…',
  'Paso 6/6 — Generando marketing angles…',
]

async function executePipeline(run, topic, rawData) {
  const logs = []
  for (const s of STEPS) {
    logs.push(s)
    await ResearchRuns.update(run.id, { notes: s, logs: [...logs] })
    await sleep(900 + Math.random() * 600)
  }
  const data = buildFinding(topic, rawData)
  const finding = await ResearchFindings.create({
    finding_id: `FND-${run.research_run_id}`,
    research_run_id: run.research_run_id,
    topic,
    ...data,
  })
  const settings = await getSettings()
  const model = settings?.ai_router_config?.market_research || 'claude-opus-4-8'
  const tokens = 18000 + Math.floor(Math.random() * 14000)
  await ResearchRuns.update(run.id, {
    status: 'OK', notes: 'Investigación completada', logs: [...logs, '✓ Finding generado'],
    finding_id: finding.id, model_used: model, tokens_used: tokens,
    cost_estimate: +(tokens * 0.000015).toFixed(3),
  })
  return finding
}

export async function runMarketResearch({ topic }) {
  const run = await ResearchRuns.create({
    research_run_id: runId(), topic, source: 'GENERAL', status: 'RUNNING', notes: 'Iniciando…',
  })
  try {
    const finding = await executePipeline(run, topic, `Corpus simulado: hilos de Reddit, reseñas y foros sobre "${topic}" (en producción: scraping real + Claude).`)
    return { success: true, run_id: run.id, finding_id: finding.id }
  } catch (e) {
    await ResearchRuns.update(run.id, { status: 'ERROR', notes: String(e?.message || e) })
    return { success: false, error: String(e?.message || e) }
  }
}

// ---------- Reddit ----------
export async function fetchRedditThreadText({ url, sort = 'top', max_comments = 80 }) {
  const clean = url.trim().replace(/\/$/, '')
  const cached = (await RedditExtracts.filter({ url: clean }))[0]
  if (cached) return { success: true, cached: true, extract: cached }

  let title = null, body = '', comments = []
  try {
    const res = await fetch(`${clean}.json?sort=${sort}&limit=${max_comments}`, { headers: { Accept: 'application/json' } })
    if (res.ok) {
      const json = await res.json()
      const post = json?.[0]?.data?.children?.[0]?.data
      title = post?.title || null
      body = post?.selftext || ''
      const walk = (children) => {
        for (const c of children || []) {
          if (c.kind === 't1' && c.data?.body) comments.push(c.data.body)
          if (comments.length >= max_comments) return
        }
      }
      walk(json?.[1]?.data?.children)
    }
  } catch { /* CORS u offline → fallback */ }

  if (!title) {
    const slug = clean.split('/comments/')[1]?.split('/')[1] || 'hilo de reddit'
    title = slug.replace(/_/g, ' ')
    body = `[Extracto simulado — el fetch directo a Reddit está bloqueado por CORS en navegador; en producción esto corre server-side]`
    comments = [
      'Llevo años con este problema y nada de lo que recomiendan funciona de verdad.',
      'A mí me cambió la vida X, pero tardé meses en encontrarlo porque nadie habla de ello.',
      'Lo peor es que tu entorno piensa que exageras.',
      'He gastado cientos de euros en soluciones que prometen y luego nada.',
      '¿Alguien ha probado [solución]? Me da miedo que sea otra estafa más.',
    ]
  }

  const extract = await RedditExtracts.create({
    extract_id: `RX-${Date.now().toString(36)}`, url: clean, sort,
    title, body, comments, comments_count: comments.length,
    text: [`# ${title}`, body, '', '## Top comments', ...comments.map((c) => `- ${c}`)].join('\n'),
  })
  return { success: true, cached: false, extract }
}

export async function runMarketResearchFromReddit({ extract_id, topic }) {
  const extract = (await RedditExtracts.filter({ extract_id }))[0]
    || (await RedditExtracts.list()).find((e) => e.id === extract_id)
  if (!extract) return { success: false, error: 'Extract no encontrado' }
  const finalTopic = topic || extract.title
  const run = await ResearchRuns.create({
    research_run_id: runId(), topic: finalTopic, source: 'REDDIT',
    reddit_extract_id: extract.extract_id, status: 'RUNNING', notes: 'Iniciando…',
  })
  try {
    const finding = await executePipeline(run, finalTopic, extract.text)
    return { success: true, run_id: run.id, finding_id: finding.id }
  } catch (e) {
    await ResearchRuns.update(run.id, { status: 'ERROR', notes: String(e?.message || e) })
    return { success: false, error: String(e?.message || e) }
  }
}

// ---------- Import al Research Hub (con dedup por nombre) ----------
export async function importAvatarToHub(avatar, topic) {
  const existing = await AvatarProfiles.filter({ nombre: avatar.avatar_name })
  if (existing.length) return { created: false, record: existing[0] }
  const record = await AvatarProfiles.create({
    avatar_id: `AV-${Date.now().toString(36).toUpperCase()}`,
    nombre: avatar.avatar_name,
    descripcion: avatar.core_beliefs,
    age_range: avatar.age, gender: avatar.gender,
    pains: avatar.fears || [], desired_outcomes: avatar.hopes_dreams || [],
    objections: (avatar.past_solutions || []).map((s) => `Ya probó: ${s}`),
    language_style: avatar.language_sample, forbidden_tones: [],
    products: [], performance_score: null, tests_count: 0, total_spend: 0,
    is_active: true, source: `Market Research: ${topic}`,
  })
  return { created: true, record }
}

export async function importDesireToHub(desire, topic) {
  const existing = await DesireLibrary.filter({ nombre: desire.desire })
  if (existing.length) return { created: false, record: existing[0] }
  const record = await DesireLibrary.create({
    desire_id: `DES-${Date.now().toString(36).toUpperCase()}`,
    nombre: desire.desire,
    core_desire: `${desire.desire} — segmento: ${desire.segment}`,
    emotional_triggers: [desire.core_emotion],
    proof_types_that_work: [], products: [],
    performance_score: null, intensity: desire.intensity,
    source: `Market Research: ${topic}`,
  })
  return { created: true, record }
}

export async function importAngleToHub(angle, desireName, topic) {
  const existing = await AngleLibrary.filter({ nombre: angle.angle_name })
  if (existing.length) return { created: false, record: existing[0] }
  const record = await AngleLibrary.create({
    angle_id: `ANG-${Date.now().toString(36).toUpperCase()}`,
    nombre: angle.angle_name,
    promise: angle.hook_idea,
    mechanism: angle.unique_solution_mechanism,
    key_objection_to_crush: angle.unique_problem_mechanism,
    proof_strategy: angle.key_emotional_moment,
    story_arc: angle.story_arc, target_audience: angle.target_audience,
    best_formats: ['UGC'], products: [], performance_score: null,
    desire: desireName, source: `Market Research: ${topic}`,
  })
  return { created: true, record }
}

export async function importResearchToHub({ finding_id }) {
  const finding = (await ResearchFindings.list()).find((f) => f.id === finding_id || f.finding_id === finding_id)
  if (!finding) return { success: false, error: 'Finding no encontrado' }
  const imported = { avatars: 0, desires: 0, angles: 0 }
  if (finding.step_4_avatar_profile?.avatar_name) {
    const r = await importAvatarToHub(finding.step_4_avatar_profile, finding.topic)
    if (r.created) imported.avatars++
  }
  for (const d of finding.step_5_mass_desires || []) {
    const r = await importDesireToHub(d, finding.topic)
    if (r.created) imported.desires++
  }
  for (const group of Object.values(finding.step_6_marketing_angles || {})) {
    for (const a of group.angles || []) {
      const r = await importAngleToHub(a, group.desire, finding.topic)
      if (r.created) imported.angles++
    }
  }
  return { success: true, imported }
}

// ---------- Export a Context Library ----------
export function findingToMarkdown(finding) {
  const av = finding.step_4_avatar_profile || {}
  const lines = [
    `# Market Research — ${finding.topic}`,
    `_Run ${finding.research_run_id} · ${new Date(finding.created_date).toLocaleDateString('es-ES')}_`,
    '', '## 📊 Análisis de contenido', finding.step_2_analysis || '—',
    '', '## 📋 RMBC Insights', finding.step_3_rmbc_insights || '—',
    '', '## 👤 Customer Avatar',
    `**${av.avatar_name}** (${av.age}, ${av.gender})`,
    `- Creencias: ${av.core_beliefs}`,
    `- Sueños: ${(av.hopes_dreams || []).join(' · ')}`,
    `- Miedos: ${(av.fears || []).join(' · ')}`,
    `- Soluciones pasadas: ${(av.past_solutions || []).join(' · ')}`,
    `- Lenguaje: ${av.language_sample}`,
    '', '## 💫 Mass Desires',
    ...(finding.step_5_mass_desires || []).map((d) => `- **${d.desire}** (${d.intensity}/10) — ${d.segment} · ${d.core_emotion}`),
    '', '## 🎯 Marketing Angles',
  ]
  for (const group of Object.values(finding.step_6_marketing_angles || {})) {
    lines.push(`### ${group.desire}`)
    for (const a of group.angles || []) {
      lines.push(`- **${a.angle_name}** → ${a.hook_idea}`)
      lines.push(`  - Arco: ${a.story_arc}`)
      lines.push(`  - Mecanismo: ${a.unique_solution_mechanism}`)
    }
  }
  return lines.join('\n')
}

export async function saveFindingToContextLibrary({ finding_id }) {
  const finding = (await ResearchFindings.list()).find((f) => f.id === finding_id || f.finding_id === finding_id)
  if (!finding) return { success: false, error: 'Finding no encontrado' }
  const doc = await ContextDocuments.create({
    title: `Market Research — ${finding.topic}`,
    doc_type: 'MARKET_RESEARCH', source_finding_id: finding.finding_id,
    content_md: findingToMarkdown(finding),
  })
  return { success: true, doc_id: doc.id }
}
