import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, Copy, FileText, Info, Plus, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  VideoAssets, VideoAnnotations, GeneratedScripts, InspirationAds,
  AvatarProfiles, AngleLibrary, DesireLibrary, CreateFileSignedUrl,
} from '@/api/entities'
import { notifyVideoUpdate, notifyVideoAnnotation } from '@/api/functions'
import { useEntityList } from '@/hooks/useData'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select'
import { StatusBadge, FormatBadge } from '@/components/shared/badges'
import { EmptyState } from '@/components/shared/misc'
import { KANBAN_COLUMNS, PHASES, FORMATS } from './constants'
import { extractDriveFileId } from '@/lib/utils'
import { fmtDate } from '@/lib/format'

function VideoPlayer({ video }) {
  const [signedUrl, setSignedUrl] = useState(null)
  useEffect(() => {
    let alive = true
    if (video.video_file_uri) {
      CreateFileSignedUrl(video.video_file_uri).then((r) => alive && setSignedUrl(r.signed_url))
    } else setSignedUrl(null)
    return () => { alive = false }
  }, [video.video_file_uri])

  if (video.video_file_uri && signedUrl) {
    return <video controls src={signedUrl} className="w-full rounded-xl bg-black aspect-video" />
  }
  if (video.drive_file_url) {
    const fileId = video.drive_file_id || extractDriveFileId(video.drive_file_url)
    if (fileId) {
      return (
        <iframe
          src={`https://drive.google.com/file/d/${fileId}/preview`}
          className="w-full rounded-xl aspect-video bg-slate-100"
          sandbox="allow-same-origin allow-scripts allow-popups allow-forms"
          allow="autoplay"
          title="Video preview"
        />
      )
    }
    if (/\.(mp4|mov|webm)(\?|$)/i.test(video.drive_file_url)) {
      return <video controls src={video.drive_file_url} className="w-full rounded-xl bg-black aspect-video" />
    }
  }
  return null
}

function AutoSaveTextarea({ value, onSave, ...props }) {
  const [v, setV] = useState(value ?? '')
  useEffect(() => setV(value ?? ''), [value])
  return <Textarea value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== (value ?? '')) onSave(v) }} {...props} />
}
function AutoSaveInput({ value, onSave, ...props }) {
  const [v, setV] = useState(value ?? '')
  useEffect(() => setV(value ?? ''), [value])
  return <Input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== (value ?? '')) onSave(v) }} {...props} />
}

function ScriptTabContent({ video, readOnly }) {
  const [script, setScript] = useState(null)
  const [research, setResearch] = useState({})
  useEffect(() => {
    let alive = true
    ;(async () => {
      if (!video.related_generated_script_id) return setScript(null)
      const s = await GeneratedScripts.get(video.related_generated_script_id)
      if (!alive) return
      setScript(s)
      if (s) {
        const [av, an, de] = await Promise.all([
          s.avatar_id ? AvatarProfiles.get(s.avatar_id) : null,
          s.angle_id ? AngleLibrary.get(s.angle_id) : null,
          s.desire_id ? DesireLibrary.get(s.desire_id) : null,
        ])
        if (alive) setResearch({ avatar: av, angle: an, desire: de })
      }
    })()
    return () => { alive = false }
  }, [video.related_generated_script_id])

  if (!video.related_generated_script_id || !script) {
    return <EmptyState icon={FileText} title="Sin script vinculado" description="Vincula un script generado desde la pestaña Details o desde Script Builder." />
  }

  const save = (patch) => GeneratedScripts.update(script.id, patch).then(() => { setScript({ ...script, ...patch }); toast.success('Guardado') })

  return (
    <div className="space-y-4">
      <div className="rounded-xl bg-gradient-to-r from-indigo-500 to-purple-500 p-4 text-white">
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex-1 font-semibold min-w-[150px]">{script.title}</p>
          <StatusBadge status={script.status} className="bg-white/20 text-white" />
          <FormatBadge format={script.format} className="bg-white/20 text-white" />
        </div>
        <p className="mt-1 text-xs text-indigo-100">Batch: {fmtDate(script.created_date)}</p>
        <p className="mt-3 rounded-lg bg-white/15 p-3 text-sm font-medium leading-relaxed">🪝 {script.hook}</p>
      </div>

      {(research.avatar || research.angle || research.desire) && (
        <div className="grid gap-2 sm:grid-cols-3">
          {research.avatar && (
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
              <p className="text-[10px] font-bold uppercase text-blue-500">Avatar</p>
              <p className="text-sm font-medium text-blue-900">{research.avatar.nombre}</p>
              <p className="mt-0.5 text-xs text-blue-700 line-clamp-2">{research.avatar.descripcion}</p>
            </div>
          )}
          {research.angle && (
            <div className="rounded-lg border border-purple-200 bg-purple-50 p-3">
              <p className="text-[10px] font-bold uppercase text-purple-500">Angle</p>
              <p className="text-sm font-medium text-purple-900">{research.angle.nombre}</p>
              <p className="mt-0.5 text-xs text-purple-700 line-clamp-2">{research.angle.promise}</p>
            </div>
          )}
          {research.desire && (
            <div className="rounded-lg border border-pink-200 bg-pink-50 p-3">
              <p className="text-[10px] font-bold uppercase text-pink-500">Desire</p>
              <p className="text-sm font-medium text-pink-900">{research.desire.nombre}</p>
              <p className="mt-0.5 text-xs text-pink-700 line-clamp-2">{research.desire.core_desire}</p>
            </div>
          )}
        </div>
      )}

      <div>
        <div className="mb-1 flex items-center justify-between">
          <Label>Full Script</Label>
          <Button size="sm" variant="ghost" onClick={() => { navigator.clipboard.writeText(script.full_script || ''); toast.success('Copiado') }}><Copy className="h-3.5 w-3.5" /> Copy</Button>
        </div>
        <AutoSaveTextarea rows={15} className="font-mono text-xs" value={script.full_script} onSave={(v) => save({ full_script: v })} disabled={readOnly} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>On-Screen Text (uno por línea)</Label>
          <AutoSaveTextarea rows={5} className="mt-1 text-xs" value={(script.on_screen_text || []).join('\n')} onSave={(v) => save({ on_screen_text: v.split('\n').filter(Boolean) })} disabled={readOnly} />
        </div>
        <div>
          <Label>Shotlist (uno por línea)</Label>
          <AutoSaveTextarea rows={5} className="mt-1 text-xs" value={(script.shotlist || []).join('\n')} onSave={(v) => save({ shotlist: v.split('\n').filter(Boolean) })} disabled={readOnly} />
        </div>
      </div>

      <div>
        <Label>CTA</Label>
        <AutoSaveInput className="mt-1" value={script.cta} onSave={(v) => save({ cta: v })} disabled={readOnly} />
      </div>
    </div>
  )
}

function DetailsTabContent({ video, editors, readOnly }) {
  const { data: inspirations } = useEntityList(InspirationAds, { staleTime: 300_000 })
  const inspiration = (inspirations || []).find((i) => i.id === video.inspiration_video_id)
  const { currentUser } = useAuth()

  const save = async (patch, msg = 'Guardado') => {
    await VideoAssets.update(video.id, patch)
    toast.success(msg)
  }

  const saveDriveUrl = async (url) => {
    const fileId = extractDriveFileId(url)
    await save({ drive_file_url: url || null, drive_file_id: fileId, has_video_file: !!fileId || !!video.video_file_uri }, fileId ? 'Drive URL guardada (fileId detectado)' : 'Guardado')
  }

  const changeStatus = async (status) => {
    await VideoAssets.update(video.id, { status })
    notifyVideoUpdate({ video, newStatus: status, byName: currentUser?.full_name })
    toast.success(`Status → ${status}`)
  }

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div><Label>Título</Label><AutoSaveInput className="mt-1" value={video.title} onSave={(v) => save({ title: v })} disabled={readOnly} /></div>
        <div><Label>Product</Label><AutoSaveInput className="mt-1" value={video.product} onSave={(v) => save({ product: v })} disabled={readOnly} /></div>
        <div>
          <Label>Format</Label>
          <Select value={video.format || ''} onValueChange={(v) => save({ format: v })} disabled={readOnly}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Formato" /></SelectTrigger>
            <SelectContent>{FORMATS.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}</SelectContent>
          </Select>
        </div>
        <div>
          <Label>Assigned Editor</Label>
          <Select value={video.assigned_editor_user_id || 'none'} onValueChange={(v) => save({ assigned_editor_user_id: v === 'none' ? null : v })} disabled={readOnly}>
            <SelectTrigger className="mt-1"><SelectValue placeholder="Sin asignar" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sin asignar</SelectItem>
              {editors.map((e) => <SelectItem key={e.user_id} value={e.user_id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div><Label>Google Drive URL</Label><AutoSaveInput className="mt-1" value={video.drive_file_url} onSave={saveDriveUrl} placeholder="https://drive.google.com/file/d/…" disabled={readOnly} /></div>

      <div>
        <Label>Video de Inspiración</Label>
        <Select value={video.inspiration_video_id || 'none'} onValueChange={(v) => save({ inspiration_video_id: v === 'none' ? null : v })} disabled={readOnly}>
          <SelectTrigger className="mt-1"><SelectValue placeholder="Ninguno" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="none">Ninguno</SelectItem>
            {(inspirations || []).map((i) => <SelectItem key={i.id} value={i.id}>{i.brand} — {i.title}</SelectItem>)}
          </SelectContent>
        </Select>
        {inspiration && (
          <div className="mt-2 rounded-lg border border-slate-200 bg-slate-50 p-3">
            <p className="text-sm font-medium text-slate-800">{inspiration.title}</p>
            <p className="text-xs text-slate-500">{inspiration.brand} · {inspiration.platform}</p>
            {inspiration.drive_link && extractDriveFileId(inspiration.drive_link) ? (
              <iframe src={`https://drive.google.com/file/d/${extractDriveFileId(inspiration.drive_link)}/preview`} className="mt-2 aspect-video w-full rounded-lg" sandbox="allow-same-origin allow-scripts allow-popups allow-forms" title="Inspiración" />
            ) : inspiration.thumbnail_url ? (
              <img src={inspiration.thumbnail_url} alt="" className="mt-2 aspect-video w-full rounded-lg object-cover" />
            ) : null}
            {inspiration.notes && <p className="mt-2 text-xs text-slate-600">{inspiration.notes}</p>}
          </div>
        )}
      </div>

      <div><Label>Notas</Label><AutoSaveTextarea rows={3} className="mt-1" value={video.notes} onSave={(v) => save({ notes: v })} disabled={readOnly} /></div>

      <div>
        <Label>Update Status</Label>
        <Select value={video.status} onValueChange={changeStatus} disabled={readOnly}>
          <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
          <SelectContent>
            {PHASES.map((phase) => (
              <SelectGroup key={phase.id}>
                <SelectLabel>{phase.title}</SelectLabel>
                {KANBAN_COLUMNS.filter((c) => c.phase === phase.id).map((c) => (
                  <SelectItem key={c.id} value={c.id}>{c.title}</SelectItem>
                ))}
              </SelectGroup>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  )
}

const SEVERITY_STYLES = {
  BLOCKING: 'border-red-200 bg-red-50',
  IMPORTANT: 'border-amber-200 bg-amber-50',
  INFO: 'border-slate-200 bg-white',
}
const SEVERITY_BADGE = {
  BLOCKING: 'bg-red-100 text-red-700',
  IMPORTANT: 'bg-amber-100 text-amber-700',
  INFO: 'bg-slate-100 text-slate-600',
}

function AnnotationsTab({ video, readOnly }) {
  const { currentUser } = useAuth()
  const { data: annotations } = useEntityList(VideoAnnotations, { filter: { video_asset_id: video.id }, sort: 'timestamp_sec' })
  const [form, setForm] = useState({ timestamp_sec: '', severity: 'INFO', text: '' })
  const [saving, setSaving] = useState(false)

  const add = async () => {
    if (!form.text.trim()) return toast.error('Escribe la anotación')
    setSaving(true)
    try {
      const annotation = await VideoAnnotations.create({
        video_asset_id: video.id, timestamp_sec: Number(form.timestamp_sec) || 0,
        severity: form.severity, text: form.text, author_name: currentUser?.full_name || 'Anon',
      })
      notifyVideoAnnotation({ video, annotation })
      setForm({ timestamp_sec: '', severity: 'INFO', text: '' })
      toast.success('Anotación añadida')
    } finally { setSaving(false) }
  }

  return (
    <div className="space-y-4">
      {!readOnly && (
        <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 space-y-2.5">
          <div className="grid grid-cols-2 gap-2.5">
            <div>
              <Label className="text-xs">Timestamp (seg)</Label>
              <Input type="number" min="0" className="mt-1" value={form.timestamp_sec} onChange={(e) => setForm({ ...form, timestamp_sec: e.target.value })} placeholder="12" />
            </div>
            <div>
              <Label className="text-xs">Severidad</Label>
              <Select value={form.severity} onValueChange={(v) => setForm({ ...form, severity: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="INFO">INFO</SelectItem>
                  <SelectItem value="IMPORTANT">IMPORTANT</SelectItem>
                  <SelectItem value="BLOCKING">BLOCKING</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <Textarea rows={2} value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} placeholder="Qué hay que cambiar…" />
          <Button size="sm" onClick={add} disabled={saving}><Plus className="h-3.5 w-3.5" /> Add Annotation</Button>
        </div>
      )}
      <div className="space-y-2">
        {(annotations || []).length === 0 && <p className="py-4 text-center text-sm text-slate-400">Sin anotaciones</p>}
        {(annotations || []).map((a) => (
          <div key={a.id} className={`rounded-lg border p-3 ${SEVERITY_STYLES[a.severity] || SEVERITY_STYLES.INFO}`}>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded bg-slate-800 px-1.5 py-0.5 font-mono text-[10px] text-white">{a.timestamp_sec}s</span>
              <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold ${SEVERITY_BADGE[a.severity]}`}>
                {a.severity === 'BLOCKING' && <AlertCircle className="h-3 w-3" />}{a.severity}
              </span>
              <span className="ml-auto text-[10px] text-slate-400">{a.author_name} · {fmtDate(a.created_date)}</span>
            </div>
            <p className="mt-1.5 text-sm text-slate-700">{a.text}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function VideoDetailModal({ videoId, onClose, editors, readOnly }) {
  const [video, setVideo] = useState(null)

  // Real-time: subscribe while modal open
  useEffect(() => {
    let alive = true
    const load = () => VideoAssets.get(videoId).then((v) => alive && setVideo(v))
    load()
    const unsub = VideoAssets.subscribe(load)
    return () => { alive = false; unsub() }
  }, [videoId])

  const del = async () => {
    if (!confirm(`¿Eliminar "${video?.title}"? Esta acción no se puede deshacer.`)) return
    await VideoAssets.delete(videoId)
    toast.success('Video eliminado')
    onClose()
  }

  if (!video) return null

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <div className="flex flex-wrap items-center gap-2 pr-8">
            <DialogTitle className="flex-1 min-w-[200px]">{video.title}</DialogTitle>
            <StatusBadge status={video.status} />
            {!readOnly && (
              <Button size="icon" variant="ghost" className="text-red-500 hover:bg-red-50 hover:text-red-600" onClick={del}>
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </DialogHeader>

        <VideoPlayer video={video} />

        <Tabs defaultValue="script" className="mt-2">
          <TabsList className="w-full justify-start">
            <TabsTrigger value="script"><FileText className="h-3.5 w-3.5" /> Script</TabsTrigger>
            <TabsTrigger value="details"><Info className="h-3.5 w-3.5" /> Details</TabsTrigger>
            <TabsTrigger value="annotations"><AlertCircle className="h-3.5 w-3.5" /> Annotations</TabsTrigger>
          </TabsList>
          <TabsContent value="script"><ScriptTabContent video={video} readOnly={readOnly} /></TabsContent>
          <TabsContent value="details"><DetailsTabContent video={video} editors={editors} readOnly={readOnly} /></TabsContent>
          <TabsContent value="annotations"><AnnotationsTab video={video} readOnly={readOnly} /></TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
