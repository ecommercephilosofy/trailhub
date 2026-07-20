// Briefs del lunes (vídeo + imagen) → asignación a editor → tarjeta kanban.
// El código QB de cada brief cierra el loop: cuando el ad lanzado (con el QB en
// el nombre) aparece en ads_weekly, la tarjeta muestra su ROAS real.
import { useEffect, useMemo, useState } from 'react'
import { useAuth } from '@/context/AuthContext'
import { supabase } from '@/api/supabaseClient'
import { useEntityList } from '@/hooks/useData'
import { Briefs as BriefsE, Cards, Profiles, AdsWeekly, AdThumbs, Notifications, EditorWeekly } from '@/api/entities'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState, ErrorState } from '@/components/shared/misc'
import { StatusBadge, UserAvatar } from '@/components/shared/badges'
import { FileText, Video, Image as ImageIcon, Copy, Check, Trophy, Lightbulb } from 'lucide-react'
import { fmtRoas } from '@/lib/format'
import { normRow, SCRIPT_COLS } from '@/lib/briefScript'
import { cn } from '@/lib/utils'
import { toast } from 'sonner'
import { useBrand } from '@/context/BrandContext'

// Análisis de ESTRATEGIA CREATIVA semanal (editor-safe: ROAS sí, dinero jamás).
// Lo publica el pipeline cada lunes en editor_weekly.
function WeeklyCreativeAnalysis() {
  const { data } = useEntityList(EditorWeekly, { sort: '-week_date', limit: 1 })
  const w = data?.[0]
  if (!w) return null
  const s = w.structures || {}
  const f = w.framings || {}
  return (
    <Card className="border-indigo-100 bg-indigo-50/30">
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Lightbulb className="h-4 w-4 text-indigo-500" /> Análisis creativo de la semana ({w.week_date})
        </CardTitle>
      </CardHeader>
      <CardContent className="grid gap-4 lg:grid-cols-2 text-sm">
        <div className="space-y-3">
          {w.winners?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase mb-1.5">Qué está ganando</p>
              {w.winners.map((win, i) => (
                <div key={i} className="mb-2">
                  <p className="font-medium text-slate-800 flex items-center gap-2">
                    <Trophy className="h-3.5 w-3.5 text-amber-500 shrink-0" /> {win.name}
                    {win.roas != null && <span className="text-emerald-600 font-semibold">ROAS {fmtRoas(win.roas)}</span>}
                  </p>
                  {win.why && <p className="text-xs text-slate-500 ml-5">{win.why}</p>}
                </div>
              ))}
            </div>
          )}
          {w.ad_model_video && <p><b>🎬 Modelo a seguir (vídeo):</b> {w.ad_model_video}</p>}
          {w.ad_model_image && <p><b>🖼 Modelo a seguir (imagen):</b> {w.ad_model_image}</p>}
        </div>
        <div className="space-y-3">
          {w.angles?.length > 0 && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase mb-1.5">Ángulos a atacar</p>
              <ul className="space-y-1">{w.angles.map((a, i) =>
                <li key={i} className="flex gap-2 text-slate-700"><span className="text-indigo-500">→</span>{a}</li>)}</ul>
            </div>
          )}
          {(s.winning_structures?.length || s.untapped?.length) ? (
            <p className="text-xs text-slate-600">
              <b>Estructuras:</b> ganan {s.winning_structures?.join(', ') || '—'}
              {s.untapped?.length ? <> · sin explotar: <span className="text-indigo-700">{s.untapped.join(', ')}</span></> : null}
            </p>
          ) : null}
          {(f.winning?.length || f.untapped?.length) ? (
            <p className="text-xs text-slate-600">
              <b>Framings:</b> ganan {f.winning?.join(', ') || '—'}
              {f.untapped?.length ? <> · sin explotar: <span className="text-indigo-700">{f.untapped.join(', ')}</span></> : null}
            </p>
          ) : null}
        </div>
      </CardContent>
    </Card>
  )
}

function CopyButton({ text, label = 'Copiar prompt' }) {
  const [ok, setOk] = useState(false)
  return (
    <Button variant="outline" size="sm" onClick={async () => {
      await navigator.clipboard.writeText(text)
      setOk(true); setTimeout(() => setOk(false), 1500)
    }}>
      {ok ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />} {ok ? 'Copiado' : label}
    </Button>
  )
}

function AssignControl({ brief, card, editors, onAssigned }) {
  const [editorId, setEditorId] = useState('')
  const assign = async () => {
    if (!editorId) return
    try {
      if (card) {
        await Cards.update(card.id, { assigned_editor: editorId })
      } else {
        await Cards.create({
          brief_tracking_code: brief.tracking_code,
          title: brief.title || brief.tracking_code,
          status: 'TODO',
          assigned_editor: editorId,
        })
      }
      await Notifications.create({
        target_user_id: editorId, type: 'BRIEF_ASSIGNED',
        title: 'Brief asignado', body: brief.title || brief.tracking_code,
      })
      toast.success('Brief asignado — tarjeta creada en Video Ops')
      onAssigned?.()
    } catch (e) {
      toast.error(`No se pudo asignar: ${e.message}`)
    }
  }
  return (
    <div className="flex items-center gap-2">
      <Select value={editorId} onValueChange={setEditorId}>
        <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue placeholder="Elegir editor…" /></SelectTrigger>
        <SelectContent>
          {editors.map((e) => <SelectItem key={e.user_id} value={e.user_id}>{e.name || e.user_id.slice(0, 8)}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button size="sm" onClick={assign} disabled={!editorId}>{card ? 'Reasignar' : 'Asignar'}</Button>
    </div>
  )
}

// Título legible: Claude a veces no rellena `title` → derivamos del contenido
// en vez de mostrar "sin título".
function briefTitle(b) {
  const t = b.title
  if (t && !/sin t[ií]tulo/i.test(t)) return t
  const p = b.payload || {}
  const derived = p.structure || p.framing || (p.hypothesis || '').split('.')[0]
  return derived ? derived.slice(0, 70) : b.tracking_code
}

const FUNNEL_BADGE = {
  TOF: 'bg-sky-100 text-sky-800 border-sky-200',
  MOF: 'bg-amber-100 text-amber-800 border-amber-200',
  BOF: 'bg-emerald-100 text-emerald-800 border-emerald-200',
}
const FORMAT_LABEL = {
  vsl: 'VSL largo', ai_animation: 'AI animation', podcast: 'Podcast/pareja',
  long_form_native_static: 'Long-form static', yapper: 'Yapper (persona a cámara)',
  native_ugc: 'UGC nativo', creator_unboxing: 'Creator unboxing',
  creator_grwm: 'Creator GRWM', creator_testimonial: 'Testimonial creator',
  side_by_side: 'Side-by-side', offer_static: 'Offer static',
  fomo_static: 'FOMO static', product_demo_short: 'Demo corta',
}

function FunnelChips({ p }) {
  if (!p.funnel_stage && !p.format_family && !p.covers_gap) return null
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {p.funnel_stage && (
        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-bold',
          FUNNEL_BADGE[p.funnel_stage] || 'bg-slate-100 text-slate-600')}>
          {p.funnel_stage}
        </span>
      )}
      {p.format_family && (
        <span className="rounded-full bg-slate-100 border border-slate-200 px-2 py-0.5 text-[10px] text-slate-700">
          {FORMAT_LABEL[p.format_family] || p.format_family}
        </span>
      )}
      {p.covers_gap && p.covers_gap !== 'null' && (
        <span className="rounded-full bg-indigo-100 border border-indigo-200 px-2 py-0.5 text-[10px] font-bold text-indigo-800">
          🎯 cubre hueco {p.covers_gap}
        </span>
      )}
    </div>
  )
}

// Guión como en el PDF: tabla de columnas VO/CLIP/SFX/TRANS/ZOOM (normalización
// de claves en lib/briefScript.js — con tests).
function ScriptTable({ rows, nameCol }) {
  const norm = (rows || []).map(normRow)
  if (!norm.length) return null
  const cols = SCRIPT_COLS.filter(([k]) => norm.some((r) => r[k]))
  if (!cols.length) return null
  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200">
      <table className="w-full text-xs">
        <thead>
          <tr className="bg-teal-700 text-white">
            {nameCol && <th className="px-2 py-1.5 text-left font-semibold w-28">BEAT</th>}
            {cols.map(([k, lbl]) => (
              <th key={k} className={cn('px-2 py-1.5 text-left font-semibold',
                k === 'vo' && 'w-[30%]', k === 'clip' && 'w-[30%]')}>■ {lbl}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {norm.map((r, i) => (
            <tr key={i} className={i % 2 ? 'bg-slate-50 dark:bg-slate-800/40' : ''}>
              {nameCol && <td className="px-2 py-2 align-top font-semibold text-slate-600 border-t border-slate-100">{nameCol(rows[i], i)}</td>}
              {cols.map(([k]) => (
                <td key={k} className={cn('px-2 py-2 align-top border-t border-slate-100',
                  k === 'vo' ? 'text-slate-800 font-medium' : 'text-slate-500')}>
                  {r[k] || <span className="text-slate-300">[—]</span>}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Banner({ text }) {
  if (!text) return null
  return (
    <p className="rounded bg-teal-50 dark:bg-teal-900/30 border border-teal-100 dark:border-teal-800 px-3 py-2 text-center text-[13px] font-semibold text-teal-800 dark:text-teal-200">
      BANNER EN PANTALLA: {text}
    </p>
  )
}

const SCRIPT_LEGEND = 'VO = palabras exactas del voiceover · CLIP = descripción visual para el editor · SFX = efecto de sonido · TRANS = transición · ZOOM = movimiento de cámara · [—] = no aplica'

function VideoBriefDetail({ p, thumbByCode = {} }) {
  const { brand } = useBrand()
  // Paridad con el PDF (build_pdf.render_brief): mismos bloques, mismo orden.
  // 3 schemas de guión conocidos: hooks/sections (rows), script_beats, script (VO/CLIP/SFX).
  const qb = p.tracking_code || p.qb_code
  const seed = p.source_ad || p.based_on_ad || p.based_on?.reference
  const libId = p.based_on?.library_id || p.based_on_id
  const cat = p.category === 'own_variation' ? '🔁 Variación Own Ad' : p.category === 'new_idea' ? '✨ Nueva Idea' : null
  const awareness = p.schwartz_awareness || p.schwartz || p.awareness_stage
  const season = p.seasonal_timing && !['null', 'none'].includes(String(p.seasonal_timing).toLowerCase()) ? p.seasonal_timing : null
  const bd = p.breakthrough_diagnosis || {}
  const asd = p.audience_segment_data || {}
  const vo = p.voice_of_customer_sources || []
  const beats = p.script_beats?.length ? p.script_beats : (p.script || [])
  const wordBudget = p.word_budget || p.word_budget_vo

  return (
    <div className="space-y-4 text-sm">
      {/* Código QB: el feedback loop entero depende de que el editor lo use */}
      {qb && (
        <div className="rounded-lg bg-indigo-50 border border-indigo-200 px-3 py-2">
          <div className="flex items-center gap-2">
            <code className="font-bold text-indigo-800">{qb}</code>
            <CopyButton text={qb} label="Copiar" />
          </div>
          <p className="text-[11px] text-indigo-700 mt-1">
            🏷 Inclúyelo en el nombre del ad al lanzar (ej: «{brand.adCodeExample} {qb}») — así el sistema mide este brief la semana siguiente.
          </p>
        </div>
      )}

      <FunnelChips p={p} />
      {(cat || seed) && (
        <p className="text-xs">
          {cat && <b>{cat} · </b>}
          {seed && <>Semilla: <b>{seed}</b></>}
          {libId && <> · <a className="text-indigo-600 underline" href={`https://www.facebook.com/ads/library/?id=${libId}`} target="_blank" rel="noreferrer">ver ad original</a></>}
        </p>
      )}
      {season && <p className="text-xs">🗓 <b>Timing estacional:</b> {season}</p>}
      {(() => {
        const code = (String(seed || '').match(AD_CODE_RE) || [])[0]
        return code && thumbByCode[code] ? <SeedThumb path={thumbByCode[code]} label={code} /> : null
      })()}

      {(p.audience || p.target_geo) && <p><b>Audiencia:</b> {p.audience || p.target_geo}{p.campaign_context ? ` · ${p.campaign_context}` : ''}</p>}
      <p className="text-xs text-slate-600">
        {awareness && <><b>Awareness:</b> {awareness} · </>}
        {p.sophistication_stage && <><b>Sophistication:</b> stage {p.sophistication_stage} · </>}
        {p.structure && <><b>Estructura:</b> {p.structure} · </>}
        {p.framing && <><b>Framing:</b> {p.framing} · </>}
        {p.mass_desire && <><b>Mass desire:</b> {p.mass_desire}</>}
      </p>
      {p.spokesperson && <p><b>🎭 Spokesperson:</b> {p.spokesperson}</p>}
      {p.iteration_axis && !['null', 'none'].includes(String(p.iteration_axis).toLowerCase()) &&
        <p className="text-xs text-slate-600">🔀 <b>Eje de iteración:</b> {p.iteration_axis}</p>}
      {p.hypothesis && <p className="text-xs text-slate-600">🔬 <b>Hipótesis (la mide el código QB):</b> {p.hypothesis}</p>}

      {/* Diagnóstico Breakthrough Advertising */}
      {Object.keys(bd).length > 0 && (
        <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 text-xs space-y-1">
          <p className="font-bold text-slate-700">📚 Breakthrough Advertising — diagnóstico</p>
          {bd.mass_desire_channeled && <p><b>Mass desire:</b> {bd.mass_desire_channeled}</p>}
          {bd.performance_or_identification && <p><b>Performance vs Identification:</b> {bd.performance_or_identification}</p>}
          {bd.mechanism_specificity && <p><b>Mecanismo:</b> {bd.mechanism_specificity}</p>}
          {bd.future_self_lever && <p><b>🧠 Palanca Yo-Futuro:</b> {bd.future_self_lever}{bd.future_self_rationale ? ` — ${bd.future_self_rationale}` : ''}</p>}
          {bd.why_this_wins && <p><b>Why this wins:</b> {bd.why_this_wins}</p>}
        </div>
      )}

      {/* Segmento target con data real */}
      {Object.keys(asd).length > 0 && (
        <p className="text-xs text-slate-600">
          🎯 <b>Segmento:</b> {asd.geo || '?'}/{asd.campaign_type || '?'} · ROAS segmento: {asd.current_roas_in_segment ?? '?'}
          {asd.sample_winners_in_segment?.length ? ` · Winners ref: ${asd.sample_winners_in_segment.join(', ')}` : ''}
        </p>
      )}

      {/* Voice of customer */}
      {vo.length > 0 && (
        <div className="text-xs space-y-1">
          <p className="font-bold text-slate-600">🗣 Voice of customer</p>
          {vo.slice(0, 5).map((v, i) => (
            <p key={i} className="text-slate-600">• <i>«{v.quote}»</i> <span className="text-slate-400">— {v.source}</span></p>
          ))}
        </div>
      )}

      {/* Guión — como en el PDF: hooks 1A/1B/1C con banner + tablas VO/CLIP/SFX/TRANS/ZOOM */}
      {(p.hooks?.length || p.sections?.length || beats.length) ? (
        <p className="text-[10px] text-slate-400">{SCRIPT_LEGEND}</p>
      ) : null}
      {(p.hooks || []).map((h, i) => (
        <div key={`h${i}`} className="space-y-1.5">
          <p className="font-bold text-red-600 text-sm">
            {h.label || `HOOK ${i + 1}`}
            {h.subtitle && <span className="ml-2 text-slate-400 font-normal text-xs">{h.subtitle}</span>}
            {h.source && <span className="ml-2 text-indigo-400 font-normal text-[10px]">🗣 {h.source}</span>}
          </p>
          <Banner text={h.banner} />
          <ScriptTable rows={h.rows} />
        </div>
      ))}
      {(p.sections || []).map((s, i) => (
        <div key={`s${i}`} className="space-y-1.5">
          <p className="font-bold text-xs bg-slate-900 dark:bg-slate-700 text-white rounded px-2.5 py-1.5 uppercase">■ {s.title || s.name}</p>
          <Banner text={s.banner} />
          <ScriptTable rows={s.rows} />
        </div>
      ))}

      {/* Fallback runs viejos: script/script_beats → misma tabla, con columna BEAT */}
      {!p.hooks?.length && !p.sections?.length && beats.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-bold text-slate-500 uppercase">Guión ({beats.length} beats)</p>
          <ScriptTable rows={beats}
            nameCol={(b, i) => {
              const t = b.timing || (b.dur_s ? `${b.dur_s}s` : '')
              return `${b.name || b.type || `Beat ${b.beat || i + 1}`}${t ? ` · ${t}` : ''}`
            }} />
        </div>
      )}

      {p.visual_direction && (
        <p className="rounded-lg bg-slate-50 border border-slate-100 px-3 py-2 text-xs">
          <b>🎬 Dirección visual:</b> {p.visual_direction}
        </p>
      )}
      {p.device_note && <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-100 rounded px-2 py-1">⚠ {p.device_note}</p>}
      {wordBudget && <p className="text-xs text-slate-400">Presupuesto de palabras: ~{wordBudget} (110 wpm)</p>}
      {Array.isArray(p.do_not) && p.do_not.length > 0 && (
        <div className="rounded-lg bg-red-50 border border-red-100 px-3 py-2">
          <p className="text-xs font-bold text-red-700 mb-1">⛔ NO hacer</p>
          <ul className="text-xs text-red-800 space-y-0.5">{p.do_not.map((d, i) => <li key={i}>• {d}</li>)}</ul>
        </div>
      )}
    </div>
  )
}

function SendToVideoOpsBtn({ brief, card, disabled, onSent }) {
  const { user } = useAuth()
  const { brand } = useBrand()
  const send = async () => {
    try {
      if (card && !card.assigned_editor) {
        await Cards.update(card.id, { assigned_editor: user.id, status: 'TODO' })
      } else if (!card) {
        await Cards.create({
          brief_tracking_code: brief.tracking_code,
          title: brief.title || brief.tracking_code,
          status: 'TODO',
          assigned_editor: user.id,
          format: brief.payload?.format_family || null,
          product: brand.productName,
        })
      } else {
        return toast.info('Ya está en Video Ops')
      }
      toast.success('En Video Ops → TODO — te aparece en "solo mis tarjetas"')
      onSent?.()
    } catch (e) {
      toast.error(`No se pudo: ${e.message}`)
    }
  }
  return (
    <Button size="sm" variant="outline" onClick={send} disabled={disabled}>
      🎬 Enviar a Video Ops
    </Button>
  )
}

// Miniatura del winner de referencia (como el PDF del informe de imagen: se ve
// QUÉ ad se está iterando). path → signed URL del bucket privado `creatives`.
function SeedThumb({ path, label }) {
  const [url, setUrl] = useState(null)
  useEffect(() => {
    if (!path) return
    supabase.storage.from('creatives').createSignedUrl(path, 3600)
      .then(({ data }) => data && setUrl(data.signedUrl))
  }, [path])
  if (!url) return null
  return (
    <div className="flex items-center gap-3">
      <img src={url} alt={label} className="h-20 w-20 rounded-lg object-cover border border-slate-200" />
      <p className="text-[11px] text-slate-400">Winner de referencia<br /><b className="text-slate-600">{label}</b></p>
    </div>
  )
}

const AD_CODE_RE = /[A-Z]{2,5}\d{2,5}(?:-\d{1,3})?/

function ImageBriefDetail({ p, thumbByCode = {} }) {
  const { brand } = useBrand()
  const cat = p.category === 'own_variation' ? '🔁 Variación de winner' : p.category === 'new_idea' ? '✨ Exploratorio' : null
  const seed = p.based_on?.reference || p.source_code
  const season = p.seasonal_timing && !['null', 'none'].includes(String(p.seasonal_timing).toLowerCase()) ? p.seasonal_timing : null
  return (
    <div className="space-y-4 text-sm">
      {(cat || seed || p.format) && (
        <p className="text-xs">
          {cat && <b>{cat} · </b>}
          {seed && <>Source winner: <b>{seed}</b> · </>}
          {p.format && <><b>Formato:</b> {p.format}</>}
        </p>
      )}
      {season && <p className="text-xs">🗓 <b>Timing estacional:</b> {season}</p>}
      {(() => {
        const code = p.source_code || (String(seed || '').match(AD_CODE_RE) || [])[0]
        return code && thumbByCode[code] ? <SeedThumb path={thumbByCode[code]} label={code} /> : null
      })()}
      {p.suggested_ad_name && (
        <div>
          <p className="text-xs text-slate-500 mb-1">Nombre del nuevo ad (úsalo TAL CUAL al lanzar):</p>
          <div className="flex items-center gap-2">
            <code className="bg-slate-900 text-white rounded px-3 py-1.5 text-xs flex-1 overflow-x-auto">{p.suggested_ad_name}</code>
            <CopyButton text={p.suggested_ad_name} label="Copiar" />
          </div>
        </div>
      )}
      {p.dna_preserved && (
        <p className="text-xs text-slate-600">
          <b>🧬 DNA (no tocar):</b> {Object.entries(p.dna_preserved).map(([k, v]) => `${k}: ${v}`).join(' · ')}
        </p>
      )}
      {p.execution_change && <p className="text-xs"><b>🎨 Qué cambia:</b> {p.execution_change}</p>}
      {p.hypothesis && <p className="text-xs text-slate-600">🔬 <b>Hipótesis (la mide el código QB):</b> {p.hypothesis}</p>}
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-bold text-slate-500">PROMPT ({brand.imageTool})</p>
          <CopyButton text={p.prompt_en || ''} />
        </div>
        <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-[11px] whitespace-pre-wrap max-h-72 overflow-y-auto">{p.prompt_en}</pre>
      </div>
      {p.negative_prompt && (
        <div>
          <p className="text-xs font-bold text-slate-500 mb-1">NEGATIVE PROMPT</p>
          <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-[11px] whitespace-pre-wrap max-h-40 overflow-y-auto">{p.negative_prompt}</pre>
        </div>
      )}
      <p className="text-[11px] text-slate-400">📌 Adjuntar SOLO el asset aislado del producto como referencia. NUNCA el ad winner completo.</p>
    </div>
  )
}

export default function Briefs() {
  const { effectiveRole, user } = useAuth()
  const canAssign = ['ADMIN', 'MANAGER'].includes(effectiveRole)
  const { data: briefs, error, refetch } = useEntityList(BriefsE, { sort: '-week_date', limit: 200 })
  const { data: cards } = useEntityList(Cards, { sort: '-created_at', limit: 500 })
  const { data: profiles } = useEntityList(Profiles, { enabled: canAssign })
  // ads_weekly lleva dinero → RLS solo dirección; se pide solo si puede leerla (badges de ROAS)
  const { data: ads } = useEntityList(AdsWeekly, { sort: '-week_date', limit: 1000, enabled: canAssign })
  // vista ad_thumbs (sin dinero): thumbnails del winner de referencia para TODOS los roles
  const { data: thumbs } = useEntityList(AdThumbs, {})
  const [open, setOpen] = useState(null)

  const editors = (profiles || []).filter((p) => ['EDITOR', 'MANAGER', 'ADMIN'].includes(p.custom_role))
  const cardByQb = useMemo(() => Object.fromEntries((cards || [])
    .filter((c) => c.brief_tracking_code).map((c) => [c.brief_tracking_code, c])), [cards])
  // ad_code → thumbnail (bucket creatives) — para enseñar el winner de referencia en el modal
  const thumbByCode = useMemo(() => Object.fromEntries(
    (thumbs || []).filter((t) => t.thumb_path).map((t) => [t.ad_code, t.thumb_path])), [thumbs])
  const roasByQb = useMemo(() => {
    const m = {}
    for (const a of ads || []) if (a.qb_code_detected && m[a.qb_code_detected] === undefined) m[a.qb_code_detected] = a.roas
    return m
  }, [ads])
  const byWeek = useMemo(() => {
    const g = {}
    for (const b of briefs || []) (g[b.week_date] ||= []).push(b)
    return Object.entries(g).sort((a, b) => (a[0] < b[0] ? 1 : -1))
  }, [briefs])

  if (error) return <ErrorState error={error} />
  if (!briefs?.length) {
    return <EmptyState icon={FileText} title="Sin briefs todavía"
      description="Cada lunes el pipeline publica aquí los briefs de la semana (vídeo + imagen)." />
  }

  return (
    <div className="space-y-8">
      <WeeklyCreativeAnalysis />
      {byWeek.map(([week, list]) => (
        <div key={week}>
          <h2 className="text-sm font-bold text-slate-500 uppercase mb-3">Semana {week}</h2>
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {list.map((b) => {
              const card = cardByQb[b.tracking_code]
              const editor = card && editors.find((e) => e.user_id === card.assigned_editor)
              const roas = roasByQb[b.tracking_code]
              return (
                <Card key={b.tracking_code} className="hover:shadow-md transition-shadow">
                  <CardContent className="pt-5 space-y-3">
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="gap-1">
                        {b.kind === 'video' ? <Video className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                        {b.kind}
                      </Badge>
                      <code className="text-[10px] text-slate-400">{b.tracking_code}</code>
                      {roas != null && (
                        <Badge className="ml-auto bg-emerald-100 text-emerald-800 hover:bg-emerald-100">
                          LANZADO · ROAS {fmtRoas(roas)}
                        </Badge>
                      )}
                    </div>
                    <button onClick={() => setOpen(b)} className="text-left">
                      <p className="font-semibold text-slate-900 leading-snug hover:text-indigo-700">{briefTitle(b)}</p>
                    </button>
                    <FunnelChips p={b.payload || {}} />
                    {b.payload?.hypothesis && (
                      <p className="text-xs text-slate-500 line-clamp-2">🔬 {b.payload.hypothesis}</p>
                    )}
                    <div className="flex items-center justify-between gap-2 pt-1 border-t border-slate-100">
                      {card ? (
                        <div className="flex items-center gap-2 text-xs text-slate-600">
                          <StatusBadge status={card.status} />
                          {editor && <><UserAvatar name={editor.name} size="sm" />{editor.name}</>}
                        </div>
                      ) : <span className="text-xs text-slate-400">Sin asignar</span>}
                    </div>
                    {canAssign && <AssignControl brief={b} card={card} editors={editors} onAssigned={refetch} />}
                    {!canAssign && (
                      <SendToVideoOpsBtn brief={b} card={card}
                                         disabled={!!card?.assigned_editor && card.assigned_editor !== user?.id}
                                         onSent={refetch} />
                    )}
                  </CardContent>
                </Card>
              )
            })}
          </div>
        </div>
      ))}

      <Dialog open={!!open} onOpenChange={(v) => !v && setOpen(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{open ? briefTitle(open) : ''}</DialogTitle></DialogHeader>
          {open && (open.kind === 'video'
            ? <VideoBriefDetail p={open.payload || {}} thumbByCode={thumbByCode} />
            : <ImageBriefDetail p={open.payload || {}} thumbByCode={thumbByCode} />)}
        </DialogContent>
      </Dialog>
    </div>
  )
}
