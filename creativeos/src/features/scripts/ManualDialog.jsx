import { useState } from 'react'
import { Loader2, PenLine } from 'lucide-react'
import { toast } from 'sonner'
import { AvatarProfiles, AngleLibrary, DesireLibrary, ProblemLibrary, GeneratedScripts } from '@/api/entities'
import { useEntityList } from '@/hooks/useData'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { AvatarCombobox, MultiSelectTags, InlineCreateForm, dedupResearch, HOOK_TYPES } from './researchInputs'
import { FORMATS_EXTENDED } from '@/features/videoops/constants'

export default function ManualDialog({ open, onOpenChange }) {
  const [form, setForm] = useState({ title: '', product: '', format: 'UGC', hook_type: 'QUESTION', avatar_id: null, angle_ids: [], desire_ids: [], problem_ids: [], duration_sec: 35, hook: '', full_script: '', cta: '', broll: '' })
  const [creating, setCreating] = useState(null)
  const [saving, setSaving] = useState(false)
  const set = (patch) => setForm((f) => ({ ...f, ...patch }))

  const { data: avatars } = useEntityList(AvatarProfiles, { staleTime: 60_000 })
  const { data: angles } = useEntityList(AngleLibrary, { staleTime: 60_000 })
  const { data: desires } = useEntityList(DesireLibrary, { staleTime: 60_000 })
  const { data: problems } = useEntityList(ProblemLibrary, { staleTime: 60_000 })

  const createInline = async (kind, f) => {
    const map = {
      avatar: async () => { const r = await AvatarProfiles.create({ nombre: f.nombre, descripcion: f.descripcion || '', is_active: true }); set({ avatar_id: r.id }) },
      angle: async () => { const r = await AngleLibrary.create({ nombre: f.nombre, promise: f.promise || '' }); set({ angle_ids: [...form.angle_ids, r.id] }) },
      desire: async () => { const r = await DesireLibrary.create({ nombre: f.nombre, core_desire: f.core_desire || '' }); set({ desire_ids: [...form.desire_ids, r.id] }) },
      problem: async () => { const r = await ProblemLibrary.create({ nombre: f.nombre, description: f.description || '' }); set({ problem_ids: [...form.problem_ids, r.id] }) },
    }
    await map[kind]()
    setCreating(null)
    toast.success('Creado y seleccionado')
  }

  const save = async () => {
    if (!form.product.trim()) return toast.error('Producto obligatorio')
    if (!form.hook.trim()) return toast.error('Hook obligatorio')
    if (!form.full_script.trim()) return toast.error('Full script obligatorio')
    if (form.duration_sec < 15) return toast.error('Duración mínima 15 segundos')
    setSaving(true)
    try {
      await GeneratedScripts.create({
        title: form.title || `${form.format} ${form.product} (manual)`,
        product: form.product, format: form.format, hook_type: form.hook_type, status: 'DRAFT',
        duration_sec: form.duration_sec, language: 'es',
        avatar_id: form.avatar_id, angle_id: form.angle_ids[0] || null, desire_id: form.desire_ids[0] || null, problem_id: form.problem_ids[0] || null,
        hook: form.hook, full_script: form.full_script, cta: form.cta,
        on_screen_text: [], shotlist: [],
        broll_suggestions: form.broll.split('\n').filter(Boolean),
        editing_checklist: ['Subtítulos quemados', 'Hook on-screen <2s', 'CTA visual final'],
        based_on: { method: 'MANUAL' },
      })
      toast.success('Script creado')
      onOpenChange(false)
      setForm({ title: '', product: '', format: 'UGC', hook_type: 'QUESTION', avatar_id: null, angle_ids: [], desire_ids: [], problem_ids: [], duration_sec: 35, hook: '', full_script: '', cta: '', broll: '' })
    } finally { setSaving(false) }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader><DialogTitle className="flex items-center gap-2"><PenLine className="h-5 w-5 text-indigo-500" /> Create Manual Script</DialogTitle></DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Título (opcional)</Label><Input className="mt-1" value={form.title} onChange={(e) => set({ title: e.target.value })} /></div>
            <div><Label>Product *</Label><Input className="mt-1" value={form.product} onChange={(e) => set({ product: e.target.value })} /></div>
            <div>
              <Label>Format</Label>
              <Select value={form.format} onValueChange={(v) => set({ format: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{FORMATS_EXTENDED.map((f) => <SelectItem key={f} value={f}>{f.replace(/_/g, '-')}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label>Tipo de Hook</Label>
              <Select value={form.hook_type} onValueChange={(v) => set({ hook_type: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{HOOK_TYPES.map((h) => <SelectItem key={h.value} value={h.value}>{h.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div><Label>Hook *</Label><Textarea rows={2} className="mt-1" value={form.hook} onChange={(e) => set({ hook: e.target.value })} /></div>
          <div><Label>Full Script *</Label><Textarea rows={10} className="mt-1 font-mono text-xs" value={form.full_script} onChange={(e) => set({ full_script: e.target.value })} /></div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>CTA</Label><Input className="mt-1" value={form.cta} onChange={(e) => set({ cta: e.target.value })} /></div>
            <div><Label>Duración (seg)</Label><Input type="number" min={15} max={1200} className="mt-1" value={form.duration_sec} onChange={(e) => set({ duration_sec: Number(e.target.value) })} /></div>
          </div>
          <div><Label>B-Roll Suggestions (uno por línea)</Label><Textarea rows={3} className="mt-1 text-xs" value={form.broll} onChange={(e) => set({ broll: e.target.value })} /></div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Avatar</Label>
              <div className="mt-1"><AvatarCombobox items={dedupResearch(avatars, 'avatar_id')} value={form.avatar_id} onChange={(v) => set({ avatar_id: v })} onCreateNew={() => setCreating('avatar')} /></div>
            </div>
            <div>
              <Label>Angles</Label>
              <div className="mt-1"><MultiSelectTags items={dedupResearch(angles, 'angle_id')} values={form.angle_ids} onChange={(v) => set({ angle_ids: v })} kind="angle" placeholder="Añadir…" onCreateNew={() => setCreating('angle')} /></div>
            </div>
            <div>
              <Label>Desires</Label>
              <div className="mt-1"><MultiSelectTags items={dedupResearch(desires, 'desire_id')} values={form.desire_ids} onChange={(v) => set({ desire_ids: v })} kind="desire" placeholder="Añadir…" onCreateNew={() => setCreating('desire')} /></div>
            </div>
            <div>
              <Label>Problems</Label>
              <div className="mt-1"><MultiSelectTags items={dedupResearch(problems, 'problem_id')} values={form.problem_ids} onChange={(v) => set({ problem_ids: v })} kind="problem" placeholder="Añadir…" onCreateNew={() => setCreating('problem')} /></div>
            </div>
          </div>

          {creating === 'avatar' && <InlineCreateForm title="Nuevo Avatar" bg="bg-blue-50" fields={[{ key: 'nombre', label: 'Nombre', required: true }, { key: 'descripcion', label: 'Descripción' }]} onSubmit={(f) => createInline('avatar', f)} onCancel={() => setCreating(null)} />}
          {creating === 'angle' && <InlineCreateForm title="Nuevo Ángulo" bg="bg-purple-50" fields={[{ key: 'nombre', label: 'Nombre', required: true }, { key: 'promise', label: 'Promesa' }]} onSubmit={(f) => createInline('angle', f)} onCancel={() => setCreating(null)} />}
          {creating === 'desire' && <InlineCreateForm title="Nuevo Deseo" bg="bg-green-50" fields={[{ key: 'nombre', label: 'Nombre', required: true }, { key: 'core_desire', label: 'Deseo core' }]} onSubmit={(f) => createInline('desire', f)} onCancel={() => setCreating(null)} />}
          {creating === 'problem' && <InlineCreateForm title="Nuevo Problema" bg="bg-orange-50" fields={[{ key: 'nombre', label: 'Nombre', required: true }, { key: 'description', label: 'Descripción' }]} onSubmit={(f) => createInline('problem', f)} onCancel={() => setCreating(null)} />}
        </div>
        <DialogFooter>
          <Button onClick={save} disabled={saving}>{saving && <Loader2 className="animate-spin" />} Crear Script</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
