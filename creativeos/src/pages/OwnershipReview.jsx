import { useMemo } from 'react'
import { UserCheck, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { VideoAssets, GeneratedScripts, EditorQueue, UserProfiles } from '@/api/entities'
import { useEntityList } from '@/hooks/useData'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StatusBadge, FormatBadge } from '@/components/shared/badges'
import { LoadingSpinner, EmptyState } from '@/components/shared/misc'
import PageGuide from '@/components/shared/PageGuide'

export default function OwnershipReview() {
  const { data: videos, isLoading } = useEntityList(VideoAssets, { sort: '-created_date', limit: 300 })
  const { data: scripts } = useEntityList(GeneratedScripts, { sort: '-created_date', limit: 300 })
  const { data: queue } = useEntityList(EditorQueue, { sort: '-created_date', limit: 300 })
  const { data: profiles } = useEntityList(UserProfiles, { staleTime: 300_000 })

  const editors = useMemo(() => (profiles || []).filter((p) => ['EDITOR', 'MANAGER', 'ADMIN'].includes(p.custom_role)), [profiles])

  const orphanVideos = useMemo(() => (videos || []).filter((v) => !v.assigned_editor_user_id && !['PUBLISHED', 'ARCHIVED'].includes(v.status)), [videos])
  const orphanScripts = useMemo(() => (scripts || []).filter((s) => !s.assigned_editor_user_id && ['READY', 'SENT', 'APPROVED'].includes(s.status)), [scripts])
  const orphanQueue = useMemo(() => (queue || []).filter((q) => !q.assigned_editor_user_id && q.status !== 'DONE'), [queue])

  if (isLoading) return <LoadingSpinner size="lg" />

  const assign = (entity, label) => async (id, userId) => {
    await entity.update(id, { assigned_editor_user_id: userId })
    toast.success(`${label} asignado`)
  }

  const Section = ({ title, items, entity, render }) => (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm flex items-center gap-2">
          {items.length > 0 && <AlertTriangle className="h-4 w-4 text-amber-500" />} {title}
          <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{items.length}</span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        {items.length === 0 && <p className="py-2 text-center text-sm text-emerald-600">✅ Todo asignado</p>}
        {items.map((item) => (
          <div key={item.id} className="flex flex-wrap items-center gap-2.5 rounded-lg border border-slate-100 bg-white/60 p-3">
            {render(item)}
            <Select onValueChange={(v) => assign(entity, 'Item')(item.id, v)}>
              <SelectTrigger className="h-8 w-[170px] text-xs"><SelectValue placeholder="Asignar a…" /></SelectTrigger>
              <SelectContent>
                {editors.map((e) => <SelectItem key={e.user_id} value={e.user_id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        ))}
      </CardContent>
    </Card>
  )

  return (
    <div className="space-y-4 animate-fade-in">
      <PageGuide pageName="OwnershipReview" />
      <p className="text-sm text-slate-500 flex items-center gap-2"><UserCheck className="h-4 w-4" /> Trabajo activo sin owner. Todo lo que está aquí no avanza solo.</p>
      <Section
        title="Videos sin editor" items={orphanVideos} entity={VideoAssets}
        render={(v) => (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-800">{v.title}</p>
            <div className="mt-0.5 flex items-center gap-1.5"><StatusBadge status={v.status} /><FormatBadge format={v.format} size="sm" /></div>
          </div>
        )}
      />
      <Section
        title="Scripts aprobados sin editor" items={orphanScripts} entity={GeneratedScripts}
        render={(s) => (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-800">{s.title}</p>
            <div className="mt-0.5 flex items-center gap-1.5"><StatusBadge status={s.status} /><FormatBadge format={s.format} size="sm" /></div>
          </div>
        )}
      />
      <Section
        title="Items de cola sin editor" items={orphanQueue} entity={EditorQueue}
        render={(q) => (
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-slate-800">{q.script_title}</p>
            <div className="mt-0.5 flex items-center gap-1.5"><StatusBadge status={q.status} />{q.product && <span className="text-xs text-slate-400">{q.product}</span>}</div>
          </div>
        )}
      />
    </div>
  )
}
