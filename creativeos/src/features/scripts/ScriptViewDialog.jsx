import { useEffect, useState } from 'react'
import { Clapperboard, FileText, Eye, Info, Loader2, Save, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { GeneratedScripts, VideoAssets, Tasks, EditorQueue, UserProfiles } from '@/api/entities'
import { notifyTaskAssignment } from '@/api/functions'
import { useEntityList } from '@/hooks/useData'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StatusBadge, FormatBadge } from '@/components/shared/badges'
import { fmtRoas, fmtSec } from '@/lib/format'

export default function ScriptViewDialog({ scriptId, onClose }) {
  const [script, setScript] = useState(null)
  const [edits, setEdits] = useState({})
  const [busy, setBusy] = useState(false)
  const { data: profiles } = useEntityList(UserProfiles, { staleTime: 300_000 })
  const { data: tasks } = useEntityList(Tasks, { sort: '-created_date', limit: 100 })
  const editors = (profiles || []).filter((p) => ['EDITOR', 'MANAGER', 'ADMIN'].includes(p.custom_role))
  const activeTasks = (tasks || []).filter((t) => !['DONE'].includes(t.status))

  useEffect(() => {
    let alive = true
    GeneratedScripts.get(scriptId).then((s) => { if (alive) { setScript(s); setEdits({ hook: s?.hook, full_script: s?.full_script, cta: s?.cta }) } })
    return () => { alive = false }
  }, [scriptId])

  if (!script) return null

  const saveChanges = async () => {
    await GeneratedScripts.update(script.id, edits)
    setScript({ ...script, ...edits })
    toast.success('Cambios guardados')
  }

  const createVideoTask = async () => {
    setBusy(true)
    try {
      const editorId = script.assigned_editor_user_id || null
      const editorProfile = editors.find((e) => e.user_id === editorId)
      // 1. VideoAsset
      const video = await VideoAssets.create({
        video_asset_id: `VID-${Date.now().toString().slice(-6)}`,
        title: script.title, product: script.product, format: script.format,
        avatar_id: script.avatar_id, angle_id: script.angle_id, desire_id: script.desire_id,
        status: 'SCRIPT_DRAFT', source: 'TASK', version: 1, processing_status: 'IDLE',
        related_generated_script_id: script.id, assigned_editor_user_id: editorId,
        duration_sec: script.duration_sec,
      })
      // 2. Task
      const task = await Tasks.create({
        title: `Producir: ${script.title}`,
        description: `Hook: ${script.hook?.slice(0, 120)}`,
        assignee_user_id: editorId, assignee_name: editorProfile?.name || null,
        related_video_asset_id: video.id, related_generated_script_id: script.id,
        script_text: script.full_script, product: script.product, format: script.format,
        priority: 'MEDIUM', status: 'TODO',
      })
      // 3. EditorQueue
      await EditorQueue.create({
        script_title: script.title, product: script.product, format: script.format,
        priority: 'MEDIUM', status: 'TODO', generated_script_id: script.id, video_asset_id: video.id,
        brief_for_editor: `Hook: ${script.hook}\nCTA: ${script.cta || '—'}\nChecklist: ${(script.editing_checklist || []).join(' · ')}`,
        assigned_editor_user_id: editorId,
      })
      // 4. Discord
      if (editorId) await notifyTaskAssignment({ task, assignee: { user_id: editorId } })
      // 5. Auto-approve
      await GeneratedScripts.update(script.id, { status: 'APPROVED', assigned_to_task_id: task.id })
      toast.success('Creado: video en VideoOps + tarea + cola de edición ✅')
      onClose()
    } finally { setBusy(false) }
  }

  const assignToTask = async (taskId) => {
    await GeneratedScripts.update(script.id, { assigned_to_task_id: taskId })
    await Tasks.update(taskId, { related_generated_script_id: script.id, script_text: script.full_script })
    setScript({ ...script, assigned_to_task_id: taskId })
    toast.success('Asignado a la tarea')
  }

  const deleteScript = async () => {
    if (!confirm(`¿Eliminar "${script.title}"?`)) return
    await GeneratedScripts.delete(script.id)
    toast.success('Script eliminado')
    onClose()
  }

  const basedOn = script.based_on

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle className="flex-1 min-w-[200px]">{script.title}</DialogTitle>
            <StatusBadge status={script.status} />
            <FormatBadge format={script.format} />
          </div>
        </DialogHeader>
        <Tabs defaultValue="script">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="script"><FileText className="h-3.5 w-3.5" /> Script</TabsTrigger>
            <TabsTrigger value="visuals"><Eye className="h-3.5 w-3.5" /> Visuals</TabsTrigger>
            <TabsTrigger value="details"><Info className="h-3.5 w-3.5" /> Details</TabsTrigger>
          </TabsList>

          <TabsContent value="script" className="space-y-4">
            <Button onClick={createVideoTask} disabled={busy} className="w-full">
              {busy ? <Loader2 className="animate-spin" /> : <Clapperboard />} Crear Tarea en VideoOps
            </Button>
            <div>
              <Label>Hook</Label>
              <Textarea rows={2} className="mt-1 bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200 font-medium" value={edits.hook || ''} onChange={(e) => setEdits({ ...edits, hook: e.target.value })} />
            </div>
            <div>
              <Label>Full Script</Label>
              <Textarea rows={20} className="mt-1 font-mono text-xs" value={edits.full_script || ''} onChange={(e) => setEdits({ ...edits, full_script: e.target.value })} />
            </div>
            <div>
              <Label>CTA</Label>
              <Textarea rows={1} className="mt-1 bg-emerald-50 border-emerald-200" value={edits.cta || ''} onChange={(e) => setEdits({ ...edits, cta: e.target.value })} />
            </div>
            <Button variant="outline" onClick={saveChanges}><Save /> Guardar Cambios</Button>
          </TabsContent>

          <TabsContent value="visuals" className="space-y-4">
            <div>
              <Label>On-Screen Text</Label>
              <ol className="mt-1.5 space-y-1">
                {(script.on_screen_text || []).map((t, i) => (
                  <li key={i} className="flex gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm"><span className="font-bold text-indigo-500">{i + 1}.</span> {t}</li>
                ))}
                {!script.on_screen_text?.length && <p className="text-sm text-slate-400">—</p>}
              </ol>
            </div>
            <div>
              <Label>Shotlist</Label>
              <div className="mt-1.5 space-y-1">
                {(script.shotlist || []).map((s, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-1.5 text-sm">
                    <span className="rounded bg-indigo-100 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700">Shot {i + 1}</span> {s}
                  </div>
                ))}
                {!script.shotlist?.length && <p className="text-sm text-slate-400">—</p>}
              </div>
            </div>
            <div>
              <Label>B-Roll Suggestions</Label>
              <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-sm text-slate-600">
                {(script.broll_suggestions || []).map((b, i) => <li key={i}>{b}</li>)}
                {!script.broll_suggestions?.length && <p className="text-sm text-slate-400 list-none -ml-5">—</p>}
              </ul>
            </div>
            <div>
              <Label>Editing Checklist</Label>
              <div className="mt-1.5 space-y-1">
                {(script.editing_checklist || []).map((c, i) => (
                  <p key={i} className="flex items-start gap-2 text-sm text-slate-600"><span>☐</span> {c}</p>
                ))}
              </div>
            </div>
          </TabsContent>

          <TabsContent value="details" className="space-y-4">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {[['Product', script.product], ['Format', script.format?.replace(/_/g, '-')], ['Duration', fmtSec(script.duration_sec)], ['Language', (script.language || 'es').toUpperCase()]].map(([k, v]) => (
                <div key={k} className="rounded-lg bg-slate-50 p-3">
                  <p className="text-[10px] font-bold uppercase text-slate-400">{k}</p>
                  <p className="text-sm font-medium text-slate-800">{v || '—'}</p>
                </div>
              ))}
            </div>
            {basedOn && (
              <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
                <p className="text-xs font-bold uppercase text-amber-600">Based On</p>
                {basedOn.source_ad_name && <p className="mt-1 text-sm font-medium text-slate-800">{basedOn.source_ad_name}</p>}
                <div className="mt-1 flex flex-wrap gap-3 text-xs text-slate-600">
                  {basedOn.source_roas && <span>ROAS original: <b>{fmtRoas(basedOn.source_roas)}</b></span>}
                  <span>Método: <b>{basedOn.method || '—'}</b></span>
                  {basedOn.model && <span>Modelo: <b>{basedOn.model}</b></span>}
                </div>
              </div>
            )}
            <div>
              <Label>Asignar a tarea existente</Label>
              <Select value={script.assigned_to_task_id || 'none'} onValueChange={(v) => v !== 'none' && assignToTask(v)}>
                <SelectTrigger className="mt-1"><SelectValue placeholder="Sin tarea" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Sin tarea</SelectItem>
                  {activeTasks.map((t) => <SelectItem key={t.id} value={t.id}>{t.title}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {['DRAFT', 'READY', 'APPROVED'].includes(script.status) && (
              <Button variant="destructive" onClick={deleteScript}><Trash2 /> Eliminar Script</Button>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
