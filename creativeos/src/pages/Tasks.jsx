import { useMemo, useState } from 'react'
import { CheckSquare, MoreVertical, Pencil, Plus, Search, Trash2, Loader2, CalendarDays } from 'lucide-react'
import { toast } from 'sonner'
import { Tasks as TasksEntity, VideoAssets, UserProfiles } from '@/api/entities'
import { notifyTaskAssignment } from '@/api/functions'
import { useEntityList } from '@/hooks/useData'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StatusBadge, PriorityBadge, UserAvatar } from '@/components/shared/badges'
import { LoadingSpinner, EmptyState } from '@/components/shared/misc'
import PageGuide from '@/components/shared/PageGuide'
import { FORMATS } from '@/features/videoops/constants'
import { fmtDate } from '@/lib/format'
import { cn } from '@/lib/utils'

const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'REVIEW', 'DONE', 'BLOCKED']
const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']
const EMPTY_FORM = { title: '', description: '', priority: 'MEDIUM', status: 'TODO', product: '', format: 'UGC', assignee_user_id: '', due_date: '' }

function TaskDialog({ open, onOpenChange, editing, profiles }) {
  const [form, setForm] = useState(editing || EMPTY_FORM)
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }))

  useMemo(() => setForm(editing || EMPTY_FORM), [editing, open])

  const save = async () => {
    if (!form.title.trim()) return toast.error('Título obligatorio')
    setSaving(true)
    try {
      const assignee = profiles.find((p) => p.user_id === form.assignee_user_id)
      const payload = { ...form, assignee_name: assignee?.name || null, assignee_user_id: form.assignee_user_id || null, due_date: form.due_date || null }
      if (editing?.id) {
        const assigneeChanged = editing.assignee_user_id !== payload.assignee_user_id && payload.assignee_user_id
        await TasksEntity.update(editing.id, payload)
        if (assigneeChanged) await notifyTaskAssignment({ task: payload, assignee: { user_id: payload.assignee_user_id } })
        toast.success('Tarea actualizada')
      } else {
        // 1. create task
        const task = await TasksEntity.create(payload)
        // 2. auto-create linked VideoAsset
        const video = await VideoAssets.create({
          video_asset_id: `VID-${Date.now().toString().slice(-6)}`,
          title: form.title, product: form.product, format: form.format,
          status: 'SCRIPT_DRAFT', source: 'TASK', version: 1, processing_status: 'IDLE',
          related_task_id: task.id, assigned_editor_user_id: payload.assignee_user_id,
        })
        // 3. link back
        await TasksEntity.update(task.id, { related_video_asset_id: video.id })
        // 4. notify
        if (payload.assignee_user_id) await notifyTaskAssignment({ task: payload, assignee: { user_id: payload.assignee_user_id } })
        toast.success('Tarea creada + video en VideoOps')
      }
      onOpenChange(false)
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader><DialogTitle>{editing?.id ? 'Editar tarea' : 'Nueva tarea'}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label>Title *</Label><Input className="mt-1" value={form.title} onChange={(e) => set('title', e.target.value)} /></div>
          <div><Label>Description</Label><Textarea rows={3} className="mt-1" value={form.description || ''} onChange={(e) => set('description', e.target.value)} /></div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Priority</Label>
              <Select value={form.priority} onValueChange={(v) => set('priority', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{PRIORITIES.map((p) => <SelectItem key={p} value={p}>{p}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Status</Label>
              <Select value={form.status} onValueChange={(v) => set('status', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div><Label>Product</Label><Input className="mt-1" value={form.product || ''} onChange={(e) => set('product', e.target.value)} /></div>
            <div>
              <Label>Format</Label>
              <Select value={form.format} onValueChange={(v) => set('format', v)}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{FORMATS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Assignee</Label>
              <Select value={form.assignee_user_id || 'none'} onValueChange={(v) => set('assignee_user_id', v === 'none' ? '' : v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Sin asignar" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin asignar</SelectItem>
                  {profiles.map((p) => <SelectItem key={p.user_id} value={p.user_id}>{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div><Label>Due Date</Label><Input type="date" className="mt-1" value={form.due_date || ''} onChange={(e) => set('due_date', e.target.value)} /></div>
          </div>
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="animate-spin" />} {editing?.id ? 'Guardar' : 'Crear tarea'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

export default function Tasks() {
  const { effectiveRole, currentUser } = useAuth()
  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState(null)

  const isEditor = effectiveRole === 'EDITOR'
  const { data: tasks, isLoading } = useEntityList(TasksEntity, {
    sort: '-created_date', limit: 300,
    filter: isEditor ? { assignee_user_id: currentUser?.id } : undefined,
  })
  const { data: profiles } = useEntityList(UserProfiles, { staleTime: 300_000 })

  const filtered = useMemo(() => {
    const q = search.toLowerCase()
    return (tasks || []).filter((t) => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      return !q || t.title?.toLowerCase().includes(q) || t.description?.toLowerCase().includes(q)
    })
  }, [tasks, search, statusFilter])

  const toggleDone = async (task) => {
    await TasksEntity.update(task.id, { status: task.status === 'DONE' ? 'TODO' : 'DONE' })
  }

  const del = async (task) => {
    if (!confirm(`¿Eliminar tarea "${task.title}"?`)) return
    await TasksEntity.delete(task.id)
    toast.success('Tarea eliminada')
  }

  if (isLoading) return <LoadingSpinner size="lg" />

  return (
    <div className="space-y-4 animate-fade-in">
      <PageGuide pageName="Tasks" />
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <Input className="pl-8" placeholder="Buscar tareas…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Select value={statusFilter} onValueChange={setStatusFilter}>
          <SelectTrigger className="w-[150px]"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos</SelectItem>
            {TASK_STATUSES.map((s) => <SelectItem key={s} value={s}>{s.replace(/_/g, ' ')}</SelectItem>)}
          </SelectContent>
        </Select>
        <Button className="ml-auto" onClick={() => { setEditing(null); setDialogOpen(true) }}><Plus /> Add Task</Button>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={CheckSquare} title="Sin tareas" description="Crea la primera tarea de producción." />
      ) : (
        <div className="space-y-2.5">
          {filtered.map((t) => {
            const done = t.status === 'DONE'
            return (
              <div key={t.id} className={cn('glass-card flex items-start gap-3 p-4', done && 'opacity-60')}>
                <Checkbox checked={done} onCheckedChange={() => toggleDone(t)} className="mt-1" />
                <div className="min-w-0 flex-1">
                  <p className={cn('font-medium text-slate-800', done && 'line-through')}>{t.title}</p>
                  {t.description && <p className="mt-0.5 text-sm text-slate-500 line-clamp-2">{t.description}</p>}
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <PriorityBadge priority={t.priority} />
                    <StatusBadge status={t.status} />
                    {t.due_date && (
                      <span className="flex items-center gap-1 text-xs text-slate-400"><CalendarDays className="h-3 w-3" /> {fmtDate(t.due_date)}</span>
                    )}
                    {t.assignee_name && <UserAvatar name={t.assignee_name} size="sm" />}
                  </div>
                </div>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100"><MoreVertical className="h-4 w-4" /></button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onClick={() => { setEditing(t); setDialogOpen(true) }}><Pencil /> Edit</DropdownMenuItem>
                    <DropdownMenuItem className="text-red-600" onClick={() => del(t)}><Trash2 /> Delete</DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )
          })}
        </div>
      )}

      <TaskDialog open={dialogOpen} onOpenChange={setDialogOpen} editing={editing} profiles={profiles || []} />
    </div>
  )
}
