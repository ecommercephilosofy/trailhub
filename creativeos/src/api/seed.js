// Demo seed — Quies-flavored ecommerce (tapones/antifaz para dormir).
// Deterministic RNG so the demo is stable across resets.

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
const rng = mulberry32(20260611)
const rnd = (min, max) => min + rng() * (max - min)

let n = 0
const id = (p) => `${p}_seed${(n++).toString(36).padStart(3, '0')}`
const NOW = new Date('2026-06-11T09:00:00')
const iso = (daysAgo = 0, h = 9) => {
  const d = new Date(NOW)
  d.setDate(d.getDate() - daysAgo)
  d.setHours(h, Math.floor(rnd(0, 59)))
  return d.toISOString()
}
const dateStr = (daysAgo) => iso(daysAgo).slice(0, 10)

export function seedDatabase() {
  const db = {}
  const t = (name) => (db[name] = db[name] || [])
  const rec = (name, data, daysAgo = rnd(1, 30)) => {
    const r = { id: id(name.slice(0, 4).toLowerCase()), created_date: iso(daysAgo), updated_date: iso(Math.max(0, daysAgo - 1)), ...data }
    t(name).push(r)
    return r
  }

  // ---- Users ----
  const uMarc = rec('AuthUsers', { email: 'marc@creativeos.app', full_name: 'Marc Delgado', role: 'admin' }, 90)
  const uClaudia = rec('AuthUsers', { email: 'claudia@creativeos.app', full_name: 'Claudia Ruiz', role: 'user' }, 80)
  const uLaura = rec('AuthUsers', { email: 'laura@creativeos.app', full_name: 'Laura Vidal', role: 'user' }, 70)
  const uPablo = rec('AuthUsers', { email: 'pablo@creativeos.app', full_name: 'Pablo Soler', role: 'user' }, 70)
  const profile = (u, role, skills, cap) =>
    rec('UserProfiles', {
      user_id: u.id, custom_role: role, name: u.full_name, timezone: 'Europe/Madrid',
      skills_tags: skills, capacity_per_day: cap, discord_user_id: '',
      notification_prefs: { notify_on_task_assigned: true, notify_on_task_updated: true, notify_on_video_note_added: true, notify_on_script_assigned: true },
      onboarding_completed: true, avatar_url: '',
    }, 60)
  profile(uMarc, 'ADMIN', ['strategy', 'media buying'], 8)
  profile(uClaudia, 'MANAGER', ['research', 'copywriting'], 6)
  profile(uLaura, 'EDITOR', ['UGC', 'captions', 'CapCut'], 3)
  profile(uPablo, 'EDITOR', ['VSL', 'motion graphics', 'After Effects'], 2)

  // ---- Research Hub ----
  const avMama = rec('AvatarProfiles', {
    avatar_id: 'AV-MAMA-CANSADA', nombre: 'Mamá agotada (30-45)', descripcion: 'Madre trabajadora que no duerme bien desde hace años. Su pareja ronca y los niños la despiertan. Está irritable y culpable por ello.',
    age_range: '30-45', gender: 'female', pains: ['Despertares constantes', 'Ronquidos de la pareja', 'Irritabilidad diurna'],
    desired_outcomes: ['Dormir 7h del tirón', 'Despertar con energía', 'Dejar de discutir por los ronquidos'],
    objections: ['Los tapones me darán dolor de oído', '¿Y si no oigo a mis hijos?'], language_style: 'Cercano, empático, sin tecnicismos',
    forbidden_tones: ['condescendiente', 'médico-alarmista'], products: ['Quies Sleep'], performance_score: 87, total_spend: 2140, tests_count: 9, is_active: true,
  }, 45)
  const avViajero = rec('AvatarProfiles', {
    avatar_id: 'AV-VIAJERO', nombre: 'Viajero frecuente (25-40)', descripcion: 'Profesional que vuela 2+ veces al mes. Duerme mal en aviones y hoteles ruidosos. Valora productos compactos y premium.',
    age_range: '25-40', gender: 'any', pains: ['Jet lag', 'Hoteles ruidosos', 'No descansa en vuelos'],
    desired_outcomes: ['Llegar descansado', 'Rutina de sueño portátil'], objections: ['Ya probé tapones de espuma y se caen'],
    language_style: 'Directo, aspiracional', forbidden_tones: ['infantil'], products: ['Quies Travel'], performance_score: 72, total_spend: 1320, tests_count: 6, is_active: true,
  }, 45)
  const avEstudiante = rec('AvatarProfiles', {
    avatar_id: 'AV-ESTUDIANTE', nombre: 'Estudiante opositor (20-30)', descripcion: 'Prepara oposiciones en piso compartido. Necesita concentración de día y silencio de noche. Presupuesto ajustado.',
    age_range: '20-30', gender: 'any', pains: ['Ruido de compañeros', 'Ansiedad pre-examen', 'Sueño irregular'],
    desired_outcomes: ['Concentración profunda', 'Dormir antes de exámenes'], objections: ['Parece caro para ser tapones'],
    language_style: 'Informal, memes ok', forbidden_tones: ['corporativo'], products: ['Quies Focus'], performance_score: 64, total_spend: 760, tests_count: 4, is_active: true,
  }, 40)
  const avSensible = rec('AvatarProfiles', {
    avatar_id: 'AV-OIDO-SENSIBLE', nombre: 'Durmiente de oído sensible (35-60)', descripcion: 'Se despierta con cualquier ruido: tráfico, vecinos, mascotas. Ha probado de todo. Escéptico pero desesperado.',
    age_range: '35-60', gender: 'any', pains: ['Sueño ligero extremo', 'Vecinos ruidosos', 'Ha probado 5+ soluciones'],
    desired_outcomes: ['Bloquear ruido sin molestia física'], objections: ['Nada me ha funcionado antes'],
    language_style: 'Probatorio, con evidencia', forbidden_tones: ['promesas absolutas'], products: ['Quies Sleep'], performance_score: 78, total_spend: 980, tests_count: 5, is_active: true,
  }, 38)

  const ang1 = rec('AngleLibrary', { angle_id: 'ANG-SILENCIO-CIENCIA', nombre: 'El silencio como ciencia del descanso', promise: 'Reduce 27dB el ruido y duerme del tirón desde la primera noche', mechanism: 'Cera natural moldeable que sella el canal auditivo sin presión', key_objection_to_crush: 'Los tapones duelen al dormir de lado', proof_strategy: 'Demo de moldeado + test de decibelios on-screen', best_formats: ['UGC', 'PROBLEM_SOLUTION'], products: ['Quies Sleep'], performance_score: 84 }, 44)
  const ang2 = rec('AngleLibrary', { angle_id: 'ANG-PAREJA-RONCA', nombre: 'Salva tu relación (ronquidos)', promise: 'Deja de odiar a tu pareja por las mañanas', mechanism: 'Bloqueo físico del ronquido sin dormir separados', key_objection_to_crush: 'No oiré el despertador', proof_strategy: 'Testimonio pareja + clip despertador audible', best_formats: ['UGC', 'TESTIMONIAL'], products: ['Quies Sleep'], performance_score: 91 }, 44)
  const ang3 = rec('AngleLibrary', { angle_id: 'ANG-RITUAL-VIAJE', nombre: 'Ritual de sueño portátil', promise: 'Tu dormitorio en el bolsillo: duerme igual en cualquier parte', mechanism: 'Kit compacto tapones + antifaz de presión cero', key_objection_to_crush: 'Los kits de viaje son gimmicks', proof_strategy: 'POV vuelo nocturno real', best_formats: ['POV', 'VSL'], products: ['Quies Travel'], performance_score: 69 }, 40)
  const ang4 = rec('AngleLibrary', { angle_id: 'ANG-100-ANOS', nombre: 'Autoridad: 100 años de farmacia francesa', promise: 'La marca que las farmacias francesas llevan recomendando un siglo', mechanism: 'Herencia farmacéutica + cera natural', key_objection_to_crush: 'Será otra marca china de Amazon', proof_strategy: 'Archivo histórico + sello farmacia', best_formats: ['AUTHORITY', 'VSL'], products: ['Quies Sleep', 'Quies Travel'], performance_score: 75 }, 40)
  const ang5 = rec('AngleLibrary', { angle_id: 'ANG-FOCUS-DEEPWORK', nombre: 'Deep work sin ruido', promise: '3 horas de concentración real aunque tu piso parezca un bar', mechanism: 'Atenuación selectiva: bloquea voces, no alarmas', key_objection_to_crush: 'Me aíslo demasiado y me agobio', proof_strategy: 'Split-screen estudio con/sin', best_formats: ['UGC', 'PROBLEM_SOLUTION'], products: ['Quies Focus'], performance_score: 58 }, 35)

  const des1 = rec('DesireLibrary', { desire_id: 'DES-DORMIR-TIRON', nombre: 'Dormir del tirón', core_desire: 'Una noche completa sin despertares — y despertar siendo otra persona', emotional_triggers: ['Agotamiento crónico', 'Envidia de quien duerme bien'], proof_types_that_work: ['Testimonios antes/después', 'Métricas de sueño (apps)'], products: ['Quies Sleep'], performance_score: 88 }, 44)
  const des2 = rec('DesireLibrary', { desire_id: 'DES-PAZ-PAREJA', nombre: 'Paz con la pareja', core_desire: 'Volver a dormir juntos sin resentimiento', emotional_triggers: ['Culpa', 'Nostalgia de la relación'], proof_types_that_work: ['Testimonio de pareja real'], products: ['Quies Sleep'], performance_score: 79 }, 42)
  const des3 = rec('DesireLibrary', { desire_id: 'DES-ENERGIA', nombre: 'Energía y rendimiento diurno', core_desire: 'Rendir al máximo sin depender de 4 cafés', emotional_triggers: ['Miedo a quedarse atrás', 'Ambición'], proof_types_that_work: ['Datos de productividad', 'Rutinas de famosos'], products: ['Quies Focus', 'Quies Travel'], performance_score: 61 }, 40)
  const des4 = rec('DesireLibrary', { desire_id: 'DES-CONTROL-ENTORNO', nombre: 'Control del entorno', core_desire: 'Que el ruido de otros deje de decidir cómo vives', emotional_triggers: ['Frustración con vecinos', 'Sensación de injusticia'], proof_types_that_work: ['Demo dB', 'Comparativas'], products: ['Quies Sleep', 'Quies Focus'], performance_score: 70 }, 38)

  const pro1 = rec('ProblemLibrary', { problem_id: 'PRB-DESPERTARES', nombre: 'Micro-despertares por ruido', description: 'El cerebro procesa ruido aunque duermas: cada moto o portazo fragmenta el sueño profundo sin que lo recuerdes.', unique_mechanism_behind_problem: 'El oído no tiene párpados: la corteza auditiva sigue activa en fase REM', unique_mechanism_behind_solution: 'Sellado pasivo de cera que baja 27dB la señal antes de llegar al tímpano', knowledge_gap: 'La gente cree que "se acostumbra" al ruido; la fragmentación sigue ocurriendo', past_solutions_tried: ['Espuma barata', 'Ruido blanco', 'Melatonina'], why_past_failed: 'La espuma se expande y duele; el ruido blanco añade más ruido; la melatonina no bloquea despertares', products: ['Quies Sleep'], performance_score: 82 }, 44)
  const pro2 = rec('ProblemLibrary', { problem_id: 'PRB-RONQUIDO', nombre: 'Ronquido de pareja (65-90dB)', description: 'Un ronquido medio alcanza el volumen de una aspiradora a 50cm de tu cabeza.', unique_mechanism_behind_problem: 'Vibración de baja frecuencia que atraviesa almohadas y paredes', unique_mechanism_behind_solution: 'La cera sella mejor las bajas frecuencias que la espuma', knowledge_gap: 'Dormir separados empeora la relación: el problema es el sonido, no la persona', past_solutions_tried: ['Dormir separados', 'Apps anti-ronquido', 'Codazos'], why_past_failed: 'Atacan al roncador, no protegen al que sufre', products: ['Quies Sleep'], performance_score: 90 }, 42)
  const pro3 = rec('ProblemLibrary', { problem_id: 'PRB-PISO-RUIDOSO', nombre: 'Piso compartido / vecinos', description: 'Convivencia con horarios distintos: imposible controlar el ruido ajeno.', unique_mechanism_behind_problem: 'Ruido impredecible = hipervigilancia del sistema nervioso', unique_mechanism_behind_solution: 'Atenuación constante que elimina la imprevisibilidad', knowledge_gap: 'No es ser "quejica": es fisiología del sobresalto', past_solutions_tried: ['Auriculares', 'Mudanza', 'Hablar con vecinos'], why_past_failed: 'Auriculares duelen al dormir; mudarse es caro; hablar no escala', products: ['Quies Sleep', 'Quies Focus'], performance_score: 67 }, 40)

  rec('ObjectionLibrary', { objection_id: 'OBJ-NO-OIGO-HIJOS', nombre: 'No oiré a mis hijos / despertador', text: '¿Y si pasa algo por la noche y no me entero?', how_to_address: 'Atenúa, no aísla: bajas 27dB pero un llanto o alarma (80dB+) sigue siendo audible', best_rebuttals: ['Demo despertador sonando con tapones', 'Testimonio de madre'], products: ['Quies Sleep'], avatars: ['AV-MAMA-CANSADA'], is_active: true }, 40)
  rec('ObjectionLibrary', { objection_id: 'OBJ-DUELEN', nombre: 'Los tapones duelen al dormir de lado', text: 'Uso espuma y me duele la oreja por la mañana', how_to_address: 'La cera se moldea plana al canal: cero presión interna, apta para dormir de lado', best_rebuttals: ['Macro del moldeado', 'Comparativa cera vs espuma'], products: ['Quies Sleep', 'Quies Travel'], avatars: ['AV-OIDO-SENSIBLE'], is_active: true }, 38)
  rec('ObjectionLibrary', { objection_id: 'OBJ-CARO', nombre: 'Es caro para ser tapones', text: 'Por ese precio compro 3 cajas de espuma', how_to_address: 'Coste por noche < 0,15€ y reutilizables; compara con el coste de una mala noche', best_rebuttals: ['Cálculo coste/noche on-screen', 'Garantía devolución'], products: ['Quies Focus'], avatars: ['AV-ESTUDIANTE'], is_active: true }, 36)

  // ---- Ads: 12 ads × 14 days ----
  const adDefs = [
    { ad_id: '120211001', name: '[V03] UGC | HOOK-QUESTION | MAMA_CANSADA | Quies Sleep', product: 'Quies Sleep', type: 'VIDEO', p: 'winner', roas: 3.9, spendD: [45, 85], hook: 33, hold: 17, ctr: 2.1, avatar: avMama, angle: ang2, desire: des1, hook_type: 'QUESTION', format: 'UGC' },
    { ad_id: '120211002', name: '[V07] UGC | HOOK-PERSONAL_STORY | MAMA_CANSADA | Quies Sleep', product: 'Quies Sleep', type: 'VIDEO', p: 'winner', roas: 3.2, spendD: [38, 70], hook: 29, hold: 14, ctr: 1.8, avatar: avMama, angle: ang1, desire: des1, hook_type: 'PERSONAL_STORY', format: 'UGC' },
    { ad_id: '120211003', name: '[V12] VSL | HOOK-CONSPIRACY | OIDO_SENSIBLE | Quies Sleep', product: 'Quies Sleep', type: 'VIDEO', p: 'winner', roas: 2.8, spendD: [50, 95], hook: 26, hold: 19, ctr: 1.6, avatar: avSensible, angle: ang4, desire: des4, hook_type: 'CONSPIRACY', format: 'VSL', fatigue: true },
    { ad_id: '120211004', name: '[V04] TESTIMONIAL | HOOK-RESULT_FIRST | PAREJA | Quies Sleep', product: 'Quies Sleep', type: 'VIDEO', p: 'regular', roas: 2.1, spendD: [25, 45], hook: 24, hold: 12, ctr: 1.4, avatar: avMama, angle: ang2, desire: des2, hook_type: 'RESULT_FIRST', format: 'TESTIMONIAL' },
    { ad_id: '120211005', name: '[V09] POV | HOOK-VISUAL_DEMO | VIAJERO | Quies Travel', product: 'Quies Travel', type: 'VIDEO', p: 'regular', roas: 1.9, spendD: [20, 40], hook: 22, hold: 10, ctr: 1.3, avatar: avViajero, angle: ang3, desire: des3, hook_type: 'VISUAL_DEMO', format: 'POV' },
    { ad_id: '120211006', name: '[I02] IMG | STATIC-BENEFITS | MAMA_CANSADA | Quies Sleep', product: 'Quies Sleep', type: 'IMAGE', p: 'regular', roas: 1.7, spendD: [15, 30], hook: 0, hold: 0, ctr: 1.1, avatar: avMama, angle: ang1, desire: des1, hook_type: null, format: null },
    { ad_id: '120211007', name: '[V15] AUTHORITY | HOOK-DOCUMENTARY | OIDO_SENSIBLE | Quies Sleep', product: 'Quies Sleep', type: 'VIDEO', p: 'regular', roas: 1.6, spendD: [18, 35], hook: 19, hold: 13, ctr: 1.0, avatar: avSensible, angle: ang4, desire: des4, hook_type: 'DOCUMENTARY', format: 'AUTHORITY', fatigue: true },
    { ad_id: '120211008', name: '[V05] UGC | HOOK-HUMOR | ESTUDIANTE | Quies Focus', product: 'Quies Focus', type: 'VIDEO', p: 'loser', roas: 0.9, spendD: [10, 25], hook: 16, hold: 7, ctr: 0.8, avatar: avEstudiante, angle: ang5, desire: des3, hook_type: 'HUMOR', format: 'UGC' },
    { ad_id: '120211009', name: '[V11] PROBLEM_SOLUTION | HOOK-STATISTIC | ESTUDIANTE | Quies Focus', product: 'Quies Focus', type: 'VIDEO', p: 'loser', roas: 0.7, spendD: [8, 20], hook: 13, hold: 6, ctr: 0.7, avatar: avEstudiante, angle: ang5, desire: des4, hook_type: 'STATISTIC', format: 'PROBLEM_SOLUTION' },
    { ad_id: '120211010', name: '[I04] IMG | STATIC-OFFER | VIAJERO | Quies Travel', product: 'Quies Travel', type: 'IMAGE', p: 'loser', roas: 1.1, spendD: [6, 15], hook: 0, hold: 0, ctr: 0.6, avatar: avViajero, angle: ang3, desire: des3, hook_type: null, format: null },
    { ad_id: '120211011', name: '[V18] UGC | HOOK-CONTRADICTION | MAMA_CANSADA | Quies Sleep', product: 'Quies Sleep', type: 'VIDEO', p: 'unscored', roas: 2.4, spendD: [2, 6], hook: 27, hold: 13, ctr: 1.5, avatar: avMama, angle: ang1, desire: des1, hook_type: 'CONTRADICTION', format: 'UGC' },
    { ad_id: '120211012', name: '[V19] POV | HOOK-CHALLENGE | VIAJERO | Quies Travel', product: 'Quies Travel', type: 'VIDEO', p: 'unscored', roas: 0.8, spendD: [1, 5], hook: 18, hold: 8, ctr: 0.9, avatar: avViajero, angle: ang3, desire: des3, hook_type: 'CHALLENGE', format: 'POV' },
  ]

  const DAYS = 14
  for (const ad of adDefs) {
    let bestRoas = 0
    for (let d = DAYS - 1; d >= 0; d--) {
      const progress = (DAYS - 1 - d) / (DAYS - 1) // 0=oldest..1=newest
      const fat = ad.fatigue ? 1 - progress * 0.45 : 1
      const spend = rnd(ad.spendD[0], ad.spendD[1])
      const cpm = rnd(6.5, 9.5)
      const impressions = Math.round((spend / cpm) * 1000)
      const ctr = ad.ctr * fat * rnd(0.85, 1.15)
      const link_clicks = Math.round((impressions * ctr) / 100)
      const clicks = Math.round(link_clicks * rnd(1.15, 1.35))
      const cvr = rnd(0.035, 0.06)
      const conversions = Math.max(0, Math.round(link_clicks * cvr * (ad.roas / 2)))
      const aov = rnd(24, 32)
      const conversion_value = +(spend * ad.roas * fat * rnd(0.8, 1.2)).toFixed(2)
      const frequency = +(1.4 + progress * (ad.fatigue ? 2.6 : 1.1) + rnd(-0.1, 0.2)).toFixed(2)
      const isVideo = ad.type === 'VIDEO'
      const video_plays = isVideo ? Math.round(impressions * rnd(0.8, 0.92)) : 0
      const video_3s = isVideo ? Math.round((video_plays * ad.hook * fat * rnd(0.9, 1.1)) / 100) : 0
      const thruplay = isVideo ? Math.round((video_3s * ad.hold * rnd(0.9, 1.1)) / 100) : 0
      const video_p25 = isVideo ? Math.round(video_plays * rnd(0.28, 0.42) * fat) : 0
      const video_p50 = isVideo ? Math.round(video_p25 * rnd(0.5, 0.65)) : 0
      const video_p75 = isVideo ? Math.round(video_p50 * rnd(0.45, 0.6)) : 0
      const dayRoas = spend > 0 ? conversion_value / spend : 0
      if (dayRoas > bestRoas) bestRoas = dayRoas
      rec('AdsPerformanceDaily', {
        date: dateStr(d), ad_id: ad.ad_id, ad_name: ad.name, campaign_name: `[CBO] ${ad.product} | Prospecting`,
        adset_name: `${ad.product} | Broad ES`, creative_type: ad.type, spend: +spend.toFixed(2), impressions,
        reach: Math.round(impressions / frequency), clicks, link_clicks, conversions, conversion_value,
        frequency, video_plays, video_3s, thruplay, video_p25, video_p50, video_p75,
        avg_watch_time: isVideo ? +rnd(5, 14).toFixed(1) : 0, aov: +aov.toFixed(2),
      }, d)
    }
    rec('AdStats', { ad_id: ad.ad_id, ad_name: ad.name, best_roas_ever: +Math.max(bestRoas, ad.roas * 1.15).toFixed(2), created_time: iso(rnd(20, 60)), product: ad.product, parsed_format: ad.format, parsed_hook: ad.hook_type }, 20)
  }

  // ---- AdsPerformanceAgg LAST_7D (rebuilt by syncMetaAds too) ----
  buildAggIntoDB(db, rec)

  // ---- Generated Scripts ----
  const mkScript = (data, daysAgo) =>
    rec('GeneratedScripts', {
      language: 'es', editor_rating: null, assigned_editor_user_id: null, assigned_to_task_id: null, based_on: null,
      on_screen_text: [], shotlist: [], broll_suggestions: [], editing_checklist: ['Subtítulos quemados estilo CapCut', 'Hook en <2s', 'CTA visual final 3s', 'Música trending baja -18dB', 'Logo última escena'],
      ...data,
    }, daysAgo)

  const gs1 = mkScript({
    title: 'UGC Mamá — "¿Tu pareja también ronca así?"', product: 'Quies Sleep', format: 'UGC', hook_type: 'QUESTION', status: 'APPROVED', duration_sec: 35,
    avatar_id: avMama.id, angle_id: ang2.id, desire_id: des1.id,
    hook: '¿Tu pareja también ronca como si fuera un tractor? Mira esto.',
    full_script: `HOOK (0-3s): ¿Tu pareja también ronca como si fuera un tractor? Mira esto.\n\nPROBLEMA (3-10s): Llevaba 2 años durmiendo fatal. Probé espuma, ruido blanco, hasta dormir en el sofá.\n\nMECANISMO (10-20s): Estos son de cera natural. Los moldeas así *demo* y sellan el oído sin presión. Bajan 27 decibelios.\n\nPRUEBA (20-28s): Primera noche: dormí 7 horas del tirón. Y ojo — el despertador SÍ lo oigo.\n\nCTA (28-35s): Están en oferta esta semana. Link abajo. Tu relación me lo agradecerá.`,
    cta: 'Consíguelos con -20% esta semana → link en bio',
    on_screen_text: ['POV: tu pareja ronca a 80dB', '27dB menos de ruido', '7 HORAS del tirón', '-20% solo esta semana'],
    shotlist: ['Selfie cama despeinada, luz cálida', 'B-roll pareja roncando (humor)', 'Macro moldeado del tapón', 'Demo colocación en oreja', 'Despertar feliz estirándose', 'Packshot con oferta'],
    broll_suggestions: ['Reloj marcando 3:00 AM', 'App de medición dB', 'Caja Quies en mesilla'],
    editor_rating: 5,
  }, 6)
  const gs2 = mkScript({
    title: 'VSL Autoridad — 100 años de farmacias', product: 'Quies Sleep', format: 'VSL', hook_type: 'CONSPIRACY', status: 'SENT', duration_sec: 90,
    avatar_id: avSensible.id, angle_id: ang4.id, desire_id: des4.id,
    hook: 'Las farmacias francesas llevan 100 años recomendando esto para dormir. En España casi nadie lo conoce.',
    full_script: `HOOK (0-5s): Las farmacias francesas llevan 100 años recomendando esto para dormir. En España casi nadie lo conoce.\n\nHISTORIA (5-25s): Desde 1918, Quies fabrica la misma fórmula de cera natural...\n\nMECANISMO (25-50s): A diferencia de la espuma, la cera no empuja hacia fuera...\n\nPRUEBA SOCIAL (50-70s): 4.6 estrellas, 12.000 reseñas...\n\nCTA (70-90s): Pruébalos 30 noches. Si no duermes mejor, te devolvemos el dinero.`,
    cta: 'Prueba 30 noches sin riesgo → quies.es',
    on_screen_text: ['Desde 1918', '27dB de reducción', '12.000+ reseñas ★4.6', 'Garantía 30 noches'],
    shotlist: ['Archivo b/n farmacia 1920', 'Macro producto girando', 'Comparativa cera vs espuma', 'Testimonios rápidos x3', 'Packshot garantía'],
    broll_suggestions: ['Sello farmacéutico', 'Mapa Francia→España'],
  }, 4)
  const gs3 = mkScript({
    title: 'POV Vuelo nocturno — kit Travel', product: 'Quies Travel', format: 'POV', hook_type: 'VISUAL_DEMO', status: 'READY', duration_sec: 28,
    avatar_id: avViajero.id, angle_id: ang3.id, desire_id: des3.id,
    hook: 'POV: vuelo de 11 horas y el bebé de la fila 12 acaba de despertar.',
    full_script: `HOOK (0-3s): POV: vuelo de 11 horas y el bebé de la fila 12 acaba de despertar.\n\nDEMO (3-15s): Saco el kit: tapones moldeables + antifaz cero presión. 20 segundos y desaparece el avión.\n\nRESULTADO (15-23s): Aterrizo en Tokio como si hubiera dormido en mi cama.\n\nCTA (23-28s): El kit entero cuesta menos que un menú del aeropuerto.`,
    cta: 'Kit de viaje completo → link',
    on_screen_text: ['11h de vuelo 😵', '20 segundos de setup', 'Modo avión: OFF. Modo sueño: ON'],
    shotlist: ['POV asiento avión', 'Unboxing kit en bandeja', 'Colocación tapones+antifaz', 'Time-lapse ventana', 'Llegada fresh'],
    broll_suggestions: ['Pantalla de vuelo BCN-NRT', 'Cinta de maletas'],
    assigned_editor_user_id: uPablo.id,
  }, 3)
  const gs4 = mkScript({
    title: 'Iteración Winner — ronquidos v2 (escalado)', product: 'Quies Sleep', format: 'UGC', hook_type: 'CONTRADICTION', status: 'DRAFT', duration_sec: 32,
    avatar_id: avMama.id, angle_id: ang2.id, desire_id: des2.id,
    hook: 'No le pidas a tu pareja que deje de roncar. En serio, no funciona.',
    full_script: `HOOK (0-3s): No le pidas a tu pareja que deje de roncar. En serio, no funciona.\n\nGIRO (3-12s): El problema no es el ronquido. Es que TÚ lo oyes...\n\nMECANISMO (12-22s): demo moldeado + 27dB...\n\nCTA (22-32s): oferta + garantía.`,
    cta: 'Pruébalos esta noche → link',
    based_on: { source_ad_id: '120211001', source_ad_name: '[V03] UGC | HOOK-QUESTION | MAMA_CANSADA | Quies Sleep', source_roas: 3.9, method: 'AI_ITERATION_FROM_WINNER' },
  }, 1)
  const gs5 = mkScript({
    title: 'Testimonial pareja real — 30 noches', product: 'Quies Sleep', format: 'TESTIMONIAL', hook_type: 'RESULT_FIRST', status: 'NEEDS_EDIT', duration_sec: 45,
    avatar_id: avMama.id, angle_id: ang2.id, desire_id: des2.id,
    hook: 'Llevábamos 3 meses durmiendo en habitaciones separadas. Esto nos devolvió a la misma cama.',
    full_script: `HOOK: resultado primero...\nHISTORIA: 3 meses separados...\nPRODUCTO: cera moldeable...\nCTA: garantía 30 noches.`,
    cta: 'Garantía 30 noches → quies.es', assigned_editor_user_id: uLaura.id, editor_rating: 3,
  }, 8)
  const gs6 = mkScript({
    title: 'Focus estudiante — biblioteca en casa', product: 'Quies Focus', format: 'PROBLEM_SOLUTION', hook_type: 'STATISTIC', status: 'REJECTED', duration_sec: 30,
    avatar_id: avEstudiante.id, angle_id: ang5.id, desire_id: des3.id,
    hook: 'Tardas 23 minutos en recuperar la concentración cada vez que te interrumpe un ruido.',
    full_script: `HOOK: dato 23 min...\nPROBLEMA: piso compartido...\nSOLUCIÓN: atenuación selectiva...\nCTA: coste por día.`,
    cta: 'Menos de 0,15€/día → link',
  }, 10)
  const gs7 = mkScript({
    title: 'Demo visual — test del decibelímetro', product: 'Quies Sleep', format: 'UGC', hook_type: 'VISUAL_DEMO', status: 'READY', duration_sec: 26,
    avatar_id: avSensible.id, angle_id: ang1.id, desire_id: des4.id,
    hook: 'Puse un decibelímetro dentro de mi oreja (más o menos). Mira lo que pasa.',
    full_script: `HOOK: decibelímetro...\nDEMO: 78dB → 51dB on-screen...\nEXPLICACIÓN: cera vs espuma...\nCTA.`,
    cta: 'Compruébalo tú mismo → link', assigned_editor_user_id: uLaura.id,
  }, 2)
  const gs8 = mkScript({
    title: 'Humor — compañero de piso DJ', product: 'Quies Focus', format: 'UGC', hook_type: 'HUMOR', status: 'DRAFT', duration_sec: 24,
    avatar_id: avEstudiante.id, angle_id: ang5.id, desire_id: des4.id,
    hook: 'Mi compañero de piso descubrió que quiere ser DJ. Yo descubrí esto.',
    full_script: `HOOK humor...\nSETUP: fiesta a las 2AM...\nSOLUCIÓN...\nCTA.`,
    cta: 'Sobrevive a tu piso → link',
  }, 0)

  // ---- Script Library ----
  const sl1 = rec('ScriptLibrary', { script_id: 'SCR-BASE-001', doc_url: 'https://docs.google.com/document/d/example1', title: 'BASE — UGC ronquidos (estructura madre)', product: 'Quies Sleep', format: 'UGC', avatar_id: avMama.id, angle_id: ang2.id, texto_script_cached: 'Estructura madre UGC: HOOK pregunta → historia personal → demo moldeado → prueba dB → CTA oferta.', status: 'BASE', internal_rating: 5, tags: ['estructura-madre', 'winner-origin'], linked_ad_id: '120211001' }, 30)
  rec('ScriptLibrary', { script_id: 'SCR-BASE-002', doc_url: 'https://docs.google.com/document/d/example2', title: 'BASE — VSL autoridad 100 años', product: 'Quies Sleep', format: 'VSL', avatar_id: avSensible.id, angle_id: ang4.id, texto_script_cached: 'VSL larga: historia marca → mecanismo único → prueba social → garantía.', status: 'BASE', internal_rating: 4, tags: ['vsl', 'authority'], linked_ad_id: '120211003' }, 28)
  rec('ScriptLibrary', { script_id: 'SCR-ITER-003', doc_url: 'https://docs.google.com/document/d/example3', title: 'ITER — POV viaje v2', product: 'Quies Travel', format: 'POV', avatar_id: avViajero.id, angle_id: ang3.id, texto_script_cached: 'Iteración POV con hook bebé fila 12.', status: 'ITERATION', internal_rating: 3, tags: ['pov', 'travel'], linked_ad_id: '120211005' }, 20)
  rec('ScriptLibrary', { script_id: 'SCR-ARCH-004', doc_url: 'https://docs.google.com/document/d/example4', title: 'ARCH — Humor DJ (fatigado)', product: 'Quies Focus', format: 'UGC', avatar_id: avEstudiante.id, angle_id: ang5.id, texto_script_cached: 'Humor compañero DJ. Quemado tras 3 iteraciones.', status: 'ARCHIVED', internal_rating: 2, tags: ['humor'], linked_ad_id: '120211008' }, 15)

  // ---- Inspiration ----
  rec('InspirationAds', { title: 'Loop Earplugs — "Sound, your way"', brand: 'Loop', platform: 'TikTok', drive_link: '', notes: 'Transiciones rápidas + color pop. Hook visual con zoom al producto en 1s.', format: 'UGC', hook_type: 'VISUAL_DEMO', tags: ['color', 'transiciones'], thumbnail_url: 'https://picsum.photos/seed/loop/400/225' }, 12)
  rec('InspirationAds', { title: 'Calm — historia de insomnio', brand: 'Calm', platform: 'Meta', drive_link: '', notes: 'Storytelling lento con voz en off íntima. Funciona para frío.', format: 'VSL', hook_type: 'PERSONAL_STORY', tags: ['storytelling'], thumbnail_url: 'https://picsum.photos/seed/calm/400/225' }, 10)
  rec('InspirationAds', { title: 'Ostrichpillow — POV siesta oficina', brand: 'Ostrichpillow', platform: 'TikTok', drive_link: '', notes: 'Humor absurdo + product demo. Alto share rate.', format: 'POV', hook_type: 'HUMOR', tags: ['humor', 'pov'], thumbnail_url: 'https://picsum.photos/seed/ostrich/400/225' }, 8)
  rec('InspirationAds', { title: 'Eight Sleep — datos de sueño', brand: 'Eight Sleep', platform: 'Meta', drive_link: '', notes: 'Autoridad con métricas y gráficos animados. Premium feel.', format: 'AUTHORITY', hook_type: 'STATISTIC', tags: ['data', 'premium'], thumbnail_url: 'https://picsum.photos/seed/eight/400/225' }, 6)

  // ---- Video Assets ----
  const mkVideo = (data, daysAgo) => rec('VideoAssets', { source: 'UPLOADED', version: 1, processing_status: 'IDLE', has_video_file: false, notes: '', ...data }, daysAgo)
  const va1 = mkVideo({ video_asset_id: 'VID-0001', title: 'UGC Mamá ronquidos v2 — iteración winner', product: 'Quies Sleep', format: 'UGC', status: 'SCRIPT_DRAFT', related_generated_script_id: gs4.id, assigned_editor_user_id: uLaura.id, source: 'TASK' }, 1)
  const va2 = mkVideo({ video_asset_id: 'VID-0002', title: 'POV vuelo nocturno — kit Travel', product: 'Quies Travel', format: 'POV', status: 'TODO', related_generated_script_id: gs3.id, assigned_editor_user_id: uPablo.id, source: 'TASK' }, 3)
  const va3 = mkVideo({ video_asset_id: 'VID-0003', title: 'Demo decibelímetro', product: 'Quies Sleep', format: 'UGC', status: 'IN_PROGRESS', related_generated_script_id: gs7.id, assigned_editor_user_id: uLaura.id, has_video_file: true, video_file_uri: 'https://storage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4', duration_sec: 26 }, 4)
  const va4 = mkVideo({ video_asset_id: 'VID-0004', title: 'Testimonial pareja 30 noches', product: 'Quies Sleep', format: 'TESTIMONIAL', status: 'REVIEW', related_generated_script_id: gs5.id, assigned_editor_user_id: uLaura.id, has_video_file: true, video_file_uri: 'https://storage.googleapis.com/gtv-videos-bucket/sample/BigBuckBunny.mp4', duration_sec: 45 }, 6)
  mkVideo({ video_asset_id: 'VID-0005', title: 'VSL 100 años farmacia — cut A', product: 'Quies Sleep', format: 'VSL', status: 'APPROVED', related_generated_script_id: gs2.id, assigned_editor_user_id: uPablo.id, duration_sec: 90 }, 8)
  mkVideo({ video_asset_id: 'VID-0006', title: 'UGC pregunta ronquidos — PUBLICADO', product: 'Quies Sleep', format: 'UGC', status: 'PUBLISHED', related_generated_script_id: gs1.id, assigned_editor_user_id: uLaura.id, meta_video_id: '120211001', source: 'META', duration_sec: 35 }, 12)
  mkVideo({ video_asset_id: 'VID-0007', title: 'Humor DJ — archivado por fatiga', product: 'Quies Focus', format: 'UGC', status: 'ARCHIVED', assigned_editor_user_id: uPablo.id, duration_sec: 24 }, 20)
  mkVideo({ video_asset_id: 'VID-0008', title: 'Focus biblioteca v1', product: 'Quies Focus', format: 'PROBLEM_SOLUTION', status: 'TODO', assigned_editor_user_id: uPablo.id }, 2)
  mkVideo({ video_asset_id: 'VID-0009', title: 'Antes/después energía — borrador', product: 'Quies Sleep', format: 'UGC', status: 'SCRIPT_DRAFT' }, 0)
  mkVideo({ video_asset_id: 'VID-0010', title: 'Authority documental — recut', product: 'Quies Sleep', format: 'AUTHORITY', status: 'IN_PROGRESS', assigned_editor_user_id: uPablo.id }, 5)

  rec('VideoAnnotations', { video_asset_id: va4.id, timestamp_sec: 3, severity: 'BLOCKING', text: 'El hook tarda 4s en aparecer — recortar intro a <2s', author_name: 'Marc Delgado' }, 2)
  rec('VideoAnnotations', { video_asset_id: va4.id, timestamp_sec: 18, severity: 'IMPORTANT', text: 'Subtítulo desincronizado con el audio aquí', author_name: 'Claudia Ruiz' }, 2)
  rec('VideoAnnotations', { video_asset_id: va4.id, timestamp_sec: 40, severity: 'INFO', text: 'Me gusta este plano final, mantener en futuras versiones', author_name: 'Marc Delgado' }, 1)
  rec('VideoAnnotations', { video_asset_id: va3.id, timestamp_sec: 10, severity: 'IMPORTANT', text: 'El número de dB tiene que ser más grande on-screen', author_name: 'Claudia Ruiz' }, 1)

  // ---- Tasks ----
  const mkTask = (d, daysAgo) => rec('Tasks', d, daysAgo)
  mkTask({ title: 'Editar iteración winner ronquidos v2', description: 'Usar estructura del script aprobado. Hook en <2s, subtítulos grandes.', assignee_user_id: uLaura.id, assignee_name: 'Laura Vidal', related_video_asset_id: va1.id, related_generated_script_id: gs4.id, product: 'Quies Sleep', format: 'UGC', priority: 'URGENT', status: 'TODO', due_date: dateStr(-2) }, 1)
  mkTask({ title: 'Montar POV vuelo con material de stock', description: 'Combinar clips POV avión + demo producto grabada el martes.', assignee_user_id: uPablo.id, assignee_name: 'Pablo Soler', related_video_asset_id: va2.id, related_generated_script_id: gs3.id, product: 'Quies Travel', format: 'POV', priority: 'HIGH', status: 'IN_PROGRESS', due_date: dateStr(-3) }, 3)
  mkTask({ title: 'Corregir anotaciones testimonial pareja', description: '3 anotaciones pendientes, 1 BLOCKING en el hook.', assignee_user_id: uLaura.id, assignee_name: 'Laura Vidal', related_video_asset_id: va4.id, related_generated_script_id: gs5.id, product: 'Quies Sleep', format: 'TESTIMONIAL', priority: 'HIGH', status: 'REVIEW', due_date: dateStr(-1) }, 4)
  mkTask({ title: 'Exportar VSL 100 años en 3 ratios', description: '9:16, 1:1 y 4:5 para placements distintos.', assignee_user_id: uPablo.id, assignee_name: 'Pablo Soler', product: 'Quies Sleep', format: 'VSL', priority: 'MEDIUM', status: 'DONE', due_date: dateStr(2) }, 8)
  mkTask({ title: 'Buscar 10 clips b-roll dormitorio', description: 'Stock o grabación propia. Luz cálida, estética cozy.', assignee_user_id: uLaura.id, assignee_name: 'Laura Vidal', product: 'Quies Sleep', format: 'UGC', priority: 'LOW', status: 'TODO', due_date: dateStr(-7) }, 2)
  mkTask({ title: 'Revisar música licencias TikTok', description: 'Bloqueado: esperando acceso a la cuenta de Artlist.', assignee_user_id: uPablo.id, assignee_name: 'Pablo Soler', product: 'Quies Focus', format: 'UGC', priority: 'MEDIUM', status: 'BLOCKED', due_date: dateStr(-5) }, 6)

  // ---- Editor Queue ----
  rec('EditorQueue', { script_title: 'UGC Mamá ronquidos v2 (iteración winner)', product: 'Quies Sleep', format: 'UGC', priority: 'URGENT', status: 'TODO', generated_script_id: gs4.id, video_asset_id: va1.id, brief_for_editor: 'Iteración del mejor ad de la cuenta (ROAS 3.9). Mantener estructura, cambiar solo hook. Subtítulos estilo CapCut, hook en pantalla <2s.', assigned_editor_user_id: uLaura.id, due_date: dateStr(-2) }, 1)
  rec('EditorQueue', { script_title: 'POV vuelo nocturno — kit Travel', product: 'Quies Travel', format: 'POV', priority: 'HIGH', status: 'IN_PROGRESS', generated_script_id: gs3.id, video_asset_id: va2.id, brief_for_editor: 'POV inmersivo. Sonido ambiente avión primeros 2s, luego corte a silencio al ponerse tapones (contraste sonoro = el hook).', assigned_editor_user_id: uPablo.id, due_date: dateStr(-3) }, 3)
  rec('EditorQueue', { script_title: 'Demo decibelímetro', product: 'Quies Sleep', format: 'UGC', priority: 'MEDIUM', status: 'IN_PROGRESS', generated_script_id: gs7.id, video_asset_id: va3.id, brief_for_editor: 'El número de dB es el protagonista: grande, animado, cambia de rojo a verde.', assigned_editor_user_id: uLaura.id, due_date: dateStr(-4) }, 4)
  rec('EditorQueue', { script_title: 'Testimonial pareja 30 noches', product: 'Quies Sleep', format: 'TESTIMONIAL', priority: 'HIGH', status: 'REVIEW', generated_script_id: gs5.id, video_asset_id: va4.id, brief_for_editor: 'Tono íntimo, sin música épica. Corregir anotaciones del review.', assigned_editor_user_id: uLaura.id, due_date: dateStr(-1) }, 5)
  rec('EditorQueue', { script_title: 'VSL 100 años farmacia', product: 'Quies Sleep', format: 'VSL', priority: 'MEDIUM', status: 'DONE', generated_script_id: gs2.id, brief_for_editor: 'Archivo histórico b/n + transiciones suaves. Voz en off grave.', assigned_editor_user_id: uPablo.id, due_date: dateStr(4) }, 9)
  rec('EditorQueue', { script_title: 'Focus biblioteca split-screen', product: 'Quies Focus', format: 'PROBLEM_SOLUTION', priority: 'LOW', status: 'TODO', brief_for_editor: 'Split-screen con/sin tapones estudiando. Timer on-screen.', due_date: dateStr(-8) }, 2)

  // ---- Sync Runs ----
  rec('SyncRuns', { run_type: 'META_SYNC', status: 'SUCCESS', detail: '12 ads · 168 filas diarias · ventana 7d', duration_ms: 8400 }, 0)
  rec('SyncRuns', { run_type: 'GENERATE_SCRIPTS', status: 'SUCCESS', detail: '3 scripts UGC Quies Sleep', duration_ms: 21000 }, 1)
  rec('SyncRuns', { run_type: 'META_SYNC', status: 'SUCCESS', detail: '12 ads · ventana 7d', duration_ms: 7900 }, 1)
  rec('SyncRuns', { run_type: 'DRIVE_SYNC', status: 'ERROR', detail: 'Folder ID no accesible (permisos)', duration_ms: 3100 }, 2)
  rec('SyncRuns', { run_type: 'META_SYNC', status: 'SUCCESS', detail: '11 ads · ventana 7d', duration_ms: 8100 }, 3)

  // ---- Settings ----
  rec('Settings', {
    singleton: 'main',
    meta_ad_account_id: 'act_1234567890', meta_access_token: '', meta_api_version: 'v21.0',
    claude_api_key: '', openai_api_key: '', perplexity_api_key: '', gemini_api_key: '',
    daily_script_limit: 10, language_default: 'es', generation_frequency: 'DAILY', run_time_local: '07:30',
    metric_thresholds_manual: { roas_winner: 2.5, roas_regular: 1.5, min_spend: 50, hook_rate_good: 25, hold_rate_good: 12, cpa_max: 15 },
    margin_config: { cogs_pct: 16, fees_pct: 6, scale_mult: 1.4 },
    scoring_mode: 'MANUAL',
    banned_claims: ['cura el insomnio', 'resultados garantizados', 'aprobado por médicos'],
    brand_voice_rules: 'Cercano y honesto. Nunca prometer curas. Hablar de "atenuar", no "eliminar" el ruido. Humor permitido en UGC, nunca en Authority.',
    product_rules: { 'Quies Sleep': 'Mencionar siempre cera natural y 27dB', 'Quies Travel': 'Enfatizar tamaño/portabilidad', 'Quies Focus': 'Coste por día como ancla de precio' },
    discord_webhook_scripts: '', discord_webhook_alerts: '', discord_webhook_tasks: '', discord_notifications_enabled: false,
    daily_summary_enabled: true, delivery_posts_enabled: false,
    drive_folder_script_library: '', drive_folder_generated: '',
    ai_router_config: {
      script_generation: 'claude-fable-5', ad_analysis: 'claude-sonnet-4-6', market_research: 'claude-opus-4-8',
      pdf_extraction: 'claude-haiku-4-5', pattern_mining: 'claude-sonnet-4-6', brief_writing: 'claude-haiku-4-5',
    },
  }, 50)

  // ---- AdScriptMapping ----
  rec('AdScriptMapping', { ad_id: '120211001', ad_name: adDefs[0].name, script_id: gs1.id, script_type: 'GENERATED', match_method: 'MANUAL', confidence: 1 }, 10)
  rec('AdScriptMapping', { ad_id: '120211003', ad_name: adDefs[2].name, script_id: gs2.id, script_type: 'GENERATED', match_method: 'NAME_TOKEN', confidence: 0.9 }, 9)
  rec('AdScriptMapping', { ad_id: '120211005', ad_name: adDefs[4].name, script_id: gs3.id, script_type: 'GENERATED', match_method: 'NAME_TOKEN', confidence: 0.85 }, 8)
  rec('AdScriptMapping', { ad_id: '120211004', ad_name: adDefs[3].name, script_id: gs5.id, script_type: 'GENERATED', match_method: 'MANUAL', confidence: 1 }, 8)
  rec('AdScriptMapping', { ad_id: '120211008', ad_name: adDefs[7].name, script_id: gs8.id, script_type: 'GENERATED', match_method: 'AI_FUZZY', confidence: 0.7 }, 7)
  rec('AdScriptMapping', { ad_id: '120211002', ad_name: adDefs[1].name, script_id: sl1.id, script_type: 'LIBRARY', match_method: 'MANUAL', confidence: 1 }, 12)

  // ---- Pattern Findings ----
  rec('PatternFindings', { title: 'Hooks de pregunta directa dominan en UGC', insight: 'Los hooks QUESTION en formato UGC tienen hook rate medio 33% vs 21% del resto. El patrón "¿Tu X también...?" genera identificación inmediata.', dimension: 'hook_type', confidence: 'HIGH', supporting_ads: ['120211001', '120211002'], recommendation: 'Generar 3 variantes más de hooks pregunta para Quies Sleep con avatar Mamá.' }, 2)
  rec('PatternFindings', { title: 'Fatiga acelerada en VSL tras 10 días', insight: 'Las VSL pierden 40%+ de CTR tras 10 días con frecuencia >3. Las UGC aguantan 20+ días.', dimension: 'format', confidence: 'MEDIUM', supporting_ads: ['120211003', '120211007'], recommendation: 'Planificar refresh de VSL cada 8-10 días; duplicar con hooks nuevos antes del día 10.' }, 3)
  rec('PatternFindings', { title: 'Avatar "Mamá cansada" = mejor ROAS de la cuenta', insight: 'Los 4 ads con avatar Mamá promedian ROAS 2.9 (agregado, no media de medias) vs 1.4 del resto. El ángulo pareja-ronquidos es el motor.', dimension: 'avatar', confidence: 'HIGH', supporting_ads: ['120211001', '120211002', '120211004'], recommendation: 'Asignar 60% del presupuesto de testing a este avatar el próximo sprint.' }, 1)

  // ---- Script Modules ----
  rec('ScriptModules', { module_type: 'HOOK', name: 'Pregunta identificativa', content: '¿Tu {pareja/compañero} también {problema} como {comparación absurda}?', best_for: ['UGC'], performance_note: 'Hook rate 33% medio' }, 20)
  rec('ScriptModules', { module_type: 'HOOK', name: 'Contradicción frontal', content: 'No {consejo común}. En serio, no funciona.', best_for: ['UGC', 'PROBLEM_SOLUTION'], performance_note: 'Alto retention 50%' }, 18)
  rec('ScriptModules', { module_type: 'PROOF', name: 'Demo decibelios', content: 'Mostrar app dB: {antes}dB → {después}dB con producto puesto', best_for: ['UGC', 'PROBLEM_SOLUTION'], performance_note: 'Sube CVR post-click' }, 16)
  rec('ScriptModules', { module_type: 'OBJECTION', name: 'Despertador audible', content: 'Y ojo — el despertador SÍ lo oigo. Atenúa, no aísla.', best_for: ['UGC', 'TESTIMONIAL'], performance_note: 'Mata objeción #1 madres' }, 14)
  rec('ScriptModules', { module_type: 'CTA', name: 'Oferta + garantía', content: '{descuento} esta semana + 30 noches de prueba. Link abajo.', best_for: ['UGC', 'VSL'], performance_note: 'CTR out estable' }, 12)
  rec('ScriptModules', { module_type: 'OFFER', name: 'Ancla coste/noche', content: 'Menos de 0,15€ por noche de sueño real.', best_for: ['PROBLEM_SOLUTION', 'VSL'], performance_note: 'Para precio-sensibles' }, 10)

  // ---- Page Guides ----
  rec('PageGuides', { pageName: 'VideoOps', title: 'Cómo funciona el pipeline de video', content: 'Cada tarjeta es un video. Arrástralas entre columnas según avance la producción. Click para ver script, detalles y anotaciones. Las anotaciones BLOCKING impiden aprobar.', video_url: '', is_active: true }, 30)
  rec('PageGuides', { pageName: 'ScriptBuilder', title: 'Generación de scripts con IA', content: 'Configura producto + avatar + ángulo + deseo y genera variantes. El primer elemento de cada multi-select es el principal. Usa "Crear Tarea en VideoOps" para mandar a producción.', video_url: '', is_active: true }, 30)
  rec('PageGuides', { pageName: 'AdsPerformance', title: 'Lectura de labels', content: 'WINNER/REGULAR/LOSER se calculan con spend ≥50€ y thresholds de Settings. Ratios agregados correctamente (suma/suma), nunca media de medias — evita el Breakdown Effect.', video_url: '', is_active: true }, 25)

  // ---- Bonus ----
  const br1 = rec('BonusRules', { name: 'Bonus por Winner', rule_type: 'PER_WINNER', amount_eur: 50, condition: 'Ad editado alcanza WINNER (ROAS ≥2.5 con spend ≥50€) en ventana 7d', is_active: true }, 40)
  rec('BonusRules', { name: 'Bonus ROAS de cartera', rule_type: 'PORTFOLIO_ROAS', amount_eur: 150, condition: 'ROAS agregado de los ads del editor ≥2.0 en el período', is_active: true }, 40)
  rec('BonusPeriods', { period_name: 'Mayo 2026', start_date: '2026-05-01', end_date: '2026-05-31', status: 'CLOSED', total_paid_eur: 250 }, 11)
  const bp2 = rec('BonusPeriods', { period_name: 'Junio 2026', start_date: '2026-06-01', end_date: '2026-06-30', status: 'OPEN', total_paid_eur: 0 }, 10)
  rec('BonusLedger', { period_id: bp2.id, editor_user_id: uLaura.id, editor_name: 'Laura Vidal', rule_id: br1.id, rule_name: 'Bonus por Winner', amount_eur: 50, status: 'PENDING', detail: 'VID-0006 → ad 120211001 WINNER (ROAS 3.9)' }, 2)
  rec('BonusLedger', { period_id: bp2.id, editor_user_id: uLaura.id, editor_name: 'Laura Vidal', rule_id: br1.id, rule_name: 'Bonus por Winner', amount_eur: 50, status: 'APPROVED', detail: 'Ad 120211002 WINNER (ROAS 3.2)' }, 5)
  rec('BonusLedger', { period_id: bp2.id, editor_user_id: uPablo.id, editor_name: 'Pablo Soler', rule_id: br1.id, rule_name: 'Bonus por Winner', amount_eur: 50, status: 'PAID', detail: 'Ad 120211003 WINNER (ROAS 2.8)' }, 8)

  // ---- Notifications ----
  rec('NotificationsLog', { type: 'TASK_ASSIGNED', target_user_id: uLaura.id, title: 'Nueva tarea: Editar iteración winner ronquidos v2', body: 'Prioridad URGENT · due 13 jun', read: false }, 1)
  rec('NotificationsLog', { type: 'VIDEO_NOTE', target_user_id: uLaura.id, title: 'Anotación BLOCKING en Testimonial pareja', body: 'Marc: "El hook tarda 4s en aparecer"', read: false }, 2)
  rec('NotificationsLog', { type: 'SCRIPT_ASSIGNED', target_user_id: uPablo.id, title: 'Script asignado: POV vuelo nocturno', body: 'Formato POV · Quies Travel', read: true }, 3)

  // ---- Market Research Runs ----
  rec('MarketResearchRuns', { run_type: 'REDDIT', query: 'r/sleep + r/insomnia — quejas sobre tapones', status: 'SUCCESS', logs: ['Scrapeados 240 posts', 'Detectados 18 pain points', '4 objeciones nuevas candidatas'], findings_summary: 'Pain dominante: tapones de espuma que se caen de noche (34 menciones). Oportunidad de ángulo: "se quedan puestos toda la noche".', elements_created: 2 }, 4)

  // ---- Training ----
  rec('TrainingResources', { title: 'Anatomía de un hook que retiene', category: 'HOOKS', content_url: '', description: 'Los 3 primeros segundos: patrón interrupt, especificidad y contraste sonoro.', duration_min: 12, required_for: ['EDITOR'] }, 15)
  rec('TrainingResources', { title: 'Subtítulos estilo CapCut en Premiere', category: 'EDITING', content_url: '', description: 'Workflow de subtitulado rápido con presets del equipo.', duration_min: 18, required_for: ['EDITOR'] }, 14)
  rec('TrainingResources', { title: 'Cómo leer el dashboard de ads sin ahogarse', category: 'DATA', content_url: '', description: 'ROAS, hook rate, hold rate y por qué no debes mirar el CTR a secas.', duration_min: 15, required_for: ['EDITOR', 'MANAGER'] }, 13)

  return db
}

// Builds AdsPerformanceAgg LAST_7D from the daily rows already in db.
function buildAggIntoDB(db, rec) {
  const daily = db['AdsPerformanceDaily'] || []
  const cutoff = dateStr(6)
  const last7 = daily.filter((r) => r.date >= cutoff)
  const byAd = {}
  for (const r of last7) {
    const a = (byAd[r.ad_id] = byAd[r.ad_id] || { ad_id: r.ad_id, ad_name: r.ad_name, spend: 0, conversion_value: 0, impressions: 0, link_clicks: 0, conversions: 0, video_plays: 0, video_3s: 0, thruplay: 0 })
    a.spend += r.spend; a.conversion_value += r.conversion_value; a.impressions += r.impressions
    a.link_clicks += r.link_clicks; a.conversions += r.conversions
    a.video_plays += r.video_plays; a.video_3s += r.video_3s; a.thruplay += r.thruplay
  }
  for (const a of Object.values(byAd)) {
    const roas = a.spend > 0 ? a.conversion_value / a.spend : 0
    let label = 'UNSCORED', action = null
    if (a.spend >= 50) {
      if (roas >= 2.5) { label = 'WINNER'; action = 'SCALE' }
      else if (roas >= 1.5) { label = 'REGULAR'; action = 'ITERATE' }
      else { label = 'LOSER'; action = 'KILL' }
    }
    rec('AdsPerformanceAgg', {
      window: 'LAST_7D', ad_id: a.ad_id, ad_name: a.ad_name,
      spend: +a.spend.toFixed(2), conversion_value: +a.conversion_value.toFixed(2), roas: +roas.toFixed(2),
      impressions: a.impressions, link_clicks: a.link_clicks, conversions: a.conversions,
      ctr: a.impressions ? +((a.link_clicks / a.impressions) * 100).toFixed(2) : 0,
      hook_rate: a.video_plays ? +((a.video_3s / a.video_plays) * 100).toFixed(1) : 0,
      hold_rate: a.video_3s ? +((a.thruplay / a.video_3s) * 100).toFixed(1) : 0,
      label, action, fatigue_flag: ['120211003', '120211007'].includes(a.ad_id),
      fatigue_reasons: ['120211003', '120211007'].includes(a.ad_id) ? ['CTR -38% vs primera mitad', 'Frecuencia 3.8 (>3.2)'] : [],
    }, 0)
  }
}
