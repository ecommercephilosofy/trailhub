import { useEffect, useMemo, useState } from 'react'
import { BarChart3, BookOpen, Brain, ClipboardList, Download, FileText, Heart, Loader2, MessageSquare, Plus, Search, Target, User, X } from 'lucide-react'
import { toast } from 'sonner'
import { useQueryClient } from '@tanstack/react-query'
import { ResearchRuns, ResearchFindings } from '@/api/entities'
import {
  runMarketResearch, runMarketResearchFromReddit, fetchRedditThreadText,
  importResearchToHub, saveFindingToContextLibrary, findingToMarkdown,
  importAvatarToHub, importDesireToHub, importAngleToHub,
} from '@/api/research'
import { useEntityList } from '@/hooks/useData'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { LoadingSpinner, EmptyState } from '@/components/shared/misc'
import PageGuide from '@/components/shared/PageGuide'
import { timeAgo } from '@/lib/utils'

const STATUS_CLS = {
  OK: 'bg-green-100 text-green-800',
  ERROR: 'bg-red-100 text-red-800',
  RUNNING: 'bg-slate-100 text-slate-600 animate-pulse',
}

function RunStatusBadge({ status }) {
  return <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${STATUS_CLS[status] || 'bg-slate-100 text-slate-500'}`}>{status}</span>
}

function Section({ icon: Icon, title, color, children }) {
  return (
    <div className="rounded-xl border border-slate-100 bg-white/70 p-4">
      <p className={`mb-2 flex items-center gap-2 text-sm font-semibold ${color}`}><Icon className="h-4 w-4" /> {title}</p>
      {children}
    </div>
  )
}

function Markdownish({ text }) {
  return (
    <div className="space-y-1 text-sm text-slate-600">
      {(text || '').split('\n').map((l, i) => {
        if (l.startsWith('## ')) return <p key={i} className="pt-1 font-semibold text-slate-800">{l.slice(3)}</p>
        if (l.startsWith('### ')) return <p key={i} className="pt-1 font-medium text-slate-700">{l.slice(4)}</p>
        if (l.startsWith('- ')) return <p key={i} className="pl-3">• {l.slice(2).replace(/\*\*/g, '')}</p>
        return l.trim() ? <p key={i}>{l.replace(/\*\*/g, '')}</p> : null
      })}
    </div>
  )
}

function FindingModal({ finding, run, onClose }) {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(null)
  const av = finding.step_4_avatar_profile || {}

  const doImportAll = async () => {
    setBusy('hub')
    try {
      const res = await importResearchToHub({ finding_id: finding.id })
      if (res.success) {
        toast.success(`Importado al Hub: ${res.imported.avatars} avatar · ${res.imported.desires} desires · ${res.imported.angles} angles`)
        qc.invalidateQueries()
      } else toast.error(res.error)
    } finally { setBusy(null) }
  }

  const doSaveContext = async () => {
    setBusy('ctx')
    try {
      const res = await saveFindingToContextLibrary({ finding_id: finding.id })
      res.success ? toast.success('Guardado en Context Library') : toast.error(res.error)
    } finally { setBusy(null) }
  }

  const doExportMd = () => {
    const blob = new Blob([findingToMarkdown(finding)], { type: 'text/markdown' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `research-${finding.research_run_id}.md`
    a.click()
    URL.revokeObjectURL(a.href)
  }

  const createOne = async (kind, payload, extra) => {
    setBusy(kind + JSON.stringify(payload).slice(0, 30))
    try {
      const fn = kind === 'avatar' ? () => importAvatarToHub(payload, finding.topic)
        : kind === 'desire' ? () => importDesireToHub(payload, finding.topic)
        : () => importAngleToHub(payload, extra, finding.topic)
      const r = await fn()
      toast[r.created ? 'success' : 'info'](r.created ? 'Creado en Research Hub' : 'Ya existía (dedup por nombre)')
      qc.invalidateQueries()
    } finally { setBusy(null) }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[88vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="pr-8 text-base">{finding.topic}</DialogTitle>
          <div className="flex flex-wrap items-center gap-2 pt-1">
            <span className="font-mono text-[10px] text-slate-400">{finding.research_run_id}</span>
            {run?.model_used && <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] text-slate-500">{run.model_used} · {(run.tokens_used / 1000).toFixed(0)}k tokens · ~{run.cost_estimate}€</span>}
            <div className="ml-auto flex gap-2">
              <Button size="sm" className="bg-gradient-to-r from-indigo-500 to-purple-600 text-white" onClick={doImportAll} disabled={busy === 'hub'}>
                {busy === 'hub' ? <Loader2 className="animate-spin" /> : <Download />} Importar a Research Hub
              </Button>
              <Button size="sm" className="bg-gradient-to-r from-green-500 to-emerald-600 text-white" onClick={doSaveContext} disabled={busy === 'ctx'}>
                {busy === 'ctx' ? <Loader2 className="animate-spin" /> : <BookOpen />} Context Library
              </Button>
              <Button size="sm" variant="outline" onClick={doExportMd} title="Exportar Markdown"><FileText /></Button>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3">
          <Section icon={BarChart3} title="📊 Análisis de Contenido" color="text-indigo-600">
            <Markdownish text={finding.step_2_analysis} />
          </Section>

          <Section icon={User} title="👤 Customer Avatar" color="text-purple-600">
            <div className="flex items-start justify-between gap-2">
              <div className="space-y-1.5 text-sm text-slate-600">
                <p className="font-medium text-slate-800">{av.avatar_name} <span className="font-normal text-slate-400">({av.age} · {av.gender})</span></p>
                <p><b>Creencias:</b> {av.core_beliefs}</p>
                <p><b>Sueños:</b> {(av.hopes_dreams || []).join(' · ')}</p>
                <p><b>Miedos:</b> {(av.fears || []).join(' · ')}</p>
                <p><b>Ya probó:</b> {(av.past_solutions || []).join(' · ')}</p>
                <p className="rounded-lg bg-slate-50 p-2 italic text-slate-500">{av.language_sample}</p>
              </div>
              <Button size="sm" variant="outline" onClick={() => createOne('avatar', av)} disabled={!!busy}><Plus /> Crear Avatar</Button>
            </div>
          </Section>

          <Section icon={Heart} title="💫 Mass Desires" color="text-rose-600">
            <div className="space-y-2">
              {(finding.step_5_mass_desires || []).map((d, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white p-2.5">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-slate-800">{d.desire} <span className="text-xs font-bold text-rose-500">{d.intensity}/10</span></p>
                    <p className="text-xs text-slate-400">{d.segment} · {d.core_emotion}</p>
                  </div>
                  <Button size="icon" variant="outline" className="h-7 w-7" title="Crear en DesireLibrary" onClick={() => createOne('desire', d)} disabled={!!busy}><Plus className="h-3.5 w-3.5" /></Button>
                </div>
              ))}
            </div>
          </Section>

          <Section icon={Target} title="🎯 Marketing Angles" color="text-amber-600">
            <div className="space-y-3">
              {Object.values(finding.step_6_marketing_angles || {}).map((group, gi) => (
                <div key={gi}>
                  <p className="mb-1.5 text-xs font-bold uppercase tracking-wide text-slate-400">{group.desire}</p>
                  <div className="space-y-2">
                    {(group.angles || []).map((a, ai) => (
                      <div key={ai} className="flex items-start gap-2 rounded-lg border border-slate-100 bg-white p-2.5">
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p className="text-sm font-medium text-slate-800">{a.angle_name}</p>
                          <p className="text-xs text-slate-500">🪝 {a.hook_idea}</p>
                          <p className="text-xs text-slate-400">{a.target_audience} · {a.story_arc}</p>
                        </div>
                        <Button size="icon" variant="outline" className="h-7 w-7 shrink-0" title="Crear en AngleLibrary" onClick={() => createOne('angle', a, group.desire)} disabled={!!busy}><Plus className="h-3.5 w-3.5" /></Button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <Section icon={ClipboardList} title="📋 RMBC Insights" color="text-emerald-600">
            <Markdownish text={finding.step_3_rmbc_insights} />
          </Section>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export default function MarketResearch() {
  const qc = useQueryClient()
  const [topic, setTopic] = useState('')
  const [redditUrl, setRedditUrl] = useState('')
  const [isRunning, setIsRunning] = useState(null) // estado local — NO isLoading de TanStack (mutación larga)
  const [openFinding, setOpenFinding] = useState(null)

  const { data: runs, isLoading } = useEntityList(ResearchRuns, { sort: '-created_date', limit: 60 })
  const { data: findings } = useEntityList(ResearchFindings, { sort: '-created_date', limit: 60 })
  const findingByRun = useMemo(() => Object.fromEntries((findings || []).map((f) => [f.research_run_id, f])), [findings])
  const runByRunId = useMemo(() => Object.fromEntries((runs || []).map((r) => [r.research_run_id, r])), [runs])

  // Polling 10s mientras haya runs RUNNING → badge de status en tiempo real
  const hasRunning = (runs || []).some((r) => r.status === 'RUNNING')
  useEffect(() => {
    if (!hasRunning) return
    const id = setInterval(() => qc.invalidateQueries(), 10_000)
    return () => clearInterval(id)
  }, [hasRunning, qc])

  const doGeneral = async () => {
    if (!topic.trim()) return toast.error('Escribe un tema de investigación')
    setIsRunning('general')
    try {
      const res = await runMarketResearch({ topic: topic.trim() })
      if (res.success) { toast.success('Investigación completada'); setTopic('') } else toast.error(res.error)
      qc.invalidateQueries()
    } finally { setIsRunning(null) }
  }

  const doReddit = async () => {
    if (!/^https?:\/\/(www\.|old\.)?reddit\.com\/r\/.+\/comments\//.test(redditUrl.trim())) return toast.error('Pega una URL de hilo de Reddit válida')
    setIsRunning('reddit')
    try {
      const fr = await fetchRedditThreadText({ url: redditUrl.trim(), sort: 'top', max_comments: 80 })
      if (!fr.success) return toast.error('No se pudo extraer el hilo')
      toast.info(fr.cached ? 'Hilo en caché — reutilizando extract' : `Extraídos ${fr.extract.comments_count} comentarios`)
      const res = await runMarketResearchFromReddit({ extract_id: fr.extract.extract_id })
      if (res.success) { toast.success('Investigación completada'); setRedditUrl('') } else toast.error(res.error)
      qc.invalidateQueries()
    } finally { setIsRunning(null) }
  }

  if (isLoading) return <LoadingSpinner size="lg" />

  const openRun = (run) => {
    const f = findingByRun[run.research_run_id]
    if (!f) return toast.error(run.status === 'RUNNING' ? 'Aún en proceso…' : 'Run sin finding (error)')
    setOpenFinding(f)
  }

  return (
    <div className="space-y-4 animate-fade-in">
      <PageGuide pageName="MarketResearch" />

      {/* ZONA 2 — Panel nueva investigación */}
      <div className="rounded-2xl border-2 border-indigo-200 bg-gradient-to-br from-indigo-50 to-purple-50 p-5">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700"><Brain className="h-4 w-4 text-indigo-500" /> Nueva investigación de mercado · 6 pasos (RMBC + Mass Desires)</p>
        <Tabs defaultValue="general">
          <TabsList>
            <TabsTrigger value="general">🧠 General</TabsTrigger>
            <TabsTrigger value="reddit">👽 Reddit</TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="space-y-3 pt-3">
            <div>
              <Label>Tema de investigación</Label>
              <Input className="mt-1 bg-white" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder='p.ej. "sleep apnea men 40-65 USA" o "joyería personalizada regalo madre España"' onKeyDown={(e) => e.key === 'Enter' && doGeneral()} />
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={doGeneral} disabled={!!isRunning} className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white">
                {isRunning === 'general' ? <Loader2 className="animate-spin" /> : <Brain />} Ejecutar Market Research
              </Button>
              <span className="text-xs text-slate-400">Scraping → análisis → RMBC → avatar → desires → angles · ~2-4 min con backend real</span>
            </div>
          </TabsContent>
          <TabsContent value="reddit" className="space-y-3 pt-3">
            <div>
              <Label>URL del hilo de Reddit</Label>
              <Input className="mt-1 bg-white" value={redditUrl} onChange={(e) => setRedditUrl(e.target.value)} placeholder="https://www.reddit.com/r/sleep/comments/…" onKeyDown={(e) => e.key === 'Enter' && doReddit()} />
            </div>
            <div className="flex items-center gap-3">
              <Button onClick={doReddit} disabled={!!isRunning} className="bg-gradient-to-r from-orange-500 to-red-500 text-white">
                {isRunning === 'reddit' ? <Loader2 className="animate-spin" /> : <MessageSquare />} Extraer y analizar
              </Button>
              <span className="text-xs text-slate-400">Post + top 80 comentarios → mismo pipeline de 6 pasos</span>
            </div>
          </TabsContent>
        </Tabs>
      </div>

      {/* ZONA 3 — Historial */}
      <h3 className="text-sm font-semibold text-slate-500">Historial de investigaciones</h3>
      {(runs || []).length === 0 ? (
        <EmptyState icon={Search} title="Sin investigaciones" description="Lanza tu primera investigación arriba. Los resultados alimentan el Research Hub." />
      ) : (
        <div className="grid gap-3 lg:grid-cols-2">
          {(runs || []).map((r) => (
            <button key={r.id} onClick={() => openRun(r)} className="glass-card p-4 text-left transition hover:border-indigo-200 hover:shadow-md">
              <div className="flex flex-wrap items-center gap-2">
                <span className={`rounded px-2 py-0.5 text-[10px] font-bold ${r.source === 'REDDIT' ? 'bg-orange-100 text-orange-700' : 'bg-indigo-100 text-indigo-700'}`}>{r.source}</span>
                <p className="min-w-0 flex-1 truncate font-medium text-slate-800">{r.topic}</p>
                <RunStatusBadge status={r.status} />
              </div>
              <div className="mt-2 flex items-center gap-2 text-xs text-slate-400">
                <span className="font-mono">{r.research_run_id}</span>
                <span>· {timeAgo(r.created_date)}</span>
                {r.model_used && <span>· {r.model_used}</span>}
                {r.cost_estimate != null && <span>· ~{r.cost_estimate}€</span>}
              </div>
              {r.status === 'RUNNING' && r.notes && <p className="mt-2 font-mono text-[11px] text-indigo-500">→ {r.notes}</p>}
              {r.status === 'ERROR' && <p className="mt-2 text-xs text-red-500">{r.notes}</p>}
              {r.status === 'OK' && findingByRun[r.research_run_id] && (
                <p className="mt-2 text-xs text-slate-500">
                  {(findingByRun[r.research_run_id].step_5_mass_desires || []).length} desires · {Object.values(findingByRun[r.research_run_id].step_6_marketing_angles || {}).reduce((s, g) => s + (g.angles || []).length, 0)} angles · click para abrir
                </p>
              )}
            </button>
          ))}
        </div>
      )}

      {openFinding && <FindingModal finding={openFinding} run={runByRunId[openFinding.research_run_id]} onClose={() => setOpenFinding(null)} />}
    </div>
  )
}
