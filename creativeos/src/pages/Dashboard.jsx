import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as ReTooltip } from 'recharts'
import { FileUp, TrendingUp, Wand2, Clapperboard, Target, ArrowRight, Loader2, Trophy, Flame, Clock } from 'lucide-react'
import { toast } from 'sonner'
import { AdsPerformanceAgg, GeneratedScripts, VideoAssets, SyncRuns } from '@/api/entities'
import { analyzeResearchPDF, importSelectedElements } from '@/api/functions'
import { useEntityList } from '@/hooks/useData'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { StatusBadge, FormatBadge, FatigueIndicator } from '@/components/shared/badges'
import { LoadingSpinner, EmptyState } from '@/components/shared/misc'
import PageGuide from '@/components/shared/PageGuide'
import { fmtEur, fmtRoas } from '@/lib/format'
import { timeAgo } from '@/lib/utils'

const PIE_COLORS = { Winners: '#10b981', Regular: '#f59e0b', Losers: '#ef4444', Pending: '#6366f1' }

function StatCard({ icon: Icon, label, value, sub, accent }) {
  return (
    <Card>
      <CardContent className="p-5 flex items-start gap-3">
        <div className={`rounded-xl p-2.5 ${accent || 'bg-indigo-100 text-indigo-600'}`}><Icon className="h-5 w-5" /></div>
        <div className="min-w-0">
          <p className="text-xs text-slate-500">{label}</p>
          <p className="text-2xl font-bold text-slate-900 leading-tight">{value}</p>
          {sub && <p className="text-xs text-slate-500 mt-0.5">{sub}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

function ImportPdfDialog({ open, onOpenChange }) {
  const [step, setStep] = useState(1)
  const [file, setFile] = useState(null)
  const [analyzing, setAnalyzing] = useState(false)
  const [results, setResults] = useState(null)
  const [selected, setSelected] = useState({})
  const [importing, setImporting] = useState(false)

  const reset = () => { setStep(1); setFile(null); setResults(null); setSelected({}) }

  const analyze = async () => {
    setAnalyzing(true)
    try {
      const res = await analyzeResearchPDF({ fileName: file?.name })
      setResults(res)
      const sel = {}
      for (const cat of ['avatars', 'angles', 'desires', 'problems']) res[cat].forEach((_, i) => (sel[`${cat}_${i}`] = true))
      setSelected(sel)
      setStep(2)
    } finally { setAnalyzing(false) }
  }

  const doImport = async () => {
    setImporting(true)
    try {
      const payload = {}
      for (const cat of ['avatars', 'angles', 'desires', 'problems'])
        payload[cat] = results[cat].filter((_, i) => selected[`${cat}_${i}`])
      const res = await importSelectedElements(payload)
      const c = res.counts
      toast.success(`Importado! ${c.avatars} avatares, ${c.angles} ángulos, ${c.desires} deseos, ${c.problems} problemas`)
      onOpenChange(false)
      reset()
    } finally { setImporting(false) }
  }

  const CATS = [
    { key: 'avatars', title: 'Avatares', color: 'text-blue-600', name: (x) => x.nombre, desc: (x) => x.descripcion },
    { key: 'angles', title: 'Ángulos', color: 'text-purple-600', name: (x) => x.nombre, desc: (x) => x.promise },
    { key: 'desires', title: 'Deseos', color: 'text-pink-600', name: (x) => x.nombre, desc: (x) => x.core_desire },
    { key: 'problems', title: 'Problemas', color: 'text-orange-600', name: (x) => x.nombre, desc: (x) => x.description },
  ]

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset() }}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Importar Investigación PDF</DialogTitle>
          <DialogDescription>La IA extrae avatares, ángulos, deseos y problemas del documento.</DialogDescription>
        </DialogHeader>
        {step === 1 && (
          <div className="space-y-4">
            <label className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 bg-slate-50/50 py-10 hover:border-indigo-400 hover:bg-indigo-50/40">
              <FileUp className="h-8 w-8 text-indigo-400" />
              <span className="text-sm font-medium text-slate-700">{file ? file.name : 'Selecciona un PDF de investigación'}</span>
              <span className="text-xs text-slate-400">Click para elegir archivo</span>
              <input type="file" accept=".pdf" className="hidden" onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
            <DialogFooter>
              <Button disabled={!file || analyzing} onClick={analyze}>
                {analyzing && <Loader2 className="animate-spin" />} {analyzing ? 'Analizando con IA…' : 'Analizar PDF'}
              </Button>
            </DialogFooter>
          </div>
        )}
        {step === 2 && results && (
          <div className="space-y-4">
            {CATS.map((cat) => (
              <div key={cat.key}>
                <h4 className={`mb-1.5 text-sm font-semibold ${cat.color}`}>{cat.title} ({results[cat.key].length})</h4>
                <div className="space-y-1.5">
                  {results[cat.key].map((item, i) => {
                    const k = `${cat.key}_${i}`
                    return (
                      <label key={k} className="flex items-start gap-2.5 rounded-lg border border-slate-200 bg-white/70 p-2.5 cursor-pointer hover:border-indigo-300">
                        <Checkbox checked={!!selected[k]} onCheckedChange={(v) => setSelected({ ...selected, [k]: !!v })} className="mt-0.5" />
                        <span className="min-w-0">
                          <span className="block text-sm font-medium text-slate-800">{cat.name(item)}</span>
                          <span className="block text-xs text-slate-500 line-clamp-2">{cat.desc(item)}</span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              </div>
            ))}
            <DialogFooter>
              <Button variant="outline" onClick={() => setStep(1)}>Atrás</Button>
              <Button onClick={doImport} disabled={importing}>
                {importing && <Loader2 className="animate-spin" />} Importar seleccionados
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  )
}

export default function Dashboard() {
  const [pdfOpen, setPdfOpen] = useState(false)
  const { data: aggs, isLoading } = useEntityList(AdsPerformanceAgg, { filter: { window: 'LAST_7D' }, staleTime: 300_000 })
  const { data: scripts } = useEntityList(GeneratedScripts, { sort: '-created_date', limit: 10 })
  const { data: videos } = useEntityList(VideoAssets, { sort: '-created_date', limit: 100 })
  const { data: syncs } = useEntityList(SyncRuns, { sort: '-created_date', limit: 5 })

  const stats = useMemo(() => {
    const a = aggs || []
    const winners = a.filter((x) => x.label === 'WINNER')
    const losers = a.filter((x) => x.label === 'LOSER')
    const regular = a.filter((x) => x.label === 'REGULAR')
    const pending = a.filter((x) => x.label === 'UNSCORED')
    const spend = a.reduce((s, x) => s + (x.spend || 0), 0)
    const value = a.reduce((s, x) => s + (x.conversion_value || 0), 0)
    const avgRoas = spend > 0 ? value / spend : 0
    const inProgress = (videos || []).filter((v) => ['TODO', 'IN_PROGRESS', 'REVIEW'].includes(v.status))
    const published = (videos || []).filter((v) => v.status === 'PUBLISHED')
    // Creative velocity: median days created→published
    const velDays = published
      .map((v) => (new Date(v.updated_date) - new Date(v.created_date)) / 86400000)
      .sort((x, y) => x - y)
    const velocity = velDays.length ? velDays[Math.floor(velDays.length / 2)] : null
    return {
      winners, losers, regular, pending, avgRoas, total: a.length,
      pendingScripts: (scripts || []).filter((s) => ['DRAFT', 'READY'].includes(s.status)).length,
      inProgress: inProgress.length, published: published.length, velocity,
      topWinners: [...a].sort((x, y) => (y.roas || 0) - (x.roas || 0)).slice(0, 5),
      fatigued: a.filter((x) => x.fatigue_flag).slice(0, 5),
    }
  }, [aggs, scripts, videos])

  const pieData = [
    { name: 'Winners', value: stats.winners?.length || 0 },
    { name: 'Regular', value: stats.regular?.length || 0 },
    { name: 'Losers', value: stats.losers?.length || 0 },
    { name: 'Pending', value: stats.pending?.length || 0 },
  ].filter((d) => d.value > 0)

  if (isLoading) return <LoadingSpinner size="lg" />

  return (
    <div className="space-y-5 animate-fade-in">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageGuide pageName="Dashboard" />
        <Button onClick={() => setPdfOpen(true)}><FileUp /> Importar Investigación PDF</Button>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard icon={Target} label="Total Ads Tracked (7d)" value={stats.total} sub={`${stats.winners.length} winners · ${stats.losers.length} losers`} />
        <StatCard
          icon={TrendingUp} label="ROAS agregado (7d)" value={fmtRoas(stats.avgRoas)}
          sub={stats.avgRoas >= 2 ? '✅ Healthy' : '⚠️ Needs work'}
          accent={stats.avgRoas >= 2 ? 'bg-emerald-100 text-emerald-600' : 'bg-amber-100 text-amber-600'}
        />
        <StatCard icon={Wand2} label="Scripts generados" value={(scripts || []).length} sub={`${stats.pendingScripts} pendientes de aprobar`} accent="bg-purple-100 text-purple-600" />
        <StatCard
          icon={Clapperboard} label="Videos en producción" value={stats.inProgress}
          sub={`${stats.published} publicados${stats.velocity != null ? ` · velocidad ${stats.velocity.toFixed(1)}d` : ''}`}
          accent="bg-orange-100 text-orange-600"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader><CardTitle className="text-sm">Performance Distribution</CardTitle></CardHeader>
          <CardContent>
            {pieData.length === 0 ? (
              <EmptyState icon={Target} title="Sin datos" description="Sincroniza Meta para ver distribución" />
            ) : (
              <>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={50} outerRadius={70} paddingAngle={3}>
                        {pieData.map((d) => <Cell key={d.name} fill={PIE_COLORS[d.name]} />)}
                      </Pie>
                      <ReTooltip />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="mt-2 flex flex-wrap justify-center gap-3">
                  {pieData.map((d) => (
                    <span key={d.name} className="flex items-center gap-1.5 text-xs text-slate-600">
                      <span className="h-2.5 w-2.5 rounded-full" style={{ background: PIE_COLORS[d.name] }} /> {d.name} ({d.value})
                    </span>
                  ))}
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm flex items-center gap-1.5"><Trophy className="h-4 w-4 text-emerald-500" /> Top Winners</CardTitle>
            <Link to="/AdsPerformance" className="text-xs text-indigo-600 hover:underline flex items-center gap-0.5">View all <ArrowRight className="h-3 w-3" /></Link>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {stats.topWinners.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">Sin ads aún</p>}
            {stats.topWinners.map((ad) => (
              <div key={ad.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-700">{ad.ad_name}</p>
                  <p className="text-xs text-slate-400">{fmtEur(ad.spend)} gastados</p>
                </div>
                <span className={`text-sm font-bold ${ad.roas >= 2.5 ? 'text-emerald-600' : ad.roas >= 1.5 ? 'text-amber-600' : 'text-red-500'}`}>{fmtRoas(ad.roas)}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-1.5"><Flame className="h-4 w-4 text-orange-500" /> Fatigue Alerts</CardTitle></CardHeader>
          <CardContent className="space-y-2.5">
            {stats.fatigued.length === 0 && <p className="text-sm text-slate-400 py-4 text-center">Sin fatiga detectada 🎉</p>}
            {stats.fatigued.map((ad) => (
              <div key={ad.id} className="flex items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-700">{ad.ad_name}</p>
                  <p className="truncate text-xs text-slate-400">{(ad.fatigue_reasons || []).join(' · ')}</p>
                </div>
                <FatigueIndicator reasons={ad.fatigue_reasons} severity="HIGH" />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle className="text-sm">Scripts recientes</CardTitle>
            <Link to="/ScriptBuilder" className="text-xs text-indigo-600 hover:underline flex items-center gap-0.5">View all <ArrowRight className="h-3 w-3" /></Link>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {(scripts || []).slice(0, 5).map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-700">{s.title}</p>
                  <p className="text-xs text-slate-400">{timeAgo(s.created_date)}</p>
                </div>
                <FormatBadge format={s.format} size="sm" />
                <StatusBadge status={s.status} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-1.5"><Clock className="h-4 w-4 text-slate-400" /> Recent Syncs</CardTitle></CardHeader>
          <CardContent className="space-y-2.5">
            {(syncs || []).map((s) => (
              <div key={s.id} className="flex items-center gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-slate-700">{s.run_type}</p>
                  <p className="truncate text-xs text-slate-400">{s.detail} · {timeAgo(s.created_date)}</p>
                </div>
                <StatusBadge status={s.status} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <ImportPdfDialog open={pdfOpen} onOpenChange={setPdfOpen} />
    </div>
  )
}
