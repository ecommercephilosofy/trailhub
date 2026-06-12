import { useMemo, useState } from 'react'
import { CalendarDays, ExternalLink, ListVideo } from 'lucide-react'
import { EditorQueue as QueueEntity, UserProfiles, AdScriptMapping, AdsPerformanceAgg, GeneratedScripts } from '@/api/entities'
import { useEntityList } from '@/hooks/useData'
import { useAuth } from '@/context/AuthContext'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Card, CardContent } from '@/components/ui/card'
import { StatusBadge, PriorityBadge, FormatBadge, UserAvatar } from '@/components/shared/badges'
import { LoadingSpinner, EmptyState } from '@/components/shared/misc'
import PageGuide from '@/components/shared/PageGuide'
import { fmtDate, fmtEur, fmtRoas } from '@/lib/format'

const Q_STATUSES = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']

export default function EditorQueue() {
  const { effectiveRole, currentUser } = useAuth()
  const isEditor = effectiveRole === 'EDITOR'
  const [statusFilter, setStatusFilter] = useState('all')
  const [editorFilter, setEditorFilter] = useState('all')

  const { data: queue, isLoading } = useEntityList(QueueEntity, { sort: '-created_date', limit: 300 })
  const { data: profiles } = useEntityList(UserProfiles, { staleTime: 300_000 })
  const { data: mappings } = useEntityList(AdScriptMapping, { staleTime: 300_000 })
  const { data: aggs } = useEntityList(AdsPerformanceAgg, { filter: { window: 'LAST_7D' }, staleTime: 300_000 })
  const { data: scripts } = useEntityList(GeneratedScripts, { staleTime: 300_000 })

  const profById = useMemo(() => Object.fromEntries((profiles || []).map((p) => [p.user_id, p])), [profiles])

  const visible = useMemo(() => {
    let items = queue || []
    if (isEditor) items = items.filter((q) => !q.assigned_editor_user_id || q.assigned_editor_user_id === currentUser?.id)
    if (statusFilter !== 'all') items = items.filter((q) => q.status === statusFilter)
    if (editorFilter !== 'all') items = items.filter((q) => q.assigned_editor_user_id === editorFilter)
    return items
  }, [queue, isEditor, currentUser, statusFilter, editorFilter])

  const stats = useMemo(() => {
    const all = queue || []
    return {
      total: all.length,
      TODO: all.filter((q) => q.status === 'TODO').length,
      IN_PROGRESS: all.filter((q) => q.status === 'IN_PROGRESS').length,
      REVIEW: all.filter((q) => q.status === 'REVIEW').length,
      DONE: all.filter((q) => q.status === 'DONE').length,
    }
  }, [queue])

  // Editor performance: EditorQueue → script → AdScriptMapping → Agg
  const editorPerf = useMemo(() => {
    const scriptEditor = {}
    for (const s of scripts || []) if (s.assigned_editor_user_id) scriptEditor[s.id] = s.assigned_editor_user_id
    for (const q of queue || []) if (q.generated_script_id && q.assigned_editor_user_id) scriptEditor[q.generated_script_id] = q.assigned_editor_user_id
    const aggByAd = Object.fromEntries((aggs || []).map((a) => [a.ad_id, a]))
    const perf = {}
    for (const m of mappings || []) {
      const editorId = scriptEditor[m.script_id]
      const agg = aggByAd[m.ad_id]
      if (!editorId || !agg) continue
      const p = (perf[editorId] = perf[editorId] || { ads: 0, spend: 0, value: 0, winners: 0, losers: 0 })
      p.ads += 1
      p.spend += agg.spend || 0
      p.value += agg.conversion_value || 0
      if (agg.label === 'WINNER') p.winners += 1
      if (agg.label === 'LOSER') p.losers += 1
    }
    return Object.entries(perf).map(([editorId, p]) => ({
      editorId,
      name: profById[editorId]?.name || 'Editor',
      scripts: (queue || []).filter((q) => q.assigned_editor_user_id === editorId).length,
      roas: p.spend > 0 ? p.value / p.spend : 0,
      winRate: p.ads > 0 ? (p.winners / p.ads) * 100 : 0,
      ...p,
    }))
  }, [queue, mappings, aggs, scripts, profById])

  const editors = (profiles || []).filter((p) => p.custom_role === 'EDITOR')

  if (isLoading) return <LoadingSpinner size="lg" />

  return (
    <div className="space-y-4 animate-fade-in">
      <PageGuide pageName="EditorQueue" />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        {[['Total', stats.total, 'text-slate-800'], ['To Do', stats.TODO, 'text-blue-600'], ['In Progress', stats.IN_PROGRESS, 'text-amber-600'], ['Review', stats.REVIEW, 'text-purple-600'], ['Done', stats.DONE, 'text-emerald-600']].map(([label, value, cls]) => (
          <Card key={label}>
            <CardContent className="p-4">
              <p className="text-xs text-slate-400">{label}</p>
              <p className={`text-2xl font-bold ${cls}`}>{value}</p>
            </CardContent>
          </Card>
        ))}
      </div>

      {editorPerf.length > 0 && !isEditor && (
        <div>
          <h3 className="mb-2 text-sm font-semibold text-slate-500">Editor Performance (7d)</h3>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {editorPerf.map((e) => (
              <Card key={e.editorId}>
                <CardContent className="p-4">
                  <div className="flex items-center gap-2.5">
                    <UserAvatar name={e.name} />
                    <div className="flex-1 min-w-0">
                      <p className="truncate font-medium text-slate-800">{e.name}</p>
                      <p className="text-xs text-slate-400">{e.scripts} scripts · {e.ads} ads live</p>
                    </div>
                    <span className={`text-lg font-bold ${e.roas >= 2.5 ? 'text-emerald-600' : e.roas >= 1.5 ? 'text-amber-600' : 'text-red-500'}`}>{fmtRoas(e.roas)}</span>
                  </div>
                  <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">Win rate {e.winRate.toFixed(0)}%</span>
                    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{fmtEur(e.spend)} spend</span>
                    <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-medium text-emerald-700">{e.winners} 🏆</span>
                    <span className="rounded-full bg-red-100 px-2 py-0.5 font-medium text-red-700">{e.losers} ❌</span>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los status</SelectItem>
            {Q_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}
          </SelectContent>
        </Select>
        {!isEditor && (
          <Select value={editorFilter} onValueChange={setEditorFilter}>
            <SelectTrigger className="w-[170px]"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos los editores</SelectItem>
              {editors.map((e) => <SelectItem key={e.user_id} value={e.user_id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {visible.length === 0 ? (
        <EmptyState icon={ListVideo} title="Cola vacía" description="Los scripts asignados a producción aparecerán aquí." />
      ) : (
        <div className="space-y-2.5">
          {visible.map((q) => (
            <div key={q.id} className="glass-card p-4">
              <div className="flex flex-wrap items-start gap-2">
                <PriorityBadge priority={q.priority} />
                <StatusBadge status={q.status} />
                <p className="w-full font-medium text-slate-800 sm:w-auto sm:flex-1">{q.script_title}</p>
                <div className="flex items-center gap-2">
                  <Select value={q.status} onValueChange={(v) => QueueEntity.update(q.id, { status: v })}>
                    <SelectTrigger className="h-8 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{Q_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                  </Select>
                  {q.doc_url && (
                    <a href={q.doc_url} target="_blank" rel="noreferrer" className="flex items-center gap-1 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs text-slate-600 hover:bg-slate-50">
                      <ExternalLink className="h-3 w-3" /> View Script
                    </a>
                  )}
                </div>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                {q.product && <span className="rounded bg-slate-100 px-1.5 py-0.5">{q.product}</span>}
                <FormatBadge format={q.format} size="sm" />
                {q.due_date && <span className="flex items-center gap-1"><CalendarDays className="h-3 w-3" /> {fmtDate(q.due_date)}</span>}
                {q.assigned_editor_user_id && (
                  <span className="ml-auto flex items-center gap-1.5">
                    <UserAvatar name={profById[q.assigned_editor_user_id]?.name} size="sm" />
                    <span>{profById[q.assigned_editor_user_id]?.name}</span>
                  </span>
                )}
              </div>
              {q.brief_for_editor && (
                <p className="mt-2 rounded-lg bg-slate-50 p-2.5 text-sm text-slate-600 line-clamp-2 whitespace-pre-line">{q.brief_for_editor}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
