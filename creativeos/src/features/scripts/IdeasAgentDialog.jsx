import { useMemo, useState } from 'react'
import { Ban, Bot, Brain, CheckCircle2, FileEdit, Loader2, RefreshCw, Sparkles, TrendingDown, TrendingUp } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { CreativeLearnings, ScriptIdeas } from '@/api/entities'
import { generateNewIdeas, rebuildLearningsFromMetrics, ideaToScript } from '@/api/creativeAgent'
import { useEntityList } from '@/hooks/useData'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

const VERDICT_CLS = {
  PROVEN: 'bg-emerald-100 text-emerald-700',
  PROMISING: 'bg-sky-100 text-sky-700',
  INCONCLUSIVE: 'bg-slate-100 text-slate-500',
  FAILED: 'bg-red-100 text-red-700',
  FATIGUED: 'bg-amber-100 text-amber-700',
}

function LearningChip({ l }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className={`inline-flex cursor-help items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${VERDICT_CLS[l.verdict]}`}>
          {l.verdict === 'PROVEN' ? <TrendingUp className="h-3 w-3" /> : l.verdict === 'FAILED' ? <TrendingDown className="h-3 w-3" /> : null}
          {l.key} · {l.avg_roas}x
        </span>
      </TooltipTrigger>
      <TooltipContent>
        <div className="space-y-0.5 text-xs">
          <p>{l.dimension} · {l.verdict} · ROAS {l.avg_roas} · {l.total_spend}€ ({l.ads_count} ads)</p>
          {(l.evidence || []).slice(0, 3).map((e, i) => <p key={i}>· {e.ad_name}: {e.roas}x / {e.spend}€</p>)}
          {(l.history || []).length > 0 && <p className="text-slate-400">Evolución: {l.history.map((h) => `${h.from}→${h.to} (${h.date})`).join(' · ')}</p>}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

export default function IdeasAgentDialog({ open, onOpenChange }) {
  const qc = useQueryClient()
  const [running, setRunning] = useState(false)
  const [result, setResult] = useState(null)
  const [quantity, setQuantity] = useState('3')
  const [busy, setBusy] = useState(null)

  const { data: learnings } = useEntityList(CreativeLearnings, { limit: 500 })
  const { data: ideas } = useEntityList(ScriptIdeas, { sort: '-created_date', limit: 50 })

  const grouped = useMemo(() => {
    const g = { PROVEN: [], PROMISING: [], FAILED: [], FATIGUED: [], INCONCLUSIVE: [] }
    for (const l of learnings || []) (g[l.verdict] || g.INCONCLUSIVE).push(l)
    return g
  }, [learnings])

  const refreshMemory = async () => {
    setRunning(true)
    try {
      const r = await rebuildLearningsFromMetrics()
      toast.success(`Memoria actualizada: ${r.created} nuevos · ${r.updated} actualizados · breakeven ${r.breakeven}x`)
      qc.invalidateQueries()
    } finally { setRunning(false) }
  }

  const generate = async () => {
    setRunning(true)
    setResult(null)
    try {
      const r = await generateNewIdeas({ quantity: Number(quantity) })
      setResult(r)
      toast.success(`${r.ideas.length} ideas nuevas · ${r.discards.length} descartes por memoria`)
      qc.invalidateQueries()
    } finally { setRunning(false) }
  }

  const toScript = async (idea) => {
    setBusy(idea.id)
    try {
      await ideaToScript(idea)
      toast.success('Borrador creado en Script Builder')
      qc.invalidateQueries()
    } finally { setBusy(null) }
  }

  const shownIdeas = result?.ideas || (ideas || []).filter((i) => i.status === 'NEW').slice(0, 8)

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-base"><Bot className="h-5 w-5 text-indigo-500" /> Agente de ideas nuevas</DialogTitle>
          <p className="text-xs text-slate-400">Proceso ads-agent: métricas propias + investigación + inspiración − lo que la memoria sabe que falló. Solo genera <b>new ideas</b> — nunca repite fuente ni patrón quemado.</p>
        </DialogHeader>

        {/* Memoria creativa */}
        <div className="rounded-xl border border-slate-100 bg-white/70 p-3.5 space-y-2.5">
          <div className="flex items-center gap-2">
            <p className="flex items-center gap-1.5 text-sm font-semibold text-slate-700"><Brain className="h-4 w-4 text-purple-500" /> Memoria creativa</p>
            <span className="text-xs text-slate-400">{(learnings || []).length} aprendizajes</span>
            <Button size="sm" variant="outline" className="ml-auto" onClick={refreshMemory} disabled={running}><RefreshCw className={running ? 'animate-spin' : ''} /> Actualizar desde métricas</Button>
          </div>
          {['PROVEN', 'PROMISING', 'FAILED', 'FATIGUED'].map((v) => grouped[v].length > 0 && (
            <div key={v} className="flex flex-wrap items-center gap-1.5">
              <span className="w-20 text-[10px] font-bold text-slate-400">{v}</span>
              {grouped[v].sort((a, b) => b.total_spend - a.total_spend).slice(0, 10).map((l) => <LearningChip key={l.id} l={l} />)}
            </div>
          ))}
          {(learnings || []).length === 0 && <p className="text-xs text-slate-400">Sin aprendizajes aún — pulsa "Actualizar desde métricas" (necesita datos sincronizados).</p>}
        </div>

        {/* Generar */}
        <div className="flex items-center gap-2">
          <Select value={quantity} onValueChange={setQuantity}>
            <SelectTrigger className="w-[110px]"><SelectValue /></SelectTrigger>
            <SelectContent>{['2', '3', '4', '5'].map((n) => <SelectItem key={n} value={n}>{n} ideas</SelectItem>)}</SelectContent>
          </Select>
          <Button onClick={generate} disabled={running} className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white">
            {running ? <Loader2 className="animate-spin" /> : <Sparkles />} Generar ideas nuevas
          </Button>
          {result && <span className="text-xs text-slate-400">País objetivo: {result.context.country} · {result.context.research_findings} findings · {result.context.inspiration_available} inspiraciones sin usar</span>}
        </div>

        {/* Descartes por memoria — el "ya lo probamos y no funcionó" */}
        {result?.discards?.length > 0 && (
          <div className="rounded-xl border border-red-100 bg-red-50/50 p-3.5">
            <p className="mb-1.5 flex items-center gap-1.5 text-sm font-semibold text-red-700"><Ban className="h-4 w-4" /> Descartado por memoria ({result.discards.length})</p>
            <div className="space-y-1">
              {result.discards.map((d, i) => (
                <p key={i} className="text-xs text-slate-600"><b>{d.origin}</b> → hook {d.hook_type}: {d.reason}</p>
              ))}
            </div>
          </div>
        )}

        {/* Ideas */}
        <div className="space-y-2.5">
          {shownIdeas.map((idea) => (
            <div key={idea.id || idea.signature} className="rounded-xl border border-indigo-100 bg-white p-4">
              <div className="flex flex-wrap items-start gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-slate-800">{idea.title}</p>
                  <p className="mt-0.5 text-xs text-slate-400">{idea.based_on?.type === 'inspiration' ? '✨' : '🔬'} {idea.based_on?.reference} · {idea.format} · {idea.schwartz_awareness} · soph. {idea.sophistication_stage}</p>
                </div>
                <span className="rounded bg-indigo-100 px-2 py-0.5 text-[10px] font-bold text-indigo-700">{idea.hook_type}</span>
                <Button size="sm" variant="outline" onClick={() => toScript(idea)} disabled={busy === idea.id || idea.status === 'SCRIPTED'}>
                  {busy === idea.id ? <Loader2 className="animate-spin" /> : idea.status === 'SCRIPTED' ? <CheckCircle2 /> : <FileEdit />}
                  {idea.status === 'SCRIPTED' ? 'Ya en builder' : 'Crear borrador'}
                </Button>
              </div>
              <div className="mt-2 space-y-1">
                {(idea.hooks || []).map((h, i) => (
                  <p key={i} className="text-xs text-slate-600"><b className="text-slate-400">{h.label}:</b> {h.text} <span className="text-slate-300">({h.source})</span></p>
                ))}
              </div>
              {idea.breakthrough_diagnosis && (
                <p className="mt-2 rounded-lg bg-indigo-50/60 p-2 text-[11px] text-slate-500">
                  <b>Schwartz:</b> {idea.breakthrough_diagnosis.mass_desire_channeled} · {idea.breakthrough_diagnosis.performance_or_identification} · {idea.breakthrough_diagnosis.why_this_wins}
                </p>
              )}
              <p className="mt-1.5 text-[10px] text-slate-300">Audiencia: {idea.audience} · firma: {idea.signature}</p>
            </div>
          ))}
          {shownIdeas.length === 0 && !running && <p className="py-4 text-center text-sm text-slate-400">Sin ideas todavía — genera la primera tanda.</p>}
        </div>
      </DialogContent>
    </Dialog>
  )
}
