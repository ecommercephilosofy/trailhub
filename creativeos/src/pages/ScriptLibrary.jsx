import { useMemo, useState } from 'react'
import { ExternalLink, Library, Search, Star } from 'lucide-react'
import { ScriptLibrary as LibEntity } from '@/api/entities'
import { useEntityList } from '@/hooks/useData'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog'
import { StatusBadge, FormatBadge } from '@/components/shared/badges'
import { LoadingSpinner, EmptyState } from '@/components/shared/misc'
import PageGuide from '@/components/shared/PageGuide'

export default function ScriptLibrary() {
  const [search, setSearch] = useState('')
  const [status, setStatus] = useState('all')
  const [selected, setSelected] = useState(null)
  const { data: scripts, isLoading } = useEntityList(LibEntity, { sort: '-created_date', limit: 500 })

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return (scripts || []).filter((s) => {
      if (status !== 'all' && s.status !== status) return false
      return !q || s.title?.toLowerCase().includes(q) || s.product?.toLowerCase().includes(q) || (s.tags || []).some((t) => t.includes(q))
    })
  }, [scripts, search, status])

  if (isLoading) return <LoadingSpinner size="lg" />

  return (
    <div className="space-y-4 animate-fade-in">
      <PageGuide pageName="ScriptLibrary" />
      <div className="flex flex-wrap gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input className="pl-8" placeholder="Buscar por título, producto o tag…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={status} onValueChange={setStatus}>
          <SelectTrigger className="w-[140px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            <SelectItem value="BASE">BASE</SelectItem>
            <SelectItem value="ITERATION">ITERATION</SelectItem>
            <SelectItem value="ARCHIVED">ARCHIVED</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Library} title="Biblioteca vacía" description="Los scripts base sincronizados desde Google Drive aparecerán aquí." />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((s) => (
            <button key={s.id} onClick={() => setSelected(s)} className="glass-card p-4 text-left hover:shadow-md transition-shadow">
              <div className="flex items-start justify-between gap-2">
                <p className="font-medium text-slate-800 leading-snug line-clamp-2">{s.title}</p>
                <StatusBadge status={s.status} />
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <FormatBadge format={s.format} size="sm" />
                {s.product && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] text-slate-600">{s.product}</span>}
                {s.linked_ad_id && <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] text-emerald-600">ad vinculado</span>}
              </div>
              <div className="mt-2 flex items-center justify-between">
                <div className="flex flex-wrap gap-1">
                  {(s.tags || []).slice(0, 3).map((t) => <span key={t} className="text-[10px] text-indigo-500">#{t}</span>)}
                </div>
                {s.internal_rating && (
                  <span className="flex items-center gap-0.5 text-amber-500">
                    {Array.from({ length: s.internal_rating }).map((_, i) => <Star key={i} className="h-3 w-3 fill-current" />)}
                  </span>
                )}
              </div>
            </button>
          ))}
        </div>
      )}

      {selected && (
        <Dialog open onOpenChange={(o) => !o && setSelected(null)}>
          <DialogContent className="max-w-2xl">
            <DialogHeader>
              <DialogTitle className="pr-8">{selected.title}</DialogTitle>
              <DialogDescription className="flex flex-wrap items-center gap-2">
                <StatusBadge status={selected.status} /> <FormatBadge format={selected.format} size="sm" /> {selected.product}
                {selected.linked_ad_id && <span className="font-mono text-[10px]">ad: {selected.linked_ad_id}</span>}
              </DialogDescription>
            </DialogHeader>
            <pre className="max-h-96 overflow-y-auto scrollbar-thin whitespace-pre-wrap rounded-lg bg-slate-50 p-4 font-mono text-xs text-slate-700">
              {selected.texto_script_cached || 'Sin texto cacheado'}
            </pre>
            {selected.doc_url && (
              <a href={selected.doc_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-sm text-indigo-600 hover:underline">
                <ExternalLink className="h-4 w-4" /> Abrir en Google Docs
              </a>
            )}
          </DialogContent>
        </Dialog>
      )}
    </div>
  )
}
