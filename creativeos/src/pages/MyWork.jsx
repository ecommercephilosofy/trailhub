import { useMemo } from 'react'
import { Briefcase, CheckSquare, Clapperboard, ListVideo } from 'lucide-react'
import { Tasks, EditorQueue, VideoAssets, GeneratedScripts } from '@/api/entities'
import { useEntityList } from '@/hooks/useData'
import { useAuth } from '@/context/AuthContext'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { StatusBadge, PriorityBadge, FormatBadge } from '@/components/shared/badges'
import { LoadingSpinner, EmptyState } from '@/components/shared/misc'
import PageGuide from '@/components/shared/PageGuide'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'

const VIDEO_STATUSES = ['SCRIPT_DRAFT', 'TODO', 'IN_PROGRESS', 'REVIEW', 'APPROVED', 'PUBLISHED', 'ARCHIVED']
const Q_STATUSES = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE']

export default function MyWork() {
  const { currentUser } = useAuth()
  const uid = currentUser?.id
  const { data: tasks, isLoading } = useEntityList(Tasks, { filter: { assignee_user_id: uid }, sort: '-created_date', enabled: !!uid })
  const { data: queue } = useEntityList(EditorQueue, { filter: { assigned_editor_user_id: uid }, sort: '-created_date', enabled: !!uid })
  const { data: videos } = useEntityList(VideoAssets, { filter: { assigned_editor_user_id: uid }, sort: '-updated_date', enabled: !!uid })
  const { data: scripts } = useEntityList(GeneratedScripts, { filter: { assigned_editor_user_id: uid }, sort: '-created_date', enabled: !!uid })

  const pendingScripts = useMemo(() => (scripts || []).filter((s) => ['READY', 'SENT', 'APPROVED'].includes(s.status)), [scripts])
  const activeTasks = (tasks || []).filter((t) => t.status !== 'DONE')
  const activeVideos = (videos || []).filter((v) => !['PUBLISHED', 'ARCHIVED'].includes(v.status))

  if (isLoading) return <LoadingSpinner size="lg" />

  return (
    <div className="space-y-4 animate-fade-in">
      <PageGuide pageName="MyWork" />

      <div className="grid grid-cols-3 gap-3">
        {[['Tareas activas', activeTasks.length, CheckSquare], ['En mi cola', (queue || []).filter((q) => q.status !== 'DONE').length, ListVideo], ['Videos en curso', activeVideos.length, Clapperboard]].map(([label, value, Icon]) => (
          <Card key={label}>
            <CardContent className="p-4 flex items-center gap-3">
              <Icon className="h-5 w-5 text-indigo-500" />
              <div><p className="text-xl font-bold text-slate-900">{value}</p><p className="text-xs text-slate-400">{label}</p></div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle className="text-sm">Mis tareas</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(tasks || []).length === 0 && <EmptyState icon={Briefcase} title="Sin tareas asignadas" />}
            {(tasks || []).slice(0, 8).map((t) => (
              <div key={t.id} className={cn('flex items-center gap-2.5 rounded-lg border border-slate-100 bg-white/60 p-2.5', t.status === 'DONE' && 'opacity-50')}>
                <Checkbox checked={t.status === 'DONE'} onCheckedChange={() => Tasks.update(t.id, { status: t.status === 'DONE' ? 'TODO' : 'DONE' })} />
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm font-medium text-slate-800 truncate', t.status === 'DONE' && 'line-through')}>{t.title}</p>
                  <p className="text-[10px] text-slate-400">{t.due_date ? `Due ${fmtDate(t.due_date)}` : 'Sin fecha'}</p>
                </div>
                <PriorityBadge priority={t.priority} />
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Mi cola de edición</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(queue || []).length === 0 && <EmptyState icon={ListVideo} title="Cola vacía" />}
            {(queue || []).slice(0, 8).map((q) => (
              <div key={q.id} className="rounded-lg border border-slate-100 bg-white/60 p-2.5">
                <div className="flex items-center gap-2">
                  <p className="flex-1 truncate text-sm font-medium text-slate-800">{q.script_title}</p>
                  <Select value={q.status} onValueChange={(v) => EditorQueue.update(q.id, { status: v })}>
                    <SelectTrigger className="h-7 w-[130px] text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{Q_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                {q.brief_for_editor && <p className="mt-1.5 text-xs text-slate-500 line-clamp-2">{q.brief_for_editor}</p>}
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Mis videos</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {(videos || []).length === 0 && <EmptyState icon={Clapperboard} title="Sin videos asignados" />}
            {(videos || []).slice(0, 8).map((v) => (
              <div key={v.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white/60 p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{v.title}</p>
                  <FormatBadge format={v.format} size="sm" />
                </div>
                <Select value={v.status} onValueChange={(s) => VideoAssets.update(v.id, { status: s })}>
                  <SelectTrigger className="h-7 w-[140px] text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>{VIDEO_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
                </Select>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-sm">Scripts pendientes de producir</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {pendingScripts.length === 0 && <EmptyState icon={Briefcase} title="Nada pendiente 🎉" />}
            {pendingScripts.slice(0, 8).map((s) => (
              <div key={s.id} className="flex items-center gap-2 rounded-lg border border-slate-100 bg-white/60 p-2.5">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-slate-800">{s.title}</p>
                  <p className="truncate text-xs text-slate-400">🪝 {s.hook}</p>
                </div>
                <StatusBadge status={s.status} />
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}
