import { useEffect, useState } from 'react'
import { Loader2, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { AvatarProfiles, AngleLibrary, DesireLibrary, ProblemLibrary } from '@/api/entities'
import { generateScript } from '@/api/functions'
import { useEntityList } from '@/hooks/useData'
import { useAuth } from '@/context/AuthContext'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { AvatarCombobox, MultiSelectTags, InlineCreateForm, dedupResearch, HOOK_TYPES } from './researchInputs'
import { FORMATS_EXTENDED } from '@/features/videoops/constants'

const CONFIG_KEY = 'scriptGeneratorConfig'
const DEFAULT_CONFIG = { product: '', format: 'UGC', hook_type: 'QUESTION', avatar_id: null, angle_ids: [], desire_ids: [], problem_ids: [], quantity: 1, duration_sec: 35, instructions: '' }

export default function GenerateDialog({ open, onOpenChange }) {
  const { currentUser } = useAuth()
  const [config, setConfig] = useState(DEFAULT_CONFIG)
  const [creating, setCreating] = useState(null) // 'avatar' | 'angle' | 'desire'
  const [generating, setGenerating] = useState(false)

  const { data: avatars } = useEntityList(AvatarProfiles, { staleTime: 60_000 })
  const { data: angles } = useEntityList(AngleLibrary, { staleTime: 60_000 })
  const { data: desires } = useEntityList(DesireLibrary, { staleTime: 60_000 })
  const { data: problems } = useEntityList(ProblemLibrary, { staleTime: 60_000 })

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(CONFIG_KEY))
      if (saved) setConfig({ ...DEFAULT_CONFIG, ...saved })
    } catch {}
  }, [])

  const set = (patch) => {
    setConfig((c) => {
      const next = { ...c, ...patch }
      try { localStorage.setItem(CONFIG_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  const durationValid = config.duration_sec >= 15 && config.duration_sec <= 1200

  const generate = async () => {
    if (!config.product.trim()) return toast.error('El producto es obligatorio')
    if (!durationValid) return toast.error('Duración entre 15 y 1200 segundos')
    setGenerating(true)
    try {
      const res = await generateScript({ ...config, created_by_user_id: currentUser?.id })
      toast.success(`${res.count} script${res.count > 1 ? 's' : ''} generado${res.count > 1 ? 's' : ''} ✨`)
      onOpenChange(false)
    } catch (e) {
      toast.error('Error generando: ' + e.message)
    } finally { setGenerating(false) }
  }

  const createInline = async (kind, form) => {
    if (kind === 'avatar') {
      const rec = await AvatarProfiles.create({ nombre: form.nombre, descripcion: form.descripcion || '', is_active: true })
      set({ avatar_id: rec.id })
    } else if (kind === 'angle') {
      const rec = await AngleLibrary.create({ nombre: form.nombre, promise: form.promise || '' })
      set({ angle_ids: [...config.angle_ids, rec.id] })
    } else if (kind === 'desire') {
      const rec = await DesireLibrary.create({ nombre: form.nombre, core_desire: form.core_desire || '' })
      set({ desire_ids: [...config.desire_ids, rec.id] })
    }
    setCreating(null)
    toast.success('Creado y seleccionado')
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Sparkles className="h-5 w-5 text-indigo-500" /> Generate Scripts with AI</DialogTitle>
          <DialogDescription>Config persistida automáticamente. El primer elemento de cada multi-select es el principal ⭐.</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div><Label>Product *</Label><Input className="mt-1" value={config.product} onChange={(e) => set({ product: e.target.value })} placeholder="Quies Sleep" /></div>
            <div>
              <Label>Format</Label>
              <Select value={config.format} onValueChange={(v) => set({ format: v })}>
                <SelectTrigger className="mt-1"><SelectValue /></SelectTrigger>
                <SelectContent>{FORMATS_EXTENDED.map((f) => <SelectItem key={f} value={f}>{f.replace(/_/g, '-')}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>

          <div>
            <Label>Tipo de Hook</Label>
            <div className="mt-1.5 grid grid-cols-2 gap-1.5 sm:grid-cols-5">
              {HOOK_TYPES.map((h) => (
                <Tooltip key={h.value}>
                  <TooltipTrigger asChild>
                    <button
                      onClick={() => set({ hook_type: h.value })}
                      className={`rounded-lg border px-2 py-1.5 text-xs font-medium transition-colors ${config.hook_type === h.value ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300'}`}
                    >
                      {h.label}
                    </button>
                  </TooltipTrigger>
                  <TooltipContent>Recomendado para: {h.formats}</TooltipContent>
                </Tooltip>
              ))}
            </div>
          </div>

          <div>
            <Label>Avatar</Label>
            <div className="mt-1">
              <AvatarCombobox items={dedupResearch(avatars, 'avatar_id')} value={config.avatar_id} onChange={(v) => set({ avatar_id: v })} onCreateNew={() => setCreating('avatar')} />
            </div>
            {creating === 'avatar' && (
              <div className="mt-2">
                <InlineCreateForm title="Nuevo Avatar" bg="bg-blue-50" fields={[{ key: 'nombre', label: 'Nombre', required: true }, { key: 'descripcion', label: 'Descripción' }]} onSubmit={(f) => createInline('avatar', f)} onCancel={() => setCreating(null)} />
              </div>
            )}
          </div>

          <div>
            <Label>Angles</Label>
            <div className="mt-1">
              <MultiSelectTags items={dedupResearch(angles, 'angle_id')} values={config.angle_ids} onChange={(v) => set({ angle_ids: v })} kind="angle" placeholder="Añadir ángulos…" onCreateNew={() => setCreating('angle')} />
            </div>
            {creating === 'angle' && (
              <div className="mt-2">
                <InlineCreateForm title="Nuevo Ángulo" bg="bg-purple-50" fields={[{ key: 'nombre', label: 'Nombre', required: true }, { key: 'promise', label: 'Promesa' }]} onSubmit={(f) => createInline('angle', f)} onCancel={() => setCreating(null)} />
              </div>
            )}
          </div>

          <div>
            <Label>Desires</Label>
            <div className="mt-1">
              <MultiSelectTags items={dedupResearch(desires, 'desire_id')} values={config.desire_ids} onChange={(v) => set({ desire_ids: v })} kind="desire" placeholder="Añadir deseos…" onCreateNew={() => setCreating('desire')} />
            </div>
            {creating === 'desire' && (
              <div className="mt-2">
                <InlineCreateForm title="Nuevo Deseo" bg="bg-green-50" fields={[{ key: 'nombre', label: 'Nombre', required: true }, { key: 'core_desire', label: 'Deseo core' }]} onSubmit={(f) => createInline('desire', f)} onCancel={() => setCreating(null)} />
              </div>
            )}
          </div>

          <div>
            <Label>Problems</Label>
            <div className="mt-1">
              <MultiSelectTags items={dedupResearch(problems, 'problem_id')} values={config.problem_ids} onChange={(v) => set({ problem_ids: v })} kind="problem" placeholder="Añadir problemas…" />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Quantity</Label>
              <div className="mt-1.5 flex gap-1.5">
                {[1, 3, 5].map((q) => (
                  <button key={q} onClick={() => set({ quantity: q })} className={`flex-1 rounded-lg border py-1.5 text-sm font-medium ${config.quantity === q ? 'border-indigo-400 bg-indigo-50 text-indigo-700' : 'border-slate-200 bg-white text-slate-600'}`}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <Label>Duración (seg)</Label>
              <Input type="number" min={15} max={1200} className={`mt-1 ${!durationValid ? 'border-red-400 focus-visible:ring-red-400' : ''}`} value={config.duration_sec} onChange={(e) => set({ duration_sec: Number(e.target.value) })} />
              {!durationValid && <p className="mt-1 text-xs text-red-500">Entre 15 y 1200 segundos</p>}
            </div>
          </div>

          <div>
            <Label>Additional Instructions</Label>
            <Textarea rows={2} className="mt-1" value={config.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder="Tono, claims a evitar, referencias…" />
          </div>
        </div>
        <DialogFooter>
          <Button onClick={generate} disabled={generating}>
            {generating ? <Loader2 className="animate-spin" /> : <Sparkles />} {generating ? 'Generando…' : `Generar ${config.quantity} script${config.quantity > 1 ? 's' : ''}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
