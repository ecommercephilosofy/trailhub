import { useMemo, useState } from 'react'
import { Bot, PenLine, Search, Sparkles, Star, Wand2, FileEdit } from 'lucide-react'
import { GeneratedScripts, ScriptBuilderDrafts } from '@/api/entities'
import { useEntityList } from '@/hooks/useData'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StatusBadge, FormatBadge } from '@/components/shared/badges'
import { LoadingSpinner, EmptyState } from '@/components/shared/misc'
import PageGuide from '@/components/shared/PageGuide'
import GenerateDialog from '@/features/scripts/GenerateDialog'
import ManualDialog from '@/features/scripts/ManualDialog'
import ScriptViewDialog from '@/features/scripts/ScriptViewDialog'
import DraftEditorDialog from '@/features/scripts/DraftEditorDialog'
import IdeasAgentDialog from '@/features/scripts/IdeasAgentDialog'
import { fmtDate, fmtSec } from '@/lib/format'

const STATUSES = ['DRAFT', 'READY', 'SENT', 'APPROVED', 'NEEDS_EDIT', 'REJECTED']

export default function ScriptBuilder() {
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [genOpen, setGenOpen] = useState(false)
  const [agentOpen, setAgentOpen] = useState(false)
  const [manualOpen, setManualOpen] = useState(false)
  const [viewId, setViewId] = useState(null)
  const [draftOpen, setDraftOpen] = useState(null)

  const { data: scripts, isLoading } = useEntityList(GeneratedScripts, { sort: '-created_date', limit: 500 })
  const { data: drafts } = useEntityList(ScriptBuilderDrafts, { sort: '-created_date', limit: 50 })
  const pendingDrafts = (drafts || []).filter((d) => d.status === 'DRAFT')

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return (scripts || []).filter((s) => {
      if (statusFilter !== 'all' && s.status !== statusFilter) return false
      return !q || s.title?.toLowerCase().includes(q) || s.product?.toLowerCase().includes(q) || s.hook?.toLowerCase().includes(q)
    })
  }, [scripts, search, statusFilter])

  if (isLoading) return <LoadingSpinner size="lg" />

  return (
    <div className="space-y-4 animate-fade-in">
      <PageGuide pageName="ScriptBuilder" />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input className="pl-8" placeholder="Buscar scripts…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los status</SelectItem>
            {STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}
          </SelectContent>
        </Select>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" className="border-purple-300 text-purple-600 hover:bg-purple-50" onClick={() => setAgentOpen(true)}><Bot /> Ideas Nuevas (Agente)</Button>
          <Button variant="outline" className="border-indigo-300 text-indigo-600 hover:bg-indigo-50" onClick={() => setManualOpen(true)}><PenLine /> Create Manual</Button>
          <Button onClick={() => setGenOpen(true)}><Sparkles /> Generate Scripts</Button>
        </div>
      </div>

      {pendingDrafts.length > 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3">
          <p className="text-xs font-bold uppercase text-amber-600 mb-2 flex items-center gap-1"><FileEdit className="h-3.5 w-3.5" /> Borradores desde análisis de ads ({pendingDrafts.length})</p>
          <div className="flex flex-wrap gap-2">
            {pendingDrafts.map((d) => (
              <button key={d.id} onClick={() => setDraftOpen(d)} className="rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 hover:bg-amber-100">
                {d.source_ad_name || d.source_ad_id}
              </button>
            ))}
          </div>
        </div>
      )}

      {filtered.length === 0 ? (
        <EmptyState icon={Wand2} title="Sin scripts" description="Genera tu primer script con IA o créalo manualmente." action={<Button onClick={() => setGenOpen(true)}><Sparkles /> Generate Scripts</Button>} />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <button key={s.id} onClick={() => setViewId(s.id)} className="glass-card p-4 text-left transition-shadow hover:shadow-md">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-slate-800 leading-snug line-clamp-2">{s.title}</p>
                <StatusBadge status={s.status} />
              </div>
              <p className="mt-0.5 text-xs text-slate-400">{fmtDate(s.created_date)}</p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <FormatBadge format={s.format} size="sm" />
                {s.product && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">{s.product}</span>}
              </div>
              {s.hook && (
                <div className="mt-3 rounded-lg bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 p-2.5">
                  <p className="text-xs text-indigo-900 line-clamp-2">🪝 {s.hook}</p>
                </div>
              )}
              <div className="mt-2.5 flex items-center justify-between text-xs text-slate-400">
                <span>{fmtSec(s.duration_sec)}</span>
                {s.editor_rating && (
                  <span className="flex items-center gap-0.5 text-amber-500">
                    {Array.from({ length: s.editor_rating }).map((_, i) => <Star key={i} className="h-3 w-3 fill-current" />)}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      <GenerateDialog open={genOpen} onOpenChange={setGenOpen} />
      <IdeasAgentDialog open={agentOpen} onOpenChange={setAgentOpen} />
      <ManualDialog open={manualOpen} onOpenChange={setManualOpen} />
      {viewId && <ScriptViewDialog scriptId={viewId} onClose={() => setViewId(null)} />}
      {draftOpen && <DraftEditorDialog draft={draftOpen} onClose={() => setDraftOpen(null)} />}
    </div>
  )
}
