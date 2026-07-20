// Kanban de producción (tarjetas = briefs asignados u órdenes manuales).
// Drag & drop persiste en Supabase; con Realtime, dos navegadores se ven en vivo.
// Absorbe MyWork/Tasks/EditorQueue: filtro "solo mis tarjetas" + due dates.
import { useMemo, useState } from 'react'
import { DragDropContext, Droppable, Draggable } from '@hello-pangea/dnd'
import { useAuth } from '@/context/AuthContext'
import { useEntityList } from '@/hooks/useData'
import { Cards, Annotations, Profiles, Briefs } from '@/api/entities'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Switch } from '@/components/ui/switch'
import { UserAvatar } from '@/components/shared/badges'
import { EmptyState, ErrorState } from '@/components/shared/misc'
import { Clapperboard, Plus, Trash2, ExternalLink, MessageSquare } from 'lucide-react'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn, timeAgo } from '@/lib/utils'
import { extractAdCode } from '@/lib/attribution'
import { toast } from 'sonner'
import { useBrand } from '@/context/BrandContext'

const COLUMNS = [
  { key: 'SCRIPT_DRAFT', title: '📝 Guión', color: 'border-slate-300', section: 'pre' },
  { key: 'TODO', title: '🎯 Por hacer', color: 'border-blue-300', section: 'production' },
  { key: 'IN_PROGRESS', title: '⚙️ En curso', color: 'border-amber-300', section: 'production' },
  { key: 'REVIEW', title: '✅ Revisión', color: 'border-purple-300', section: 'post' },
  { key: 'APPROVED', title: '🎉 Aprobado', color: 'border-emerald-300', section: 'post' },
  { key: 'PUBLISHED', title: '📦 Publicado', color: 'border-indigo-300', section: 'archive' },
  { key: 'ARCHIVED', title: '📁 Archivado', color: 'border-slate-400', section: 'archive' },
]

const SEVERITY = {
  BLOCKING: { cls: 'bg-red-50 border-red-200 text-red-800', label: '🛑 Blocker' },
  IMPORTANT: { cls: 'bg-amber-50 border-amber-200 text-amber-800', label: '⚠️ Importante' },
  INFO: { cls: 'bg-slate-50 border-slate-200 text-slate-700', label: 'ℹ️ Nota' },
}

function approvalPatch(card, newStatus) {
  const patch = { status: newStatus }
  if (['APPROVED', 'PUBLISHED'].includes(newStatus)) {
    if (!card.approved_at) patch.approved_at = new Date().toISOString()
    if (!card.matched_ad_code) {
      const code = extractAdCode(card.launched_ad_name || card.title)
      if (code) patch.matched_ad_code = code
    }
  }
  return patch
}

function extractDriveId(url) {
  if (!url) return null
  const m = String(url).match(/\/d\/([^/?]+)|[?&]id=([^&]+)/)
  return m ? (m[1] || m[2]) : null
}

function VideoPlayer({ url }) {
  if (!url) {
    return (
      <div className="rounded-lg bg-slate-100 aspect-video flex items-center justify-center text-slate-400 text-sm">
        Sin vídeo — añade el enlace de Drive en la pestaña Detalles
      </div>
    )
  }
  const driveId = extractDriveId(url)
  if (driveId) {
    return (
      <div className="rounded-lg overflow-hidden bg-black aspect-video relative">
        <iframe src={`https://drive.google.com/file/d/${driveId}/preview`}
                allow="autoplay" className="absolute inset-0 h-full w-full" />
        <a href={url} target="_blank" rel="noreferrer"
           className="absolute top-2 right-2 bg-black/50 text-white rounded p-1 hover:bg-black/70">
          <ExternalLink className="h-4 w-4" />
        </a>
      </div>
    )
  }
  if (/\.(mp4|webm|mov)(\?|$)/i.test(url)) {
    return <video src={url} controls className="w-full aspect-video rounded-lg bg-black" />
  }
  return (
    <div className="rounded-lg bg-slate-100 aspect-video flex flex-col items-center justify-center gap-2 text-sm">
      <p className="text-slate-500">URL no previsualizable</p>
      <a href={url} target="_blank" rel="noreferrer" className="text-indigo-600 hover:underline flex items-center gap-1">
        Abrir en pestaña nueva <ExternalLink className="h-3 w-3" />
      </a>
    </div>
  )
}

function ScriptTab({ brief }) {
  const { brand } = useBrand()
  if (!brief) {
    return (
      <div className="py-10 text-center text-slate-400">
        <MessageSquare className="h-8 w-8 mx-auto mb-2 text-slate-300" />
        <p className="text-sm">Sin brief vinculado — tarjeta creada manualmente o importada.</p>
      </div>
    )
  }
  const p = brief.payload || {}
  return (
    <div className="space-y-3 text-sm">
      {brief.kind === 'image' ? (
        <>
          {brief.suggested_ad_name && (
            <div className="rounded-lg bg-slate-900 text-white text-xs font-mono p-2 text-center">
              {brief.suggested_ad_name}
            </div>
          )}
          {p.dna_preserved && (
            <p><b>🧬 DNA:</b> {Object.entries(p.dna_preserved).map(([k, v]) => `${k}: ${v}`).join(' · ')}</p>
          )}
          {p.execution_change && <p><b>🎨 Cambio:</b> {p.execution_change}</p>}
          {p.prompt_en && (
            <div>
              <p className="text-xs font-bold text-slate-500 uppercase mb-1">Prompt {brand.imageTool}</p>
              <pre className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-[11px] whitespace-pre-wrap max-h-60 overflow-y-auto">{p.prompt_en}</pre>
            </div>
          )}
        </>
      ) : (
        <>
          {p.audience && <p><b>Audiencia:</b> {p.audience}</p>}
          {p.hypothesis && <p className="text-slate-600">🔬 {p.hypothesis}</p>}
          {p.structure && <p><b>Estructura:</b> {p.structure}{p.framing ? ` · ${p.framing}` : ''}</p>}
          {(p.hooks || []).map((h, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-3 bg-slate-50">
              <p className="font-bold text-red-600 text-xs">{h.label} <span className="text-slate-400 font-normal">{h.subtitle}</span></p>
              {h.banner && <p className="text-indigo-700 text-xs italic mt-1">BANNER: {h.banner}</p>}
              {(h.rows || []).slice(0, 3).map((r, j) => (
                <div key={j} className="mt-2 text-xs border-t border-slate-100 pt-2 space-y-0.5">
                  {r.vo && <p><b>🎙</b> {r.vo}</p>}
                  {r.clip && <p className="text-slate-500"><b>🎬</b> {r.clip}</p>}
                </div>
              ))}
            </div>
          ))}
          {(p.sections || []).map((s, i) => (
            <div key={i} className="rounded-lg border border-slate-200 p-3">
              <p className="font-bold text-xs bg-slate-900 text-white rounded px-2 py-1 inline-block">{s.title}</p>
              {(s.rows || []).slice(0, 3).map((r, j) => (
                <div key={j} className="mt-2 text-xs border-t border-slate-100 pt-2 space-y-0.5">
                  {r.vo && <p><b>🎙</b> {r.vo}</p>}
                  {r.clip && <p className="text-slate-500"><b>🎬</b> {r.clip}</p>}
                </div>
              ))}
            </div>
          ))}
        </>
      )}
    </div>
  )
}

function DetailsTab({ card, editors, canDelete, onSave, onDelete }) {
  const { brand } = useBrand()
  // assigned_editor (uuid) y due_date (date): null, nunca '' — Postgres rechaza
  // '' en columnas date/uuid ("invalid input syntax") y el guardado fallaría.
  const [state, setState] = useState({
    title: card.title || '', drive_url: card.drive_url || '',
    launched_ad_name: card.launched_ad_name || '', format: card.format || '',
    product: card.product || brand.productName, assigned_editor: card.assigned_editor || null,
    notes: card.notes || '', due_date: card.due_date || null, status: card.status,
  })
  const set = (k, v) => setState((s) => ({ ...s, [k]: v }))
  return (
    <div className="space-y-3 text-sm">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="text-xs font-medium text-slate-500">Título</label>
          <Input value={state.title} onChange={(e) => set('title', e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">Producto</label>
          <Input value={state.product} onChange={(e) => set('product', e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">Formato</label>
          <Select value={state.format || 'none'} onValueChange={(v) => set('format', v === 'none' ? '' : v)}>
            <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">—</SelectItem>
              {['UGC', 'VSL', 'TESTIMONIAL', 'POV', 'AUTHORITY', 'PROBLEM_SOLUTION',
                'vsl', 'ai_animation', 'podcast', 'yapper', 'native_ugc', 'creator_testimonial',
                'creator_unboxing', 'offer_static', 'fomo_static'].map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">Editor</label>
          <Select value={state.assigned_editor || 'none'} onValueChange={(v) => set('assigned_editor', v === 'none' ? null : v)}>
            <SelectTrigger><SelectValue placeholder="Sin asignar" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">Sin asignar</SelectItem>
              {editors.map((e) => <SelectItem key={e.user_id} value={e.user_id}>{e.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-slate-500">Google Drive URL</label>
          <Input value={state.drive_url} onChange={(e) => set('drive_url', e.target.value)}
                 placeholder="https://drive.google.com/file/d/…/view" />
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-slate-500">Nombre del ad al lanzarlo (con QB)</label>
          <Input value={state.launched_ad_name} onChange={(e) => set('launched_ad_name', e.target.value)} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">Fecha límite</label>
          <Input type="date" value={state.due_date || ''} onChange={(e) => set('due_date', e.target.value || null)} />
        </div>
        <div>
          <label className="text-xs font-medium text-slate-500">Estado</label>
          <Select value={state.status} onValueChange={(v) => set('status', v)}>
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              {COLUMNS.map((c) => <SelectItem key={c.key} value={c.key}>{c.title}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="sm:col-span-2">
          <label className="text-xs font-medium text-slate-500">Notas</label>
          <Textarea rows={3} value={state.notes} onChange={(e) => set('notes', e.target.value)} />
        </div>
      </div>
      <div className="flex gap-2 pt-2">
        <Button onClick={() => onSave(state)} className="flex-1">Guardar</Button>
        {canDelete && (
          <Button variant="outline" onClick={onDelete}
                  className="text-red-600 border-red-200 hover:bg-red-50">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
      </div>
    </div>
  )
}

function AnnotationsTab({ cardId }) {
  const { user, effectiveRole } = useAuth()
  const isMgmt = ['ADMIN', 'MANAGER'].includes(effectiveRole)
  const { data: annotations, refetch } = useEntityList(Annotations, { filter: { card_id: cardId }, sort: '-created_at' })
  const [text, setText] = useState('')
  const [ts, setTs] = useState('')
  const [severity, setSeverity] = useState('INFO')

  const add = async () => {
    if (!text.trim()) return
    await Annotations.create({
      card_id: cardId, text: text.trim(), author: user.id, severity,
      timestamp_sec: ts ? parseFloat(ts) : null,
    })
    setText(''); setTs(''); setSeverity('INFO'); refetch()
  }
  const remove = async (a) => {
    if (!confirm('¿Borrar comentario?')) return
    try { await Annotations.delete(a.id); refetch() }
    catch (e) { toast.error(e.message) }
  }

  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-lg border border-slate-200 p-3 space-y-2">
        <div className="flex gap-2">
          <Input value={ts} onChange={(e) => setTs(e.target.value)} type="number"
                 step="0.5" placeholder="⏱ seg" className="w-20" />
          <Select value={severity} onValueChange={setSeverity}>
            <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
            <SelectContent>
              {Object.entries(SEVERITY).map(([k, v]) => <SelectItem key={k} value={k}>{v.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <Textarea rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder="Comentario o feedback…" />
        <Button size="sm" onClick={add} disabled={!text.trim()}>💬 Añadir</Button>
      </div>
      {!annotations?.length && (
        <p className="text-center text-slate-400 text-xs py-6">Sin comentarios todavía</p>
      )}
      {(annotations || []).map((a) => {
        const s = SEVERITY[a.severity] || SEVERITY.INFO
        const canDelete = a.author === user?.id || isMgmt
        return (
          <div key={a.id} className={cn('rounded-lg border px-3 py-2', s.cls)}>
            <div className="flex items-center gap-2 mb-1">
              {a.timestamp_sec != null && <Badge variant="outline" className="text-[10px]">⏱ {a.timestamp_sec}s</Badge>}
              <span className="text-[10px] font-bold">{s.label}</span>
              <span className="ml-auto text-[10px] text-slate-500">{timeAgo(a.created_at)}</span>
              {canDelete && (
                <button onClick={() => remove(a)} className="text-slate-400 hover:text-red-600">
                  <Trash2 className="h-3 w-3" />
                </button>
              )}
            </div>
            <p className="text-sm">{a.text}</p>
          </div>
        )
      })}
    </div>
  )
}

function CardDetail({ card, onClose, editors }) {
  const { user, effectiveRole } = useAuth()
  const { data: briefs } = useEntityList(Briefs, {
    filter: card.brief_tracking_code ? { tracking_code: card.brief_tracking_code } : undefined,
    enabled: !!card.brief_tracking_code,
  })
  const brief = briefs?.[0]
  const canDelete = effectiveRole === 'ADMIN'
    || (card.assigned_editor === user?.id && card.status !== 'PUBLISHED')

  const save = async (rawPatch) => {
    try {
      // '' → null en columnas date/uuid (Postgres rechaza '' ahí)
      const patch = {
        ...rawPatch,
        assigned_editor: rawPatch.assigned_editor || null,
        due_date: rawPatch.due_date || null,
      }
      // Si el estado pasa a aprobado/publicado, casa la tarjeta con su ad
      const extra = approvalPatch({ ...card, ...patch }, patch.status)
      await Cards.update(card.id, { ...patch, ...extra })
      toast.success('Guardado')
      onClose()
    } catch (e) {
      toast.error(`No se pudo: ${e.message}`)
    }
  }
  const remove = async () => {
    if (!confirm('¿Borrar tarjeta y todos sus comentarios?')) return
    try {
      await Cards.delete(card.id)
      toast.success('Tarjeta borrada')
      onClose()
    } catch (e) {
      toast.error(`No se pudo: ${e.message}`)
    }
  }

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {card.title}
            {card.brief_tracking_code && (
              <code className="text-[10px] font-mono text-slate-400">{card.brief_tracking_code}</code>
            )}
          </DialogTitle>
        </DialogHeader>
        <VideoPlayer url={card.drive_url} />
        <Tabs defaultValue={brief ? 'script' : 'details'} className="mt-3">
          <TabsList className="grid grid-cols-3">
            <TabsTrigger value="script">📝 Script</TabsTrigger>
            <TabsTrigger value="details">📋 Detalles</TabsTrigger>
            <TabsTrigger value="annotations">💬 Comentarios</TabsTrigger>
          </TabsList>
          <TabsContent value="script" className="mt-3">
            <ScriptTab brief={brief} />
          </TabsContent>
          <TabsContent value="details" className="mt-3">
            <DetailsTab card={card} editors={editors || []}
                        canDelete={canDelete} onSave={save} onDelete={remove} />
          </TabsContent>
          <TabsContent value="annotations" className="mt-3">
            <AnnotationsTab cardId={card.id} />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

export default function VideoOps() {
  const { user, effectiveRole } = useAuth()
  const canManage = ['ADMIN', 'MANAGER'].includes(effectiveRole)
  const { data: cards, error, refetch } = useEntityList(Cards, { sort: '-created_at', limit: 500, staleTime: 10_000 })
  const { data: profiles } = useEntityList(Profiles)
  const [onlyMine, setOnlyMine] = useState(effectiveRole === 'EDITOR')
  const [open, setOpen] = useState(null)
  const [creating, setCreating] = useState(false)
  const [newTitle, setNewTitle] = useState('')

  const nameOf = (uid) => (profiles || []).find((p) => p.user_id === uid)?.name || ''
  const visible = useMemo(() => (cards || []).filter((c) =>
    !onlyMine || c.assigned_editor === user?.id), [cards, onlyMine, user])

  const onDragEnd = async (result) => {
    const { destination, draggableId } = result
    if (!destination) return
    const card = (cards || []).find((c) => c.id === draggableId)
    if (!card || card.status === destination.droppableId) return
    try {
      await Cards.update(card.id, approvalPatch(card, destination.droppableId))
      if (destination.droppableId === 'APPROVED') {
        const code = card.matched_ad_code || extractAdCode(card.launched_ad_name || card.title)
        if (code) toast.success(`Aprobada — sincronizada con el ad ${code} en Performance`)
      }
    } catch (e) {
      toast.error(`No se pudo mover: ${e.message}`)
    }
    refetch()
  }

  const createCard = async () => {
    if (!newTitle.trim()) return
    try {
      await Cards.create({ title: newTitle.trim(), status: 'TODO' })
      setNewTitle(''); setCreating(false); refetch()
    } catch (e) {
      toast.error(`No se pudo crear la tarjeta: ${e.message}`)
    }
  }

  if (error) return <ErrorState error={error} />
  if (!cards) return null

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-slate-600">
          <Switch checked={onlyMine} onCheckedChange={setOnlyMine} /> Solo mis tarjetas
        </label>
        {canManage && (
          <Button variant="outline" size="sm" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> Tarjeta manual
          </Button>
        )}
      </div>

      {visible.length === 0 && (
        <EmptyState icon={Clapperboard} title="Sin tarjetas"
          description="Asigna briefs desde la página Briefs, o crea una tarjeta manual." />
      )}

      <DragDropContext onDragEnd={onDragEnd}>
        <div className="grid gap-3 md:grid-cols-3 xl:grid-cols-7">
          {COLUMNS.map((col) => (
            <Droppable droppableId={col.key} key={col.key}>
              {(provided, snapshot) => (
                <div ref={provided.innerRef} {...provided.droppableProps}
                     className={cn('rounded-xl border-t-4 bg-white/60 p-2 min-h-[240px]',
                       col.color, snapshot.isDraggingOver && 'bg-indigo-50/60')}>
                  <p className="px-1 pb-2 text-xs font-bold text-slate-500 uppercase">
                    {col.title} <span className="text-slate-300">{visible.filter((c) => c.status === col.key).length}</span>
                  </p>
                  {visible.filter((c) => c.status === col.key).map((c, i) => (
                    <Draggable draggableId={c.id} index={i} key={c.id}>
                      {(prov, snap) => (
                        <div ref={prov.innerRef} {...prov.draggableProps} {...prov.dragHandleProps}
                             onClick={() => setOpen(c)}
                             className={cn('mb-2 cursor-pointer rounded-lg border border-slate-200 bg-white p-3 shadow-sm hover:shadow',
                               snap.isDragging && 'rotate-1 shadow-lg')}>
                          <p className="text-sm font-medium text-slate-800 leading-snug">{c.title}</p>
                          <div className="mt-2 flex items-center gap-2">
                            {c.brief_tracking_code && <Badge variant="outline" className="text-[9px]">{c.brief_tracking_code}</Badge>}
                            {c.assigned_editor && (
                              <span className="ml-auto flex items-center gap-1 text-[10px] text-slate-500">
                                <UserAvatar name={nameOf(c.assigned_editor)} size="sm" />{nameOf(c.assigned_editor)}
                              </span>
                            )}
                          </div>
                        </div>
                      )}
                    </Draggable>
                  ))}
                  {provided.placeholder}
                </div>
              )}
            </Droppable>
          ))}
        </div>
      </DragDropContext>

      {open && <CardDetail card={open} onClose={() => { setOpen(null); refetch() }}
                            editors={profiles || []} />}

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent className="max-w-sm">
          <DialogHeader><DialogTitle>Nueva tarjeta</DialogTitle></DialogHeader>
          <Input value={newTitle} onChange={(e) => setNewTitle(e.target.value)} placeholder="Título"
                 onKeyDown={(e) => e.key === 'Enter' && createCard()} autoFocus />
          <Button onClick={createCard}>Crear</Button>
        </DialogContent>
      </Dialog>
    </div>
  )
}
