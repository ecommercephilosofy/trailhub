import { useState } from 'react'
import { Brain, Loader2, MessageSquare, Search } from 'lucide-react'
import { toast } from 'sonner'
import { MarketResearchRuns } from '@/api/entities'
import { runMarketResearch, runMarketResearchFromReddit } from '@/api/functions'
import { useEntityList } from '@/hooks/useData'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { StatusBadge } from '@/components/shared/badges'
import { LoadingSpinner, EmptyState } from '@/components/shared/misc'
import PageGuide from '@/components/shared/PageGuide'
import { timeAgo } from '@/lib/utils'

export default function MarketResearch() {
  const [topic, setTopic] = useState('')
  const [subreddit, setSubreddit] = useState('')
  const [running, setRunning] = useState(null)
  const { data: runs, isLoading } = useEntityList(MarketResearchRuns, { sort: '-created_date', limit: 50 })

  const runGeneral = async () => {
    if (!topic.trim()) return toast.error('Escribe un tema')
    setRunning('general')
    try { await runMarketResearch({ topic }); toast.success('Investigación completada') }
    finally { setRunning(null) }
  }

  const runReddit = async () => {
    if (!subreddit.trim()) return toast.error('Escribe un subreddit')
    setRunning('reddit')
    try { await runMarketResearchFromReddit({ subreddit: subreddit.replace(/^r\//, '') }); toast.success('Scraping completado') }
    finally { setRunning(null) }
  }

  if (isLoading) return <LoadingSpinner size="lg" />

  return (
    <div className="space-y-4 animate-fade-in">
      <PageGuide pageName="MarketResearch" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><Brain className="h-4 w-4 text-indigo-500" /> Investigación general con IA</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Tema / pregunta de mercado</Label>
              <Input className="mt-1" value={topic} onChange={(e) => setTopic(e.target.value)} placeholder="p.ej. objeciones a tapones de cera en España" />
            </div>
            <Button onClick={runGeneral} disabled={running === 'general'} className="w-full">
              {running === 'general' ? <Loader2 className="animate-spin" /> : <Brain />} Ejecutar análisis
            </Button>
          </CardContent>
        </Card>
        <Card>
          <CardHeader><CardTitle className="text-sm flex items-center gap-2"><MessageSquare className="h-4 w-4 text-orange-500" /> Reddit scraping</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div>
              <Label>Subreddit</Label>
              <Input className="mt-1" value={subreddit} onChange={(e) => setSubreddit(e.target.value)} placeholder="r/sleep" />
            </div>
            <Button onClick={runReddit} disabled={running === 'reddit'} variant="outline" className="w-full border-orange-300 text-orange-600 hover:bg-orange-50">
              {running === 'reddit' ? <Loader2 className="animate-spin" /> : <MessageSquare />} Scrapear y analizar
            </Button>
          </CardContent>
        </Card>
      </div>

      <h3 className="text-sm font-semibold text-slate-500">Historial de runs</h3>
      {(runs || []).length === 0 ? (
        <EmptyState icon={Search} title="Sin investigaciones" description="Lanza tu primera investigación arriba." />
      ) : (
        <div className="space-y-2.5">
          {(runs || []).map((r) => (
            <div key={r.id} className="glass-card p-4">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-bold text-slate-600">{r.run_type}</span>
                <p className="flex-1 font-medium text-slate-800 min-w-[150px]">{r.query}</p>
                <span className="text-xs text-slate-400">{timeAgo(r.created_date)}</span>
                <StatusBadge status={r.status} />
              </div>
              {r.findings_summary && <p className="mt-2 rounded-lg bg-indigo-50/60 border border-indigo-100 p-3 text-sm text-slate-700">{r.findings_summary}</p>}
              {(r.logs || []).length > 0 && (
                <div className="mt-2 space-y-0.5">
                  {r.logs.map((l, i) => <p key={i} className="font-mono text-[11px] text-slate-400">→ {l}</p>)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
