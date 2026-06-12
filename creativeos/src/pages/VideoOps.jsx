import { useMemo, useState } from 'react'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import { GripVertical, LayoutGrid, List, Plus, Search, Video, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { VideoAssets, GeneratedScripts, UserProfiles } from '@/api/entities'
import { notifyVideoUpdate } from '@/api/functions'
import { useEntityList } from '@/hooks/useData'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StatusBadge, FormatBadge, UserAvatar } from '@/components/shared/badges'
import { LoadingSpinner, EmptyState } from '@/components/shared/misc'
import PageGuide from '@/components/shared/PageGuide'
import VideoDetailModal from '@/features/videoops/VideoDetailModal'
import { KANBAN_COLUMNS, PHASES, FORMATS } from '@/features/videoops/constants'
import { cn } from '@/lib/utils'

function VideoCard({ video, index, editorsById, onOpen, canDrag }) {
  return (
    <Draggable draggableId={video.id} index={index} isDragDisabled={!canDrag}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          onClick={() => onOpen(video)}
          className={cn(
            'mb-2 cursor-pointer rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition-shadow hover:shadow-md',
            snapshot.isDragging && 'rotate-1 shadow-lg ring-2 ring-indigo-300'
          )}
        >
          <div className="flex items-start gap-2">
            <span {...provided.dragHandleProps} onClick={(e) => e.stopPropagation()} className={cn('mt-0.5 text-slate-300 hover:text-slate-500', !canDrag && 'opacity-30')}>
              <GripVertical className="h-4 w-4" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-mono text-slate-400">{video.video_asset_id || video.id.slice(0, 10)}</p>
              <p className="text-sm font-medium text-slate-800 leading-snug line-clamp-2">{video.title}</p>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <FormatBadge format={video.format} size="sm" />
                {video.product && <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-600">{video.product}</span>}
                <span className="ml-auto">
                  {video.assigned_editor_user_id && <UserAvatar name={editorsById[video.assigned_editor_user_id]?.name} size="sm" />}
                </span>
              </div>
            </div>
          </div>
        </div>
      )}
    </Draggable>
  )
}

function AddVideoDialog({ open, onOpenChange, editors, scripts }) {
  const [form, setForm] = useState({ title: '', product: '', format: 'UGC', assigned_editor_user_id: '', drive_file_url: '', related_generated_script_id: '' })
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  const save = async () => {
    if (!form.title.trim()) return toast.error('El título es obligatorio')
    setSaving(true)
    try {
      const driveId = form.drive_file_url.match(/\/d\/([^/?]+)/)?.[1] || null
      await VideoAssets.create({
        video_asset_id: `VID-${Date.now().toString().slice(-6)}`,
        title: form.title, product: form.product, format: form.format,
        assigned_editor_user_id: form.assigned_editor_user_id || null,
        drive_file_url: form.drive_file_url || null, drive_file_id: driveId,
        has_video_file: !!driveId,
        related_generated_script_id: form.related_generated_script_id || null,
        status: 'SCRIPT_DRAFT', source: 'UPLOADED', version: 1, processing_status: 'IDLE',
      })
      toast.success('Video creado')
      onOpenChange(false)
      setForm({ title: '', product: '', format: 'UGC', assigned_editor_user_id: '', drive_file_url: '', related_generated_script_id: '' })
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>Add New Video</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Title *</Label><Input className="mt-1" value={form.title} onChange={(e) => set('title', e.target.value)} placeholder="UGC ronquidos v3…" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><Label>Product</Label><Input className="mt-1" value={form.product} onChange={(e) => set('product', e.target.value)} placeholder="Quies Sleep" /></div>
            <div>
              <Label>Format</Label>
              <Select value={form.format} onValueChange={(v) => set('format', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{FORMATS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Assign to Editor</Label>
            <Select value={form.assigned_editor_user_id || 'none'} onValueChange={(v) => set('assigned_editor_user_id', v === 'none' ? '' : v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Sin asignar" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin asignar</SelectItem>
                {editors.map((e) => <SelectItem key={e.user_id} value={e.user_id}>{e.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div><Label>Google Drive URL (opcional)</Label><Input className="mt-1" value={form.drive_file_url} onChange={(e) => set('drive_file_url', e.target.value)} placeholder="https://drive.google.com/file/d/…" /></div>
          <div>
            <Label>Script (opcional)</Label>
            <Select value={form.related_generated_script_id || 'none'} onValueChange={(v) => set('related_generated_script_id', v === 'none' ? '' : v)}>
              <SelectTrigger className="mt-1"><SelectValue placeholder="Sin script" /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Sin script</SelectItem>
                {scripts.map((s) => <SelectItem key={s.id} value={s.id}>{s.title}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="animate-spin" />} Crear Video</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function VideoOps() {
  const { effectiveRole, currentUser } = useAuth()
  const readOnly = effectiveRole === 'VIEWER'
  const [view, setView] = useState('kanban')
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [selectedId, setSelectedId] = useState(null)

  const { data: videos, isLoading } = useEntityList(VideoAssets, { sort: '-updated_date', limit: 500 })
  const { data: scripts } = useEntityList(GeneratedScripts, { sort: '-created_date', limit: 200 })
  const { data: profiles } = useEntityList(UserProfiles, { staleTime: 300_000 })

  const editors = useMemo(() => (profiles || []).filter((p) => ['EDITOR', 'MANAGER', 'ADMIN'].includes(p.custom_role)), [profiles])
  const editorsById = useMemo(() => Object.fromEntries((profiles || []).map((p) => [p.user_id, p])), [profiles])

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return (videos || []).filter((v) => !q || v.title?.toLowerCase().includes(q) || v.product?.toLowerCase().includes(q))
  }, [videos, search])

  const byColumn = useMemo(() => {
    const map = {}
    for (const col of KANBAN_COLUMNS) map[col.id] = []
    for (const v of filtered) (map[v.status] || (map[v.status] = [])).push(v)
    return map
  }, [filtered])

  const onDragEnd = async ({ draggableId, destination, source }) => {
    if (!destination || destination.droppableId === source.droppableId) return
    const video = (videos || []).find((v) => v.id === draggableId)
    if (!video) return
    await VideoAssets.update(draggableId, { status: destination.droppableId })
    notifyVideoUpdate({ video, newStatus: destination.droppableId, byName: currentUser?.full_name })
    toast.success(`"${video.title}" → ${destination.droppableId.replace(/_/g, ' ')}`)
  }

  if (isLoading) return <LoadingSpinner size="lg" />

  return (
    <div className="space-y-4 animate-fade-in">
      <PageGuide pageName="VideoOps" />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input className="pl-8" placeholder="Buscar por título o producto…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <div className="flex rounded-lg border border-slate-200 bg-white/70 p-0.5">
          <button onClick={() => setView('kanban')} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm', view === 'kanban' ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-slate-500 hover:text-slate-700')}>
            <LayoutGrid className="h-4 w-4" /> Kanban
          </button>
          <button onClick={() => setView('list')} className={cn('flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm', view === 'list' ? 'bg-indigo-100 text-indigo-700 font-medium' : 'text-slate-500 hover:text-slate-700')}>
            <List className="h-4 w-4" /> List
          </button>
        </div>
        {!readOnly && <Button onClick={() => setAddOpen(true)}><Plus /> Add Video</Button>}
      </div>

      {view === 'kanban' ? (
        <DragDropContext onDragEnd={onDragEnd}>
          <div className="space-y-6">
            {PHASES.map((phase) => {
              const cols = KANBAN_COLUMNS.filter((c) => c.phase === phase.id)
              return (
                <div key={phase.id}>
                  <h3 className="mb-2 text-sm font-semibold text-slate-500">{phase.title}</h3>
                  <div className={cn('grid gap-3', cols.length === 1 ? 'grid-cols-1 max-w-md' : 'grid-cols-1 sm:grid-cols-2')}>
                    {cols.map((col) => (
                      <div key={col.id} className="rounded-xl border border-slate-200/60 bg-white/40 backdrop-blur-sm">
                        <div className="flex items-center gap-2 px-3 py-2.5">
                          <span className={cn('h-2 w-2 rounded-full', col.dot)} />
                          <span className="text-sm font-semibold text-slate-700">{col.title}</span>
                          <span className="ml-auto rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-500">{byColumn[col.id]?.length || 0}</span>
                        </div>
                        <Droppable droppableId={col.id}>
                          {(provided, snapshot) => (
                            <div
                              ref={provided.innerRef}
                              {...provided.droppableProps}
                              className={cn('min-h-[300px] px-2 pb-2 rounded-b-xl transition-colors', snapshot.isDraggingOver && 'bg-indigo-50')}
                            >
                              {(byColumn[col.id] || []).map((v, i) => (
                                <VideoCard key={v.id} video={v} index={i} editorsById={editorsById} onOpen={(vid) => setSelectedId(vid.id)} canDrag={!readOnly} />
                              ))}
                              {provided.placeholder}
                            </div>
                          )}
                        </Droppable>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </DragDropContext>
      ) : (
        <div className="glass-card overflow-hidden">
          {filtered.length === 0 ? (
            <EmptyState icon={Video} title="Sin videos" description="Crea el primero con Add Video" />
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100 text-left text-xs text-slate-400">
                  <th className="px-4 py-2.5 font-medium">Video</th>
                  <th className="px-4 py-2.5 font-medium hidden sm:table-cell">Producto</th>
                  <th className="px-4 py-2.5 font-medium hidden md:table-cell">Formato</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium">Editor</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((v) => (
                  <tr key={v.id} onClick={() => setSelectedId(v.id)} className="cursor-pointer border-b border-slate-50 hover:bg-indigo-50/40">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <Video className="h-4 w-4 text-slate-300 shrink-0" />
                        <span className="font-medium text-slate-800 line-clamp-1">{v.title}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">{v.product}</td>
                    <td className="px-4 py-3 hidden md:table-cell"><FormatBadge format={v.format} size="sm" /></td>
                    <td className="px-4 py-3"><StatusBadge status={v.status} /></td>
                    <td className="px-4 py-3">{v.assigned_editor_user_id ? <UserAvatar name={editorsById[v.assigned_editor_user_id]?.name} size="sm" /> : <span className="text-slate-300">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      <AddVideoDialog open={addOpen} onOpenChange={setAddOpen} editors={editors} scripts={scripts || []} />
      {selectedId && (
        <VideoDetailModal
          videoId={selectedId}
          onClose={() => setSelectedId(null)}
          editors={editors}
          editorsById={editorsById}
          readOnly={readOnly}
        />
      )}
    </div>
  )
}
